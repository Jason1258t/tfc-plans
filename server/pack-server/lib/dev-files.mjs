/**
 * Вложения задач разработки (dev #357): скриншоты, логи, доказательства прогонов стенда. Раньше жили в Firestore
 * (коллекция files, taskId = "dev:<id>") и тратили бесплатный лимит чтений. Метаданные — таблица files в dev.db,
 * содержимое — <DATA_DIR>/dev-files/<sha256> (одинаковые файлы хранятся один раз). Отдельно от блобов снимков:
 * файл удаляется с диска, когда на него не ссылается ни одно вложение, — снимки так не задеть.
 * id — 20 символов, как у Firestore: перенесённые вложения сохраняют свои id, ссылки на них не ломаются.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError, SHA256_RE } from './util.mjs';

export const FILES_SCHEMA = `
create table if not exists files (
  id text primary key,
  task_id integer not null references tasks(id) on delete cascade,
  name text not null,
  type text not null,
  size integer not null,
  sha256 text not null,
  author text not null,
  created_at integer not null
);
create index if not exists files_task on files(task_id, created_at);
create index if not exists files_sha on files(sha256);
`;

/** Что можно прикладывать: картинки, тексты и логи, архивы, файлы игры, документы и видео */
const EXT = new Set(
  (
    'png jpg jpeg webp gif avif bmp svg ' +
    'txt log md json jsonc json5 yaml yml toml cfg conf ini properties csv tsv xml snbt mcmeta lang ' +
    'js mjs cjs ts tsx jsx java kt py sh patch diff html css sql zs mcfunction ' +
    'zip gz tgz tar xz 7z nbt schem schematic litematic dat mca jar pdf mp4 webm mov mp3 ogg wav'
  ).split(' '),
);
/** Ротация логов игры: latest.log.1, debug.log.2 */
const extOk = (name) => /\.log\.\d+$/i.test(name) || EXT.has(name.split('.').pop().toLowerCase());
export const FILE_TYPES = [...EXT];

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const FILE_ID_RE = /^[A-Za-z0-9]{20}$/;
const newId = () => [...randomBytes(20)].map((b) => ID_CHARS[b % 62]).join('');

/** Имя без папок и управляющих символов */
function cleanName(raw) {
  const name = String(raw ?? '')
    .split(/[/\\]/)
    .pop()
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!name || name === '.' || name === '..') throw new HttpError(400, 'Нужно имя файла (X-File-Name)');
  if (name.length > 200) throw new HttpError(400, 'Имя файла — не длиннее 200 символов');
  if (!extOk(name))
    throw new HttpError(415, `Такой тип файла не принимается: «${name}». Можно: ${FILE_TYPES.join(', ')}`);
  return name;
}

const cleanType = (t) => {
  const s = String(t ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(s) ? s : 'application/octet-stream';
};

const tooBig = (max) =>
  new HttpError(
    413,
    `Файл больше ${max >= 1024 ** 2 ? `${Math.round(max / 1024 ** 2)} МБ` : `${Math.round(max / 1024)} КБ`}`,
  );

const fileOut = (r) => ({
  id: r.id,
  task: r.task_id,
  name: r.name,
  type: r.type,
  size: r.size,
  sha256: r.sha256,
  author: r.author,
  createdAt: r.created_at,
});

/**
 * db — dev.db (таблица tasks уже есть), note(taskId, by, text) — запись в журнал задачи.
 * Ограничения: maxFile — один файл, maxTotal — все вложения на диске, minFree — сколько оставить свободным.
 */
export function openDevFiles(db, dataDir, { note, maxFile, maxTotal, minFree }) {
  db.exec(FILES_SCHEMA);
  const dir = path.join(dataDir, 'dev-files');
  const tmpDir = path.join(dir, 'tmp');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const q = {
    list: db.prepare('select * from files where task_id = ? order by created_at, id'),
    get: db.prepare('select * from files where id = ?'),
    same: db.prepare('select * from files where task_id = ? and sha256 = ? and name = ?'),
    used: db.prepare('select count(*) c from files where sha256 = ?'),
    total: db.prepare(
      'select coalesce(sum(size), 0) s from (select sha256, max(size) size from files group by sha256)',
    ),
    add: db.prepare(
      'insert into files (id, task_id, name, type, size, sha256, author, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    del: db.prepare('delete from files where id = ?'),
    shas: db.prepare('select distinct sha256 from files'),
  };

  const blobPath = (sha) => path.join(dir, sha);

  /** Файлы на диске, на которые больше ничто не ссылается (удалили вложение или задачу целиком) */
  function sweep() {
    const keep = new Set(q.shas.all().map((r) => r.sha256));
    let removed = 0;
    for (const n of fs.readdirSync(dir))
      if (SHA256_RE.test(n) && !keep.has(n)) {
        fs.rmSync(blobPath(n), { force: true });
        removed++;
      }
    return removed;
  }
  const swept = sweep();
  if (swept) console.log(`dev-files: удалено ничейных файлов: ${swept}`);

  function get(id) {
    const r = FILE_ID_RE.test(id ?? '') ? q.get.get(id) : null;
    if (!r) throw new HttpError(404, `Нет вложения ${id}`);
    return r;
  }

  /**
   * Приём файла потоком. meta: { name, type, sha256, length, by, id?, createdAt? } — id и createdAt только при
   * переносе (ключ администратора). Тот же файл с тем же именем у той же задачи второй раз не сохраняется.
   */
  async function put(taskId, stream, meta) {
    const name = cleanName(meta.name);
    const sha = String(meta.sha256 ?? '').toLowerCase();
    if (!SHA256_RE.test(sha)) throw new HttpError(400, 'X-File-Sha256 — sha256 содержимого (64 hex)');
    const length = meta.length;
    if (Number.isFinite(length) && length > maxFile) throw tooBig(maxFile);
    if (meta.id !== undefined && !FILE_ID_RE.test(meta.id)) throw new HttpError(400, 'id — 20 букв и цифр');

    const drain = async () => {
      stream.resume();
      await new Promise((ok, fail) => stream.on('end', ok).on('error', fail));
    };
    const existing = meta.id ? q.get.get(meta.id) : q.same.get(taskId, sha, name);
    if (existing) {
      if (existing.task_id !== taskId || existing.sha256 !== sha)
        throw new HttpError(409, `Вложение ${meta.id} уже есть с другим содержимым или у другой задачи`);
      await drain();
      return { file: fileOut(existing), existed: true };
    }

    if (!fs.existsSync(blobPath(sha))) {
      if (q.total.get().s + (length || 0) > maxTotal)
        throw new HttpError(507, 'Место для вложений задач закончилось (DEV_FILES_MAX_BYTES)');
      const st = await fsp.statfs(dataDir);
      if (st.bavail * st.bsize - (length || 0) < minFree) throw new HttpError(507, 'На диске сервера мало места');
      const tmp = path.join(tmpDir, `${sha}.${randomBytes(4).toString('hex')}`);
      const hash = createHash('sha256');
      let size = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          size += chunk.length;
          if (size > maxFile) return cb(tooBig(maxFile));
          hash.update(chunk);
          cb(null, chunk);
        },
      });
      try {
        await pipeline(stream, counter, fs.createWriteStream(tmp));
        if (Number.isFinite(length) && size !== length) throw new HttpError(400, 'Файл пришёл не целиком');
        if (hash.digest('hex') !== sha)
          throw new HttpError(409, 'Не совпала контрольная сумма — файл повредился при передаче');
        await fsp.rename(tmp, blobPath(sha));
      } catch (e) {
        await fsp.rm(tmp, { force: true });
        throw e;
      }
    } else await drain();

    const size = fs.statSync(blobPath(sha)).size;
    const id = meta.id ?? newId();
    const createdAt = Number.isFinite(meta.createdAt) ? meta.createdAt : Date.now();
    q.add.run(id, taskId, name, cleanType(meta.type), size, sha, meta.by, createdAt);
    if (!meta.id) note(taskId, meta.by, `Вложение «${name}» (${size} Б) — file:${id}`);
    return { file: fileOut(q.get.get(id)), existed: false };
  }

  function remove(id, by) {
    const r = get(id);
    q.del.run(r.id);
    if (!q.used.get(r.sha256).c) fs.rmSync(blobPath(r.sha256), { force: true });
    note(r.task_id, by, `Удалено вложение «${r.name}» (file:${r.id})`);
    return fileOut(r);
  }

  return {
    list: (taskId) => q.list.all(taskId).map(fileOut),
    get: (id) => fileOut(get(id)),
    path: (id) => blobPath(get(id).sha256),
    put,
    remove,
    sweep,
  };
}
