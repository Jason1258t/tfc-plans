#!/usr/bin/env node
/**
 * Собирает библиотеку внутриигровых предметов для подсказок:
 *   public/items.json   — [{ i: id, e: имя en, r: имя ru, t: путь к иконке, s: источник }]
 *   public/icons/...    — png-текстуры, на которые ссылаются предметы
 *
 * Источники:
 *   - ванильный Minecraft (client.jar с серверов Mojang + ru_ru из asset index)
 *   - моды из списка MOD_SOURCES (sparse git clone репозитория на GitHub)
 *
 * Чтобы добавить аддон сборки — допишите его в MOD_SOURCES.
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

const MC_VERSION = '1.21.1';

/** Моды: репозиторий, ветка и namespace(ы) ассетов внутри src/main/resources/assets */
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
const OUT_ICONS = path.join(ROOT, 'public', 'icons');
const OUT_JSON = path.join(ROOT, 'public', 'items.json');
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
  const done = path.join(dir, '.done');
  if (fs.existsSync(done) && !fresh) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  log(`vanilla ${MC_VERSION}: читаю манифест версий`);
  const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const ver = manifest.versions.find((v) => v.id === MC_VERSION);
  if (!ver) throw new Error(`Версия ${MC_VERSION} не найдена в манифесте`);
  const meta = await fetchJson(ver.url);

  log('vanilla: качаю client.jar (~25MB)');
  const zip = new AdmZip(await fetchBuffer(meta.downloads.client.url));
  const wanted = /^assets\/minecraft\/(models\/(item|block)\/|textures\/(item|block)\/|lang\/en_us\.json)/;
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

// ---------------------------------------------------------------- модели → текстура

/** namespace → каталог assets, где лежит <ns>/models, <ns>/textures */
const assetRoots = new Map();

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
  const root = assetRoots.get(ns);
  if (root) {
    const file = path.join(root, ns, 'models', `${p}.json`);
    if (fs.existsSync(file)) {
      try {
        model = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        model = null;
      }
    }
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
  const root = assetRoots.get(ns);
  if (!root) return null;
  const file = path.join(root, ns, 'textures', `${p}.png`);
  if (fs.existsSync(file)) return { ns, p, file };
  // Часть текстур TFC генерируется в рантайме перекраской базовой (wood/lumber_acacia ← wood/lumber)
  let base = p;
  while (/_[a-z0-9]+$/.test(base)) {
    base = base.replace(/_[a-z0-9]+$/, '');
    const baseFile = path.join(root, ns, 'textures', `${base}.png`);
    if (fs.existsSync(baseFile)) return { ns, p: base, file: baseFile };
  }
  return null;
}

function resolveIcon(itemModelRef) {
  const textures = collectTextures(itemModelRef);
  const deref = (v, n = 0) =>
    typeof v === 'string' && v.startsWith('#') && n < 10 ? deref(textures[v.slice(1)], n + 1) : v;
  const keys = [...TEXTURE_PRIORITY, ...Object.keys(textures)];
  for (const k of keys) {
    const v = deref(textures[k]);
    if (typeof v !== 'string' || v.startsWith('#')) continue;
    const tex = textureFile(v);
    if (tex) return tex;
  }
  return null;
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
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
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

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const vanillaDir = await prepareVanilla();
  assetRoots.set('minecraft', path.join(vanillaDir, 'assets'));
  const sources = [{ ns: 'minecraft', root: path.join(vanillaDir, 'assets') }];
  for (const src of MOD_SOURCES) {
    const dir = prepareMod(src);
    for (const ns of src.namespaces) {
      const root = path.join(dir, src.assetsDir);
      assetRoots.set(ns, root);
      sources.push({ ns, root });
    }
  }

  fs.rmSync(OUT_ICONS, { recursive: true, force: true });
  const items = [];
  const seen = new Set();

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
      const tex = resolveIcon(`${ns}:item/${p}`) ?? fallbackIcon(p);
      seen.add(id);
      count++;
      items.push({
        i: id,
        e: name,
        ...(ru[key] && ru[key] !== name ? { r: ru[key] } : {}),
        ...(tex ? { t: copyIcon(tex) } : {}),
      });
    }
    log(`${ns}: ${count} предметов`);
  }

  for (const ref of UI_TEXTURES) {
    const tex = textureFile(ref);
    if (tex) copyIcon(tex);
    else log(`UI-текстура не найдена: ${ref}`);
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(items));
  const kb = Math.round(fs.statSync(OUT_JSON).size / 1024);
  log(`готово: ${items.length} предметов, ${copied.size} иконок, items.json ${kb}KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
