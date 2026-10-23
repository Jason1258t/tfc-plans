// Перед dev/build: данные модов в public/ (items.json, recipes.json, icons/…). Jar не нужны: данные собирает сервер
// сборки, отсюда они только берутся.
//   1. В git worktree недостающие файлы public/ копируются из основной копии (быстро, без сети).
//   2. Есть TFC_PACK_URL и TFC_PACK_TOKEN (окружение, .env.local или вход в программу tfc) — данные модов текущего снимка с сервера сборки
//      (одинаковые файлы не качаются). Сервер недоступен — остаются прежние, с предупреждением.
// TFC_KEEP_MODS=1 — без сервера сборки: взять готовые данные (в worktree — свежие из основной копии).
// TFC_SITE_ONLY=1 (npm run deploy:site) — данные сборки не нужны вовсе: их на хостинге ставит сервер сборки.
// Собрать данные модов руками из jar — npm run mods (jar — npm run pack:fetch).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainCheckoutRoot } from './pack-cache.mjs';
import { fetchData, packServer } from './pack-fetch.mjs';
import { DATA_ROOTS, MODS_OUTPUTS as MODS_LIST } from './data-roots.mjs';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const keepMods = !!process.env.TFC_KEEP_MODS;
const siteOnly = !!process.env.TFC_SITE_ONLY;
/** Что в public/ собирает npm run mods; остальное неотслеживаемое (kubejs, аддоны, ресурспаки) — из других мест */
const MODS_OUTPUTS = new Set(MODS_LIST);

/**
 * В git worktree файлов public/, которых нет в git, нет вовсе: без них деплой убрал бы с сайта аддоны, ресурспаки
 * и разбор KubeJS. Недостающее берём из основной копии; данные модов с TFC_KEEP_MODS — всегда (тогда свежие).
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
    if (siteOnly && DATA_ROOTS.includes(name)) continue;
    if (fs.existsSync(dst) && !(keepMods && MODS_OUTPUTS.has(name))) continue;
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(path.join(mainPublic, name), dst, { recursive: true });
    copied.push(name);
  }
  // Настройки Firebase: без них сайт собирается в запасном режиме на localStorage, без общей базы
  const env = fileURLToPath(new URL('../.env.local', import.meta.url));
  if (!fs.existsSync(env) && fs.existsSync(path.join(mainRoot, '.env.local'))) {
    fs.copyFileSync(path.join(mainRoot, '.env.local'), env);
    copied.push('../.env.local');
  }
  if (copied.length) console.log(`[items] из основной копии (${mainPublic}): ${copied.join(', ')}`);
}
if (siteOnly) {
  console.log(
    '[items] TFC_SITE_ONLY: данные сборки не собираю и не проверяю — на сайте остаются выложенные сервером сборки',
  );
  process.exit(0);
}

// Сервер сборки: данные модов текущего снимка
const packSrv = keepMods ? null : packServer();
if (packSrv) {
  try {
    await fetchData({ outDir: PUBLIC, srv: packSrv });
  } catch (e) {
    console.warn(`[items] сервер сборки ${packSrv.url}: ${e.message} — беру прежние данные модов`);
  }
} else if (!keepMods)
  console.log(
    '[items] нет адреса сервера сборки (TFC_PACK_URL / TFC_PACK_TOKEN или вход в tfc) — данные модов не обновляю',
  );

const missing = [
  ['items.json', 'библиотека предметов'],
  ['recipes.json', 'каталог рецептов'],
  ['reference.json', 'справочник'],
  ['pack-manifest.json', 'снимок сборки'],
  ['geo.json', 'география'],
  ['tags.json', 'теги'],
  ['botany.json', 'ботаника'],
  ['meals.json', 'сборные блюда'],
  ['power.json', 'данные по электричеству'],
  ['multiblocks.json', 'мультиблоки'],
].filter(([f]) => !fs.existsSync(path.join(PUBLIC, f)));
if (missing.length) {
  console.error(
    `[items] нет данных модов (${missing.map((m) => m[1]).join(', ')}). Возьмите их с сервера сборки: ` +
      'вход в программу tfc или TFC_PACK_URL и TFC_PACK_TOKEN (ключ игрока подходит) в .env.local, затем снова npm run dev. ' +
      'Или соберите из jar: npm run pack:fetch && npm run mods.',
  );
  process.exit(1);
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
