#!/usr/bin/env node
/**
 * Одна команда на всю папку сборки: сама находит mods/, config/, defaultconfigs/, serverconfig/, kubejs/ и мир
 * и запускает нужные части — то, что по отдельности делают npm run mods / kubejs / serverconfig / world.
 *
 *   npm run pack -- <папка версии | zip>   — инстанс игры (папка с mods/) или папка сервера
 *   … --world <папка мира>                 — мир (иначе: level-name из server.properties, world/ или единственный в saves/)
 *   … --only mods,kubejs,config,world      — только эти части (можно несколько раз)
 *   … --out <папка>                        — данные сайта сюда, а не в public/
 *   … --instance <папка>                   — слои KubeJS и sources.json сюда, а не в instance/
 *   … --dry-run                            — ничего не писать в Firestore (config, мир) и в sources.json;
 *                                            данные сайта собираются как обычно (с --out — в отдельную папку)
 *
 * Части: mods → данные сайта из jar; kubejs → копия в <instance>/kubejs/pack и разбор (после mods — он читает
 * их данные); config — config/, defaultconfigs/, serverconfig/ (и <мир>/serverconfig/) → Firestore config;
 * world — <мир>/data/tfc_calendar.dat → Firestore config.
 *
 * <instance>/sources.json — что импортировано, откуда, когда, sha1 каждого файла: по нему видно, что устарело.
 *
 * Берётся только белый список из docs/plans/pack-directory.md. Не читаются никогда: server.properties (кроме
 * level-name), ops.json, whitelist.json, usercache.json, playerdata/, stats/, region/, options.txt, servers.dat.
 * Из config/ не берутся fancymenu, jmsharedmaps, CSC, voicechat, xaero и *.bak.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deployer, ROOT, writeConfigDocs } from './firestore-rest.mjs';
import { buildMods, DEFAULT_CACHE, DEFAULT_OUT } from './mods.mjs';
import { buildKubejs, importKubejsLayer } from './kubejs.mjs';
import { configDocs, logConfigDocs } from './serverconfig.mjs';
import { WANTED as WORLD_FILES, worldDocs } from './world.mjs';

const log = (...a) => console.log('[pack]', ...a);
const PARTS = ['mods', 'kubejs', 'config', 'world'];
const CONFIG_DIRS = ['config', 'defaultconfigs', 'serverconfig'];

/** Запреты внутри config/ — клиентское, чужие карты и голосовой чат, резервные копии */
const CONFIG_DENY = /^(fancymenu|jmsharedmaps|CSC|voicechat|xaero)(\/|$)|\.bak$/i;
export const configDenied = (rel) => CONFIG_DENY.test(rel.replaceAll('\\', '/'));

function args(argv) {
  const opts = { input: null, world: null, only: [], out: null, instance: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--world') opts.world = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--instance') opts.instance = argv[++i];
    else if (a === '--only') opts.only.push(...argv[++i].split(','));
    else if (!a.startsWith('--')) opts.input = a;
    else throw new Error(`неизвестный флаг ${a}`);
  }
  if (!opts.input) throw new Error('укажите папку версии или zip: npm run pack -- <путь>');
  for (const p of opts.only) if (!PARTS.includes(p)) throw new Error(`--only: ${p}? Части: ${PARTS.join(', ')}`);
  return opts;
}

// ---------------------------------------------------------------- вход

/** Путь из zip годится: только папки сборки и файлы мира из списка, остальное (списки игроков, регионы) — мимо */
function zipWanted(name) {
  const parts = name.replaceAll('\\', '/').split('/').filter(Boolean);
  const base = parts.at(-1);
  if (!base || name.endsWith('/')) return false;
  if (base in WORLD_FILES) return parts.at(-2) === 'data';
  const i = parts.findIndex((p) => p === 'mods' || p === 'kubejs' || CONFIG_DIRS.includes(p));
  if (i < 0) return false;
  if (parts[i] === 'mods') return i === parts.length - 2 && base.endsWith('.jar');
  if (parts[i] === 'config') return !configDenied(parts.slice(i + 1).join('/'));
  if (parts[i] === 'kubejs') return /^(server_scripts|startup_scripts|data|assets)$/.test(parts[i + 1] ?? '');
  return true;
}

/** zip → временная папка в кеше, только нужное из белого списка */
function unpack(zipFile, cacheDir) {
  const data = fs.readFileSync(zipFile);
  const dir = path.join(cacheDir, 'pack-input', createHash('sha1').update(data).digest('hex').slice(0, 16));
  fs.rmSync(dir, { recursive: true, force: true });
  const entries = unzipSync(new Uint8Array(data), { filter: (f) => zipWanted(f.name) });
  for (const [name, bytes] of Object.entries(entries)) {
    const target = path.join(dir, name);
    if (!target.startsWith(dir + path.sep)) continue; // ../ в имени
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  log(`${path.basename(zipFile)}: распаковано ${Object.keys(entries).length} файлов → ${dir}`);
  return dir;
}

/** Путь для сообщений: от корня репозитория, если внутри него */
const shown = (file) => (file.startsWith(ROOT + path.sep) ? path.relative(ROOT, file) : file);
const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();

/** Корень сборки — папка, где лежит хоть одна из mods/, kubejs/, config/…; в zip обычно есть обёртка */
function findRoot(dir, depth = 0) {
  if (['mods', 'kubejs', ...CONFIG_DIRS].some((d) => isDir(path.join(dir, d)))) return dir;
  if (depth >= 3) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const found = findRoot(path.join(dir, e.name), depth + 1);
    if (found) return found;
  }
  return null;
}

/** Мир — по level.dat (в zip его нет, там — по файлам мира из списка) */
const isWorld = (d) =>
  fs.existsSync(path.join(d, 'level.dat')) ||
  Object.keys(WORLD_FILES).some((f) => fs.existsSync(path.join(d, 'data', f)));

/** level-name из server.properties — остальное из файла не читаем (там адреса и пароли RCON) */
function levelName(root) {
  try {
    const m = /^level-name=(.*)$/m.exec(fs.readFileSync(path.join(root, 'server.properties'), 'utf8'));
    return m?.[1].trim() || null;
  } catch {
    return null;
  }
}

/** Папка мира: --world, level-name сервера, world/, единственный мир в saves/ или прямо в корне */
function findWorld(root, wanted) {
  if (wanted) {
    const p = [wanted, path.join(root, wanted), path.join(root, 'saves', wanted)].find(isDir);
    if (!p) throw new Error(`--world: нет папки ${wanted}`);
    return { dir: path.resolve(p) };
  }
  const level = levelName(root);
  if (level && isWorld(path.join(root, level))) return { dir: path.join(root, level), why: 'level-name сервера' };
  const candidates = [];
  for (const base of [root, path.join(root, 'saves')]) {
    if (!isDir(base)) continue;
    for (const e of fs.readdirSync(base, { withFileTypes: true }))
      if (e.isDirectory() && isWorld(path.join(base, e.name))) candidates.push(path.join(base, e.name));
  }
  if (candidates.length === 1) return { dir: candidates[0], why: 'единственный мир' };
  if (candidates.length > 1)
    return {
      dir: null,
      note: `миров несколько — укажите --world: ${candidates.map((c) => path.basename(c)).join(', ')}`,
    };
  return { dir: null, note: 'мир не найден (--world <папка>)' };
}

// ---------------------------------------------------------------- sources.json

const sha1 = (file) => createHash('sha1').update(fs.readFileSync(file)).digest('hex');

/** Файлы папки для снимка источников: [{ path (от корня сборки), size, sha1 }] */
function fileList(root, dir, keep = () => true) {
  if (!isDir(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .filter((rel) => keep(rel) && fs.statSync(path.join(dir, rel)).isFile())
    .sort()
    .map((rel) => {
      const full = path.join(dir, rel);
      return { path: path.relative(root, full).replaceAll('\\', '/'), size: fs.statSync(full).size, sha1: sha1(full) };
    });
}

function writeSources(file, parts) {
  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* первый запуск */
  }
  const out = { updatedAt: new Date().toISOString(), by: deployer('import'), parts: { ...prev.parts, ...parts } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  log(`снимок источников: ${shown(file)} (${Object.keys(parts).join(', ')})`);
}

// ---------------------------------------------------------------- main

/**
 * Разбор папки сборки целиком. Возвращает { root, world, parts, firestore }: parts — что запускалось, откуда и с какими
 * файлами; firestore — документы config (с dryRun не записаны — их пишет сервер сборки при публикации).
 * cacheDir — кеш jar (как у npm run mods); outDir — данные сайта; instanceDir — слои KubeJS и sources.json.
 */
export async function runPack({ input, cacheDir = DEFAULT_CACHE, ...opts }) {
  if (!fs.existsSync(input)) throw new Error(`нет ${input}`);
  if (isDir(input)) return packDir(input, path.resolve(input), { cacheDir, ...opts });
  // Распакованный zip нужен только на время разбора: jar модов — сотни МБ
  const unpacked = unpack(input, cacheDir);
  try {
    return await packDir(input, unpacked, { cacheDir, ...opts });
  } finally {
    fs.rmSync(unpacked, { recursive: true, force: true });
  }
}

async function packDir(
  input,
  unpacked,
  {
    world: wantedWorld = null,
    only = [],
    outDir = DEFAULT_OUT,
    instanceDir = path.join(ROOT, 'instance'),
    cacheDir,
    dryRun = false,
  },
) {
  const root = findRoot(unpacked);
  if (!root) throw new Error(`в ${input} нет ни mods/, ни kubejs/, ни config/ — это не папка версии`);
  const want = (p) => !only.length || only.includes(p);
  const at = new Date().toISOString();
  const from = (dir) => (isDir(input) ? dir : `${path.basename(input)}:${path.relative(unpacked, dir) || '.'}`);

  const world = want('world') || want('config') ? findWorld(root, wantedWorld) : { dir: null };
  log(`сборка: ${root}`);
  if (world.dir) log(`мир: ${world.dir}${world.why ? ` (${world.why})` : ''}`);
  else if (world.note && want('world')) log(world.note);

  const parts = {};
  const firestore = [];

  const modsDir = path.join(root, 'mods');
  if (want('mods') && isDir(modsDir)) {
    await buildMods({ modsDir, outDir, cacheDir });
    parts.mods = {
      at,
      from: from(modsDir),
      files: fileList(root, modsDir, (f) => f.endsWith('.jar') && !f.includes(path.sep)),
    };
  } else if (want('mods') && only.length) log('mods/ нет — данные модов не собираю');

  const kubejsDir = path.join(root, 'kubejs');
  if (want('kubejs') && isDir(kubejsDir)) {
    const layers = path.join(instanceDir, 'kubejs');
    importKubejsLayer(kubejsDir, 'pack', { instanceDir: layers });
    buildKubejs({ instanceDir: layers, outDir });
    parts.kubejs = {
      at,
      from: from(kubejsDir),
      files: fileList(root, kubejsDir, (f) => /^(server_scripts|startup_scripts|data|assets)[\\/]/.test(f)),
    };
  } else if (want('kubejs') && only.length) log('kubejs/ нет — разбор KubeJS не запускаю');

  if (want('config')) {
    // Позднее перекрывает раннее с тем же id: defaultconfigs/ точнее config/ для сервера
    const dirs = CONFIG_DIRS.map((d) => path.join(root, d));
    if (world.dir) dirs.push(path.join(world.dir, 'serverconfig'));
    const byId = new Map();
    const skipped = { other: 0, excluded: 0, client: 0, secret: [], unusual: [] };
    const files = [];
    for (const dir of dirs.filter(isDir)) {
      const res = configDocs(dir, { exclude: configDenied });
      for (const d of res.docs) byId.set(d.id, d);
      for (const k of ['other', 'excluded', 'client']) skipped[k] += res.skipped[k];
      skipped.secret.push(...res.skipped.secret);
      skipped.unusual.push(...res.skipped.unusual);
      const used = new Set(res.docs.map((d) => d.data.path));
      // В снимок — только то, что ушло в Firestore: остальные конфиги сайт не читает
      files.push(...fileList(root, dir, (f) => used.has(f.replaceAll('\\', '/'))));
    }
    if (byId.size) {
      logConfigDocs([...byId.values()], skipped);
      firestore.push(...byId.values());
      parts.config = { at, from: from(root), files };
    } else log('конфигов модов (*.toml) не найдено');
  }

  if (want('world') && world.dir) {
    const docs = await worldDocs(world.dir);
    if (docs.length) {
      firestore.push(...docs);
      parts.world = {
        at,
        from: from(world.dir),
        files: fileList(root, path.join(world.dir, 'data'), (f) => f in WORLD_FILES),
      };
    } else log(`в мире нет ${Object.keys(WORLD_FILES).join(', ')}`);
  }

  if (!Object.keys(parts).length) throw new Error('ничего не нашлось для разбора');
  if (dryRun) {
    log(`--dry-run: в Firestore не пишу (документов было бы ${firestore.length}), sources.json не трогаю`);
    return { root, world: world.dir, parts, firestore };
  }
  if (firestore.length) {
    await writeConfigDocs(firestore);
    log(`записано в Firestore config: ${firestore.length}`);
  }
  writeSources(path.join(instanceDir, 'sources.json'), parts);
  return { root, world: world.dir, parts, firestore };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  Promise.resolve()
    .then(() => {
      const o = args(process.argv.slice(2));
      return runPack({
        input: o.input,
        world: o.world,
        only: o.only,
        dryRun: o.dryRun,
        ...(o.out ? { outDir: path.resolve(o.out) } : {}),
        ...(o.instance ? { instanceDir: path.resolve(o.instance) } : {}),
      });
    })
    .catch((e) => {
      console.error(`[pack] ${e.message ?? e}`);
      process.exit(1);
    });
}
