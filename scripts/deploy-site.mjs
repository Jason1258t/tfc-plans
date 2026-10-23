#!/usr/bin/env node
/**
 * Деплой сайта без данных сборки (npm run deploy:site). Данные сборки (scripts/data-roots.mjs: items.json, icons/,
 * recipes.json, kubejs.json …) на хостинг ставит только сервер сборки (publish-data.mjs). Раньше деплой с Mac
 * заливал всю dist/ и откатывал их к тому, что лежало в его public/ (2026-10-22: пропали предметы аддонов).
 *
 *   1. npm run build с TFC_SITE_ONLY=1 (данные сборки не нужны и не собираются), проверка predeploy-check;
 *   2. новая версия Hosting с настройками из firebase.json;
 *   3. в неё — файлы сайта из dist/ (без корней данных) и файлы данных текущего релиза по их хешам: они уже на
 *      Hosting, ничего не скачивается и не загружается заново. Так же как есть переносятся файлы, которых в сборке
 *      сайта нет вовсе, — tfc (собран на Mac), датапаки из packs/ и старые иконки аддонов /addons/*.png: иначе
 *      выкладка со свежего checkout'а убрала бы их с сайта;
 *   4. загрузка недостающих файлов сайта, FINALIZED, релиз.
 * packUpdates не пишет — это делает публикация сервера сборки.
 *
 *   npm run deploy:site                 — собрать и выложить
 *   npm run deploy:site -- --dry-run    — что будет выложено, ничего не меняя
 *   … --no-build                        — взять готовую dist/
 *   … --force                           — выложить, даже если ничего не изменилось (проверка выкладки)
 * Авторизация — как у scripts/firestore-rest.mjs (сервисный ключ или firebase login).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './firestore-rest.mjs';
import { isDataPath } from './data-roots.mjs';
import { createVersion, currentRelease, hostingConfig, hostingFile, release, versionFiles } from './hosting-rest.mjs';

const log = (...a) => console.log('[deploy-site]', ...a);
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const DIST = path.join(ROOT, 'dist');

/** Файлы dist/ как у firebase CLI: без firebase.json и скрытых (ignore в firebase.json) */
function distFiles() {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(DIST, rel), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile() && r !== 'firebase.json') out.push(r);
    }
  };
  walk('');
  return out;
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} МБ`;
/** JSON с ключами по алфавиту: Hosting отдаёт настройки версии в своём порядке ключей */
const canon = (v) =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canon(v[k])]),
        )
      : v;

async function main() {
  const firebase = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
  const config = hostingConfig(firebase.hosting);

  if (!argv.includes('--no-build')) {
    log('собираю сайт (без данных сборки)…');
    // На Windows npm — это npm.cmd: без shell execFile его не находит
    execFileSync('npm', ['run', 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, TFC_SITE_ONLY: '1' },
      shell: process.platform === 'win32',
    });
  }
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'predeploy-check.mjs')], { stdio: 'inherit' });
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('в dist/ нет index.html — сайт не собран');

  const cur = await currentRelease();
  if (!cur) throw new Error('у сайта нет ни одного релиза — первую выкладку делайте firebase deploy');
  const published = await versionFiles(cur.version.name);
  // Файлы не из сборки сайта: их кладут tfc-dist и сервер сборки — не убираем, если в dist/ их нет
  const serverFile = /^\/(tfc|packs)\//;
  const legacyAddonIcon = /^\/addons\/[^/]+\.png$/;
  log(`текущий релиз ${cur.version.name.split('/').pop()} от ${cur.releaseTime}, файлов ${published.size}`);

  const files = new Map(); // «/путь» → { hash }
  const local = new Map(); // «/путь» → файл в dist/ (то, что, может быть, придётся загрузить)
  let dataKept = 0;
  let serverKept = 0;
  // /__/ — служебные файлы Firebase (init.js): их кладёт сам Hosting, переносим как есть
  for (const [p, hash] of published) if (p.startsWith('/__/')) files.set(p, { hash });
  for (const [p, hash] of published) {
    if (isDataPath(p)) {
      files.set(p, { hash });
      dataKept++;
    } else if (serverFile.test(p) || legacyAddonIcon.test(p)) {
      files.set(p, { hash });
      serverKept++;
    }
  }
  if (!dataKept) throw new Error('в текущем релизе нет данных сборки — выложите их сначала (сервер сборки)');

  const site = { added: [], changed: [], removed: [], skippedData: 0, uploadBytes: 0 };
  for (const rel of distFiles()) {
    const p = `/${rel}`;
    if (isDataPath(p)) {
      site.skippedData++;
      continue;
    }
    const { gz, hash, hashes } = hostingFile(fs.readFileSync(path.join(DIST, rel)));
    const pub = published.get(p);
    const h = pub && hashes.has(pub) ? pub : hash;
    files.set(p, { hash: h });
    local.set(p, path.join(DIST, rel));
    if (!pub) site.added.push(p);
    else if (pub !== h) site.changed.push(p);
    if (pub !== h) site.uploadBytes += gz.length;
  }
  for (const p of published.keys()) if (!isDataPath(p) && !files.has(p)) site.removed.push(p);

  const sameConfig = JSON.stringify(canon(cur.version.config ?? {})) === JSON.stringify(canon(config));
  log(
    `данные сборки: ${dataKept} файлов — из текущего релиза как есть` +
      (site.skippedData ? ` (в dist/ их ${site.skippedData} — не выкладываю)` : '') +
      (serverKept ? `; файлы tfc, датапаков и старых иконок аддонов: ${serverKept} — как есть` : ''),
  );
  log(
    `сайт: новых ${site.added.length}, изменённых ${site.changed.length}, убрать ${site.removed.length}; ` +
      `к загрузке ≈${mb(site.uploadBytes)} (gzip); настройки firebase.json ${sameConfig ? 'те же' : 'изменились'}`,
  );
  for (const [sign, list] of [
    ['+', site.added],
    ['~', site.changed],
    ['−', site.removed],
  ]) {
    for (const p of list.slice(0, 20)) log(`  ${sign} ${p}`);
    if (list.length > 20) log(`  ${sign} … и ещё ${list.length - 20}`);
  }
  if (!site.added.length && !site.changed.length && !site.removed.length && sameConfig && !argv.includes('--force')) {
    log('на сайте уже это — выкладывать нечего');
    return;
  }
  if (dryRun) {
    log('--dry-run: ничего не выложено');
    return;
  }

  const version = await createVersion({ config });
  log(`новая версия ${version.split('/').pop()}`);
  await release({
    version,
    files,
    getGz: (p) => {
      const f = local.get(p);
      if (!f) throw new Error(`Hosting просит загрузить ${p} — это файл данных, его нет на Hosting`);
      return hostingFile(fs.readFileSync(f)).gz;
    },
    message: 'деплой сайта (без данных сборки)',
    log: (m) => log(m),
  });
}

main().catch((e) => {
  console.error('[deploy-site]', e.message ?? e);
  process.exit(1);
});
