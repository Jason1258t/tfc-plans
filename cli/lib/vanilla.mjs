/**
 * Установка сборки в официальный Minecraft Launcher (`tfc init --launcher`): NeoForge своей версии в
 * <.minecraft>/versions, папка игры — <.minecraft>/versions/<имя>/ (моды и конфиги отдельно от обычной игры),
 * профиль в launcher_profiles.json. Дальше папку наполняет обычный `tfc pull`.
 *
 * NeoForge ставит его же установщик без окна: `--install-client <папка>`. Сначала — толстый с сервера сборки, с
 * библиотеками внутри (`tfc admin neoforge build`): maven.neoforged.net открывается не у всех; без него — с maven.
 * Он требует launcher_profiles.json (лаунчер уже запускали) и Java 21+; Java берём ту, что лаунчер скачал себе
 * сам (<.minecraft>/runtime), иначе JAVA_HOME и PATH. Установщик сам добавляет профиль «NeoForge» — его
 * возвращаем как было: игроку нужен наш профиль с отдельной папкой. Старые файлы профилей — копией рядом.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cacheDir } from './config.mjs';
import { defaultMinecraftDir, isDir } from './detect.mjs';

export { defaultMinecraftDir };

const MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
/** Лаунчер из Microsoft Store / Xbox держит профили в своём файле рядом с обычным */
const PROFILE_FILES = ['launcher_profiles.json', 'launcher_profiles_microsoft_store.json'];
const PROFILE_ID = 'tfc-realworld';
export const DEFAULT_NAME = 'TFC-RealWorld';

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
  const home = os.homedir();
  // Java лаунчера: официального (runtime/) и TLauncher (своя папка .tlauncher)
  const roots = [
    path.join(mcDir, 'runtime'),
    path.join(process.env.APPDATA || home, '.tlauncher'),
    path.join(home, '.tlauncher'),
    path.join(home, 'Library', 'Application Support', 'tlauncher'),
  ];
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

/** Толстый установщик с сервера сборки в кеш; null — на сервере такого нет или сервер его не отдал */
async function fetchServerInstaller(api, nf, dir, onBytes) {
  const meta = await api.get(`/neoforge/${nf}`).catch((e) => {
    // 404 — не выложен или старый сервер; сеть — попробуем maven
    if (e.status && e.status !== 404) throw e;
    return null;
  });
  if (!meta) return null;
  const file = path.join(dir, meta.file);
  const have = fs.existsSync(file) && createHash('sha256').update(fs.readFileSync(file)).digest('hex') === meta.sha256;
  if (!have) await api.download(meta.sha256, file, onBytes);
  return file;
}

/**
 * Установщик NeoForge в кеш (по умолчанию — кеш программы): с api — сперва толстый с сервера сборки,
 * иначе обычный с maven со сверкой sha256.
 */
export async function fetchInstaller(nf, dir = path.join(cacheDir(), 'neoforge'), { api, onBytes } = {}) {
  if (api) {
    const fat = await fetchServerInstaller(api, nf, dir, onBytes);
    if (fat) return fat;
  }
  const name = `neoforge-${nf}-installer.jar`;
  const url = `${MAVEN}/${nf}/${name}`;
  const file = path.join(dir, name);
  const get = async (u) => {
    let res;
    try {
      res = await fetch(u, { signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      throw new Error(
        `сайт NeoForge (maven.neoforged.net) не открывается: ${e.cause?.code ?? e.message}. ` +
          `Попросите хоста выполнить tfc admin neoforge build ${nf} или повторите через VPN`,
      );
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

/** Собрать толстый установщик: библиотеки NeoForge и Minecraft внутри, сам клиент Minecraft — нет (его качают у Mojang) */
export async function buildFatInstaller(nf, mcDir, dir = path.join(cacheDir(), 'neoforge')) {
  const java = findJava(mcDir);
  if (!java) throw new Error('нет Java 21 или новее (можно указать JAVA_HOME)');
  const thin = await fetchInstaller(nf, dir);
  const out = path.join(dir, `neoforge-${nf}-installer-fat.jar`);
  const args = ['-jar', thin, '--fat', out, '--fat-include-installer-libs', '--fat-include-minecraft-libs'];
  const r = spawnSync(java.bin, args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !fs.existsSync(out))
    throw new Error(
      `установщик не собрал толстую версию:\n  ${`${r.stdout}${r.stderr}`.trim().split('\n').slice(-4).join('\n  ')}`,
    );
  return out;
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => fs.writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`);

/**
 * TLauncher запускает из папки версии только сборки: их признак — блок modpack в TLauncherAdditional.json рядом с
 * версией; без него папка игры — корень .minecraft, и моды не видны. Список модов пустой: моды ставит tfc, TLauncher
 * лишние файлы не трогает (хост, dev #204). У каждой локальной копии свои числовые ID.
 */
function markTlauncherModpack(gameDir, name, mc, nf) {
  const file = path.join(gameDir, 'TLauncherAdditional.json');
  let cur = {};
  try {
    cur = readJson(file);
  } catch {
    /* файла ещё нет или он битый: TLauncher дополнит свой */
  }
  // Старые общие ID заменяем, а локальные сохраняем при обновлении и переименовании.
  const id = (current, shared) =>
    Number.isSafeInteger(current) && current < 0 && current !== shared ? current : -randomBytes(6).readUIntBE(0, 6) - 1;
  writeJson(file, {
    activateSkinCapeForUserVersion: false,
    skipHashsumValidation: false,
    tlauncherVersion: 0,
    source: 'local_version_repo',
    jar: mc,
    skinVersion: false,
    ...cur,
    modpack: {
      modpackMemory: false,
      memory: 0,
      favorite: false,
      userInstall: false,
      populateStatus: false,
      available: false,
      parser: false,
      notExists: false,
      totalComments: 0,
      ...cur.modpack,
      id: id(cur.modpack?.id, -57012801480201),
      name,
      version: {
        mods: [],
        resourcePacks: [],
        maps: [],
        shaderpacks: [],
        name: '1.0',
        available: false,
        remove: false,
        minecraftVersionTypes: [{ id: 5, name: 'neoForge' }],
        ...cur.modpack?.version,
        id: id(cur.modpack?.version?.id, -57012801606102),
        gameVersionDTO: { id: 53, name: mc },
        minecraftVersionName: { id: 1985, name: nf },
      },
    },
  });
}

/**
 * Поставить NeoForge nf в mcDir (если ещё нет) и профиль лаунчера на папку gameDir.
 * Возвращает { installed: поставили ли NeoForge сейчас, java, backups: копии файлов профилей, log }.
 */
export async function installToLauncher({
  mcDir,
  nf,
  name,
  gameDir = path.join(mcDir, 'versions', name),
  profileId,
  memoryGb,
  api,
  onStep = () => {},
}) {
  const versionDir = path.join(mcDir, 'versions', name);
  const title = name === DEFAULT_NAME ? 'TFC RealWorld' : name;
  if (!isDir(mcDir))
    throw new Error(`нет папки Minecraft Launcher ${mcDir} — поставьте лаунчер и запустите его хотя бы раз`);
  const files = profileFiles(mcDir);
  if (!files.length && !isDir(path.join(mcDir, 'versions')))
    throw new Error(`в ${mcDir} нет ни профилей, ни versions/ — запустите лаунчер хотя бы раз и закройте его`);

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

  const matches = (profile) =>
    profile?.lastVersionId === name && profile.gameDir && path.resolve(profile.gameDir) === gameDir;
  const launchers = [...before.values()].map((file) => file.profiles ?? {});
  const baseId = `${PROFILE_ID}-${name.toLowerCase()}`;
  const candidates = [profileId, baseId, PROFILE_ID, ...new Set(launchers.flatMap(Object.keys))];
  const compatible = (id) => launchers.every((profiles) => !Object.hasOwn(profiles, id) || matches(profiles[id]));
  let id =
    candidates.find((id) => id && compatible(id) && launchers.some((profiles) => matches(profiles[id]))) ?? baseId;
  for (let i = 2; !compatible(id); i++) id = `${baseId}-${i}`;

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
    let got = 0;
    const jar = await fetchInstaller(nf, undefined, {
      api,
      onBytes: (n) => onStep(`Скачиваю установщик NeoForge ${nf}: ${Math.round((got += n) / 1024 ** 2)} МБ`),
    });
    // Установщику нужен именно launcher_profiles.json; у лаунчера из Store его может не быть
    const main = path.join(mcDir, PROFILE_FILES[0]);
    const madeMain = !fs.existsSync(main);
    if (madeMain) writeJson(main, { profiles: {}, settings: {}, version: 3 });
    const step = `Ставлю NeoForge ${nf}`;
    onStep(step);
    log = path.join(cacheDir(), 'neoforge', `install-${nf}.log`);
    const r = await runInstaller(java.bin, jar, mcDir, (l) => onStep(`${step}: ${l}`)).finally(() => {
      if (madeMain) fs.rmSync(main, { force: true });
      else fs.copyFileSync(backups[files.indexOf(main)], main);
    });
    fs.writeFileSync(log, r.out);
    if (r.code !== 0 || !isNeoforgeInstalled(mcDir, nf)) {
      const tail = r.out.trim().split('\n').slice(-4).join('\n  ');
      throw new Error(`установщик NeoForge не справился (лог — ${log}):\n  ${tail || r.error || ''}`);
    }
    installed = true;
  }

  // Своя версия <name> в versions/<name>/<name>.json — копия версии NeoForge под нашим именем: её видят и
  // официальный лаунчер, и TLauncher (он берёт список из versions/), а папка версии — она же папка игры
  fs.mkdirSync(path.join(gameDir, 'mods'), { recursive: true });
  const nfJson = readJson(path.join(mcDir, 'versions', versionId(nf), `${versionId(nf)}.json`));
  fs.mkdirSync(versionDir, { recursive: true });
  writeJson(path.join(versionDir, `${name}.json`), { ...nfJson, id: name });
  if (gameDir === versionDir) markTlauncherModpack(versionDir, name, nfJson.inheritsFrom ?? '1.21.1', nf);

  // Профиль: установщик правит «NeoForge» — возвращаем как было, свой профиль добавляем во все файлы профилей
  const now = new Date().toISOString();
  for (const f of files) {
    const prev = before.get(f);
    const cur = fs.existsSync(f) ? readJson(f) : prev;
    cur.profiles ??= {};
    if (prev.profiles?.NeoForge) cur.profiles.NeoForge = prev.profiles.NeoForge;
    else delete cur.profiles.NeoForge;
    const old = Object.hasOwn(prev.profiles ?? {}, id) ? prev.profiles[id] : {};
    cur.profiles[id] = {
      ...old,
      name: old.name ?? title,
      type: 'custom',
      icon: old.icon ?? 'Furnace',
      lastVersionId: name,
      gameDir,
      javaArgs: javaArgs(old.javaArgs, memoryGb),
      created: old.created ?? now,
      lastUsed: old.lastUsed ?? now,
    };
    writeJson(f, cur);
  }
  return {
    installed,
    java,
    backups,
    log,
    gameDir,
    profileId: id,
    title: launchers.find((p) => matches(p[id]))?.[id].name ?? title,
    profiles: files.length,
  };
}

/** Установщик NeoForge без окна; onLine — последняя осмысленная строка его вывода (для крутилки) */
function runInstaller(java, jar, mcDir, onLine) {
  return new Promise((resolve) => {
    let out = '';
    let tail = '';
    const p = spawn(java, ['-jar', jar, '--install-client', mcDir], { cwd: path.dirname(jar), windowsHide: true });
    // Вывод установщика — тысячи строк по-английски; показываем этап и счётчик
    let libs = 0;
    let steps = 0;
    const feed = (d) => {
      const text = d.toString();
      out += text;
      tail += text;
      const lines = tail.split(/\r?\n/);
      tail = lines.pop();
      let phase = null;
      for (const l of lines) {
        if (/^Considering minecraft client jar/i.test(l)) phase = 'качаю Minecraft 1.21.1';
        else if (/^Considering library/i.test(l)) phase = `качаю библиотеки: ${++libs}`;
        else if (/^Processor:/i.test(l)) phase = `перестраиваю Minecraft под NeoForge: шаг ${++steps}`;
        else if (/^Injecting profile/i.test(l)) phase = 'дописываю версию';
      }
      if (phase) onLine(phase);
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', (e) => resolve({ code: -1, out, error: e.message }));
    p.on('close', (code) => resolve({ code, out }));
  });
}

/** Аргументы JVM: прежние, только с новым -Xmx; без прежних — как у лаунчера по умолчанию */
export function javaArgs(prev, memoryGb) {
  const base =
    prev ||
    '-Xmx2G -XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 ' +
      '-XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M';
  if (memoryGb === undefined) return base;
  return /-Xmx\S+/.test(base) ? base.replace(/-Xmx\S+/, `-Xmx${memoryGb}G`) : `-Xmx${memoryGb}G ${base}`;
}

/** Запущен ли сейчас лаунчер: при выходе он перепишет launcher_profiles.json своей копией */
export function launcherRunning() {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
      return /"(?:Minecraft(?:Launcher)?|TLauncher[^"]*)\.exe"/i.test(r.stdout ?? '');
    }
    const r = spawnSync('pgrep', ['-if', 'minecraft.?launcher|tlauncher'], { encoding: 'utf8', timeout: 10_000 });
    return r.status === 0 && Boolean(r.stdout.trim());
  } catch {
    return false;
  }
}
