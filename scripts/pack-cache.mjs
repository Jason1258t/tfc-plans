/**
 * Локальная копия текущего снимка сборки — вне репозитория, одна на все git worktree и на всю машину.
 * Кладёт её npm run pack:fetch (с сервера сборки): папка версии как есть — mods/, config/, kubejs/…
 *
 *   TFC_PACK_CACHE — где лежит копия (по умолчанию ~/.cache/tfc-plans/pack)
 *   TFC_MODS_DIR   — взять jar из другой папки (например mods/ папки версии лаунчера; сервер сборки — снимок)
 *
 * Читают её MCP tfc-pack (jar-инструменты), npm run mods и libs.sh аддонов (tools/*). Сайту и npm run dev jar не
 * нужны: данные модов собирает и выкладывает сервер сборки.
 */
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACK_CACHE = path.resolve(
  process.env.TFC_PACK_CACHE ?? path.join(os.homedir(), '.cache', 'tfc-plans', 'pack'),
);
/** Папка jar сборки */
export const PACK_MODS = path.resolve(process.env.TFC_MODS_DIR ?? path.join(PACK_CACHE, 'mods'));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Корень основной копии репозитория, если мы в git worktree (иначе null) */
export function mainCheckoutRoot() {
  try {
    const common = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const mainRoot = path.resolve(path.dirname(common));
    return mainRoot === ROOT ? null : mainRoot;
  } catch {
    return null;
  }
}
