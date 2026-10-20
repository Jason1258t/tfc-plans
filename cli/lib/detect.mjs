/**
 * Поиск папок игры: инстансы лаунчеров, папка сервера, миры, версия Minecraft и загрузчика.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Папка версии — та, где есть mods/ (или kubejs/, config/) */
export const isInstance = (d) => ['mods', 'kubejs', 'config'].some((x) => isDir(path.join(d, x)));
export const isServerDir = (d) => fs.existsSync(path.join(d, 'server.properties'));
const isWorld = (d) => fs.existsSync(path.join(d, 'level.dat'));

/** Prism/MultiMC хранят игру в instances/<имя>/minecraft или .minecraft */
export function gameDirOf(dir) {
  for (const sub of ['minecraft', '.minecraft']) if (isInstance(path.join(dir, sub))) return path.join(dir, sub);
  return isInstance(dir) ? dir : null;
}

/** Где лаунчеры обычно держат инстансы */
function launcherRoots() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const mac = path.join(home, 'Library', 'Application Support');
  const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  const base = process.platform === 'win32' ? appData : process.platform === 'darwin' ? mac : xdg;
  return [
    path.join(base, 'PrismLauncher', 'instances'),
    path.join(base, 'MultiMC', 'instances'),
    path.join(base, 'ModrinthApp', 'profiles'),
    path.join(base, 'com.modrinth.theseus', 'profiles'),
    path.join(base, 'ATLauncher', 'instances'),
    path.join(home, 'curseforge', 'minecraft', 'Instances'),
    path.join(home, 'Documents', 'curseforge', 'minecraft', 'Instances'),
    path.join(home, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher', 'instances'),
  ];
}

/** Найденные инстансы: [{ name, dir, launcher }] — только с модами */
export function findInstances() {
  const out = [];
  for (const root of launcherRoots()) {
    if (!isDir(root)) continue;
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dir = gameDirOf(path.join(root, e.name));
      if (dir && isDir(path.join(dir, 'mods')))
        out.push({ name: e.name, dir, launcher: path.basename(path.dirname(root)) });
    }
  }
  return out;
}

/** level-name из server.properties — остальное из файла не читаем (там пароли RCON) */
export function levelName(serverDir) {
  try {
    const m = /^level-name=(.*)$/m.exec(fs.readFileSync(path.join(serverDir, 'server.properties'), 'utf8'));
    return m?.[1].trim() || null;
  } catch {
    return null;
  }
}

/** Миры папки: у сервера — level-name, у клиента — saves/* */
export function findWorlds(dir) {
  if (isServerDir(dir)) {
    const name = levelName(dir) || 'world';
    return isDir(path.join(dir, name)) ? [{ name, dir: path.join(dir, name) }] : [];
  }
  const saves = path.join(dir, 'saves');
  if (!isDir(saves)) return [];
  return fs
    .readdirSync(saves, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isWorld(path.join(saves, e.name)))
    .map((e) => ({ name: e.name, dir: path.join(saves, e.name), mtime: fs.statSync(path.join(saves, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * Версия Minecraft и NeoForge: из mmc-pack.json (Prism/MultiMC), minecraftinstance.json (CurseForge)
 * или из имени папки libraries/net/neoforged/neoforge/<версия> (сервер). Чего не нашли — null.
 */
export function detectVersions(instanceDir) {
  const res = { mc: null, loader: null };
  try {
    const pack = JSON.parse(fs.readFileSync(path.join(path.dirname(instanceDir), 'mmc-pack.json'), 'utf8'));
    for (const c of pack.components ?? []) {
      if (c.uid === 'net.minecraft') res.mc = c.version;
      if (c.uid === 'net.neoforged') res.loader = `neoforge-${c.version}`;
    }
  } catch {
    /* не Prism */
  }
  try {
    const cf = JSON.parse(fs.readFileSync(path.join(instanceDir, 'minecraftinstance.json'), 'utf8'));
    res.mc ??= cf.gameVersion ?? null;
    const l = cf.baseModLoader?.name; // «neoforge-21.1.219»
    if (l) res.loader ??= l;
  } catch {
    /* не CurseForge */
  }
  const libs = path.join(instanceDir, 'libraries', 'net', 'neoforged', 'neoforge');
  if (!res.loader && isDir(libs)) {
    const v = fs.readdirSync(libs).sort().at(-1);
    if (v) res.loader = `neoforge-${v}`;
  }
  // NeoForge 21.1.x — это Minecraft 1.21.1
  const m = /^neoforge-(\d+)\.(\d+)\./.exec(res.loader ?? '');
  if (!res.mc && m) res.mc = `1.${m[1]}${m[2] === '0' ? '' : `.${m[2]}`}`;
  return res;
}
