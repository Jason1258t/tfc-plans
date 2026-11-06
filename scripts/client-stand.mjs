#!/usr/bin/env node
/**
 * Клиентский стенд сборки (dev #279, #284, #288): полный клиент NeoForge со снимком сборки на виртуальном экране Xvfb,
 * без sudo и без окна. Запускает игру, ждёт главное меню (или вход в одиночный мир — --world), снимает экран в PNG,
 * выходит штатно и складывает журналы.
 * Работает на Linux (test1a); с Mac его зовёт client-stand-remote.mjs (npm run client-stand). Только встроенные
 * модули Node: на хосте не нужен npm ci.
 *
 *   TFC_CLIENT_STAND — папка стенда (по умолчанию ~/.cache/tfc-plans/client-stand):
 *     x11/          — Xvfb из пакета Ubuntu (apt-get download + dpkg-deb -x, без sudo)
 *     launcher/     — versions/, libraries/, assets/ — Minecraft и NeoForge (ставит prepare)
 *     installers/   — установщики NeoForge (толстый с сервера сборки кладёт client-stand-remote.mjs)
 *     runs/<id>/    — папка прогона: свой профиль игры, свой экран и Xauthority; удаляется после прогона
 *     results/<id>/ — что осталось от прогона: summary.txt, журналы, crash-reports, PNG; screenshots/ — игровые
 *                     снимки из game/screenshots по префиксам --game-shots
 *   TFC_PACK_CACHE — снимок сборки (как у pack-stand.mjs)
 *
 *   node scripts/client-stand.mjs prepare [--neoforge 21.1.251] [--installer <jar>] [--assets base|all|none]
 *   node scripts/client-stand.mjs run [--mod <jar>]… [--exclude <часть имени jar>]… [--overlay <папка>]
 *        [--timeout 900] [--settle 20] [--load 300] [--shots 1] [--interval 10] [--memory 8G] [--ready <regex>] [--ram] [--keep]
 *        [--parallel] [--game-shots <префикс имени PNG>]… [--size 1280x720] [--world new[:<пресет>]|flat|<папка мира>]
 *   node scripts/client-stand.mjs clean [--results 10]
 *
 * Почему не runClient (ModDevGradle): в dev-запуске KubeJS TFC бросает AssertionError (!isProduction()), как у
 * серверного стенда. Поэтому — обычный production-запуск по описаниям версий лаунчера, как у официального лаунчера.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, inflateRawSync } from 'node:zlib';
import { errorLines, javaHome, killTree, sleep, stopWithProcess } from './mc-server.mjs';
import { PACK_CACHE } from './pack-cache.mjs';

export const STAND = path.resolve(
  process.env.TFC_CLIENT_STAND ?? path.join(os.homedir(), '.cache', 'tfc-plans', 'client-stand'),
);
const LAUNCHER = path.join(STAND, 'launcher');
const XVFB = path.join(STAND, 'x11', 'usr', 'bin', 'Xvfb');
const CAPTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'client-stand', 'Capture.java');
const DEFAULT_NF = '21.1.251';
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const ASSETS_URL = 'https://resources.download.minecraft.net';
/** Главное меню: FancyMenu регистрирует слой титульного экрана, когда тот открылся */
const READY = /ScreenCustomizationLayer registered: title_screen/;
/** В мире: встроенный сервер впустил игрока стенда (строка PlayerList — без перевода, в отличие от чата) */
const READY_WORLD = /StandTest\[[^\]]*\] logged in with entity id/;
/**
 * UUID игрока как у офлайн-входа (UUID v3 от «OfflinePlayer:<ник>»): нулевой FTB Chunks считает «никем» и сыплет
 * исключениями при входе
 */
const OFFLINE_UUID = (() => {
  const b = createHash('md5').update('OfflinePlayer:StandTest').digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  return b.toString('hex');
})();
/** Мир не открылся: экран ошибки или вопроса вместо мира (FancyMenu пишет каждый новый класс экрана) */
const WORLD_FAIL =
  /ScreenCustomizationLayer registered: (\S*(?:RecoverWorldData|Disconnected|DatapackLoadFailure|Alert|BackupConfirm|Confirm)Screen)/;
/** Имя мира стенда в saves/ */
const WORLD = 'stand';
/** Шум: llvmpipe без /dev/dri, Xvfb без звуковой карты, моды с объявленным, но пустым AT */
const NOISE = [/libEGL warning/, /OpenAL|SoundEngine|sound system/i, /Access transformer file .* does not exist/];
/** Флаги тестового профиля: CustomSkinLoader 15.0.1 не патчит SkinManager и без флага останавливает запуск */
const JVM_FLAGS = ['-Dcustomskinloader.ignorePatchFailure=true'];

const log = (s) => console.error(`[client-stand] ${s}`);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const readText = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const sha1 = (b) => createHash('sha1').update(b).digest('hex');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** «21.1.251» → «1.21.1»: у NeoForge первые два числа — версия Minecraft без «1.» */
const mcOf = (nf) => `1.${nf.split('.').slice(0, 2).join('.')}`.replace(/\.0$/, '');

function packVersion(cache) {
  try {
    return readJson(path.join(cache, '.tfc-fetch.json'));
  } catch {
    return {};
  }
}

const neoforgeOf = (loader) => /^(?:neoforge-)?(\d+\.\d+\.\d+(?:-beta)?)$/i.exec(String(loader ?? ''))?.[1] ?? null;

function java() {
  const home = javaHome();
  return home ? path.join(home, 'bin', 'java') : 'java';
}

// ------------------------------------------------------------------ подготовка

async function download(url, file, want) {
  if (fs.existsSync(file) && (!want || sha1(fs.readFileSync(file)) === want)) return false;
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (want && sha1(bytes) !== want) throw new Error('не сошёлся sha1');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.part`, bytes);
      fs.renameSync(`${file}.part`, file);
      return true;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`${url}: ${last.cause?.code ?? last.message}`);
}

/** Очередь загрузок по n штук */
async function pool(items, n, fn) {
  let i = 0;
  const errors = [];
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await fn(item).catch((e) => errors.push(e.message));
      }
    }),
  );
  return errors;
}

/** Xvfb из пакета Ubuntu без установки: apt-get download не просит sudo */
function ensureXvfb() {
  if (fs.existsSync(XVFB)) return;
  log('ставлю Xvfb в x11/ (apt-get download, без sudo)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'client-stand-deb-'));
  try {
    const r = spawnSync('apt-get', ['download', 'xvfb'], { cwd: tmp, encoding: 'utf8' });
    const debs = fs.readdirSync(tmp).filter((f) => f.endsWith('.deb'));
    if (r.status !== 0 || !debs.length)
      throw new Error(
        `apt-get download xvfb не скачал пакет: ${(r.stderr || r.stdout || r.error?.message || '').trim()}`,
      );
    for (const deb of debs) {
      const x = spawnSync('dpkg-deb', ['-x', path.join(tmp, deb), path.join(STAND, 'x11')], { encoding: 'utf8' });
      if (x.status !== 0) throw new Error(`dpkg-deb -x ${deb}: ${x.stderr}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (!fs.existsSync(XVFB)) throw new Error(`в пакете xvfb нет ${XVFB}`);
  const missing = ['xauth', 'xkbcomp'].filter((b) => spawnSync('which', [b]).status !== 0);
  if (missing.length)
    throw new Error(`нет ${missing.join(', ')} — их ставит владелец: sudo apt install xauth x11-xkb-utils xkb-data`);
}

/** Описание и клиент Minecraft mc от Mojang */
async function ensureVanilla(mc) {
  const dir = path.join(LAUNCHER, 'versions', mc);
  const json = path.join(dir, `${mc}.json`);
  if (!fs.existsSync(json)) {
    log(`скачиваю описание Minecraft ${mc}`);
    const manifest = await (await fetch(MANIFEST, { signal: AbortSignal.timeout(60_000) })).json();
    const v = manifest.versions.find((x) => x.id === mc);
    if (!v) throw new Error(`у Mojang нет версии ${mc}`);
    await download(v.url, json, v.sha1);
  }
  const ver = readJson(json);
  if (await download(ver.downloads.client.url, path.join(dir, `${mc}.jar`), ver.downloads.client.sha1))
    log(`скачан клиент Minecraft ${mc}`);
  return ver;
}

/**
 * NeoForge его установщиком. Толстый (с сервера сборки, tfc admin neoforge build) несёт библиотеки NeoForge внутри:
 * maven.neoforged.net с test1a не открывается. Установщику нужен launcher_profiles.json, как после лаунчера.
 */
function ensureNeoforge(nf, installer) {
  const id = `neoforge-${nf}`;
  const json = path.join(LAUNCHER, 'versions', id, `${id}.json`);
  if (fs.existsSync(json)) return;
  const dir = path.join(STAND, 'installers');
  const jar =
    installer ??
    [`neoforge-${nf}-installer-fat.jar`, `neoforge-${nf}-installer.jar`]
      .map((n) => path.join(dir, n))
      .find((f) => fs.existsSync(f));
  if (!jar || !fs.existsSync(jar))
    throw new Error(
      `нет установщика NeoForge ${nf} в ${dir}: npm run client-stand -- prepare на Mac кладёт толстый с сервера сборки`,
    );
  const profiles = path.join(LAUNCHER, 'launcher_profiles.json');
  if (!fs.existsSync(profiles)) fs.writeFileSync(profiles, '{"profiles":{}}\n');
  log(`ставлю NeoForge ${nf} установщиком ${path.basename(jar)}`);
  const r = spawnSync(java(), ['-jar', jar, '--install-client', LAUNCHER], {
    cwd: STAND,
    encoding: 'utf8',
    timeout: 1_200_000,
  });
  if (!fs.existsSync(json))
    throw new Error(
      `установщик NeoForge ${nf} не поставил клиент:\n${`${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n')}`,
    );
}

/** Правила описаний версий: ОС linux 64 бит; из features у стенда только своё разрешение окна */
function allowed(rules, features = { has_custom_resolution: true }) {
  if (!rules?.length) return true;
  let ok = false;
  for (const r of rules) {
    if (r.os?.name && r.os.name !== 'linux') continue;
    if (r.os?.arch && r.os.arch !== 'x86_64') continue;
    if (r.features && !Object.entries(r.features).every(([k, v]) => Boolean(features[k]) === v)) continue;
    ok = r.action === 'allow';
  }
  return ok;
}

/** «group:name:version[:classifier]» → путь в libraries/ */
function mavenPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`;
  return [...group.split('.'), artifact, version, file].join('/');
}

/** Библиотеки версии с родителем, сначала свои: { key, path, url, sha1 } */
function libraries(child, parent) {
  const seen = new Set();
  const out = [];
  for (const lib of [...child.libraries, ...parent.libraries]) {
    if (!allowed(lib.rules)) continue;
    const [group, artifact, , classifier] = lib.name.split(':');
    const key = `${group}:${artifact}:${classifier ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = lib.downloads?.artifact;
    out.push({ key, path: a?.path ?? mavenPath(lib.name), url: a?.url || null, sha1: a?.sha1 ?? null });
  }
  return out;
}

const versionJson = (id) => readJson(path.join(LAUNCHER, 'versions', id, `${id}.json`));

/** Всё, чего не хватает для запуска: Linux-нативы LWJGL и прочие библиотеки Mojang, индекс и объекты ресурсов */
async function ensureFiles(nf, assets) {
  const child = versionJson(`neoforge-${nf}`);
  const parent = versionJson(child.inheritsFrom);
  const missing = libraries(child, parent).filter((l) => !fs.existsSync(path.join(LAUNCHER, 'libraries', l.path)));
  const noUrl = missing.filter((l) => !l.url);
  if (noUrl.length)
    throw new Error(`нет библиотек и адреса для них (переставьте NeoForge): ${noUrl.map((l) => l.path).join(', ')}`);
  if (missing.length) log(`докачиваю библиотеки: ${missing.length}`);
  const errors = await pool(missing, 8, (l) => download(l.url, path.join(LAUNCHER, 'libraries', l.path), l.sha1));
  if (errors.length) throw new Error(`не скачались библиотеки:\n  ${errors.join('\n  ')}`);

  const idx = parent.assetIndex;
  const idxFile = path.join(LAUNCHER, 'assets', 'indexes', `${idx.id}.json`);
  await download(idx.url, idxFile, idx.sha1);
  if (assets === 'none') return;
  // base — всё, кроме звуков: список языков (pack.mcmeta) и переводы, панорама меню, встроенные ресурс-паки;
  // all — ещё звуки и музыка, сотни МБ (у Xvfb звука всё равно нет)
  const objects = Object.entries(readJson(idxFile).objects)
    .filter(([name]) => assets === 'all' || !/\/(sounds|music)\//.test(name))
    .map(([, o]) => o.hash)
    .filter((h) => !fs.existsSync(path.join(LAUNCHER, 'assets', 'objects', h.slice(0, 2), h)));
  if (objects.length) log(`докачиваю ресурсы Minecraft (${assets}): ${objects.length}`);
  const bad = await pool(objects, 16, (h) =>
    download(`${ASSETS_URL}/${h.slice(0, 2)}/${h}`, path.join(LAUNCHER, 'assets', 'objects', h.slice(0, 2), h), h),
  );
  if (bad.length) throw new Error(`не скачались ресурсы (${bad.length}): ${bad.slice(0, 5).join('; ')}`);
}

export async function prepare({ neoforge = null, installer = null, assets = 'base', cache = PACK_CACHE } = {}) {
  if (process.platform !== 'linux')
    throw new Error('клиентский стенд — для Linux (test1a); с Mac: npm run client-stand');
  const nf = neoforge || neoforgeOf(packVersion(cache).loader) || DEFAULT_NF;
  fs.mkdirSync(LAUNCHER, { recursive: true });
  ensureXvfb();
  await ensureVanilla(mcOf(nf));
  ensureNeoforge(nf, installer);
  await ensureFiles(nf, assets);
  return `Клиентский стенд готов: NeoForge ${nf}, Minecraft ${mcOf(nf)}, ${STAND}`;
}

// ------------------------------------------------------------------ прогон

/** Один файл из zip (jar) встроенными средствами, чтением по смещениям: хвост → центральный каталог → запись */
function zipEntry(file, name) {
  const fd = fs.openSync(file, 'r');
  try {
    const read = (pos, len) => {
      const b = Buffer.alloc(len);
      fs.readSync(fd, b, 0, len, pos);
      return b;
    };
    const size = fs.fstatSync(fd).size;
    const tail = read(Math.max(0, size - 65_557), Math.min(size, 65_557));
    let eocd = tail.length - 22;
    while (eocd >= 0 && tail.readUInt32LE(eocd) !== 0x06054b50) eocd--;
    if (eocd < 0) return null;
    const dir = read(tail.readUInt32LE(eocd + 16), tail.readUInt32LE(eocd + 12));
    for (let p = 0; p + 46 <= dir.length;) {
      const len = dir.readUInt16LE(p + 28);
      if (dir.toString('utf8', p + 46, p + 46 + len) === name) {
        const head = read(dir.readUInt32LE(p + 42), 30);
        const data = read(
          dir.readUInt32LE(p + 42) + 30 + head.readUInt16LE(26) + head.readUInt16LE(28),
          dir.readUInt32LE(p + 20),
        );
        return dir.readUInt16LE(p + 10) === 8 ? inflateRawSync(data) : data;
      }
      p += 46 + len + dir.readUInt16LE(p + 30) + dir.readUInt16LE(p + 32);
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** NBT из помеченных значений: [тип, значение(, тип элементов списка)] */
const tag = {
  byte: (v) => [1, v],
  int: (v) => [3, v],
  long: (v) => [4, BigInt(v)],
  double: (v) => [6, v],
  str: (v) => [8, v],
  list: (type, items) => [9, items, type],
  comp: (obj) => [10, obj],
};

/** JSON датапака → NBT: кодеки Minecraft читают числа через NbtOps без оглядки на точный тип */
function jsonTag(v) {
  if (typeof v === 'boolean') return tag.byte(v ? 1 : 0);
  if (typeof v === 'string') return tag.str(v);
  if (typeof v === 'number')
    return Number.isInteger(v) ? (Math.abs(v) < 2 ** 31 ? tag.int(v) : tag.long(v)) : tag.double(v);
  if (Array.isArray(v)) {
    // Список NBT однороден: целые рядом с дробными — все дробные
    const fractional = v.some((x) => typeof x === 'number' && !Number.isInteger(x));
    const items = v.map((x) => (fractional && typeof x === 'number' ? tag.double(x) : jsonTag(x)));
    return tag.list(items[0]?.[0] ?? 0, items);
  }
  return tag.comp(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonTag(x)])));
}

function nbtFile(root) {
  const parts = [];
  const num = (size, write) => {
    const b = Buffer.alloc(size);
    write(b);
    parts.push(b);
  };
  const str = (s) => {
    const b = Buffer.from(s, 'utf8');
    num(2, (h) => h.writeUInt16BE(b.length));
    parts.push(b);
  };
  const payload = ([t, v, elem]) => {
    if (t === 1) num(1, (b) => b.writeInt8(v));
    else if (t === 3) num(4, (b) => b.writeInt32BE(v));
    else if (t === 4) num(8, (b) => b.writeBigInt64BE(v));
    else if (t === 6) num(8, (b) => b.writeDoubleBE(v));
    else if (t === 8) str(v);
    else if (t === 9) {
      num(1, (b) => b.writeUInt8(v.length ? elem : 0));
      num(4, (b) => b.writeInt32BE(v.length));
      v.forEach(payload);
    } else {
      for (const [k, x] of Object.entries(v)) {
        num(1, (b) => b.writeUInt8(x[0]));
        str(k);
        payload(x);
      }
      num(1, (b) => b.writeUInt8(0));
    }
  };
  num(1, (b) => b.writeUInt8(10));
  str('');
  payload(tag.comp(root));
  return gzipSync(Buffer.concat(parts));
}

/**
 * Пресет мира сборки: из конфига (TFC делает свой пресетом по умолчанию — defaultWorldPreset), иначе
 * minecraft:normal. JSON пресета — по слоям, как у игры: kubejs/data, jar модов, клиент Minecraft. → { id, json }
 */
function packPreset(game, mcJar, id = null) {
  id ??= /^\s*defaultWorldPreset\s*=\s*"([^"]+)"/m.exec(readText(path.join(game, 'config', 'tfc-common.toml')))?.[1];
  id ??= 'minecraft:normal';
  const [ns, name] = id.includes(':') ? id.split(':') : ['minecraft', id];
  const rel = `data/${ns}/worldgen/world_preset/${name}.json`;
  const kjs = path.join(game, 'kubejs', rel);
  if (fs.existsSync(kjs)) return { id, json: readJson(kjs) };
  const mods = path.join(game, 'mods');
  for (const jar of [...fs.readdirSync(mods).map((f) => path.join(mods, f)), mcJar]) {
    const b = jar.endsWith('.jar') ? zipEntry(jar, rel) : null;
    if (b) return { id, json: JSON.parse(b.toString('utf8')) };
  }
  throw new Error(`нет пресета мира ${id} (${rel}) ни в kubejs/data, ни в jar модов, ни в Minecraft`);
}

/** Плоский верхний мир, как у ванильного пресета flat без построек */
const FLAT = {
  'minecraft:overworld': {
    type: 'minecraft:overworld',
    generator: {
      type: 'minecraft:flat',
      settings: {
        biome: 'minecraft:plains',
        features: false,
        lakes: false,
        structure_overrides: [],
        layers: [
          { block: 'minecraft:bedrock', height: 1 },
          { block: 'minecraft:dirt', height: 2 },
          { block: 'minecraft:grass_block', height: 1 },
        ],
      },
    },
  },
};

/**
 * Новый творческий мир для входа: только level.dat, остальное игра создаст сама. Версия данных — из version.json
 * клиента Minecraft (иначе DataFixer примет мир за древний и начнёт его переделывать). Измерений, которых нет в файле
 * (у flat — все, кроме верхнего), при загрузке добавляет реестр измерений из датапаков. initialized=0 — точку
 * появления ищет игра (у TFC — своим поиском по климату).
 */
function newWorld(dir, mcJar, dimensions) {
  const ver = JSON.parse(zipEntry(mcJar, 'version.json') ?? 'null');
  if (!ver?.world_version) throw new Error(`в ${mcJar} нет version.json с world_version`);
  const data = {
    DataVersion: tag.int(ver.world_version),
    Version: tag.comp({
      Id: tag.int(ver.world_version),
      Name: tag.str(ver.name ?? ver.id),
      Series: tag.str(ver.series_id ?? 'main'),
      Snapshot: tag.byte(ver.stable === false ? 1 : 0),
    }),
    // Формат хранения Anvil: без него LevelStorageSource.makeLevelSummary — «Unknown data version: 0»
    version: tag.int(19133),
    LevelName: tag.str(WORLD),
    GameType: tag.int(1),
    Difficulty: tag.byte(0),
    allowCommands: tag.byte(1),
    hardcore: tag.byte(0),
    initialized: tag.byte(0),
    confirmedExperimentalSettings: tag.byte(1),
    Time: tag.long(0),
    DayTime: tag.long(6000),
    LastPlayed: tag.long(Date.now()),
    GameRules: tag.comp({
      doDaylightCycle: tag.str('false'),
      doWeatherCycle: tag.str('false'),
      doMobSpawning: tag.str('false'),
    }),
    WorldGenSettings: tag.comp({
      seed: tag.long(randomBytes(6).readUIntBE(0, 6)),
      generate_features: tag.byte(1),
      bonus_chest: tag.byte(0),
      dimensions: jsonTag(dimensions),
    }),
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'level.dat'), nbtFile({ Data: tag.comp(data) }));
}

/**
 * Мир стенда в saves/: new[:<пресет>] — новый мир пресетом сборки, flat — плоский, иначе копия папки мира (с level.dat;
 * мир сервера тоже подходит). → строка для сводки
 */
function setupWorld(game, world, mc) {
  const dir = path.join(game, 'saves', WORLD);
  const mcJar = path.join(LAUNCHER, 'versions', mc, `${mc}.jar`);
  if (world === 'flat') return (newWorld(dir, mcJar, FLAT), 'новый плоский (творческий)');
  if (world === 'new' || world.startsWith('new:')) {
    const preset = packPreset(game, mcJar, world.slice(4) || null);
    newWorld(dir, mcJar, preset.json.dimensions);
    return `новый, пресет ${preset.id} (творческий)`;
  }
  if (!fs.existsSync(path.join(world, 'level.dat'))) throw new Error(`в ${world} нет level.dat — это не папка мира`);
  fs.cpSync(path.resolve(world), dir, { recursive: true });
  // session.lock прошлого владельца мешает открыть мир
  fs.rmSync(path.join(dir, 'session.lock'), { force: true });
  return `копия ${path.basename(path.resolve(world))}`;
}

/** Команда запуска по описаниям версий — как у официального лаунчера */
function launchCommand({ nf, game, natives, memory, size: [w, h], world }) {
  const id = `neoforge-${nf}`;
  const child = versionJson(id);
  const parent = versionJson(child.inheritsFrom);
  const libs = path.join(LAUNCHER, 'libraries');
  // Без ванильного <mc>.jar: клиент NeoForge собран установщиком в libraries/, второй minecraft ломает модули
  const cp = libraries(child, parent).map((l) => path.join(libs, l.path));
  const vars = {
    natives_directory: natives,
    launcher_name: 'tfc-client-stand',
    launcher_version: '1',
    classpath: cp.join(':'),
    classpath_separator: ':',
    library_directory: libs,
    version_name: id,
    version_type: 'release',
    game_directory: game,
    assets_root: path.join(LAUNCHER, 'assets'),
    assets_index_name: parent.assetIndex.id,
    auth_player_name: 'StandTest',
    auth_uuid: OFFLINE_UUID,
    auth_access_token: '0',
    auth_xuid: '0',
    clientid: '0',
    user_type: 'legacy',
    resolution_width: String(w),
    resolution_height: String(h),
  };
  const sub = (s) => s.replace(/\$\{(\w+)\}/g, (m, k) => vars[k] ?? m);
  const expand = (args) =>
    (args ?? []).flatMap((a) => {
      if (typeof a === 'string') return [sub(a)];
      if (!allowed(a.rules)) return [];
      return (Array.isArray(a.value) ? a.value : [a.value]).map(sub);
    });
  return [
    ...expand(parent.arguments.jvm),
    ...expand(child.arguments?.jvm),
    `-Xmx${memory}`,
    ...JVM_FLAGS,
    child.mainClass,
    ...expand(parent.arguments.game),
    ...expand(child.arguments?.game),
    '--disableMultiplayer',
    '--disableChat',
    ...(world ? ['--quickPlaySingleplayer', WORLD] : []),
  ];
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Папки прогонов: { dir, pid, live } — live, пока жив их процесс */
function liveRuns() {
  const dirs = [path.join(STAND, 'runs'), '/dev/shm'].flatMap((d) =>
    fs.existsSync(d)
      ? fs
          .readdirSync(d)
          .filter((n) => d !== '/dev/shm' || n.startsWith('tfc-client-'))
          .map((n) => path.join(d, n))
      : [],
  );
  return dirs.map((dir) => {
    const st = (() => {
      try {
        return readJson(path.join(dir, 'stand.json'));
      } catch {
        return {};
      }
    })();
    return { dir, ...st, live: Boolean(st.pid && alive(st.pid)) };
  });
}

/** Профиль игры: моды, config/kubejs/resourcepacks снимка, тестовые настройки, оверлей поверх */
function buildProfile({ game, cache, mods, exclude, overlay, copyMods }) {
  const modsDir = path.join(cache, 'mods');
  if (!fs.existsSync(modsDir)) throw new Error(`нет ${modsDir} — сначала снимок (npm run pack:fetch и синхронизация)`);
  fs.mkdirSync(path.join(game, 'mods'), { recursive: true });
  const jars = fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar'));
  const used = jars.filter((f) => !exclude.some((x) => f.toLowerCase().includes(x.toLowerCase())));
  // Снимок на HDD: в RAM-прогоне копия, иначе ссылки
  for (const f of used)
    if (copyMods) fs.copyFileSync(path.join(modsDir, f), path.join(game, 'mods', f));
    else fs.symlinkSync(path.join(modsDir, f), path.join(game, 'mods', f));
  for (const m of mods) {
    if (!fs.existsSync(m)) throw new Error(`нет jar ${m}`);
    fs.copyFileSync(m, path.join(game, 'mods', path.basename(m)));
  }
  for (const d of ['config', 'kubejs', 'resourcepacks', 'defaultconfigs', 'shaderpacks'])
    if (fs.existsSync(path.join(cache, d))) fs.cpSync(path.join(cache, d), path.join(game, d), { recursive: true });
  // Первый запуск без экранов-знакомств: доступность Minecraft, подсказки, приветствие FancyMenu
  fs.writeFileSync(
    path.join(game, 'options.txt'),
    ['lang:ru_ru', 'onboardAccessibility:false', 'tutorialStep:none', 'pauseOnLostFocus:false', 'narrator:0', ''].join(
      '\n',
    ),
  );
  const fancy = path.join(game, 'config', 'fancymenu', 'options.txt');
  if (!fs.existsSync(fancy)) {
    fs.mkdirSync(path.dirname(fancy), { recursive: true });
    fs.writeFileSync(fancy, "##[tutorial]\n\nB:show_welcome_screen = 'false';\n");
  }
  if (overlay) {
    if (!fs.existsSync(overlay)) throw new Error(`нет папки ${overlay}`);
    fs.cpSync(path.resolve(overlay), game, { recursive: true, force: true });
  }
  return { total: jars.length, used: used.length + mods.length, excluded: jars.length - used.length };
}

/** Lock и сокет экрана n, брошенные убитым Xvfb этого пользователя: процесса из lock-файла уже нет */
function dropStaleDisplay(n) {
  const lock = `/tmp/.X${n}-lock`;
  try {
    if (fs.statSync(lock).uid !== os.userInfo().uid) return;
    if (alive(Number(fs.readFileSync(lock, 'utf8').trim()))) return;
  } catch {
    return;
  }
  fs.rmSync(lock, { force: true });
  fs.rmSync(`/tmp/.X11-unix/X${n}`, { force: true });
}

/** Погасить Xvfb: SIGTERM — сам уберёт lock и сокет; не вышел за 5 с — убить и убрать за ним */
async function stopDisplay({ child, display }) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    for (let i = 0; i < 25 && child.exitCode === null && child.signalCode === null; i++) await sleep(200);
    if (child.exitCode === null && child.signalCode === null) killTree(child.pid);
  }
  await sleep(200);
  dropStaleDisplay(Number(display.slice(1)));
}

/** Свой экран Xvfb на свободном номере, со своим Xauthority. → { display, child, auth } */
async function startDisplay(run, [w, h]) {
  const auth = path.join(run, 'Xauthority');
  for (let n = 90; n < 140; n++) {
    dropStaleDisplay(n);
    if (fs.existsSync(`/tmp/.X${n}-lock`) || fs.existsSync(`/tmp/.X11-unix/X${n}`)) continue;
    fs.writeFileSync(auth, '', { mode: 0o600 });
    const xa = spawnSync('xauth', ['-f', auth, 'add', `:${n}`, '.', randomBytes(16).toString('hex')]);
    if (xa.status !== 0) throw new Error(`xauth: ${xa.stderr}`);
    const fd = fs.openSync(path.join(run, 'xvfb.log'), 'a');
    const child = spawn(XVFB, [`:${n}`, '-screen', '0', `${w}x${h}x24`, '-nolisten', 'tcp', '-auth', auth], {
      stdio: ['ignore', fd, fd],
      detached: true,
    });
    fs.closeSync(fd);
    stopWithProcess(child);
    let exited = false;
    child.once('exit', () => (exited = true));
    for (let i = 0; i < 50 && !exited; i++) {
      if (fs.existsSync(`/tmp/.X11-unix/X${n}`)) return { display: `:${n}`, child, auth };
      await sleep(200);
    }
    killTree(child.pid);
    // Номер заняли между проверкой и запуском — следующий
  }
  throw new Error(`Xvfb не поднялся (см. ${path.join(run, 'xvfb.log')})`);
}

/** Снимок экрана в PNG: java Capture.java (AWT Robot), на том же экране */
function capture(env, file) {
  const r = spawnSync(java(), [CAPTURE, file], { env, encoding: 'utf8', timeout: 120_000 });
  return r.status === 0 && fs.existsSync(file) ? null : (r.stderr || r.error?.message || 'нет файла').trim();
}

/** Остановить игру: SIGTERM — штатный выход через её shutdown hook; не вышла за минуту — убить */
async function stopGame(child, exited) {
  if (exited()) return 'вышла сама';
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  for (let i = 0; i < 120 && !exited(); i++) await sleep(500);
  if (exited()) return 'штатный выход (SIGTERM)';
  killTree(child.pid);
  return 'не вышла за минуту — убита';
}

/** Префикс игровых снимков: только имя файла без путей и масок */
const SHOT_PREFIX = /^[\w.-]+$/;
/** Неверные префиксы --game-shots → текст ошибки или null */
export function badShotPrefixes(prefixes) {
  const bad = prefixes.filter((p) => !SHOT_PREFIX.test(p));
  return bad.length
    ? `--game-shots: префикс — начало имени файла (буквы, цифры, . _ -), не путь и не маска: ${bad.join(', ')}`
    : null;
}
/** Больше кадров не копируем: снимки — для отчёта, не архив */
const MAX_GAME_SHOTS = 100;

/** Ширина и высота PNG из заголовка IHDR; не PNG — null */
function pngSize(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(24);
    if (fs.readSync(fd, b, 0, 24, 0) < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Игровые PNG из game/screenshots с именами на один из префиксов → out/screenshots. Берём только обычные файлы .png с
 * простым именем (без ссылок и подпапок). → { files: [{ name, size, dims }], skipped }
 */
function collectGameShots(game, out, prefixes) {
  const res = { files: [], skipped: 0 };
  const dir = path.join(game, 'screenshots');
  if (!prefixes.length || !fs.existsSync(dir)) return res;
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && SHOT_PREFIX.test(e.name) && e.name.toLowerCase().endsWith('.png'))
    .map((e) => e.name)
    .filter((n) => prefixes.some((p) => n.startsWith(p)))
    .sort();
  res.skipped = Math.max(0, names.length - MAX_GAME_SHOTS);
  const to = path.join(out, 'screenshots');
  for (const name of names.slice(0, MAX_GAME_SHOTS)) {
    const from = path.join(dir, name);
    const dims = pngSize(from);
    if (!dims) {
      res.skipped++;
      continue;
    }
    fs.mkdirSync(to, { recursive: true });
    fs.copyFileSync(from, path.join(to, name));
    res.files.push({ name, size: fs.statSync(from).size, dims });
  }
  return res;
}

function collect(game, run, out) {
  fs.mkdirSync(out, { recursive: true });
  const take = (from, to = path.basename(from)) => {
    if (fs.existsSync(from)) fs.cpSync(from, path.join(out, to), { recursive: true });
  };
  take(path.join(run, 'client.log'));
  take(path.join(run, 'xvfb.log'));
  take(path.join(game, 'logs', 'latest.log'));
  take(path.join(game, 'logs', 'debug.log'));
  take(path.join(game, 'logs', 'kubejs'), 'kubejs');
  take(path.join(game, 'crash-reports'));
  for (const f of fs.existsSync(game) ? fs.readdirSync(game) : [])
    if (/^hs_err_pid\d+\.log$/.test(f)) take(path.join(game, f));
}

/**
 * Прогон: профиль → экран → игра → главное меню (или мир) → PNG → выход → журналы в results/<id>. → { ok, text, out }
 * mods — свои jar в моды, exclude — убрать jar снимка по части имени, overlay — папка поверх профиля игры,
 * world — войти в одиночный мир: 'new' (пресет сборки, 'new:<id>' — другой), 'flat' или папка мира; ready тогда по
 * умолчанию — вход игрока.
 */
export async function runClient({
  mods = [],
  exclude = [],
  overlay = null,
  timeout = 900,
  settle = 20,
  load = 300,
  shots = 1,
  interval = 10,
  memory = '8G',
  ready = null,
  world = null,
  ram = false,
  keep = false,
  parallel = false,
  gameShots = [],
  signal = null,
  size = [1280, 720],
  cache = PACK_CACHE,
} = {}) {
  if (process.platform !== 'linux')
    throw new Error('клиентский стенд — для Linux (test1a); с Mac: npm run client-stand');
  const ver = packVersion(cache);
  const nf = neoforgeOf(ver.loader) || DEFAULT_NF;
  if (!fs.existsSync(XVFB) || !fs.existsSync(path.join(LAUNCHER, 'versions', `neoforge-${nf}`)))
    throw new Error(`стенд не готов для NeoForge ${nf}: сначала prepare`);
  const bad = badShotPrefixes(gameShots);
  if (bad)
    throw new Error(
      `--game-shots: префикс — часть имени файла (буквы, цифры, . _ -), не путь и не маска: ${bad.join(', ')}`,
    );
  const busy = liveRuns().filter((r) => r.live);
  if (busy.length && !parallel)
    throw new Error(
      `уже идёт прогон ${busy.map((r) => path.basename(r.dir)).join(', ')} — дождитесь его или --parallel (памяти на два клиента по 8G не хватит)`,
    );

  const id = `${stamp()}-${randomBytes(2).toString('hex')}`;
  const run = ram ? path.join('/dev/shm', `tfc-client-${id}`) : path.join(STAND, 'runs', id);
  const out = path.join(STAND, 'results', id);
  const game = path.join(run, 'game');
  fs.mkdirSync(path.join(run, 'natives'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(run, 'stand.json'), JSON.stringify({ pid: process.pid, id, out }));
  const started = Date.now();
  const secs = () => Math.round((Date.now() - started) / 1000);
  const pngs = [];
  const notes = [];
  let display;
  let profile;
  let worldNote = null;
  ready ??= world ? READY_WORLD : READY;
  let state = 'не запускалась';
  let readySec = null;
  let failScreen = null;
  let shownSec = null;
  let stopped = '';
  let shotsOut = { files: [], skipped: 0 };
  try {
    profile = buildProfile({ game, cache, mods, exclude, overlay, copyMods: ram });
    if (world) worldNote = setupWorld(game, world, versionJson(`neoforge-${nf}`).inheritsFrom);
    display = await startDisplay(run, size);
    const env = {
      ...process.env,
      DISPLAY: display.display,
      XAUTHORITY: display.auth,
      LIBGL_ALWAYS_SOFTWARE: '1',
      // llvmpipe отдаёт OpenGL 4.5, а Voxy компилирует шейдеры GLSL 4.60 и роняет клиент при входе в мир
      MESA_GL_VERSION_OVERRIDE: '4.6',
      MESA_GLSL_VERSION_OVERRIDE: '460',
    };
    log(`прогон ${id}: экран ${display.display}, модов ${profile.used}, NeoForge ${nf}`);
    const fd = fs.openSync(path.join(run, 'client.log'), 'w');
    const child = spawn(java(), launchCommand({ nf, game, natives: path.join(run, 'natives'), memory, size, world }), {
      cwd: game,
      env,
      stdio: ['ignore', fd, fd],
      detached: true,
    });
    fs.closeSync(fd);
    stopWithProcess(child);
    let exitCode;
    child.once('exit', (code, signal) => (exitCode = signal ?? code));
    const exited = () => exitCode !== undefined;
    state = `не дошла до ${world ? 'мира' : 'меню'}`;
    const deadline = started + timeout * 1000;
    let lastNote = 0;
    const aborted = () => Boolean(signal?.aborted);
    // Пауза, которую прерывает обрыв вызова
    const wait = async (ms) => {
      for (const end = Date.now() + ms; Date.now() < end && !aborted();) await sleep(Math.min(500, end - Date.now()));
    };
    while (!exited() && !aborted() && Date.now() < deadline) {
      const text = readText(path.join(run, 'client.log'));
      if (ready.test(text)) {
        readySec = secs();
        break;
      }
      failScreen = world ? (WORLD_FAIL.exec(text)?.[1] ?? null) : null;
      if (failScreen) break;
      if (secs() - lastNote >= 60) {
        lastNote = secs();
        log(`жду ${world ? 'вход в мир' : 'главное меню'}: ${lastNote} с`);
      }
      await sleep(2000);
    }
    if (readySec !== null) {
      state = world ? 'в мире' : 'главное меню';
      if (world) {
        // Игрок вошёл раньше, чем мир на экране: на программном OpenGL «Загрузка территории…» висит минутами, и этот
        // кадр неподвижен. Пробные снимки раз в 10 с, пока картинка не сменится (не дольше load)
        log(`игрок вошёл через ${readySec} с, жду мир на экране (до ${load} с)`);
        let first = null;
        for (let n = 0; !exited() && !aborted(); n++) {
          const probe = path.join(run, 'probe.png');
          if (capture(env, probe)) break;
          const hash = sha1(fs.readFileSync(probe));
          if (first !== null && hash !== first) {
            shownSec = secs();
            break;
          }
          first ??= hash;
          if (secs() - readySec >= load) {
            notes.push(`картинка не менялась ${load} с после входа — вероятно, всё ещё «Загрузка территории…»`);
            break;
          }
          await wait(10_000);
        }
      }
      log(`${state} через ${shownSec ?? readySec} с, снимаю экран через ${settle} с`);
      await wait(settle * 1000);
      for (let i = 1; i <= shots && !exited() && !aborted(); i++) {
        const file = path.join(run, `${world ? 'world' : 'menu'}-${String(i).padStart(2, '0')}.png`);
        const err = capture(env, file);
        if (err) notes.push(`снимок ${i} не вышел: ${err.split('\n').at(-1)}`);
        else pngs.push(file);
        if (i < shots) await wait(interval * 1000);
      }
    } else if (failScreen) {
      state = `мир не открылся: экран ${failScreen.split('.').at(-1)} через ${secs()} с`;
      await wait(5000);
      const file = path.join(run, 'world-error.png');
      if (!capture(env, file)) pngs.push(file);
    } else if (aborted()) state = 'прерван (оборвался вызов)';
    else if (exited()) state = `вышла до ${world ? 'входа в мир' : 'меню'} (код ${exitCode})`;
    else {
      state = `не дошла до ${world ? 'мира' : 'меню'} за ${timeout} с`;
      const file = path.join(run, 'timeout.png');
      if (!capture(env, file)) pngs.push(file);
    }
    stopped = await stopGame(child, exited);
  } finally {
    if (display) await stopDisplay(display);
    collect(game, run, out);
    shotsOut = collectGameShots(game, out, gameShots);
    for (const f of pngs) fs.copyFileSync(f, path.join(out, path.basename(f)));
    if (!keep) fs.rmSync(run, { recursive: true, force: true, maxRetries: 3 });
  }

  // ------------------------------------------------------------ сводка
  const latest = readText(path.join(out, 'latest.log')) || readText(path.join(out, 'client.log'));
  const kjs = [...latest.matchAll(/Loaded \d+\/\d+ KubeJS (startup|client) scripts[^\n]*/g)].map((m) => m[0]);
  const logErr = errorLines(latest, /\/(ERROR|FATAL)\]/, 25, NOISE);
  const crashes = fs.existsSync(path.join(out, 'crash-reports')) ? fs.readdirSync(path.join(out, 'crash-reports')) : [];
  const ok = readySec !== null && pngs.length > 0 && !crashes.length;
  const text = [
    `Клиентский стенд: снимок ${ver.snapshot ?? '?'}, NeoForge ${nf}, прогон ${id}`,
    `итог: ${state}${readySec !== null ? ` за ${readySec} с` : ''}${shownSec !== null ? `, мир на экране через ${shownSec} с` : ''}; ${stopped || 'не запускалась'}; всего ${secs()} с`,
    profile
      ? `моды: ${profile.used} в профиле${profile.excluded ? `, убрано --exclude: ${profile.excluded}` : ''}${mods.length ? `, свои: ${mods.map((m) => path.basename(m)).join(', ')}` : ''}`
      : 'профиль не собран',
    ...(worldNote ? [`мир: ${worldNote}`] : []),
    ...(kjs.length ? ['KubeJS:', ...kjs.slice(-2).map((l) => '  ' + l)] : []),
    logErr.lines.length ? 'Ошибки latest.log (без повторов):' : 'Ошибок в latest.log нет.',
    ...logErr.lines.map((l) => '  ' + l),
    ...(logErr.more ? [`  … ещё ${logErr.more}`] : []),
    ...(logErr.noise ? [`  (+ ${logErr.noise} строк шума: звук, /dev/dri, пустые AT модов)`] : []),
    ...crashes.map((c) => `Краш: ${path.join(out, 'crash-reports', c)}`),
    ...notes,
    ...(gameShots.length
      ? [
          shotsOut.files.length
            ? `Игровые снимки (${gameShots.join(', ')}): ${shotsOut.files.length} в ${path.join(out, 'screenshots')}`
            : `Игровых снимков с префиксом ${gameShots.join(', ')} в game/screenshots нет`,
          ...shotsOut.files.map(
            (f) => `  ${f.name} — ${f.dims.join('×')}, ${Math.max(1, Math.round(f.size / 1024))} КБ`,
          ),
          ...(shotsOut.skipped ? [`  пропущено ${shotsOut.skipped} (сверх ${MAX_GAME_SHOTS} или не PNG)`] : []),
        ]
      : []),
    `PNG: ${pngs.length ? pngs.map((f) => path.join(out, path.basename(f))).join(', ') : 'нет'}`,
    `Журналы: ${out}${keep ? `; папка прогона оставлена: ${run}` : ''}`,
  ].join('\n');
  fs.writeFileSync(path.join(out, 'summary.txt'), `${text}\n`);
  return { ok, text, out };
}

// ------------------------------------------------------------------ уборка

/** Брошенные прогоны (процесс умер — Xvfb и папку убрать) и старые результаты сверх results */
export function clean({ results = 10 } = {}) {
  const lines = [];
  for (const r of liveRuns()) {
    if (r.live) {
      lines.push(`идёт: ${r.dir}`);
      continue;
    }
    fs.rmSync(r.dir, { recursive: true, force: true });
    lines.push(`убран брошенный прогон: ${r.dir}`);
  }
  // Xvfb стенда без живого прогона: его экран никому не нужен
  const ps = spawnSync('pgrep', ['-u', String(os.userInfo().uid), '-a', '-f', XVFB], { encoding: 'utf8' });
  const live = new Set(
    liveRuns()
      .filter((r) => r.live)
      .map((r) => r.dir),
  );
  for (const l of (ps.stdout ?? '').split('\n').filter(Boolean)) {
    const [pid, ...cmd] = l.split(' ');
    const auth = cmd[cmd.indexOf('-auth') + 1] ?? '';
    if ([...live].some((d) => auth.startsWith(d))) continue;
    killTree(Number(pid));
    lines.push(`погашен Xvfb ${pid} (${cmd[1] ?? '?'})`);
  }
  for (let n = 90; n < 140; n++) {
    const had = fs.existsSync(`/tmp/.X${n}-lock`);
    dropStaleDisplay(n);
    if (had && !fs.existsSync(`/tmp/.X${n}-lock`)) lines.push(`убран брошенный экран :${n}`);
  }
  const dir = path.join(STAND, 'results');
  const all = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  for (const n of all.slice(0, Math.max(0, all.length - results))) {
    fs.rmSync(path.join(dir, n), { recursive: true, force: true });
    lines.push(`удалён результат ${n}`);
  }
  return lines.length ? lines.join('\n') : 'Убирать нечего.';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, ...argv] = process.argv.slice(2);
  const many = (f) => argv.flatMap((a, i) => (a === f && argv[i + 1] ? [argv[i + 1]] : []));
  const one = (f) => many(f).at(-1);
  const num = (f, d) => (one(f) ? Number(one(f)) : d);
  // Вызов по ssh: оборвалось соединение — закрылся stdin. Игра выходит штатно, журналы собираются, папка и экран убираются; не успели за 90 с — выход жёстко
  const abort = new AbortController();
  if (argv.includes('--stdin-watch')) {
    process.stdin.on('end', () => {
      if (abort.signal.aborted) return;
      log('вызов оборвался — останавливаю прогон');
      abort.abort();
      setTimeout(() => process.exit(129), 90_000).unref();
    });
    process.stdin.resume();
  }
  const job =
    cmd === 'prepare'
      ? prepare({ neoforge: one('--neoforge'), installer: one('--installer'), assets: one('--assets') ?? 'base' })
      : cmd === 'run'
        ? runClient({
            mods: many('--mod'),
            exclude: many('--exclude'),
            overlay: one('--overlay') ?? null,
            timeout: num('--timeout', 900),
            settle: num('--settle', 20),
            load: num('--load', 300),
            shots: num('--shots', 1),
            interval: num('--interval', 10),
            memory: one('--memory') ?? '8G',
            ready: one('--ready') ? new RegExp(one('--ready')) : null,
            world: one('--world') ?? null,
            ram: argv.includes('--ram'),
            keep: argv.includes('--keep'),
            parallel: argv.includes('--parallel'),
            gameShots: many('--game-shots'),
            size: (one('--size') ?? '1280x720').split('x').map(Number),
            signal: abort.signal,
          }).then((r) => {
            process.exitCode = r.ok ? 0 : 1;
            return `${r.text}\nRESULT ${r.out}`;
          })
        : cmd === 'clean'
          ? Promise.resolve(clean({ results: num('--results', 10) }))
          : Promise.reject(new Error('команда: prepare | run | clean (см. начало scripts/client-stand.mjs)'));
  job.then(
    (text) => {
      console.log(text);
      if (argv.includes('--stdin-watch')) process.stdin.destroy();
    },
    (e) => {
      console.error(e.message);
      process.exitCode = 1;
      if (argv.includes('--stdin-watch')) process.stdin.destroy();
    },
  );
}
