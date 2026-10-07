#!/usr/bin/env node
/**
 * Собирает библиотеку внутриигровых предметов для подсказок:
 *   public/items.json   — [{ i: id, e: имя en, r: имя ru, t: путь к иконке, s: источник }]
 *   public/icons/...    — png-текстуры, на которые ссылаются предметы
 *
 * Источники:
 *   - ванильный Minecraft (client.jar с серверов Mojang + ru_ru из asset index)
 *   - все jar из папки mods/ — просто скопируйте туда моды сборки
 *   - MOD_SOURCES (sparse git clone) — запасной вариант для TFC, если его jar нет в mods/
 *
 * Сгенерированные файлы не коммитятся (это ассеты Mojang/авторов модов).
 *
 * Использование:  npm run items          (пересобрать, используя кеш)
 *                 npm run items -- --fresh  (скачать всё заново)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { writeManifest } from './manifest.mjs';
import { writeGeo } from './geo.mjs';
import { buildReference } from './reference.mjs';

const MC_VERSION = '1.21.1';

/**
 * Моды из GitHub. Используются, только если такой namespace не нашёлся ни в одном jar из mods/
 * (тогда берётся jar — он точно совпадает с версией в сборке).
 */
const MOD_SOURCES = [
  {
    name: 'tfc',
    repo: 'https://github.com/TerraFirmaCraft/TerraFirmaCraft.git',
    branch: '1.21.x',
    assetsDir: 'src/main/resources/assets',
    namespaces: ['tfc'],
  },
  // Пример для аддона:
  // { name: 'firmalife', repo: 'https://github.com/eerussianguy/firmalife.git', branch: '1.21.x',
  //   assetsDir: 'src/main/resources/assets', namespaces: ['firmalife'] },
];

/** Текстуры, нужные интерфейсу (фон, иконки кнопок), даже если ни один предмет на них не ссылается */
const UI_TEXTURES = [
  'minecraft:block/dirt',
  'minecraft:block/stone',
  'minecraft:block/oak_planks',
  'minecraft:item/writable_book',
  'minecraft:item/written_book',
  'minecraft:item/book',
  'minecraft:item/paper',
  'minecraft:item/compass_00',
  'minecraft:item/clock_00',
  'minecraft:item/experience_bottle',
  'minecraft:item/nether_star',
  'minecraft:item/barrier',
  'minecraft:item/name_tag',
  'minecraft:item/chest_minecart',
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'assets');
const MODS_DIR = path.join(ROOT, 'mods');
export const SIGNATURE_FILE = path.join(ROOT, '.cache', 'items-signature.json');
const OUT_ICONS = path.join(ROOT, 'public', 'icons');
const OUT_JSON = path.join(ROOT, 'public', 'items.json');
const OUT_RECIPES = path.join(ROOT, 'public', 'recipes.json');
const OUT_REFERENCE = path.join(ROOT, 'public', 'reference.json');
const OUT_MANIFEST = path.join(ROOT, 'public', 'pack-manifest.json');
const fresh = process.argv.includes('--fresh');

const log = (...a) => console.log('[items]', ...a);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Скачивает client.jar и вытаскивает models/textures/lang en_us; ru_ru берёт из asset index */
async function prepareVanilla() {
  const dir = path.join(CACHE, `minecraft-${MC_VERSION}`);
  // .done-v3 — кеш с рецептами и тегами (v1 — только ассеты, v2 — без тегов)
  const done = path.join(dir, '.done-v3');
  if (fs.existsSync(done) && !fresh) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  log(`vanilla ${MC_VERSION}: читаю манифест версий`);
  const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const ver = manifest.versions.find((v) => v.id === MC_VERSION);
  if (!ver) throw new Error(`Версия ${MC_VERSION} не найдена в манифесте`);
  const meta = await fetchJson(ver.url);

  log('vanilla: качаю client.jar (~25MB)');
  const zip = new AdmZip(await fetchBuffer(meta.downloads.client.url));
  const wanted =
    /^(assets\/minecraft\/(models\/(item|block)\/|textures\/(item|block)\/|lang\/en_us\.json)|data\/minecraft\/(recipe|tags\/item)\/.+\.json$)/;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !wanted.test(entry.entryName)) continue;
    const target = path.join(dir, entry.entryName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
  }

  log('vanilla: качаю ru_ru.json');
  const index = await fetchJson(meta.assetIndex.url);
  const ru = index.objects['minecraft/lang/ru_ru.json'];
  if (ru) {
    const buf = await fetchBuffer(`https://resources.download.minecraft.net/${ru.hash.slice(0, 2)}/${ru.hash}`);
    fs.writeFileSync(path.join(dir, 'assets/minecraft/lang/ru_ru.json'), buf);
  }
  fs.writeFileSync(done, new Date().toISOString());
  return dir;
}

/** Sparse-клон только нужных папок мода */
function prepareMod(src) {
  const dir = path.join(CACHE, src.name);
  if (fs.existsSync(path.join(dir, '.git')) && !fresh) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  log(`${src.name}: sparse clone ${src.repo}@${src.branch}`);
  const git = (...args) => execFileSync('git', args, { stdio: 'inherit' });
  git('clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', src.branch, src.repo, dir);
  const paths = src.namespaces.flatMap((ns) =>
    ['models/item', 'models/block', 'textures/item', 'textures/block', 'lang'].map(
      (p) => `${src.assetsDir}/${ns}/${p}`,
    ),
  );
  git('-C', dir, 'sparse-checkout', 'set', '--no-cone', ...paths);
  return dir;
}

/** Список jar в mods/ с размером и датой — по нему понимаем, что сборка изменилась */
export function modsSignature() {
  if (!fs.existsSync(MODS_DIR)) return [];
  return fs
    .readdirSync(MODS_DIR)
    .filter((f) => f.endsWith('.jar'))
    .sort()
    .map((f) => {
      const st = fs.statSync(path.join(MODS_DIR, f));
      return `${f}:${st.size}:${Math.round(st.mtimeMs)}`;
    });
}

/**
 * Распаковывает из jar только assets/<ns>/{models,textures,lang/en_us|ru_ru}.
 * Результат кешируется по имени+размеру+дате файла, повторный запуск ничего не распаковывает.
 */
function prepareJar(file) {
  const st = fs.statSync(file);
  const key = `${path.basename(file, '.jar')}-${st.size}-${Math.round(st.mtimeMs)}`.replace(/[^\w.+-]/g, '_');
  const dir = path.join(CACHE, 'jars', key);
  // v4 — плюс теги, жилы, данные TFC для справочника и география TFC Real World
  const done = path.join(dir, '.done-v4');
  if (!fs.existsSync(done) || fresh) {
    fs.rmSync(dir, { recursive: true, force: true });
    let zip;
    try {
      zip = new AdmZip(file);
    } catch (e) {
      log(`пропускаю ${path.basename(file)}: не читается как zip (${e.message})`);
      return null;
    }
    // Рецепты — только папка recipe/ (1.21); recipes/ в некоторых jar — остатки 1.20, игра их не читает.
    // Для справочника: теги предметов, конфиги жил, данные TFC (топливо, еда, нагрев).
    const wanted =
      /^(assets\/[a-z0-9_.-]+\/(models\/.+\.json|textures\/.+\.png|lang\/(en_us|ru_ru)\.json)|data\/[a-z0-9_.-]+\/(recipe\/.+|tags\/item\/.+|worldgen\/configured_feature\/(vein\/.+|[^/]*vein[^/]*)|tfc\/(fuel|food|fluid_heat)\/.+|geography\/.+|profiles\/.+\/settings)\.json|data\/[a-z0-9_.-]+\/profiles\/.+\/maps\/(continent|altitude|koppen|temperature|rainfall)\.png)$/;
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !wanted.test(entry.entryName)) continue;
      const target = path.join(dir, entry.entryName);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData());
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(done, new Date().toISOString());
  }
  const assets = path.join(dir, 'assets');
  const namespaces = fs.existsSync(assets) ? fs.readdirSync(assets).filter((n) => !n.startsWith('.')) : [];
  return { root: assets, namespaces, data: path.join(dir, 'data') };
}

/**
 * JSON из модов бывает «грязным»: BOM в начале, комментарии, висячие запятые.
 * Пытаемся прочитать строго, потом — после чистки; не вышло — null.
 */
function parseLooseJson(text) {
  const t = text.replace(/^\uFEFF/, '');
  try {
    return JSON.parse(t);
  } catch {
    try {
      const cleaned = t
        .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? '')
        .replace(/,(\s*[}\]])/g, '$1');
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------- модели → текстура

/**
 * namespace → каталоги assets, где лежит <ns>/models, <ns>/textures. Один namespace может быть
 * в нескольких jar (аддоны дописывают модели в чужой namespace) — ищем по порядку.
 */
const assetRoots = new Map();
function addRoot(ns, root) {
  const list = assetRoots.get(ns) ?? [];
  if (!list.includes(root)) list.push(root);
  assetRoots.set(ns, list);
}
/** Первый существующий файл <root>/<ns>/<rel> среди корней namespace */
function findAsset(ns, rel) {
  for (const root of assetRoots.get(ns) ?? []) {
    const file = path.join(root, ns, rel);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function splitId(ref, defaultNs = 'minecraft') {
  const [ns, p] = ref.includes(':') ? ref.split(':', 2) : [defaultNs, ref];
  return { ns, p };
}

const modelCache = new Map();
function readModel(ref) {
  const { ns, p } = splitId(ref);
  const key = `${ns}:${p}`;
  if (modelCache.has(key)) return modelCache.get(key);
  let model = null;
  const file = findAsset(ns, `models/${p}.json`);
  if (file) {
    model = parseLooseJson(fs.readFileSync(file, 'utf8'));
  }
  modelCache.set(key, model);
  return model;
}

/** Собирает словарь текстур по цепочке parent'ов (дочерние перекрывают родительские) */
function collectTextures(ref, depth = 0) {
  if (depth > 12) return {};
  const model = readModel(ref);
  if (!model) return {};
  // neoforge:separate_transforms — берём вид для GUI
  const parentRef = model.parent ?? model.perspectives?.gui?.parent ?? model.base?.parent;
  const parent = parentRef ? collectTextures(parentRef, depth + 1) : {};
  return { ...parent, ...(model.textures ?? {}) };
}

const TEXTURE_PRIORITY = [
  'layer0',
  'all',
  'side',
  'texture',
  'front',
  'cross',
  'plant',
  'top',
  'end',
  'wool',
  'particle',
];

function textureFile(texRef) {
  const { ns, p } = splitId(texRef);
  const file = findAsset(ns, `textures/${p}.png`);
  if (file) return { ns, p, file };
  // Часть текстур TFC генерируется в рантайме перекраской базовой (wood/lumber_acacia ← wood/lumber)
  let base = p;
  while (/_[a-z0-9]+$/.test(base)) {
    base = base.replace(/_[a-z0-9]+$/, '');
    const baseFile = findAsset(ns, `textures/${base}.png`);
    if (baseFile) return { ns, p: base, file: baseFile };
  }
  return null;
}

function resolveIcon(itemModelRef) {
  const textures = collectTextures(itemModelRef);
  const deref = (v, n = 0) =>
    typeof v === 'string' && v.startsWith('#') && n < 10 ? deref(textures[v.slice(1)], n + 1) : v;
  const keys = [...TEXTURE_PRIORITY, ...Object.keys(textures)];
  const { ns: itemNs } = splitId(itemModelRef);
  // Сначала текстуры самого мода: у шестерни Create «particle» — ванильное бревно, а нужна её собственная
  for (const ownOnly of [true, false]) {
    for (const k of keys) {
      const v = deref(textures[k]);
      if (typeof v !== 'string' || v.startsWith('#')) continue;
      if (ownOnly && splitId(v).ns !== itemNs) continue;
      const tex = textureFile(v);
      if (tex) return tex;
    }
  }
  return null;
}

/** namespace → (имя файла без .png → путь текстуры) — для поиска по имени предмета */
const textureIndex = new Map();
function texturesByName(ns) {
  if (textureIndex.has(ns)) return textureIndex.get(ns);
  const map = new Map();
  for (const root of assetRoots.get(ns) ?? []) {
    const base = path.join(root, ns, 'textures');
    if (!fs.existsSync(base)) continue;
    for (const rel of fs.readdirSync(base, { recursive: true })) {
      if (!rel.endsWith('.png')) continue;
      const p = rel.slice(0, -4).split(path.sep).join('/');
      if (!/^(item|block)s?\//.test(p)) continue;
      const name = p.split('/').pop();
      // Предпочитаем item/ перед block/
      if (!map.has(name) || p.startsWith('item')) map.set(name, p);
    }
  }
  textureIndex.set(ns, map);
  return map;
}

/** Для 3D/OBJ-моделей без явной текстуры (мультиблоки IE и т.п.) — текстура с тем же именем */
function iconByName(ns, p) {
  const name = p.split('/').pop();
  const found = texturesByName(ns).get(name);
  return found ? textureFile(`${ns}:${found}`) : null;
}

/** Иконки для предметов, чья текстура целиком собирается в рантайме (жидкости в вёдрах и т.п.) */
function fallbackIcon(p) {
  if (p.startsWith('bucket/')) return textureFile('minecraft:item/water_bucket');
  if (p.includes('coral')) return textureFile('minecraft:block/tube_coral_fan');
  return null;
}

// ---------------------------------------------------------------- сборка

function readLang(root, ns, lang) {
  const file = path.join(root, ns, 'lang', `${lang}.json`);
  if (!fs.existsSync(file)) return {};
  const data = parseLooseJson(fs.readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object') {
    log(`⚠ не читается ${path.relative(CACHE, file)} — пропускаю переводы ${ns} (${lang})`);
    return {};
  }
  return data;
}

const copied = new Set();
function copyIcon(tex) {
  const rel = `${tex.ns}/${tex.p}`;
  if (!copied.has(rel)) {
    const target = path.join(OUT_ICONS, `${rel}.png`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(tex.file, target);
    copied.add(rel);
  }
  return rel;
}

function collectRecipes(into, dataDir, source) {
  if (!fs.existsSync(dataDir)) return;
  for (const ns of fs.readdirSync(dataDir)) {
    const base = path.join(dataDir, ns, 'recipe');
    if (!fs.existsSync(base)) continue;
    for (const rel of fs.readdirSync(base, { recursive: true })) {
      if (!rel.endsWith('.json')) continue;
      const json = parseLooseJson(fs.readFileSync(path.join(base, rel), 'utf8'));
      if (!json || typeof json !== 'object') continue;
      const p = rel.slice(0, -5).split(path.sep).join('/');
      into.set(`${ns}:${p}`, { source, json });
    }
  }
}

/** public/recipes.json: [{ i: "ns:path" (= data/ns/recipe/path.json), t: тип, s: jar-источник, j: json }] */
function writeRecipes(recipes) {
  const list = [...recipes].map(([id, r]) => ({
    i: id,
    t: typeof r.json.type === 'string' ? r.json.type : '',
    s: r.source,
    j: r.json,
  }));
  fs.writeFileSync(OUT_RECIPES, JSON.stringify(list));
  log(
    `рецептов: ${list.length}, типов: ${new Set(list.map((r) => r.t)).size}, recipes.json ${Math.round(fs.statSync(OUT_RECIPES).size / 1024)}KB`,
  );
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const vanillaDir = await prepareVanilla();
  const vanillaRoot = path.join(vanillaDir, 'assets');
  addRoot('minecraft', vanillaRoot);
  /** Пары (namespace, корень), откуда читаем переводы и перечисляем предметы */
  const sources = [{ ns: 'minecraft', root: vanillaRoot }];

  // 1. Все jar из mods/
  const jars = fs.existsSync(MODS_DIR)
    ? fs
        .readdirSync(MODS_DIR)
        .filter((f) => f.endsWith('.jar'))
        .sort()
    : [];
  if (jars.length) log(`mods/: ${jars.length} jar`);
  /** Рецепты: «data/<ns>/recipe/<path>.json» → { источник, json }; поздние перекрывают ранние, как датапаки */
  const recipes = new Map();
  collectRecipes(recipes, path.join(vanillaDir, 'data'), 'minecraft');
  /** data/ всех источников в порядке загрузки — для справочника */
  const dataDirs = [{ dir: path.join(vanillaDir, 'data'), source: 'minecraft' }];
  for (const jar of jars) {
    const res = prepareJar(path.join(MODS_DIR, jar));
    if (!res) continue;
    collectRecipes(recipes, res.data, jar.replace(/\.jar$/, ''));
    dataDirs.push({ dir: res.data, source: jar.replace(/\.jar$/, '') });
    for (const ns of res.namespaces) {
      // Переопределения ванили внутри модов не должны перебивать оригинал
      if (ns === 'minecraft') continue;
      addRoot(ns, res.root);
      if (fs.existsSync(path.join(res.root, ns, 'lang', 'en_us.json'))) sources.push({ ns, root: res.root });
    }
  }

  // 2. GitHub-источники — только для того, чего нет среди jar
  for (const src of MOD_SOURCES) {
    const missing = src.namespaces.filter((ns) => !assetRoots.has(ns));
    if (!missing.length) continue;
    const dir = prepareMod(src);
    const root = path.join(dir, src.assetsDir);
    for (const ns of missing) {
      addRoot(ns, root);
      sources.push({ ns, root });
    }
  }

  fs.rmSync(OUT_ICONS, { recursive: true, force: true });
  const items = [];
  const seen = new Set();

  const perNs = new Map();
  for (const { ns, root } of sources) {
    const en = readLang(root, ns, 'en_us');
    const ru = readLang(root, ns, 'ru_ru');
    let count = 0;
    for (const [key, name] of Object.entries(en)) {
      const m = key.match(/^(item|block)\.([a-z0-9_]+)\.([a-z0-9_.]+)$/);
      if (!m || m[2] !== ns) continue;
      // В ключах перевода "/" из id превращается в "." — восстанавливаем путь
      const p = m[3].replaceAll('.', '/');
      const id = `${ns}:${p}`;
      if (seen.has(id)) continue;
      // Предметом считаем только то, у чего есть модель предмета
      if (!readModel(`${ns}:item/${p}`)) continue;
      const tex = resolveIcon(`${ns}:item/${p}`) ?? iconByName(ns, p) ?? fallbackIcon(p);
      seen.add(id);
      count++;
      items.push({
        i: id,
        e: name,
        ...(ru[key] && ru[key] !== name ? { r: ru[key] } : {}),
        ...(tex ? { t: copyIcon(tex) } : {}),
      });
    }
    if (count) perNs.set(ns, (perNs.get(ns) ?? 0) + count);
  }
  const summary = [...perNs].sort((a, b) => b[1] - a[1]);
  log(`по модам: ${summary.map(([ns, n]) => `${ns} ${n}`).join(', ')}`);

  for (const ref of UI_TEXTURES) {
    const tex = textureFile(ref);
    if (tex) copyIcon(tex);
    else log(`UI-текстура не найдена: ${ref}`);
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(items));
  writeRecipes(recipes);
  const ref = buildReference(dataDirs, recipes, parseLooseJson);
  fs.writeFileSync(OUT_REFERENCE, JSON.stringify(ref));
  log(
    `справочник: ${ref.veins.length} жил, ${ref.fuels.length} топлива, ${ref.foods.length} еды, ${ref.metals.length} металлов, ${ref.tagCount} тегов — ${Math.round(fs.statSync(OUT_REFERENCE).size / 1024)}KB`,
  );
  const geo = writeGeo(dataDirs, parseLooseJson, path.join(ROOT, 'public'));
  if (geo) log(`география: ${geo.profiles} профилей, ${geo.waypoints} городов, ${geo.maps} карт`);
  const manifest = writeManifest({
    jarPaths: jars.map((j) => path.join(MODS_DIR, j)),
    items,
    recipes,
    outFile: OUT_MANIFEST,
    cacheDir: path.join(ROOT, '.cache'),
  });
  log(
    `снимок сборки: ${manifest.mods.length} модов, pack-manifest.json ${Math.round(fs.statSync(OUT_MANIFEST).size / 1024)}KB`,
  );
  fs.writeFileSync(SIGNATURE_FILE, JSON.stringify(modsSignature()));
  const kb = Math.round(fs.statSync(OUT_JSON).size / 1024);
  log(`готово: ${items.length} предметов, ${copied.size} иконок, items.json ${kb}KB`);
}

// Запуск как скрипт (а не импорт из ensure-items)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
