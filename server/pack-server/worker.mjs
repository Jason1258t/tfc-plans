#!/usr/bin/env node
/**
 * Процесс одного задания сервера сборки (его запускает lib/jobs.mjs, из копии репозитория — поэтому разборщики
 * и этот файл всегда одной версии). Аргумент — файл задания: { id, kind, snapshot, parts, publish, dataDir }.
 *
 * build:
 *   1. снимок → <DATA>/work/<снимок>/ — жёсткие ссылки на blobs (копия, если ссылка невозможна);
 *   2. scripts/pack.mjs (runPack) с выходом в <DATA>/data/<снимок>.tmp-<задание>/, кеш jar — <DATA>/cache/
 *      (там же кеш объёмных иконок и ресурсы Minecraft/NeoForge для них — cache/platform/);
 *      с parts — только эти части поверх прошлой сборки того же снимка;
 *   3. рядом: .firestore.json (документы config — пишутся при публикации), .index.json (файлы и sha256 — для
 *      npm run pack:fetch), .build.json (со счётом объёмных иконок render); потом папка переименовывается в
 *      data/<снимок>/;
 *   4. publish dry-run | live — scripts/publish-data.mjs.
 * publish: только шаг 4 по уже собранной data/<снимок>/.
 * Итог — <DATA>/jobs/<id>.result.json.
 */
import { deploymentsOf } from './lib/datapacks.mjs';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const DATA = path.resolve(spec.dataDir);
const log = (...a) => console.log('[job]', ...a);
const snapDir = (id) => path.join(DATA, 'data', id);

// Генератор объёмных иконок (MCP) читает jar из TFC_MODS_DIR, путь берётся при загрузке модуля — поэтому до импорта
// разборщиков; без него он искал бы jar в mods/ копии репозитория, где их нет
process.env.TFC_MODS_DIR = path.join(DATA, 'work', spec.snapshot, 'mods');
// граница-ок: worker запускается только в полной копии репозитория (код разборщиков), не в /opt/tfc-pack, где нет npm
const { runPack } = await import('../../scripts/pack.mjs');
// граница-ок: то же
const { dataFiles, publishData } = await import('../../scripts/publish-data.mjs');

/** Снимок → папка версии из жёстких ссылок на blobs. Блоб — только чтение: разборщик его не испортит */
function materialize(snap, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  let linked = 0;
  let copied = 0;
  for (const f of snap.files) {
    const blob = path.join(DATA, 'blobs', f.sha256);
    const target = path.join(dir, ...f.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.chmodSync(blob, 0o444);
    try {
      fs.linkSync(blob, target);
      linked++;
    } catch (e) {
      if (!['EXDEV', 'EPERM', 'EMLINK'].includes(e.code)) throw e;
      fs.copyFileSync(blob, target);
      copied++;
    }
  }
  log(`снимок ${snap.id}: ${snap.files.length} файлов → ${dir} (ссылок ${linked}, копий ${copied})`);
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function build() {
  const snap = JSON.parse(fs.readFileSync(path.join(DATA, 'snapshots', `${spec.snapshot}.json`), 'utf8'));
  const work = path.join(DATA, 'work', snap.id);
  const instance = path.join(DATA, 'work', `${snap.id}.instance`);
  const out = path.join(DATA, 'data', `${snap.id}.tmp-${spec.id}`);
  const final = snapDir(snap.id);
  materialize(snap, work);
  fs.rmSync(instance, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  let only = spec.parts;
  let baseDocs = [];
  let prevInfo = null;
  if (only.length && fs.existsSync(final)) {
    // Части поверх прошлой сборки: копия, а не ссылки — разборщики переписывают файлы на месте
    fs.cpSync(final, out, { recursive: true });
    try {
      prevInfo = JSON.parse(fs.readFileSync(path.join(out, '.build.json'), 'utf8'));
    } catch {
      /* прошлая сборка без сведений */
    }
    try {
      baseDocs = JSON.parse(fs.readFileSync(path.join(out, '.firestore.json'), 'utf8'));
    } catch {
      /* прошлая сборка без документов */
    }
    log(`собираю только ${only.join(', ')} поверх прошлой сборки снимка`);
  } else if (only.length) {
    log(`прошлой сборки снимка нет — собираю всё, а не только ${only.join(', ')}`);
    only = [];
  }

  const t = Date.now();
  const r = await runPack({
    input: work,
    only,
    outDir: out,
    instanceDir: instance,
    cacheDir: path.join(DATA, 'cache'),
    dryRun: true, // в Firestore пишет публикация, не сборка
    neoforge: snap.loader ?? null,
  });

  // Уровни установки публикуются вместе с рецептами того же снимка, без чтения Firestore в браузере.
  const kjsFile = path.join(out, 'kubejs.json');
  if (fs.existsSync(kjsFile)) {
    const data = JSON.parse(fs.readFileSync(kjsFile, 'utf8'));
    data.datapacks = deploymentsOf(snap);
    data.snapshot = snap.id;
    fs.writeFileSync(kjsFile, JSON.stringify(data));
  }

  // Документы config: пересобранные части заменяют свои, остальные — из прошлой сборки
  const rebuiltWorld = !only.length || only.includes('world');
  const rebuiltConfig = !only.length || only.includes('config');
  const docs = [
    ...baseDocs.filter((d) => (d.id.startsWith('world__') ? !rebuiltWorld : !rebuiltConfig)),
    ...r.firestore,
  ].map((d) => ({ ...d, data: { ...d.data, source: `снимок ${snap.id}` } }));
  fs.writeFileSync(path.join(out, '.firestore.json'), JSON.stringify(docs));

  const files = dataFiles(out).map((p) => {
    const full = path.join(out, p);
    return { path: p, sha256: sha256(full), size: fs.statSync(full).size };
  });
  fs.writeFileSync(path.join(out, '.index.json'), JSON.stringify({ snapshot: snap.id, files }));
  const info = {
    snapshot: snap.id,
    job: spec.id,
    builtAt: new Date().toISOString(),
    commit: spec.commit ?? null,
    parts: Object.keys(r.parts),
    only,
    files: files.length,
    bytes: files.reduce((n, f) => n + f.size, 0),
    configDocs: docs.length,
    // Объёмные иконки: без них публикация не трогает icons/*/render/ (publish-data.mjs)
    render: r.render ?? (only.length && !only.includes('mods') ? (prevInfo?.render ?? null) : null),
    seconds: Math.round((Date.now() - t) / 1000),
  };
  fs.writeFileSync(path.join(out, '.build.json'), JSON.stringify(info, null, 1));

  fs.rmSync(final, { recursive: true, force: true });
  fs.renameSync(out, final);
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(instance, { recursive: true, force: true });
  log(
    `собрано: ${info.files} файлов, ${(info.bytes / 1024 / 1024).toFixed(1)} МБ, части ${info.parts.join(', ')} → ${final}`,
  );
  return info;
}

const result = { kind: spec.kind, snapshot: spec.snapshot };
try {
  if (spec.kind === 'build') result.build = await build();
  if (spec.publish !== 'none') {
    const dir = snapDir(spec.snapshot);
    if (!fs.existsSync(path.join(dir, '.build.json'))) throw new Error(`снимок ${spec.snapshot} ещё не собран`);
    result.publish = await publishData({
      dataDir: dir,
      dryRun: spec.publish !== 'live',
      allowRemovals: !!spec.allowRemovals,
      message: `сервер сборки: снимок ${spec.snapshot} (${spec.by})`,
    });
  }
} finally {
  const ru = process.resourceUsage();
  // maxRSS — в КБ; пик памяти нужен, чтобы понимать, влезает ли сборка в память сервера
  result.maxRssMb = Math.round(ru.maxRSS / 1024);
  log(`пик памяти процесса: ${result.maxRssMb} МБ`);
  fs.writeFileSync(path.join(DATA, 'jobs', `${spec.id}.result.json`), JSON.stringify(result, null, 1));
}
