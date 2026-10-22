/**
 * Настройки программы: адрес сервера сборки, ключ, профили (папка версии + мир).
 * Файл — ~/.config/tfc/config.json (Windows — %APPDATA%\tfc\config.json); TFC_CONFIG_DIR — другая папка (для проверок).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_SERVER = 'https://tfc-pack.duckdns.org:28788';

export function configDir() {
  if (process.env.TFC_CONFIG_DIR) return process.env.TFC_CONFIG_DIR;
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'tfc');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'tfc');
}

/**
 * Общий кеш скачанного (по sha256) на все профили: второй профиль и переустановка не качают сборку заново.
 * TFC_CACHE_DIR — другая папка (для проверок).
 */
export function cacheDir() {
  if (process.env.TFC_CACHE_DIR) return process.env.TFC_CACHE_DIR;
  if (process.platform === 'win32')
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'tfc', 'cache');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'tfc');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'tfc');
}

const file = () => path.join(configDir(), 'config.json');

export function loadConfig() {
  try {
    return { server: DEFAULT_SERVER, profiles: {}, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    return { server: DEFAULT_SERVER, token: null, role: null, profile: null, profiles: {} };
  }
}

export function saveConfig(cfg) {
  fs.mkdirSync(configDir(), { recursive: true });
  // В файле ключ доступа к сборке — читать только владельцу
  fs.writeFileSync(file(), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
}

export const configFile = file;

/**
 * Профиль: { instance, world?, serverDir?, side: 'client' | 'server' }.
 * instance — папка версии (где mods/); world — папка мира; serverDir — папка сервера рядом с клиентом хоста
 * (оттуда serverconfig/, если в инстансе его нет).
 */
export function currentProfile(cfg, name) {
  const key = name || cfg.profile || Object.keys(cfg.profiles)[0];
  const p = key && cfg.profiles[key];
  if (!p)
    throw new Error(
      name ? `нет профиля «${name}» — tfc init --profile ${name}` : 'сначала настройте папку игры: tfc init',
    );
  return { name: key, ...p };
}
