#!/usr/bin/env node
/**
 * Собирает библиотеку внутриигровых предметов для подсказок:
 *   public/items.json   — [{ i: id, e: имя en, r: имя ru, t: путь к иконке, s: источник }]
 *   public/blocks.json  — блоки без своего предмета (ремень Create, шлюз на ремне…) и чем их ставят, scripts/mods/blocks.mjs
 *   public/icons/...    — png-текстуры, на которые ссылаются предметы
 *
 * Источники:
 *   - ванильный Minecraft (client.jar с серверов Mojang + ru_ru из asset index)
 *   - все jar сборки — копия снимка вне репозитория (npm run pack:fetch, scripts/pack-cache.mjs) или TFC_MODS_DIR
 *   - MOD_SOURCES (sparse git clone) — запасной вариант для TFC, если его jar нет среди них
 *
 * Сгенерированные файлы не коммитятся (это ассеты Mojang/авторов модов).
 *
 * Обычно данные модов собирает сервер сборки, а npm run dev берёт их оттуда; руками — для проверки разборщиков.
 * Использование:  npm run mods          (пересобрать, используя кеш)
 *                 npm run mods -- --fresh  (скачать всё заново)
 *
 * Из кода: buildMods({ modsDir, outDir, cacheDir, fresh }) — папка jar, папка данных сайта (вместо public/)
 * и кеша (вместо .cache/); по умолчанию — как у npm run mods.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { writeManifest } from './mods/manifest.mjs';
import { writeGeo } from './mods/geo.mjs';
import { buildReference } from './mods/reference.mjs';
import { writeTags } from './mods/tags.mjs';
import { writeBlocks } from './mods/blocks.mjs';
import { isBotanyClass, writeBotany } from './mods/botany.mjs';
import { isMealClass, writeMeals } from './mods/meals.mjs';
import { isCuisineClass, isCuisineData } from './mods/cuisine.mjs';
import { writePower } from './mods/power.mjs';
import { writeMultiblocks } from './mods/multiblocks.mjs';
import { makeRenderer } from './mods/icons3d.mjs';
import { writeBlockModels } from './mods/block-models.mjs';
import { platformAssets } from './mods/platform-assets.mjs';
import { MODS as MCP_MODS } from './mcp/data.mjs';
import { PACK_MODS } from './pack-cache.mjs';
import { platform, setPlatformAssets } from './mcp/jars.mjs';
import { hiddenItems } from './mods/visibility/index.mjs';

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
export const DEFAULT_MODS = PACK_MODS;
export const DEFAULT_OUT = path.join(ROOT, 'public');
export const DEFAULT_CACHE = path.join(ROOT, '.cache');
/** Список jar прошлой сборки — в папке кеша */
const signatureFile = (cacheDir) => path.join(cacheDir, 'items-signature.json');
/** Путь для сообщений: от корня репозитория, если внутри него */
const shown = (file) => (file.startsWith(ROOT + path.sep) ? path.relative(ROOT, file) : file);

/** Папки текущего запуска buildMods: распакованные ассеты (кеш) и иконки; fresh — не верить кешу */
let CACHE = path.join(DEFAULT_CACHE, 'assets');
let OUT_ICONS = path.join(DEFAULT_OUT, 'icons');
let fresh = false;

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
  // .done-v5 — кеш с рецептами и тегами предметов/жидкостей/блоков (v1 — только ассеты, v2 — без тегов, v3 — только item),
  // v5 — плюс blockstates и loot-таблицы блоков (блоки без предмета, scripts/mods/blocks.mjs)
  const done = path.join(dir, '.done-v5');
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
    /^(assets\/minecraft\/(models\/(item|block)\/|textures\/(item|block)\/|blockstates\/|lang\/en_us\.json)|data\/minecraft\/(recipe|tags\/(item|fluid|block|entity_type)|loot_table\/blocks)\/.+\.json$)/;
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

/** Список jar папки модов с размером и датой — по нему понимаем, что сборка изменилась */
export function modsSignature(modsDir = DEFAULT_MODS) {
  if (!fs.existsSync(modsDir)) return [];
  return fs
    .readdirSync(modsDir)
    .filter((f) => f.endsWith('.jar'))
    .sort()
    .map((f) => {
      const st = fs.statSync(path.join(modsDir, f));
      return `${f}:${st.size}:${Math.round(st.mtimeMs)}`;
    });
}

/**
 * Не даёт молча собрать библиотеку без модов, если прежняя сборка была с модами: так на сайт уходит каталог
 * из одной ванили и TFC, а pack-release записывает «убраны все моды». Типичный случай — деплой из git worktree,
 * где нет jar. Нарочно собрать без модов: TFC_ALLOW_NO_MODS=1.
 */
export function assertModsPresent({ modsDir = DEFAULT_MODS, outDir = DEFAULT_OUT, cacheDir = DEFAULT_CACHE } = {}) {
  if (modsSignature(modsDir).length || process.env.TFC_ALLOW_NO_MODS) return;
  const MODS_DIR = modsDir;
  const why = [];
  try {
    const prev = JSON.parse(fs.readFileSync(signatureFile(cacheDir), 'utf8'));
    if (prev.length) why.push(`прошлая сборка здесь была из ${prev.length} jar (${shown(signatureFile(cacheDir))})`);
  } catch {
    /* ещё не собирали */
  }
  try {
    const manifestFile = path.join(outDir, 'pack-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (manifest.mods?.length) why.push(`в ${shown(manifestFile)} ${manifest.mods.length} модов`);
  } catch {
    /* снимка нет */
  }
  if (!why.length) return;
  const err = new Error(
    [
      `в ${MODS_DIR} нет ни одного jar, а сборка была с модами: ${why.join('; ')}.`,
      'Библиотека без модов — это каталог из одной ванили и TFC; при деплое он ушёл бы на сайт, а в историю обновлений — «убраны все моды».',
      modsDir === DEFAULT_MODS
        ? 'Скачайте снимок сборки: npm run pack:fetch (или укажите папку с jar: TFC_MODS_DIR=…) и запустите снова.'
        : `Положите jar сборки в ${MODS_DIR} и запустите снова.`,
      'Если библиотека без модов нужна нарочно — TFC_ALLOW_NO_MODS=1.',
    ].join('\n'),
  );
  err.code = 'NO_MODS';
  throw err;
}

/**
 * Распаковывает из jar только assets/<ns>/{models,textures,lang/en_us|ru_ru}.
 * Результат кешируется по имени+размеру+дате файла, повторный запуск ничего не распаковывает.
 */
function prepareJar(file) {
  const st = fs.statSync(file);
  const key = `${path.basename(file, '.jar')}-${st.size}-${Math.round(st.mtimeMs)}`.replace(/[^\w.+-]/g, '_');
  const dir = path.join(CACHE, 'jars', key);
  // v20 — плюс данные и классы сковороды Cuisine Delight; v19 — плюс классы тегов модов; v18 — плюс помощники и конфиги блюд аддонов; v17 — плюс классы сборных блюд; v16 — плюс классы полива теплицы; v15 — плюс классы грядок теплицы; v14 — плюс перечисление черт еды; v13 — плюс уровни теплицы; v12 — плюс растения теплицы Firmalife и классы конфигов аддонов; v11 — плюс loot-таблицы растений и их размещение в мире; v10 — плюс классы календаря; v9 — плюс классы конфигов; v8 — плюс классы растений (classes/) для ботаники; v7 — плюс климатические диапазоны растений TFC; v6 — плюс теги, жилы, данные TFC для справочника, география TFC Real World и жидкое топливо; теги блоков и сущностей
  // v21 — ещё .obj/.mtl моделей, v22 — и .obj.ie IE, и .png.mcmeta (объёмные иконки), v23 — blockstates и все loot-таблицы блоков
  const done = path.join(dir, '.done-v23');
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
      /^(assets\/[a-z0-9_.-]+\/(models\/.+\.(json|obj|obj\.ie|mtl)|blockstates\/.+\.json|textures\/.+\.png(\.mcmeta)?|lang\/(en_us|ru_ru)\.json)|data\/[a-z0-9_.-]+\/(recipe\/.+|tags\/(item|fluid|block|entity_type)\/.+|createdieselgenerators\/fuel_type\/.+|createliquidfuel\/compat\/.+|worldgen\/configured_feature\/(vein\/.+|[^/]*vein[^/]*)|tfc\/(fuel|food|fluid_heat|climate_range)\/.+|cuisinedelight_config\/ingredient\/.+|cuisinetfc\/cooked_food\/.+|firmalife\/(plantable|greenhouse)\/.+|loot_table\/blocks\/.+|worldgen\/placed_feature\/plant\/.+|geography\/.+|profiles\/.+\/settings)\.json|data\/[a-z0-9_.-]+\/profiles\/.+\/maps\/(continent|altitude|koppen|temperature|rainfall)\.png)$/;
    const entries = zip.getEntries();
    for (const entry of entries) {
      if (entry.isDirectory || !wanted.test(entry.entryName)) continue;
      const target = path.join(dir, entry.entryName);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData());
    }
    // Ботаника: расход удобрений, сезоны и скорость роста моды задают кодом. Классы читаем только у jar,
    // которые описывают растения TFC (есть climate_range), и только те, что про растения (scripts/mods/botany.mjs).
    // Сковорода Cuisine Delight: у jar с её данными нужны ещё классы готовки и настроек (scripts/mods/cuisine.mjs).
    const cuisine = entries.some((e) => isCuisineData(e.entryName));
    if (cuisine || entries.some((e) => /^data\/[a-z0-9_.-]+\/tfc\/climate_range\//.test(e.entryName))) {
      for (const entry of entries) {
        if (entry.isDirectory || !entry.entryName.endsWith('.class')) continue;
        const data = entry.getData();
        if (
          !isBotanyClass(entry.entryName, data) &&
          !isMealClass(entry.entryName, data) &&
          !(cuisine && isCuisineClass(entry.entryName, data))
        )
          continue;
        const target = path.join(dir, 'classes', entry.entryName);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
      }
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(done, new Date().toISOString());
  }
  const assets = path.join(dir, 'assets');
  const namespaces = fs.existsSync(assets) ? fs.readdirSync(assets).filter((n) => !n.startsWith('.')) : [];
  return { root: assets, namespaces, data: path.join(dir, 'data') };
}

/**
 * Моды внутри jar (META-INF/jarjar/*.jar): бандлы вроде Create Aeronautics кладут туда целые моды со своими
 * предметами и рецептами (aeronautics, simulated, offroad). Берём только вложенные моды (есть neoforge.mods.toml)
 * с assets/ или data/ — библиотеки пропускаем. Распакованные jar кешируются по имени+размеру+дате родителя.
 */
function nestedModJars(file) {
  const st = fs.statSync(file);
  const key = `${path.basename(file, '.jar')}-${st.size}-${Math.round(st.mtimeMs)}`.replace(/[^\w.+-]/g, '_');
  const dir = path.join(CACHE, 'nested', key);
  const done = path.join(dir, '.done-v1');
  if (!fs.existsSync(done) || fresh) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    let zip;
    try {
      zip = new AdmZip(file);
    } catch {
      return [];
    }
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !/^META-INF\/jarjar\/[^/]+\.jar$/.test(entry.entryName)) continue;
      const data = entry.getData();
      let inner;
      try {
        inner = new AdmZip(data).getEntries();
      } catch {
        continue;
      }
      const isMod = inner.some((e) => e.entryName === 'META-INF/neoforge.mods.toml');
      if (!isMod || !inner.some((e) => /^(assets|data)\/[a-z0-9_.-]+\//.test(e.entryName))) continue;
      fs.writeFileSync(path.join(dir, path.basename(entry.entryName)), data);
    }
    fs.writeFileSync(done, new Date().toISOString());
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jar'))
    .sort()
    .map((f) => path.join(dir, f));
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
/**
 * Корни модов с перерисованными текстурами ванили (кожа, красители, компас TFC). В игре ресурсы модов лежат поверх
 * ванили, поэтому текстуры minecraft ищем сначала здесь; модели ванили моды не перебивают.
 */
const vanillaTextureRoots = [];
/** Первый существующий файл <root>/<ns>/<rel> среди корней namespace */
function findAsset(ns, rel) {
  const roots = assetRoots.get(ns) ?? [];
  for (const root of ns === 'minecraft' && rel.startsWith('textures/') ? [...vanillaTextureRoots, ...roots] : roots) {
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
function collectTextures(ref, depth = 0, extras = false) {
  if (depth > 12) return {};
  return modelTextures(readModel(ref), depth, extras);
}

/**
 * Текстуры модели-объекта. Кроме parent/textures понимает загрузчики без текстур в JSON:
 * neoforge:composite (children — вложенные модели), IE conf_sides (base_name + _side_none / _up_none — грани
 * накопителей и насоса), IE conveyor (лента — block/conveyor/off, неподвижный кадр). Их берём только вторым
 * проходом (extras), если обычные текстуры ничего не дали, — иначе у части предметов сменилась бы иконка.
 */
function modelTextures(model, depth, extras) {
  if (!model || typeof model !== 'object') return {};
  // neoforge:separate_transforms — берём вид для GUI
  const parentRef = model.parent ?? model.perspectives?.gui?.parent ?? model.base?.parent;
  const parent = parentRef ? collectTextures(parentRef, depth + 1, extras) : {};
  if (!extras) return { ...parent, ...(model.textures ?? {}) };
  const children = {};
  for (const c of Object.values(model.children ?? {})) Object.assign(children, modelTextures(c, depth + 1, extras));
  const loader = {};
  if (model.loader === 'immersiveengineering:conf_sides' && typeof model.base_name === 'string') {
    loader.side = `${model.base_name}_side_none`;
    loader.top = `${model.base_name}_up_none`;
  } else if (model.loader === 'immersiveengineering:models/conveyor') {
    loader.all = 'immersiveengineering:block/conveyor/off';
  }
  return { ...parent, ...children, ...loader, ...(model.textures ?? {}) };
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

/** Иконка по модели; extras — второй проход с загрузчиками и вложенными моделями (см. modelTextures) */
function resolveIcon(itemModelRef, extras = false) {
  return pickIcon(itemModelRef, collectTextures(itemModelRef, 0, extras));
}

function pickIcon(itemModelRef, textures) {
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

/** recipes.json: [{ i: "ns:path" (= data/ns/recipe/path.json), t: тип, s: jar-источник, j: json }] */
function writeRecipes(recipes, OUT_RECIPES) {
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

/**
 * Собирает данные сайта из jar папки modsDir в outDir (items.json, recipes.json, icons/ …). neoforge — версия загрузчика
 * (ресурсы NeoForge для иконок, если нет своего platform). Возвращает { items, icons, render } — render: счёт объёмных иконок.
 */
export async function buildMods({
  modsDir = DEFAULT_MODS,
  outDir = DEFAULT_OUT,
  cacheDir = DEFAULT_CACHE,
  fresh: freshRun = false,
  neoforge = null,
} = {}) {
  assertModsPresent({ modsDir, outDir, cacheDir });
  const MODS_DIR = modsDir;
  CACHE = path.join(cacheDir, 'assets');
  OUT_ICONS = path.join(outDir, 'icons');
  fresh = freshRun;
  const OUT_JSON = path.join(outDir, 'items.json');
  const OUT_RECIPES = path.join(outDir, 'recipes.json');
  const OUT_REFERENCE = path.join(outDir, 'reference.json');
  const OUT_MANIFEST = path.join(outDir, 'pack-manifest.json');
  // Состояние прошлого запуска в этом же процессе (другая папка модов) не должно просочиться
  for (const m of [assetRoots, modelCache, textureIndex, copied]) m.clear();
  vanillaTextureRoots.length = 0;
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
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
  if (jars.length) log(`${modsDir}: ${jars.length} jar`);
  /** Рецепты: «data/<ns>/recipe/<path>.json» → { источник, json }; поздние перекрывают ранние, как датапаки */
  const recipes = new Map();
  collectRecipes(recipes, path.join(vanillaDir, 'data'), 'minecraft');
  /** data/ всех источников в порядке загрузки — для справочника */
  const dataDirs = [{ dir: path.join(vanillaDir, 'data'), source: 'minecraft' }];
  // Сначала сам jar, за ним вложенные в него моды; один и тот же вложенный jar из разных бандлов — один раз
  const nestedSeen = new Set();
  const units = jars.flatMap((jar) => {
    const file = path.join(MODS_DIR, jar);
    const nested = nestedModJars(file).filter((f) => !nestedSeen.has(path.basename(f)));
    for (const f of nested) nestedSeen.add(path.basename(f));
    if (nested.length) log(`${jar}: вложенные моды — ${nested.map((f) => path.basename(f)).join(', ')}`);
    return [file, ...nested];
  });
  for (const file of units) {
    const res = prepareJar(file);
    if (!res) continue;
    const source = path.basename(file, '.jar');
    collectRecipes(recipes, res.data, source);
    dataDirs.push({ dir: res.data, source });
    for (const ns of res.namespaces) {
      // Модели и переводы ванили моды не перебивают, а текстуры — да (см. vanillaTextureRoots)
      if (ns === 'minecraft') {
        if (!vanillaTextureRoots.includes(res.root)) vanillaTextureRoots.push(res.root);
        continue;
      }
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
  // Генератор иконок читает jar через MCP (TFC_MODS_DIR, задаётся до запуска процесса): чужая папка — чужие иконки
  if (path.resolve(MCP_MODS) !== path.resolve(MODS_DIR))
    log(`  объёмные иконки: jar для генератора — из ${MCP_MODS}, а сборка — из ${MODS_DIR} (задайте TFC_MODS_DIR)`);
  // Ресурсы Minecraft и NeoForge без сборки аддона (сервер сборки) — скачать
  if (!platform()) setPlatformAssets(await platformAssets({ cacheDir, mc: MC_VERSION, neoforge, log }));
  const icons3d = makeRenderer({ findAsset, outIcons: OUT_ICONS, cacheDir: CACHE });
  const items = [];
  const seen = new Set();

  const perNs = new Map();
  /** Названия жидкостей (fluid_type.<ns>.<path>) — для справочника топлива */
  const fluidNames = new Map();
  /** Все переводы подряд — для ключей, которые не привязаны к предмету (названия уровней теплицы) */
  const dict = { en: {}, ru: {} };
  for (const { ns, root } of sources) {
    const en = readLang(root, ns, 'en_us');
    const ru = readLang(root, ns, 'ru_ru');
    Object.assign(dict.en, en);
    Object.assign(dict.ru, ru);
    // Ключи переводов жидкостей у модов разные (fluid.* / fluid_type.*), и в en и ru они могут не совпадать
    for (const [lang, dict] of [
      ['en', en],
      ['ru', ru],
    ]) {
      for (const [key, name] of Object.entries(dict)) {
        const f = key.match(/^fluid(?:_type)?\.([a-z0-9_]+)\.([a-z0-9_.]+)$/);
        if (!f) continue;
        const id = `${f[1]}:${f[2].replaceAll('.', '/')}`;
        const cur = fluidNames.get(id) ?? { en: null, ru: null };
        fluidNames.set(id, { ...cur, [lang]: cur[lang] ?? name });
      }
    }
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
      // Потом — текстура с тем же именем, загрузчики моделей (конвейеры, накопители IE) и модель блока
      const tex =
        resolveIcon(`${ns}:item/${p}`) ??
        iconByName(ns, p) ??
        resolveIcon(`${ns}:item/${p}`, true) ??
        resolveIcon(`${ns}:block/${p}`, true) ??
        fallbackIcon(p);
      seen.add(id);
      count++;
      // Модель из элементов (блоки) — ещё и объёмной картинкой, как в инвентаре (g); t — текстура, она нужна и граням
      // кубов мультиблоков и схем
      const drawn = icons3d.render(ns, p);
      items.push({
        i: id,
        e: name,
        ...(ru[key] && ru[key] !== name ? { r: ru[key] } : {}),
        ...(tex ? { t: copyIcon(tex) } : {}),
        ...(drawn ? { g: drawn } : {}),
      });
    }
    if (count) perNs.set(ns, (perNs.get(ns) ?? 0) + count);
  }
  const st = icons3d.stats;
  log(
    `объёмные иконки: нарисовано ${st.drawn}, из кеша ${st.cached}, не вышло ${st.failed}, модель кодом или загрузчиком ${st.code} (эти — текстурой)`,
  );
  if (st.codeKinds.size)
    log(
      `  текстурой (рисует код): ${[...st.codeKinds]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${n}`)
        .join(', ')}`,
    );
  if (st.failedIds.length)
    log(`  не вышло: ${st.failedIds.slice(0, 60).join(', ')}${st.failedIds.length > 60 ? '…' : ''}`);
  if (st.noFluid.length) log(`  вёдра без жидкости (цвет не найден в коде): ${[...new Set(st.noFluid)].join(', ')}`);
  const summary = [...perNs].sort((a, b) => b[1] - a[1]);
  log(`по модам: ${summary.map(([ns, n]) => `${ns} ${n}`).join(', ')}`);

  for (const ref of UI_TEXTURES) {
    const tex = textureFile(ref);
    if (tex) copyIcon(tex);
    else log(`UI-текстура не найдена: ${ref}`);
  }

  // Модели блоков для схем (block-models/<ns>.json), текстуры граней — в icons/
  const blockstates = [];
  for (const [ns, roots] of assetRoots) {
    const seenBs = new Set();
    for (const root of roots) {
      const dir = path.join(root, ns, 'blockstates');
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir, { recursive: true })) {
        const rel = String(f).split(path.sep).join('/');
        if (!rel.endsWith('.json') || seenBs.has(rel)) continue;
        seenBs.add(rel);
        blockstates.push({ ns, path: rel.slice(0, -5) });
      }
    }
  }
  const blockModels = writeBlockModels({
    layers: icons3d.layers,
    blockstates,
    outDir: path.join(outDir, 'block-models'),
    iconsDir: OUT_ICONS,
    copyTexture: (id) => {
      const { ns, p } = splitId(id);
      const file = findAsset(ns, `textures/${p}.png`);
      return file ? copyIcon({ ns, p, file }) : null;
    },
    log,
  });
  for (const w of blockModels.warnings) log(`  модели блоков: ${w}`);

  // Предметы, которых игрок не видит (мод их выключает или прячет из JEI): в библиотеке с пометкой h — причина
  const vis = hiddenItems(
    jars.map((j) => path.join(MODS_DIR, j)),
    items.map((it) => it.i),
  );
  for (const it of items) if (vis.hidden.has(it.i)) it.h = vis.hidden.get(it.i);
  if (vis.hidden.size) {
    const by = new Map();
    for (const [id, why] of vis.hidden) by.set(why, [...(by.get(why) ?? []), id]);
    log(`скрыто (в игре не видно): ${vis.hidden.size}`);
    for (const [why, ids] of by)
      log(`  ${why}: ${ids.length} — ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? '…' : ''}`);
  }
  for (const w of vis.warnings) log(`  видимость: ${w}`);
  // До записи items.json: помечает предметы-блоки (b)
  const blocks = writeBlocks(
    dataDirs,
    parseLooseJson,
    items,
    (key) => ({ en: dict.en[key], ru: dict.ru[key] }),
    path.join(outDir, 'blocks.json'),
  );
  log(
    `блоки без предмета: ${blocks.count}, из них с предметом из добычи ${blocks.withDrop} — blocks.json ${blocks.kb}KB`,
  );
  fs.writeFileSync(OUT_JSON, JSON.stringify(items));
  writeRecipes(recipes, OUT_RECIPES);
  const ref = buildReference(dataDirs, recipes, parseLooseJson, fluidNames);
  fs.writeFileSync(OUT_REFERENCE, JSON.stringify(ref));
  log(
    `справочник: ${ref.veins.length} жил, ${ref.fuels.length} топлива, ${ref.foods.length} еды, ${ref.metals.length} металлов, ${ref.tagCount} тегов — ${Math.round(fs.statSync(OUT_REFERENCE).size / 1024)}KB`,
  );
  const tags = writeTags(dataDirs, parseLooseJson, fluidNames, path.join(outDir, 'tags.json'));
  log(`теги: ${tags.tags} (${tags.entries} значений), жидкостей ${tags.fluids} — tags.json ${tags.kb}KB`);
  const botany = writeBotany(
    dataDirs,
    parseLooseJson,
    items,
    recipes,
    (key) => ({ en: dict.en[key], ru: dict.ru[key] }),
    path.join(outDir, 'botany.json'),
  );
  log(
    `ботаника: культур ${botany.crops}, кустов ${botany.bushes}, деревьев ${botany.trees}, прочих ${botany.other}; ` +
      `из кода: удобрения у ${botany.npk}, сезоны у ${botany.life}, настроек модов ${botany.configKeys}; ` +
      `урожай у ${botany.drops}, дикие формы у ${botany.wild}, применение у ${botany.uses}, в теплице ${botany.greenhouse}`,
  );
  for (const w of botany.warnings) log(`  ботаника: ${w}`);
  const meals = writeMeals(
    dataDirs.map((d) => path.join(path.dirname(d.dir), 'classes')),
    recipes,
    items,
    path.join(outDir, 'meals.json'),
    jars.map((j) => path.join(MODS_DIR, j)),
    dataDirs,
    parseLooseJson,
  );
  log(`сборные блюда: семейств ${meals.families}, блюд ${meals.dishes}; из кода: ${meals.computed.join(', ') || '—'}`);
  for (const w of meals.warnings) log(`  сборные блюда: ${w}`);
  const power = writePower(
    jars.map((j) => path.join(MODS_DIR, j)),
    path.join(outDir, 'power.json'),
    recipes,
  );
  log(`электричество: настроек EE ${power.ee}, проводов IE ${power.ieWires}`);
  for (const w of power.warnings) log(`  электричество: ${w}`);
  const multiblocks = await writeMultiblocks(
    jars.map((j) => path.join(MODS_DIR, j)),
    recipes,
    (key) => ({ en: dict.en[key], ru: dict.ru[key] }),
    path.join(outDir, 'multiblocks.json'),
    path.join(outDir, 'multiblocks'),
    path.join(vanillaDir, 'assets'),
  );
  log(`мультиблоки: ${multiblocks.count} — multiblocks.json ${multiblocks.kb}KB`);
  for (const w of multiblocks.warnings) log(`  мультиблоки: ${w}`);
  const geo = writeGeo(dataDirs, parseLooseJson, outDir);
  if (geo) log(`география: ${geo.profiles} профилей, ${geo.waypoints} городов, ${geo.maps} карт`);
  const manifest = writeManifest({
    jarPaths: jars.map((j) => path.join(MODS_DIR, j)),
    items,
    recipes,
    outFile: OUT_MANIFEST,
    cacheDir,
  });
  log(
    `снимок сборки: ${manifest.mods.length} модов, pack-manifest.json ${Math.round(fs.statSync(OUT_MANIFEST).size / 1024)}KB`,
  );
  fs.writeFileSync(signatureFile(cacheDir), JSON.stringify(modsSignature(modsDir)));
  const kb = Math.round(fs.statSync(OUT_JSON).size / 1024);
  log(`готово: ${items.length} предметов, ${copied.size} иконок, items.json ${kb}KB`);
  return {
    items: items.length,
    icons: copied.size,
    render: { drawn: st.drawn, cached: st.cached, failed: st.failed, code: st.code },
  };
}

// Запуск как скрипт (а не импорт из ensure-items)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  buildMods({ fresh: process.argv.includes('--fresh') }).catch((e) => {
    console.error(e.code === 'NO_MODS' ? `[items] ${e.message}` : e);
    process.exit(1);
  });
}
