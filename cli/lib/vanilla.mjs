/**
 * Установка сборки в официальный Minecraft Launcher (`tfc init --launcher`): NeoForge своей версии в
 * <.minecraft>/versions, папка игры — <.minecraft>/versions/<имя>/ (моды и конфиги отдельно от обычной игры),
 * профиль в launcher_profiles.json. Дальше папку наполняет обычный `tfc pull`.
 *
 * NeoForge ставит его же установщик (maven.neoforged.net, сверка sha256) без окна: `--install-client <папка>`.
 * Он требует launcher_profiles.json (лаунчер уже запускали) и Java 21+; Java берём ту, что лаунчер скачал себе
 * сам (<.minecraft>/runtime), иначе JAVA_HOME и PATH. Установщик сам добавляет профиль «NeoForge» — его
 * возвращаем как было: игроку нужен наш профиль с отдельной папкой. Старые файлы профилей — копией рядом.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cacheDir } from './config.mjs';
import { isDir } from './detect.mjs';

const MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
/** Лаунчер из Microsoft Store / Xbox держит профили в своём файле рядом с обычным */
const PROFILE_FILES = ['launcher_profiles.json', 'launcher_profiles_microsoft_store.json'];
export const PROFILE_ID = 'tfc-realworld';
export const DEFAULT_NAME = 'TFC-RealWorld';

/** Папка официального лаунчера по умолчанию */
export function defaultMinecraftDir() {
  const home = os.homedir();
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), '.minecraft');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'minecraft');
  return path.join(home, '.minecraft');
}

/** Файлы профилей, что есть в папке лаунчера */
export const profileFiles = (mcDir) => PROFILE_FILES.map((n) => path.join(mcDir, n)).filter((f) => fs.existsSync(f));

/** «neoforge-21.1.248» / «21.1.248» → «21.1.248» */
export function neoforgeVersion(loader) {
  const m = /^(?:neoforge-)?(\d+\.\d+\.\d+(?:-beta)?)$/i.exec(String(loader ?? '').trim());
  return m?.[1] ?? null;
}

export const versionId = (nf) => `neoforge-${nf}`;
export const isNeoforgeInstalled = (mcDir, nf) =>
  fs.existsSync(path.join(mcDir, 'versions', versionId(nf), `${versionId(nf)}.json`));

/** Мажорная версия Java по `java -version` или null */
function javaMajor(bin) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${r.stderr ?? ''}${r.stdout ?? ''}`);
  if (!m) return null;
  return m[1] === '1' ? Number(m[2]) : Number(m[1]); // «1.8.0» — это Java 8
}

/** bin/java(.exe) внутри папки на глубину до depth */
function findJavaBins(dir, depth, out = []) {
  if (depth < 0 || !isDir(dir)) return out;
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const bin = path.join(dir, 'bin', exe);
  if (fs.existsSync(bin)) out.push(bin);
  for (const e of fs.readdirSync(dir, { withFileTypes: true }))
    if (e.isDirectory() && e.name !== 'bin' && e.name !== 'lib' && e.name !== 'legal')
      findJavaBins(path.join(dir, e.name), depth - 1, out);
  return out;
}

/** Java 21+: сначала та, что скачал лаунчер, потом JAVA_HOME и PATH. { bin, major } или null */
export function findJava(mcDir) {
  const roots = [path.join(mcDir, 'runtime')];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA)
    // Лаунчер из Microsoft Store
    roots.push(
      path.join(
        process.env.LOCALAPPDATA,
        'Packages',
        'Microsoft.4297127D64EC6_8wekyb3d8bbwe',
        'LocalCache',
        'Local',
        'runtime',
      ),
    );
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [
    ...roots.flatMap((r) => findJavaBins(r, 6)),
    ...(process.env.JAVA_HOME ? [path.join(process.env.JAVA_HOME, 'bin', exe)] : []),
    'java',
  ];
  for (const bin of candidates) {
    if (bin !== 'java' && !fs.existsSync(bin)) continue;
    const major = javaMajor(bin);
    if (major >= 21) return { bin, major };
  }
  return null;
}

/** Память для игры по объёму ОЗУ: сборка тяжёлая, но и половину системы отдавать нельзя */
export function defaultMemoryGb() {
  const gb = os.totalmem() / 1024 ** 3;
  return gb >= 15 ? 8 : gb >= 11 ? 6 : 4;
}

/** Установщик NeoForge в кеш программы, со сверкой sha256 из maven */
async function fetchInstaller(nf) {
  const name = `neoforge-${nf}-installer.jar`;
  const url = `${MAVEN}/${nf}/${name}`;
  const file = path.join(cacheDir(), 'neoforge', name);
  const get = async (u) => {
    let res;
    try {
      res = await fetch(u, { signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      throw new Error(`maven NeoForge недоступен: ${e.cause?.code ?? e.message}`);
    }
    if (!res.ok) throw new Error(`maven NeoForge ответил ${res.status} на ${path.basename(u)} — есть ли версия ${nf}?`);
    return res;
  };
  const want = (await (await get(`${url}.sha256`)).text()).trim().slice(0, 64);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  if (fs.existsSync(file) && sha(fs.readFileSync(file)) === want) return file;
  const bytes = Buffer.from(await (await get(url)).arrayBuffer());
  if (sha(bytes) !== want)
    throw new Error('установщик NeoForge пришёл повреждённым (хеш не сошёлся) — запустите ещё раз');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => fs.writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`);

/**
 * Поставить NeoForge nf в mcDir (если ещё нет) и профиль лаунчера на папку gameDir.
 * Возвращает { installed: поставили ли NeoForge сейчас, java, backups: копии файлов профилей, log }.
 */
export async function installToLauncher({ mcDir, nf, gameDir, title, memoryGb, onStep = () => {} }) {
  if (!isDir(mcDir))
    throw new Error(`нет папки Minecraft Launcher ${mcDir} — поставьте лаунчер и запустите его хотя бы раз`);
  const files = profileFiles(mcDir);
  if (!files.length)
    throw new Error(`в ${mcDir} нет launcher_profiles.json — запустите Minecraft Launcher хотя бы раз и закройте его`);

  // Копии файлов профилей до любых правок
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const before = new Map();
  const backups = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    before.set(f, JSON.parse(text));
    const b = `${f}.tfc-${stamp}`;
    fs.writeFileSync(b, text);
    backups.push(b);
  }

  let installed = false;
  let java = null;
  let log = null;
  if (!isNeoforgeInstalled(mcDir, nf)) {
    java = findJava(mcDir);
    if (!java)
      throw new Error(
        'нет Java 21 или новее. Проще всего: в Minecraft Launcher один раз запустите обычную версию 1.21.1 ' +
          '(лаунчер скачает Java сам), закройте игру и лаунчер и повторите. Или поставьте Java 21 (adoptium.net).',
      );
    onStep(`Скачиваю установщик NeoForge ${nf}`);
    const jar = await fetchInstaller(nf);
    // Установщику нужен именно launcher_profiles.json; у лаунчера из Store его может не быть
    const main = path.join(mcDir, PROFILE_FILES[0]);
    const madeMain = !fs.existsSync(main);
    if (madeMain) writeJson(main, { profiles: {}, settings: {}, version: 3 });
    onStep(`Ставлю NeoForge ${nf} — скачает Minecraft 1.21.1 и библиотеки, около 150 МБ`);
    log = path.join(cacheDir(), 'neoforge', `install-${nf}.log`);
    const r = spawnSync(java.bin, ['-jar', jar, '--install-client', mcDir], {
      cwd: path.dirname(jar),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 ** 2,
      windowsHide: true,
    });
    fs.writeFileSync(log, `${r.stdout ?? ''}${r.stderr ?? ''}`);
    if (madeMain) fs.rmSync(main, { force: true });
    if (r.status !== 0 || !isNeoforgeInstalled(mcDir, nf)) {
      const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-4).join('\n  ');
      throw new Error(`установщик NeoForge не справился (лог — ${log}):\n  ${tail || r.error?.message || ''}`);
    }
    installed = true;
  }

  // Профиль: установщик правит «NeoForge» — возвращаем как было, свой профиль добавляем во все файлы профилей
  fs.mkdirSync(path.join(gameDir, 'mods'), { recursive: true });
  const now = new Date().toISOString();
  for (const f of files) {
    const prev = before.get(f);
    const cur = fs.existsSync(f) ? readJson(f) : prev;
    cur.profiles ??= {};
    if (prev.profiles?.NeoForge) cur.profiles.NeoForge = prev.profiles.NeoForge;
    else delete cur.profiles.NeoForge;
    const old = cur.profiles[PROFILE_ID] ?? {};
    cur.profiles[PROFILE_ID] = {
      ...old,
      name: title,
      type: 'custom',
      icon: old.icon ?? 'Furnace',
      lastVersionId: versionId(nf),
      gameDir,
      javaArgs: javaArgs(old.javaArgs, memoryGb),
      created: old.created ?? now,
      lastUsed: old.lastUsed ?? now,
    };
    writeJson(f, cur);
  }
  return { installed, java, backups, log };
}

/** Аргументы JVM: прежние, только с новым -Xmx; без прежних — как у лаунчера по умолчанию */
export function javaArgs(prev, memoryGb) {
  const base =
    prev ||
    '-Xmx2G -XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 ' +
      '-XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M';
  return /-Xmx\S+/.test(base) ? base.replace(/-Xmx\S+/, `-Xmx${memoryGb}G`) : `-Xmx${memoryGb}G ${base}`;
}

/** Запущен ли сейчас лаунчер: при выходе он перепишет launcher_profiles.json своей копией */
export function launcherRunning() {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
      return /"Minecraft(Launcher)?\.exe"/i.test(r.stdout ?? '');
    }
    const r = spawnSync('pgrep', ['-if', 'minecraft.?launcher'], { encoding: 'utf8', timeout: 10_000 });
    return r.status === 0 && Boolean(r.stdout.trim());
  } catch {
    return false;
  }
}
