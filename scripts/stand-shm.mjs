/**
 * Снимок и сервер NeoForge в /dev/shm на время прогона серверного стенда: с HDD test1a стенд грузится заметно дольше.
 * Общее для исполнителя проверки печати (print-worker.mjs) и очереди стенда (stand-queue.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PACK_CACHE } from './pack-cache.mjs';

/** Версия снимка из .tfc-fetch.json кеша */
export function packMeta(cache = PACK_CACHE) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cache, '.tfc-fetch.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Копия снимка и установленного NeoForge (loader из снимка) в /dev/shm; места меньше 2 ГБ — работаем с диска.
 * stand — папка стенда (TFC_STAND_DIR), где лежит neoforge-<версия>. → { pack, stand, clean }
 */
export function stageShm(stand, { prefix = 'tfc-stand.', loader = packMeta().loader } = {}) {
  const free = (() => {
    try {
      const s = fs.statfsSync('/dev/shm');
      return s.bavail * s.bsize;
    } catch {
      return 0;
    }
  })();
  if (free < 2 * 1024 ** 3) return { pack: PACK_CACHE, stand, clean: () => {} };
  const ram = fs.mkdtempSync(`/dev/shm/${prefix}`);
  fs.cpSync(PACK_CACHE, path.join(ram, 'pack'), { recursive: true });
  fs.mkdirSync(path.join(ram, 'stand'));
  const nf = loader ? path.join(stand, loader) : null;
  if (nf && fs.existsSync(nf)) fs.cpSync(nf, path.join(ram, 'stand', loader), { recursive: true });
  return {
    pack: path.join(ram, 'pack'),
    stand: path.join(ram, 'stand'),
    clean: () => fs.rmSync(ram, { recursive: true, force: true }),
  };
}
