#!/usr/bin/env node
/**
 * Публикация собранных данных сайта (то, что npm run pack кладёт в public/) без firebase deploy: только изменённое.
 * Её запускает сервер сборки после сборки снимка; с машины разработчика — для проверки (--dry-run).
 *
 *   node scripts/publish-data.mjs <папка данных> --dry-run   — что будет выложено, ничего не меняя
 *   node scripts/publish-data.mjs <папка данных>             — выложить
 *
 * Три части, по порядку (как predeploy при firebase deploy):
 *   1. packUpdates — запись об обновлении сборки (pack-release.mjs: сравнение с опубликованным pack-manifest.json);
 *   2. Firestore config — документы из <папка>/.firestore.json (их пишет сборка), только новые и изменённые (по sha1);
 *   3. Hosting — новая версия: файлы сайта текущего релиза (по хешам) + файлы данных; загружаются только новые
 *      хеши; перед выпуском — сверка, что в версии есть все файлы.
 *      Файлы, которые отличаются только меткой времени сборки (pack-manifest.json — builtAt, kubejs.json —
 *      generatedAt), не перевыкладываются.
 * Корни данных — то, что лежит в папке на верхнем уровне (без скрытых): чего в папке нет (аддоны, ресурспаки,
 * сам сайт), остаётся как было. Удаляется с хостинга только то, что лежит внутри этих корней и пропало из сборки.
 * Защита: сборка без объёмных иконок (.build.json render = 0) не убирает icons/…/render/; больше MAX_REMOVALS
 * удалений — только с allowRemovals (--allow-removals).
 *
 * Авторизация — scripts/firestore-rest.mjs: GOOGLE_APPLICATION_CREDENTIALS (сервисный ключ) или firebase login.
 * Из кода: publishData({ dataDir, dryRun, message, log }) → отчёт.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS, fromValue, SITE, token, writeConfigDocs } from './firestore-rest.mjs';
import { currentRelease, deploy, gzipWithHash, hostingFile, versionFiles } from './hosting-rest.mjs';
import { packRelease } from './pack-release.mjs';

/** Больше стольких удалений с хостинга за раз — только с allowRemovals (обычно это сборка, которая чего-то не умеет) */
export const MAX_REMOVALS = 300;
/** Объёмные иконки (scripts/mods/icons3d.mjs): сборка без них не убирает их с сайта */
const RENDER = /^\/icons\/[^/]+\/render\//;

/** Файлы, где меняется только метка времени при каждой сборке */
const STAMPS = { 'pack-manifest.json': 'builtAt', 'kubejs.json': 'generatedAt' };

/** Файлы папки данных: относительные пути через «/», без скрытых */
export function dataFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk('');
  return out.sort();
}

function sameExceptStamp(a, b, key) {
  try {
    const x = JSON.parse(a);
    const y = JSON.parse(b);
    delete x[key];
    delete y[key];
    return JSON.stringify(x) === JSON.stringify(y);
  } catch {
    return false;
  }
}

/** Все документы config: id → данные */
async function readConfig() {
  const headers = { Authorization: `Bearer ${await token()}` };
  const out = new Map();
  let page = '';
  do {
    const r = await fetch(`${DOCS}/config?pageSize=300${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, {
      headers,
    });
    if (!r.ok) throw new Error(`Firestore config: ${r.status} ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    for (const d of j.documents ?? [])
      out.set(d.name.split('/').pop(), fromValue({ mapValue: { fields: d.fields ?? {} } }));
    page = j.nextPageToken ?? '';
  } while (page);
  return out;
}

const kb = (n) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`);

export async function publishData({
  dataDir,
  dryRun = false,
  allowRemovals = false,
  message = null,
  log = console.log,
}) {
  const say = (...a) => log(`[publish] ${a.join(' ')}`);
  if (!fs.existsSync(dataDir)) throw new Error(`нет папки данных ${dataDir}`);
  const files = dataFiles(dataDir);
  if (!files.length) throw new Error(`в ${dataDir} нет файлов`);
  const roots = [...new Set(files.map((f) => f.split('/')[0]))].map((name) => ({
    name,
    dir: fs.statSync(path.join(dataDir, name)).isDirectory(),
  }));
  const report = { dryRun, roots: roots.map((r) => r.name + (r.dir ? '/' : '')) };
  say(dryRun ? 'ПРОБНЫЙ ЗАПУСК — ничего не выкладываю и не записываю' : 'выкладываю');

  // ---- 1. packUpdates
  const manifest = path.join(dataDir, 'pack-manifest.json');
  if (fs.existsSync(manifest)) {
    const rec = await packRelease({ manifestFile: manifest, dryRun });
    report.packUpdate = rec
      ? {
          baseline: rec.baseline,
          mods: {
            added: rec.mods.added.length,
            removed: rec.mods.removed.length,
            updated: rec.mods.updated.length,
          },
          totals: rec.totals ?? null,
        }
      : null;
    say(
      rec ? 'packUpdates: будет запись об обновлении сборки' : 'packUpdates: сборка модов не изменилась — записи нет',
    );
  } else say('packUpdates: нет pack-manifest.json (моды не собирались) — пропускаю');

  // ---- 2. Firestore config
  const docsFile = path.join(dataDir, '.firestore.json');
  const docs = fs.existsSync(docsFile) ? JSON.parse(fs.readFileSync(docsFile, 'utf8')) : [];
  if (docs.length) {
    const existing = await readConfig();
    const changed = docs.filter((d) => {
      const e = existing.get(d.id);
      return !e || e.sha1 !== d.data.sha1;
    });
    report.config = {
      total: docs.length,
      write: changed.map((d) => ({ id: d.id, new: !existing.has(d.id) })),
    };
    say(`config: документов ${docs.length}, новых/изменённых ${changed.length}`);
    for (const d of changed.slice(0, 40)) say(`  ${existing.has(d.id) ? '~' : '+'} config/${d.id}`);
    if (!dryRun && changed.length) {
      await writeConfigDocs(changed);
      say(`config: записано ${changed.length}`);
    }
  } else say('config: конфигов и файлов мира в сборке нет — пропускаю');

  // ---- 3. Hosting
  const release = await currentRelease();
  if (!release) throw new Error('у сайта нет ни одного релиза — первую выкладку делайте firebase deploy');
  const published = await versionFiles(release.version.name);
  say(
    `hosting: текущий релиз ${release.version.name.split('/').pop()} от ${release.releaseTime}, файлов ${published.size}`,
  );

  const local = new Map(); // «/путь» → { hash, size, gzSize }
  const added = [];
  const changed = [];
  let stampOnly = 0;
  let uploadBytes = 0;
  for (const rel of files) {
    const p = `/${rel}`;
    const buf = fs.readFileSync(path.join(dataDir, rel));
    const { gz, hash, hashes } = hostingFile(buf);
    const pub = published.get(p);
    // Тот же файл, сжатый на другой системе, — тот же (на хостинге остаётся прежний вариант)
    let h = pub && hashes.has(pub) ? pub : hash;
    if (pub && pub !== h && STAMPS[rel]) {
      const r = await fetch(`${SITE}${p}`, { cache: 'no-store' });
      if (r.ok && sameExceptStamp(buf.toString('utf8'), await r.text(), STAMPS[rel])) {
        h = pub; // на хостинге остаётся прежний файл
        stampOnly++;
      }
    }
    local.set(p, { hash: h });
    if (!pub) added.push(p);
    else if (pub !== h) changed.push(p);
    if (pub !== h) uploadBytes += gz.length;
  }
  const inRoots = (p) => roots.some((r) => (r.dir ? p.startsWith(`/${r.name}/`) : p === `/${r.name}`));
  let removed = [...published.keys()].filter((p) => inRoots(p) && !local.has(p));
  // Сборка не рисовала объёмные иконки (старый код, нет jar для генератора) — те, что на сайте, остаются
  let build = null;
  try {
    build = JSON.parse(fs.readFileSync(path.join(dataDir, '.build.json'), 'utf8'));
  } catch {
    /* папка не с сервера сборки */
  }
  const rendered = build?.render ? build.render.drawn + build.render.cached : files.some((f) => RENDER.test(`/${f}`));
  let keptRender = 0;
  if (!rendered) {
    for (const p of removed.filter((x) => RENDER.test(x))) {
      local.set(p, { hash: published.get(p) });
      keptRender++;
    }
    removed = removed.filter((p) => !RENDER.test(p));
    if (keptRender)
      say(`hosting: сборка без объёмных иконок — оставляю на сайте прежние (${keptRender} в icons/*/render/)`);
  }
  report.hosting = {
    release: release.name,
    version: release.version.name,
    files: local.size,
    added: added.length,
    changed: changed.length,
    removed: removed.length,
    keptRender,
    stampOnly,
    uploadBytes,
    sample: { added: added.slice(0, 30), changed: changed.slice(0, 30), removed: removed.slice(0, 30) },
  };
  say(
    `hosting: файлов данных ${local.size}; новых ${added.length}, изменённых ${changed.length}, ` +
      `убрать ${removed.length}; к загрузке ≈${kb(uploadBytes)} (gzip)` +
      (stampOnly ? `; только метка времени — оставляю прежние: ${stampOnly}` : ''),
  );
  for (const [sign, list] of [
    ['+', added],
    ['~', changed],
    ['−', removed],
  ])
    for (const p of list.slice(0, 30)) say(`  ${sign} ${p}`);
  for (const [sign, list] of [
    ['+', added],
    ['~', changed],
    ['−', removed],
  ])
    if (list.length > 30) say(`  ${sign} … и ещё ${list.length - 30}`);

  if (!added.length && !changed.length && !removed.length) {
    say('hosting: данные на сайте уже такие — выкладывать нечего');
    report.hosting.deployed = false;
    return report;
  }
  if (removed.length > MAX_REMOVALS && !allowRemovals) {
    const why =
      `с сайта убралось бы ${removed.length} файлов (больше ${MAX_REMOVALS}) — так бывает, когда сборка чего-то не умеет. ` +
      'Посмотрите список выше; если удаление верное — публикуйте с разрешением удалять (tfc admin publish --live --allow-removals)';
    report.hosting.blocked = why;
    if (!dryRun) throw new Error(why);
    say(`внимание: настоящая публикация остановится — ${why}`);
  }
  if (dryRun) {
    say('пробный запуск: на хостинг ничего не выложено');
    return report;
  }
  const res = await deploy({
    sourceVersion: release.version.name,
    roots,
    files: local,
    getGz: (p, h) => gzipWithHash(fs.readFileSync(path.join(dataDir, p.slice(1))), h),
    message: message ?? 'сервер сборки: данные сборки',
    log: (m) => say(`hosting: ${m}`),
  });
  report.hosting = { ...report.hosting, deployed: true, ...res };
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const dir = argv.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('node scripts/publish-data.mjs <папка данных> [--dry-run] [--allow-removals]');
    process.exit(1);
  }
  publishData({
    dataDir: path.resolve(dir),
    dryRun: argv.includes('--dry-run'),
    allowRemovals: argv.includes('--allow-removals'),
  }).catch((e) => {
    console.error('[publish]', e.message ?? e);
    process.exit(1);
  });
}
