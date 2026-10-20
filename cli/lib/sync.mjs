/**
 * Применение плана: скачать, заменить с копией старого, убрать лишнее, отменить последнюю синхронизацию.
 *
 * Сначала всё качается в <версия>/.tfc/dl/ (по sha256), и только потом файлы быстро переставляются на место:
 * оборванная загрузка не оставляет полусобранную папку. Старое уходит в <версия>/.tfc/backup/<время>/,
 * `tfc sync --undo` возвращает. Хранятся последние BACKUPS копий.
 */
import fs from 'node:fs';
import path from 'node:path';
import { modIdsOf } from './jarid.mjs';
import { loadState, saveState } from './plan.mjs';
import { localPath, stateDir } from './scan.mjs';
import { mb, progress } from './ui.mjs';

const BACKUPS = 5;

function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e; // мир на другом диске
    fs.copyFileSync(from, to);
    fs.rmSync(from);
  }
}

/** Файл не занят игрой (на Windows запущенная игра держит jar) */
function assertNotLocked(files) {
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    try {
      fs.closeSync(fs.openSync(f, 'r+'));
    } catch (e) {
      if (['EBUSY', 'EPERM', 'EACCES'].includes(e.code))
        throw new Error(`${path.basename(f)} занят — закройте игру (и сервер) и запустите ещё раз`);
      throw e;
    }
  }
}

/** Скачать всё нужное в .tfc/dl; одинаковое содержимое — один раз */
async function fetchAll(api, items) {
  const dl = path.join(stateDir(items.profile), 'dl');
  const bySha = new Map();
  for (const f of items.list) if (!bySha.has(f.sha256)) bySha.set(f.sha256, f);
  const todo = [...bySha.values()].filter((f) => !fs.existsSync(path.join(dl, f.sha256)));
  if (todo.length) {
    const total = todo.reduce((s, f) => s + f.size, 0);
    console.log(`Скачиваю ${todo.length} файлов, ${mb(total)}`);
    const bar = progress('загрузка', total);
    for (const f of todo) await api.download(f.sha256, path.join(dl, f.sha256), (n) => bar.add(n));
    bar.end();
  }
  return (sha) => path.join(dl, sha);
}

/**
 * Применить план. Возвращает { backup, duplicates } — папку копий и убранные старые версии модов.
 * cache — HashCache из scanLocal (запомнить хеши записанного, чтобы не перечитывать).
 */
export async function applyPlan({ api, profile, plan, snapshot, cache, onlyNew = false }) {
  const dest = (f) => localPath(profile, f.path);
  const toWrite = [...plan.add, ...plan.update];
  assertNotLocked([...plan.update, ...plan.remove].map(dest));
  const blob = await fetchAll(api, { profile, list: [...toWrite, ...plan.conflict] });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(stateDir(profile), 'backup', stamp);
  const state = loadState(profile);
  const manifest = {
    at: Date.now(),
    snapshot: snapshot.id,
    added: [],
    replaced: [],
    removed: [],
    tfcNew: [],
    prevState: state,
  };
  const keep = (f, to) => {
    move(dest(f), path.join(backupDir, 'files', ...f.path.split('/')));
    (to ?? manifest.replaced).push(f.path);
  };

  for (const f of plan.update) keep(f);
  for (const f of plan.remove) {
    keep(f, manifest.removed);
    delete state.files[f.path];
  }
  for (const f of toWrite) {
    const target = dest(f);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(blob(f.sha256), target);
    cache.remember(target, f.sha256);
    state.files[f.path] = f.sha256;
    if (plan.add.includes(f)) manifest.added.push(f.path);
  }
  for (const f of plan.conflict) {
    const target = `${dest(f)}.tfc-new`;
    fs.copyFileSync(blob(f.sha256), target);
    manifest.tfcNew.push(`${f.path}.tfc-new`);
  }
  for (const f of plan.same) state.files[f.path] = f.sha256;

  // Старые версии обновлённых модов: свой jar игрока с тем же id мода, что у jar сборки
  const duplicates = [];
  const snapJars = (snapshot.files ?? []).filter((f) => f.kind === 'mod');
  if (!onlyNew && snapJars.length && plan.extra.some((f) => f.kind === 'mod')) {
    const owner = new Map();
    for (const f of snapJars) {
      const file = dest(f);
      if (fs.existsSync(file)) for (const id of modIdsOf(file)) owner.set(id, f.path);
    }
    for (const f of plan.extra.filter((x) => x.kind === 'mod')) {
      const ids = modIdsOf(f.file).filter((id) => owner.has(id));
      if (!ids.length) continue;
      assertNotLocked([f.file]);
      keep(f, manifest.removed);
      duplicates.push({ path: f.path, ids, by: owner.get(ids[0]) });
    }
  }

  state.snapshot = snapshot.id;
  saveState(profile, state);
  cache.save();
  const touched = manifest.added.length + manifest.replaced.length + manifest.removed.length + manifest.tfcNew.length;
  if (touched) {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
    pruneBackups(profile);
  }
  fs.rmSync(path.join(stateDir(profile), 'dl'), { recursive: true, force: true });
  return { backup: touched ? backupDir : null, duplicates };
}

function backups(profile) {
  const dir = path.join(stateDir(profile), 'backup');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, 'manifest.json')))
    .sort()
    .map((d) => path.join(dir, d));
}

function pruneBackups(profile) {
  const all = backups(profile);
  for (const d of all.slice(0, Math.max(0, all.length - BACKUPS))) fs.rmSync(d, { recursive: true, force: true });
}

/** Отменить последнюю синхронизацию: убрать добавленное, вернуть заменённое и убранное */
export function undoLast(profile) {
  const last = backups(profile).at(-1);
  if (!last) return null;
  const m = JSON.parse(fs.readFileSync(path.join(last, 'manifest.json'), 'utf8'));
  const all = [...m.added, ...m.replaced, ...m.removed].map((p) => localPath(profile, p)).filter(Boolean);
  assertNotLocked(all);
  for (const p of [...m.added, ...m.replaced]) {
    const f = localPath(profile, p);
    if (f) fs.rmSync(f, { force: true });
  }
  for (const p of m.tfcNew) {
    const f = localPath(profile, p);
    if (f) fs.rmSync(f, { force: true });
  }
  for (const p of [...m.replaced, ...m.removed]) {
    const f = localPath(profile, p);
    if (f) move(path.join(last, 'files', ...p.split('/')), f);
  }
  saveState(profile, m.prevState);
  fs.rmSync(last, { recursive: true, force: true });
  return m;
}
