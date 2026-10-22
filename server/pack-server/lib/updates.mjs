/**
 * Предложенные обновления сборки: администратор (обычно Claude) выкладывает несколько файлов и/или убирает пути,
 * хост забирает их к себе (`tfc admin updates pull`), проверяет и одобряет — тогда из текущего снимка
 * с этими изменениями получается новый снимок. Одобрить может только другой администратор, не автор.
 *
 *   updates/<id>.json — { id, createdAt, author, note, base, files: [{ path, sha256, size, kind }], remove: [path],
 *                         status: pending | approved | rejected, decidedAt?, decidedBy?, snapshot?, reason? }
 * base — текущий снимок на момент предложения: по нему видно, не поменяли ли эти пути с тех пор.
 */
import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { classifyPath } from './paths.mjs';
import { HttpError, SHA256_RE, writeJsonAtomic } from './util.mjs';

const ID_RE = /^u\d{8}-\d{6}-[0-9a-f]{4}$/;
const MAX_FILES = 2000;

export async function openUpdates(dataDir, store) {
  const dir = path.join(dataDir, 'updates');
  await fsp.mkdir(dir, { recursive: true });
  const file = (id) => path.join(dir, `${id}.json`);

  async function get(id) {
    if (!ID_RE.test(id ?? '')) return null;
    try {
      return JSON.parse(await fsp.readFile(file(id), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  async function pending(id) {
    const u = await get(id);
    if (!u) throw new HttpError(404, 'Нет такого обновления');
    if (u.status !== 'pending')
      throw new HttpError(409, `Обновление уже ${u.status === 'approved' ? 'одобрено' : 'отклонено'}`);
    return u;
  }

  /** Пути обновления, которые в текущем снимке поменялись после base (и не совпадают с предложенным) */
  async function conflictsOf(u, current) {
    const base = await store.getSnapshot(u.base);
    if (!base || !current || base.id === current.id) return [];
    const was = new Map(base.files.map((f) => [f.path, f.sha256]));
    const now = new Map(current.files.map((f) => [f.path, f.sha256]));
    const mine = new Map([...u.files.map((f) => [f.path, f.sha256]), ...u.remove.map((p) => [p, null])]);
    return [...mine]
      .filter(([p, sha]) => was.get(p) !== now.get(p) && now.get(p) !== (sha ?? undefined))
      .map(([p]) => p);
  }

  return {
    get,

    async list() {
      const out = [];
      for (const n of await fsp.readdir(dir)) {
        if (!n.endsWith('.json')) continue;
        const u = await get(n.slice(0, -5)).catch(() => null);
        if (u) out.push(u);
      }
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async create(body, author) {
      const { note, files = [], remove = [] } = body ?? {};
      if (typeof note !== 'string' || !note.trim() || note.length > 2000)
        throw new HttpError(400, 'note — что меняется и зачем, строка до 2000 символов');
      if (!Array.isArray(files) || !Array.isArray(remove) || files.length + remove.length > MAX_FILES)
        throw new HttpError(400, `files и remove — массивы, вместе до ${MAX_FILES}`);
      if (!files.length && !remove.length) throw new HttpError(400, 'Нечего менять: files и remove пустые');
      const current = await store.getCurrent();
      if (!current) throw new HttpError(409, 'Текущего снимка ещё нет — сначала tfc publish');
      const inCurrent = new Map(current.files.map((f) => [f.path, f.sha256]));

      const problems = [];
      const missing = [];
      const seen = new Set();
      const outFiles = [];
      for (const f of files) {
        const c = classifyPath(f?.path);
        if (c.error) problems.push({ path: f?.path, reason: c.error });
        else if (seen.has(f.path.toLowerCase())) problems.push({ path: f.path, reason: 'повтор пути' });
        else if (!SHA256_RE.test(f.sha256 ?? '')) problems.push({ path: f.path, reason: 'неверный sha256' });
        else if (!store.hasBlob(f.sha256)) missing.push(f.sha256);
        else if (inCurrent.get(f.path) === f.sha256) problems.push({ path: f.path, reason: 'в сборке уже такой' });
        else outFiles.push({ path: f.path, sha256: f.sha256, size: store.blobSize(f.sha256), kind: c.kind });
        if (typeof f?.path === 'string') seen.add(f.path.toLowerCase());
      }
      for (const p of remove) {
        if (typeof p !== 'string' || !inCurrent.has(p)) problems.push({ path: p, reason: 'убрать: в сборке нет' });
        else if (seen.has(p.toLowerCase())) problems.push({ path: p, reason: 'и меняется, и убирается' });
      }
      if (problems.length) throw new HttpError(400, `Обновление не принято: ${problems.length} ошибок`, { problems });
      if (missing.length)
        throw new HttpError(409, `Не залито файлов: ${new Set(missing).size}`, { missing: [...new Set(missing)] });

      const d = new Date().toISOString().replace(/\D/g, '');
      const u = {
        id: `u${d.slice(0, 8)}-${d.slice(8, 14)}-${randomBytes(2).toString('hex')}`,
        createdAt: new Date().toISOString(),
        author,
        note: note.trim(),
        base: current.id,
        files: outFiles.sort((a, b) => (a.path < b.path ? -1 : 1)),
        remove: [...remove].sort(),
        status: 'pending',
      };
      await writeJsonAtomic(file(u.id), u);
      return u;
    },

    /** Одобрить: новый снимок = текущий + файлы − remove. Возвращает { update, snapshot } (снимок ещё не текущий) */
    async approve(id, who, { force = false } = {}) {
      const u = await pending(id);
      if (u.author === who) throw new HttpError(403, 'Одобрить должен другой администратор, не автор обновления');
      const current = await store.getCurrent();
      if (!current) throw new HttpError(409, 'Текущего снимка нет');
      const conflicts = await conflictsOf(u, current);
      if (conflicts.length && !force)
        throw new HttpError(409, `Эти файлы в сборке поменяли после предложения: ${conflicts.length}`, { conflicts });
      const files = new Map(current.files.map((f) => [f.path, f]));
      for (const f of u.files) files.set(f.path, f);
      for (const p of u.remove) files.delete(p);
      const snapshot = await store.createSnapshot(
        {
          note: `${u.note} (обновление ${u.id} от ${u.author})`.slice(0, 2000),
          mc: current.mc,
          loader: current.loader,
          files: [...files.values()],
        },
        who,
      );
      const done = {
        ...u,
        status: 'approved',
        decidedAt: new Date().toISOString(),
        decidedBy: who,
        snapshot: snapshot.id,
      };
      await writeJsonAtomic(file(u.id), done);
      return { update: done, snapshot };
    },

    async reject(id, who, reason = '') {
      const u = await pending(id);
      const done = {
        ...u,
        status: 'rejected',
        decidedAt: new Date().toISOString(),
        decidedBy: who,
        reason: String(reason).slice(0, 2000),
      };
      await writeJsonAtomic(file(u.id), done);
      return done;
    },
  };
}
