/**
 * Предложенные обновления сборки: администратор (обычно Claude) выкладывает несколько файлов и/или убирает пути,
 * хост забирает их к себе (`tfc admin updates pull`), проверяет и одобряет — тогда из текущего снимка
 * с этими изменениями получается новый снимок. Одобрить может только другой администратор, не автор.
 *
 *   updates/<id>.json — { id, createdAt, author, note, base, files: [{ path, sha256, size, kind }], remove: [path],
 *                         datapacks?: [{ id, revision, sha256, sourcePath?, name, path, contentHash, worldPaths }],
 *                         status: pending | approved | rejected, decidedAt?, decidedBy?, snapshot?, parent?, reason? }
 * base — текущий снимок на момент предложения: по нему видно, не поменяли ли эти пути с тех пор.
 * datapacks — подтвердить вместе с новым снимком (как tfc datapacks confirm): ZIP уже в files по пути kubejs/data/…,
 * ревизию карточки и пересечения данных сервер проверяет и при предложении, и при одобрении. Старые записи без этого
 * поля одобряются как раньше. parent — снимок, который был текущим до одобрения (откат).
 */
import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { confirmDatapackItems } from './datapack-deployment.mjs';
import { deploymentsOf } from './datapacks.mjs';
import { classifyPath, isModJar, jarKey } from './paths.mjs';
import { HttpError, SHA256_RE, writeJsonAtomic } from './util.mjs';

const ID_RE = /^u\d{8}-\d{6}-[0-9a-f]{4}$/;
const MAX_FILES = 2000;

export async function openUpdates(dataDir, store, site) {
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

  /**
   * Что изменилось в сборке после base. conflicts — пути обновления, которые в текущем снимке поменялись (и не совпадают
   * с предложенным). jarConflicts — [{ path, current }]: jar обновления и появившийся после base jar того же мода под
   * другим именем; вместе они дали бы две версии мода, а игра с такой сборкой не запустится.
   */
  async function conflictsOf(u, current) {
    const base = await store.getSnapshot(u.base);
    if (!base || !current || base.id === current.id) return { conflicts: [], jarConflicts: [] };
    const was = new Map(base.files.map((f) => [f.path, f.sha256]));
    const now = new Map(current.files.map((f) => [f.path, f.sha256]));
    const mine = new Map([...u.files.map((f) => [f.path, f.sha256]), ...u.remove.map((p) => [p, null])]);
    const conflicts = [...mine]
      .filter(([p, sha]) => was.get(p) !== now.get(p) && now.get(p) !== (sha ?? undefined))
      .map(([p]) => p);
    const added = current.files.filter((f) => isModJar(f.path) && !was.has(f.path) && !mine.has(f.path));
    const jarConflicts = u.files
      .filter((f) => isModJar(f.path))
      .flatMap((f) =>
        added.filter((c) => jarKey(c.path) === jarKey(f.path)).map((c) => ({ path: f.path, current: c.path })),
      );
    return { conflicts, jarConflicts };
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
      const current = await store.getCurrent();
      for (const u of out) if (u.status === 'pending') Object.assign(u, await conflictsOf(u, current));
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async create(body, author) {
      const { note, files = [], remove = [], datapacks = [] } = body ?? {};
      if (typeof note !== 'string' || !note.trim() || note.length > 2000)
        throw new HttpError(400, 'note — что меняется и зачем, строка до 2000 символов');
      if (!Array.isArray(files) || !Array.isArray(remove) || files.length + remove.length > MAX_FILES)
        throw new HttpError(400, `files и remove — массивы, вместе до ${MAX_FILES}`);
      if (!Array.isArray(datapacks) || datapacks.length > 100)
        throw new HttpError(400, 'datapacks — массив, до 100 пакетов');
      if (new Set(datapacks.map((d) => d?.id)).size !== datapacks.length)
        throw new HttpError(400, 'Повтор id датапака');
      if (!files.length && !remove.length && !datapacks.length)
        throw new HttpError(400, 'Нечего менять: files, remove и datapacks пустые');
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
      for (const d of datapacks) {
        if (!SHA256_RE.test(d?.sha256 ?? '')) problems.push({ path: d?.id, reason: 'датапак: неверный sha256' });
        else if (!store.hasBlob(d.sha256)) missing.push(d.sha256);
      }
      if (problems.length) throw new HttpError(400, `Обновление не принято: ${problems.length} ошибок`, { problems });
      if (missing.length)
        throw new HttpError(409, `Не залито файлов: ${new Set(missing).size}`, { missing: [...new Set(missing)] });

      // Проверяем сразу, как при подтверждении: автор узнаёт о конфликте сейчас, а не хост при одобрении
      const outDatapacks = [];
      if (datapacks.length) {
        const after = new Map(current.files.map((f) => [f.path, f]));
        for (const f of outFiles) after.set(f.path, f);
        for (const p of remove) after.delete(p);
        const deployments = new Map(deploymentsOf(current).map((x) => [x.id, x]));
        await confirmDatapackItems(store, site, current, datapacks, { files: after, deployments, by: author });
        for (const { id, revision, sha256, sourcePath } of datapacks) {
          const { name, path: target, contentHash, worldPaths } = deployments.get(id);
          outDatapacks.push({
            id,
            revision,
            sha256,
            ...(sourcePath ? { sourcePath } : {}),
            name,
            path: target,
            contentHash,
            worldPaths,
          });
          if (inCurrent.get(target) !== sha256 && !outFiles.some((f) => f.path === target))
            outFiles.push({ path: target, sha256, size: store.blobSize(sha256), kind: 'kubejs' });
        }
      }

      const d = new Date().toISOString().replace(/\D/g, '');
      const u = {
        id: `u${d.slice(0, 8)}-${d.slice(8, 14)}-${randomBytes(2).toString('hex')}`,
        createdAt: new Date().toISOString(),
        author,
        note: note.trim(),
        base: current.id,
        files: outFiles.sort((a, b) => (a.path < b.path ? -1 : 1)),
        remove: [...remove].sort(),
        ...(outDatapacks.length ? { datapacks: outDatapacks } : {}),
        status: 'pending',
      };
      await writeJsonAtomic(file(u.id), u);
      return u;
    },

    /**
     * Одобрить: новый снимок = текущий + файлы − remove, датапаки обновления подтверждаются в нём же. activate делает
     * снимок текущим; не вышло — обновление остаётся ждущим. Возвращает { update, snapshot, ...итог activate }.
     */
    async approve(id, who, { force = false, activate } = {}) {
      const u = await pending(id);
      if (u.author === who)
        throw new HttpError(
          403,
          `Сервер распознал ключ «${who}» — это автор обновления. Войдите ключом другого администратора: tfc login <ключ>`,
        );
      const current = await store.getCurrent();
      if (!current) throw new HttpError(409, 'Текущего снимка нет');
      const { conflicts, jarConflicts } = await conflictsOf(u, current);
      if (jarConflicts.length)
        throw new HttpError(409, `В сборке уже другая версия мода: ${jarConflicts.length}. --force тут не поможет`, {
          conflicts: jarConflicts.map((j) => `${j.path} — в сборке ${j.current}`),
          jarConflicts,
        });
      if (conflicts.length && !force)
        throw new HttpError(409, `Эти файлы в сборке поменяли после предложения: ${conflicts.length}`, { conflicts });
      const files = new Map(current.files.map((f) => [f.path, f]));
      for (const f of u.files) files.set(f.path, f);
      for (const p of u.remove) files.delete(p);
      let options = {};
      if (u.datapacks?.length) {
        const deployments = new Map(deploymentsOf(current).map((d) => [d.id, d]));
        await confirmDatapackItems(store, site, current, u.datapacks, { files, deployments, by: who });
        options = { datapacks: [...deployments.values()] };
      }
      const snapshot = await store.createSnapshot(
        {
          note: `${u.note} (обновление ${u.id} от ${u.author})`.slice(0, 2000),
          mc: current.mc,
          loader: current.loader,
          files: [...files.values()],
        },
        who,
        options,
      );
      const activated = await activate?.(snapshot);
      const done = {
        ...u,
        status: 'approved',
        decidedAt: new Date().toISOString(),
        decidedBy: who,
        snapshot: snapshot.id,
        parent: current.id,
      };
      await writeJsonAtomic(file(u.id), done);
      return { update: done, snapshot, ...activated };
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
