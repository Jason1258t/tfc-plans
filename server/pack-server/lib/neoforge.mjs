/**
 * Толстые установщики NeoForge: у части игроков maven.neoforged.net не открывается, а обычный установщик качает
 * оттуда ещё и библиотеки. Хост собирает установщик с библиотеками внутри (`tfc admin neoforge build`), заливает его
 * блобом, здесь — запись «версия → блоб». Файл: neoforge.json — { "21.1.251": { version, file, sha256, size, by, at } }.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { HttpError, SHA256_RE, writeJsonAtomic } from './util.mjs';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const FILE_RE = /^[\w.+-]+\.jar$/;

export function openNeoforge(dataDir, store) {
  const file = path.join(dataDir, 'neoforge.json');
  const read = async () => {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return {};
      throw e;
    }
  };
  return {
    get: async (version) => (await read())[version] ?? null,
    list: async () => Object.values(await read()),
    async put(body, who) {
      const { version, file: name, sha256 } = body ?? {};
      if (!VERSION_RE.test(version ?? '')) throw new HttpError(400, 'version — версия NeoForge (21.1.251)');
      if (!FILE_RE.test(name ?? '')) throw new HttpError(400, 'file — имя jar без папок');
      if (!SHA256_RE.test(sha256 ?? '')) throw new HttpError(400, 'sha256 — 64 строчных шестнадцатеричных символа');
      if (!store.hasBlob(sha256)) throw new HttpError(409, 'Сначала залейте установщик (PUT /blobs/<sha256>)');
      const all = await read();
      all[version] = { version, file: name, sha256, size: store.blobSize(sha256), by: who, at: Date.now() };
      await writeJsonAtomic(file, all);
      return all[version];
    },
  };
}
