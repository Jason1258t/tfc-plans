// Перед dev/build: пересобирает библиотеку предметов, если её нет или поменялось содержимое mods/.
// TFC_KEEP_MODS=1 — данные модов не пересобирать, взять готовые (в git worktree — из основной копии); jar не нужны.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNATURE_FILE, assertModsPresent, mainCheckoutRoot, modsSignature } from './mods.mjs';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const keepMods = !!process.env.TFC_KEEP_MODS;
/** Что в public/ собирает npm run mods; остальное неотслеживаемое (kubejs, аддоны, ресурспаки) — из других мест */
const MODS_OUTPUTS = new Set([
  'items.json',
  'icons',
  'recipes.json',
  'reference.json',
  'pack-manifest.json',
  'geo.json',
  'geo',
  'tags.json',
  'botany.json',
  'config-defaults.json',
  'meals.json',
  'power.json',
  'multiblocks.json',
  'multiblocks',
]);

/**
 * В git worktree файлов public/, которых нет в git, нет вовсе: без них деплой убрал бы с сайта аддоны, ресурспаки
 * и разбор KubeJS. Недостающее берём из основной копии; данные модов — только с TFC_KEEP_MODS (тогда всегда свежие).
 */
const mainRoot = mainCheckoutRoot();
if (mainRoot) {
  const mainPublic = path.join(mainRoot, 'public');
  const entries = execFileSync(
    'git',
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', 'public'],
    {
      cwd: mainRoot,
      encoding: 'utf8',
    },
  )
    .split('\n')
    .filter(Boolean)
    .map((e) => e.replace(/^public\//, '').replace(/\/$/, ''));
  const copied = [];
  for (const name of entries) {
    const dst = path.join(PUBLIC, name);
    const fromMods = MODS_OUTPUTS.has(name);
    if (fromMods ? !keepMods : fs.existsSync(dst)) continue;
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(path.join(mainPublic, name), dst, { recursive: true });
    copied.push(name);
  }
  if (copied.length) console.log(`[items] из основной копии (${mainPublic}): ${copied.join(', ')}`);
}

const itemsJson = fileURLToPath(new URL('../public/items.json', import.meta.url));
const recipesJson = fileURLToPath(new URL('../public/recipes.json', import.meta.url));
const referenceJson = fileURLToPath(new URL('../public/reference.json', import.meta.url));
const manifestJson = fileURLToPath(new URL('../public/pack-manifest.json', import.meta.url));
const geoJson = fileURLToPath(new URL('../public/geo.json', import.meta.url));
const botanyJson = fileURLToPath(new URL('../public/botany.json', import.meta.url));
const mealsJson = fileURLToPath(new URL('../public/meals.json', import.meta.url));
const powerJson = fileURLToPath(new URL('../public/power.json', import.meta.url));
const multiblocksJson = fileURLToPath(new URL('../public/multiblocks.json', import.meta.url));
const tagsJson = fileURLToPath(new URL('../public/tags.json', import.meta.url));
const current = JSON.stringify(modsSignature());
let previous = null;
try {
  previous = fs.readFileSync(SIGNATURE_FILE, 'utf8');
} catch {
  /* ещё не собирали */
}

let reason = null;
if (!fs.existsSync(itemsJson)) reason = 'библиотека предметов не найдена';
else if (!fs.existsSync(recipesJson)) reason = 'каталог рецептов не найден';
else if (!fs.existsSync(referenceJson)) reason = 'справочник не найден';
else if (!fs.existsSync(manifestJson)) reason = 'снимок сборки не найден';
else if (!fs.existsSync(geoJson)) reason = 'география не найдена';
else if (!fs.existsSync(tagsJson)) reason = 'теги не найдены';
else if (!fs.existsSync(botanyJson)) reason = 'ботаника не найдена';
else if (!fs.existsSync(mealsJson)) reason = 'сборные блюда не найдены';
else if (!fs.existsSync(powerJson)) reason = 'данные по электричеству не найдены';
else if (!fs.existsSync(multiblocksJson)) reason = 'мультиблоки не найдены';
else if (keepMods)
  reason = null; // с флагом набор jar не сравниваем
else if (previous !== null && previous !== current) reason = 'набор модов в mods/ изменился';
else if (previous === null && current !== '[]') reason = 'в mods/ появились моды';

if (reason && keepMods) {
  console.error(
    `[items] TFC_KEEP_MODS: ${reason}, а пересобирать данные модов флаг не даёт. ` +
      (mainRoot ? `В основной копии ${mainRoot} их тоже нет — ` : '') +
      'соберите их там, где лежат jar: npm run mods.',
  );
  process.exit(1);
} else if (keepMods) {
  console.log('[items] TFC_KEEP_MODS: данные модов не пересобираю, mods/ не смотрю');
} else if (reason) {
  // mods/ пуст, а сборка была с модами (чаще всего — git worktree без jar): стоп, а не каталог из одной ванили
  try {
    assertModsPresent();
  } catch (e) {
    console.error(`[items] ${reason}, но пересобирать нельзя:\n${e.message}`);
    process.exit(1);
  }
  console.log(`[items] ${reason} — пересобираю…`);
  execFileSync(process.execPath, [fileURLToPath(new URL('./mods.mjs', import.meta.url))], {
    stdio: 'inherit',
  });
}

// Скрипты KubeJS импортированы (instance/kubejs), а разбора нет — пересобрать public/kubejs.json
const kubejsJson = fileURLToPath(new URL('../public/kubejs.json', import.meta.url));
const kubejsData = fileURLToPath(new URL('../public/kubejs-data.json', import.meta.url));
if (
  fs.existsSync(fileURLToPath(new URL('../instance/kubejs', import.meta.url))) &&
  !(fs.existsSync(kubejsJson) && fs.existsSync(kubejsData))
) {
  console.log('[kubejs] разбор скриптов не найден — собираю…');
  execFileSync(process.execPath, [fileURLToPath(new URL('./kubejs.mjs', import.meta.url))], { stdio: 'inherit' });
}
