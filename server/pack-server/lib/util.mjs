/** Общее для сервера сборки: ошибка с HTTP-кодом, атомарная запись JSON */
import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const SHA256_RE = /^[0-9a-f]{64}$/;

/** Запись через временный файл и rename: оборванная запись не оставляет полфайла */
export async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 1));
  await fsp.rename(tmp, file);
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`${path.basename(file)}: ${e.message}`);
  }
}
