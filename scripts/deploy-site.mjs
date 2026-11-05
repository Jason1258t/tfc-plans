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
 * Защита от гонок (релизы Hosting — «последний выигрывает», 2026-11-05 чужой релиз затёр свежий):
 *   - блокировка на сборку и выпуск, общая для ворктри (deploy-lock.mjs): второй запуск отказывается;
 *   - перед релизом — сверка: текущий релиз тот же, от которого считался план (иначе потеряются файлы чужого релиза,
 *     в том числе публикации данных с сервера сборки);
 *   - коммит сборки пишется в сообщение релиза (commit=…), и новый деплой обязан его содержать — иначе он откатил бы
 *     чужие изменения. Чтений Firestore нет: только список релизов Hosting. Публикации данных файлы сайта не меняют
 *     и коммита не пишут, поэтому берём последний релиз с отметкой.
 *
 *   npm run deploy:site                 — собрать и выложить
 *   npm run deploy:site -- --dry-run    — что будет выложено, ничего не меняя
 *   … --no-build                        — взять готовую dist/
 *   … --force                           — выложить, даже если ничего не изменилось (проверка выкладки)
 *   … --allow-older                     — выложить сборку без коммита текущего релиза (нарочный откат сайта)
 * Авторизация — как у scripts/firestore-rest.mjs (сервисный ключ или firebase login).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { deployLock } from './deploy-lock.mjs';
import { ROOT } from './firestore-rest.mjs';
import { isDataPath } from './data-roots.mjs';
import {
  createVersion,
  currentRelease,
  hostingConfig,
  hostingFile,
  listReleases,
  release,
  versionFiles,
} from './hosting-rest.mjs';

const log = (...a) => console.log('[deploy-site]', ...a);
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const noBuild = argv.includes('--no-build');
const short = (sha) => sha.slice(0, 8);
let DIST;

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

const COMMIT_MARK = /\bcommit=([0-9a-f]{40})\b/;

/** Стоп, если эта копия не содержит коммит, из которого выпущен сайт. При --dry-run только предупреждение. */
async function checkPublishedCommit(head) {
  const releases = await listReleases();
  const marked = releases.find((r) => COMMIT_MARK.test(r.message ?? ''));
  if (!marked) return log(`в последних ${releases.length} релизах нет отметки коммита — сверку пропускаю`);
  const published = COMMIT_MARK.exec(marked.message)[1];
  const contained = spawnSync('git', ['merge-base', '--is-ancestor', published, head], { cwd: ROOT }).status === 0;
  if (contained) return log(`сайт выпущен из ${short(published)}, он есть в сборке ${short(head)}`);
  const text =
    `сайт выпущен из коммита ${short(published)} (${marked.releaseTime}), а в этой копии (${short(head)}) его нет — ` +
    'выкладка убрала бы чужие изменения. Обновите копию (git pull или git merge main) и запустите снова; ' +
    'нарочный откат — --allow-older';
  if (argv.includes('--allow-older')) log(`--allow-older: ${text}`);
  else if (dryRun) log(`настоящая выкладка отказалась бы: ${text}`);
  else throw new Error(text);
}

async function main() {
  // --dry-run ничего не выпускает и собирает во временную папку — другим выкладкам не мешает
  const unlock = dryRun ? () => {} : deployLock(ROOT, log);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'tfc-site-'));
  DIST = path.join(staging, 'dist');
  try {
    await deploy();
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    unlock();
  }
}

async function deploy() {
  const firebase = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
  const config = hostingConfig(firebase.hosting);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  await checkPublishedCommit(head); // до сборки: отказ не должен стоить минуты ожидания

  if (!noBuild) {
    log('собираю сайт (без данных сборки)…');
    // На Windows npm — это npm.cmd: без shell execFile его не находит
    execFileSync('npm', ['run', 'build', '--', '--outDir', DIST], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, TFC_SITE_ONLY: '1' },
      shell: process.platform === 'win32',
    });
  }
  if (noBuild) fs.cpSync(path.join(ROOT, 'dist'), DIST, { recursive: true });
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'predeploy-check.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, TFC_DEPLOY_DIST: DIST },
  });
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
    // Готовая dist/ могла быть собрана из другого коммита — такой релиз коммитом не отмечаем
    message: `деплой сайта (без данных сборки)${noBuild ? '' : ` commit=${head}`}`,
    beforeRelease: async () => {
      const now = await currentRelease();
      if (now?.name !== cur.name)
        throw new Error(
          `пока шла выкладка, вышел другой релиз (${now?.name.split('/').pop()}, ${now?.releaseTime}; ` +
            `«${now?.message ?? ''}»). Эта версия не выпущена, сайт не менялся: иначе пропало бы то, что он выложил. ` +
            'Обновите копию и запустите снова.',
        );
    },
    log: (m) => log(m),
  });
}

main().catch((e) => {
  console.error('[deploy-site]', e.message ?? e);
  process.exit(1);
});
