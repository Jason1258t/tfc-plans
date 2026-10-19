/**
 * Файлы на диске. Раскладка (её же понимает scripts/files-migrate.mjs как «dir:<папка>»):
 *   <DATA_DIR>/files/<id>.json  — запись: { id, name, size, type, createdAt, sha256, ...свои поля }
 *   <DATA_DIR>/files/<id>.bin   — содержимое
 *   <DATA_DIR>/tmp/             — недописанные загрузки
 * Файл существует, когда есть .json; .json пишется последним, оба — через rename, поэтому оборванная
 * загрузка не оставляет «битых» файлов. Записи держатся в памяти, на диск — только при изменении.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** id как у Firestore: 20 символов [A-Za-z0-9] */
export function newId() {
  const bytes = randomBytes(40);
  let id = '';
  for (const b of bytes) {
    if (b >= 248) continue; // 248 = 62*4 — без перекоса распределения
    id += ID_ALPHABET[b % 62];
    if (id.length === 20) break;
  }
  return id.length === 20 ? id : newId();
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function openStorage(dataDir) {
  const filesDir = path.join(dataDir, 'files');
  const tmpDir = path.join(dataDir, 'tmp');
  await fsp.mkdir(filesDir, { recursive: true });
  await fsp.rm(tmpDir, { recursive: true, force: true });
  await fsp.mkdir(tmpDir, { recursive: true });

  const records = new Map();
  const names = await fsp.readdir(filesDir);
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(await fsp.readFile(path.join(filesDir, n), 'utf8'));
      if (rec.id === n.slice(0, -5)) records.set(rec.id, rec);
    } catch (e) {
      console.warn(`Пропускаю повреждённую запись ${n}: ${e.message}`);
    }
  }
  // Содержимое без записи — остаток оборванного удаления или загрузки
  for (const n of names) {
    if (n.endsWith('.bin') && !records.has(n.slice(0, -4))) await fsp.rm(path.join(filesDir, n), { force: true });
  }

  const binPath = (id) => path.join(filesDir, `${id}.bin`);
  const jsonPath = (id) => path.join(filesDir, `${id}.json`);
  const listeners = new Set();
  const emit = (event, data) => listeners.forEach((l) => l(event, data));

  async function writeJson(file, value) {
    const tmp = path.join(tmpDir, `${path.basename(file)}.${randomBytes(4).toString('hex')}`);
    await fsp.writeFile(tmp, JSON.stringify(value));
    await fsp.rename(tmp, file);
  }

  return {
    list: () => [...records.values()].sort((a, b) => a.createdAt - b.createdAt),
    get: (id) => records.get(id) ?? null,
    totalBytes: () => [...records.values()].reduce((n, r) => n + r.size, 0),
    contentPath: binPath,
    onChange(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },

    /**
     * Принимает поток содержимого. maxSize — обрыв с 413, sha256 — сверка (409 при расхождении).
     * fields: { id?, name, type, createdAt?, ...свои }. Существующий id перезаписывается (импорт).
     */
    async put(stream, { maxSize, sha256, ...fields }) {
      const id = fields.id ?? newId();
      if (!ID_RE.test(id)) throw new HttpError(400, 'Недопустимый id');
      const tmp = path.join(tmpDir, `${id}.${randomBytes(4).toString('hex')}.bin`);
      const hash = createHash('sha256');
      let size = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          size += chunk.length;
          if (size > maxSize) return cb(new HttpError(413, 'Файл больше допустимого размера'));
          hash.update(chunk);
          cb(null, chunk);
        },
      });
      try {
        await pipeline(stream, counter, fs.createWriteStream(tmp));
        const digest = hash.digest('hex');
        if (sha256 && sha256.toLowerCase() !== digest)
          throw new HttpError(409, 'Не совпала контрольная сумма — файл повредился при передаче');
        const rec = { ...fields, id, size, sha256: digest, createdAt: fields.createdAt ?? Date.now() };
        await fsp.rename(tmp, binPath(id));
        await writeJson(jsonPath(id), rec);
        records.set(id, rec);
        emit('put', rec);
        return rec;
      } catch (e) {
        await fsp.rm(tmp, { force: true });
        throw e;
      }
    },

    async remove(id) {
      if (!records.has(id)) return false;
      // Сначала запись: без неё файл уже не виден, а лишний .bin уберётся при следующем старте
      await fsp.rm(jsonPath(id), { force: true });
      records.delete(id);
      await fsp.rm(binPath(id), { force: true });
      emit('delete', { id });
      return true;
    },
  };
}
