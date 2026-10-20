/**
 * Хранилище сборки. Раскладка <DATA_DIR>:
 *   blobs/<sha256>        — файлы по содержимому: одинаковый jar в разных снимках лежит один раз
 *   snapshots/<id>.json   — снимок: { id, createdAt, author, note, mc, loader, parent, files: [{ path, sha256, size, kind }] }
 *   channels.json         — { current, history: [{ id, at, by }] } — какой снимок текущий; откат = переключить указатель
 *   tmp/                  — недописанные загрузки (чистится при старте)
 * Всё пишется через временный файл и rename. Blob появляется под своим именем только после сверки хеша.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { classifyPath } from './paths.mjs';
import { HttpError, readJson, SHA256_RE, writeJsonAtomic } from './util.mjs';

const SNAPSHOT_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const MAX_FILES = 50_000;

export async function openStore(dataDir, { maxBlobSize, maxTotalBytes, minFreeBytes }) {
  const blobsDir = path.join(dataDir, 'blobs');
  const snapsDir = path.join(dataDir, 'snapshots');
  const tmpDir = path.join(dataDir, 'tmp');
  const channelsFile = path.join(dataDir, 'channels.json');
  await fsp.mkdir(blobsDir, { recursive: true });
  await fsp.mkdir(snapsDir, { recursive: true });
  await fsp.rm(tmpDir, { recursive: true, force: true });
  await fsp.mkdir(tmpDir, { recursive: true });

  /** sha256 → размер; держим в памяти, чтобы /blobs/missing и проверка снимка не ходили на диск */
  const blobs = new Map();
  for (const n of await fsp.readdir(blobsDir)) {
    if (!SHA256_RE.test(n)) continue;
    blobs.set(n, (await fsp.stat(path.join(blobsDir, n))).size);
  }
  let totalBytes = [...blobs.values()].reduce((a, b) => a + b, 0);

  /** id → сводка снимка (без списка файлов); сами снимки читаются с диска по запросу */
  const summaries = new Map();
  for (const n of await fsp.readdir(snapsDir)) {
    if (!n.endsWith('.json')) continue;
    try {
      const s = JSON.parse(await fsp.readFile(path.join(snapsDir, n), 'utf8'));
      if (s.id === n.slice(0, -5)) summaries.set(s.id, summarize(s));
    } catch (e) {
      console.warn(`Пропускаю повреждённый снимок ${n}: ${e.message}`);
    }
  }

  let channels = await readJson(channelsFile, { current: null, history: [] });

  const blobPath = (sha) => path.join(blobsDir, sha);
  const snapPath = (id) => path.join(snapsDir, `${id}.json`);

  function checkSha(sha) {
    if (!SHA256_RE.test(sha ?? '')) throw new HttpError(400, 'sha256 — 64 строчных шестнадцатеричных символа');
  }

  async function checkSpace(len) {
    if (totalBytes + len > maxTotalBytes) throw new HttpError(507, 'Хранилище заполнено (MAX_TOTAL_BYTES)');
    const st = await fsp.statfs(dataDir);
    if (st.bavail * st.bsize - len < minFreeBytes) throw new HttpError(507, 'На диске сервера мало места');
  }

  async function getSnapshot(id) {
    if (!SNAPSHOT_ID_RE.test(id ?? '') || !summaries.has(id)) return null;
    return JSON.parse(await fsp.readFile(snapPath(id), 'utf8'));
  }

  function newSnapshotId() {
    const d = new Date().toISOString().replace(/\D/g, ''); // 20261020123005123
    for (;;) {
      const id = `${d.slice(0, 8)}-${d.slice(8, 14)}-${randomBytes(2).toString('hex')}`;
      if (!summaries.has(id)) return id;
    }
  }

  return {
    stats: () => ({ blobs: blobs.size, bytes: totalBytes, snapshots: summaries.size, current: channels.current }),
    hasBlob: (sha) => blobs.has(sha),
    blobSize: (sha) => blobs.get(sha),
    blobPath,

    /** Каких файлов из списка нет — клиент заливает только их */
    missing(list) {
      if (!Array.isArray(list) || list.length > MAX_FILES) throw new HttpError(400, `sha256 — массив до ${MAX_FILES}`);
      list.forEach(checkSha);
      return [...new Set(list)].filter((sha) => !blobs.has(sha));
    },

    /**
     * Принимает поток. Хеш считается по дороге и сверяется с ожидаемым; не совпал — 409, файл не сохраняется.
     * Уже есть — тело дочитывается вхолостую (клиент мог не спросить /blobs/missing), ответ { existed: true }.
     */
    async putBlob(sha, stream, declaredLength) {
      checkSha(sha);
      if (Number.isFinite(declaredLength) && declaredLength > maxBlobSize)
        throw new HttpError(413, 'Файл больше допустимого размера (MAX_BLOB_SIZE)');
      if (blobs.has(sha)) {
        stream.resume();
        await new Promise((ok, fail) => stream.on('end', ok).on('error', fail));
        return { sha256: sha, size: blobs.get(sha), existed: true };
      }
      await checkSpace(declaredLength || 0);
      const tmp = path.join(tmpDir, `${sha}.${randomBytes(4).toString('hex')}`);
      const hash = createHash('sha256');
      let size = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          size += chunk.length;
          if (size > maxBlobSize) return cb(new HttpError(413, 'Файл больше допустимого размера (MAX_BLOB_SIZE)'));
          hash.update(chunk);
          cb(null, chunk);
        },
      });
      try {
        await pipeline(stream, counter, fs.createWriteStream(tmp));
        if (Number.isFinite(declaredLength) && size !== declaredLength)
          throw new HttpError(400, 'Файл пришёл не целиком');
        if (hash.digest('hex') !== sha)
          throw new HttpError(
            409,
            'Не совпала контрольная сумма — файл повредился при передаче или хеш посчитан неверно',
          );
        await fsp.rename(tmp, blobPath(sha));
      } catch (e) {
        await fsp.rm(tmp, { force: true });
        throw e;
      }
      // Две одновременные заливки одного файла — обе пишут своё, rename одинакового содержимого безвреден
      if (!blobs.has(sha)) totalBytes += size;
      blobs.set(sha, size);
      return { sha256: sha, size, existed: false };
    },

    listSnapshots: () =>
      [...summaries.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
    getSnapshot,
    getCurrent: () => (channels.current ? getSnapshot(channels.current) : null),
    channels: () => channels,

    /**
     * Новый снимок. Проверки: пути из белого списка без запрещённых, без повторов, все файлы уже залиты
     * и размер совпадает. Ошибки собираются списком (problems), чтобы клиент показал всё сразу.
     */
    async createSnapshot(body, author) {
      const { note = '', mc = '', loader = '', files } = body ?? {};
      if (!Array.isArray(files) || !files.length) throw new HttpError(400, 'files — непустой массив');
      if (files.length > MAX_FILES) throw new HttpError(400, `Больше ${MAX_FILES} файлов в снимке`);
      for (const [k, v, max] of [
        ['note', note, 2000],
        ['mc', mc, 40],
        ['loader', loader, 80],
      ])
        if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `${k} — строка до ${max} символов`);

      const problems = [];
      const missing = [];
      const seen = new Set();
      const out = [];
      for (const f of files) {
        const p = f?.path;
        const c = classifyPath(p);
        if (c.error) {
          problems.push({ path: p, reason: c.error });
          continue;
        }
        const low = p.toLowerCase(); // на Windows Mods/a.jar и mods/A.jar — один файл
        if (seen.has(low)) {
          problems.push({ path: p, reason: 'повтор пути' });
          continue;
        }
        seen.add(low);
        if (f.kind !== undefined && f.kind !== c.kind) {
          problems.push({ path: p, reason: `вид ${f.kind}, а по пути — ${c.kind}` });
          continue;
        }
        if (!SHA256_RE.test(f.sha256 ?? '')) {
          problems.push({ path: p, reason: 'неверный sha256' });
          continue;
        }
        if (!blobs.has(f.sha256)) {
          missing.push(f.sha256);
          continue;
        }
        const size = blobs.get(f.sha256);
        if (f.size !== undefined && f.size !== size) {
          problems.push({ path: p, reason: `размер ${f.size}, а у залитого файла — ${size}` });
          continue;
        }
        out.push({ path: p, sha256: f.sha256, size, kind: c.kind });
      }
      if (problems.length)
        throw new HttpError(400, `Снимок не принят: ${problems.length} путей с ошибками`, {
          problems: problems.slice(0, 200),
        });
      if (missing.length)
        throw new HttpError(409, `Не залито файлов: ${new Set(missing).size}`, { missing: [...new Set(missing)] });

      out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const snap = {
        id: newSnapshotId(),
        createdAt: new Date().toISOString(),
        author,
        note,
        mc,
        loader,
        parent: channels.current,
        files: out,
      };
      await writeJsonAtomic(snapPath(snap.id), snap);
      summaries.set(snap.id, summarize(snap));
      return summarize(snap);
    },

    /** Сделать снимок текущим: { id } или { rollback: true } — на тот, что был текущим до нынешнего */
    async setCurrent(body, by) {
      const at = new Date().toISOString();
      let history;
      let id = body?.id;
      if (body?.rollback === true) {
        // Назад по истории: повторный откат уходит ещё на шаг, а не возвращает обратно
        const i = channels.history.findLastIndex((h) => h.id !== channels.current);
        if (i < 0) throw new HttpError(409, 'Откатываться некуда: другого текущего снимка не было');
        id = channels.history[i].id;
        history = [...channels.history.slice(0, i), { id, at, by, rollback: true }];
      } else {
        if (!summaries.has(id)) throw new HttpError(404, 'Нет такого снимка');
        history = [...channels.history, { id, at, by }].slice(-200);
      }
      const next = { current: id, history };
      await writeJsonAtomic(channelsFile, next);
      const was = channels.current;
      channels = next;
      return { current: id, previous: was };
    },
  };
}

function summarize(s) {
  return {
    id: s.id,
    createdAt: s.createdAt,
    author: s.author,
    note: s.note,
    mc: s.mc,
    loader: s.loader,
    parent: s.parent ?? null,
    fileCount: s.files.length,
    totalSize: s.files.reduce((n, f) => n + f.size, 0),
  };
}
