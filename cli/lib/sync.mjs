/**
 * Применение плана: скачать, заменить с копией старого, убрать лишнее, отменить последний `tfc pull`.
 *
 * Сначала всё качается в <версия>/.tfc/dl/ (по sha256), и только потом файлы быстро переставляются на место:
 * оборванная загрузка не оставляет полусобранную папку. Старое уходит в <версия>/.tfc/backup/<время>/
 * (одна копия на весь pull — и сборка, и сайт: beginBackup … finishBackup), `tfc undo` возвращает.
 * Хранятся последние BACKUPS копий.
 */
import fs from 'node:fs';
import path from 'node:path';
import { modIdsOf } from './jarid.mjs';
import { loadState, normsOf, saveState } from './plan.mjs';
import { localPath, stateDir } from './scan.mjs';
import { mb, progress } from './ui.mjs';

const BACKUPS = 5;

export function move(from, to) {
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
export function assertNotLocked(files) {
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

/** Копия на один pull: сюда складывают старое и сборка (applyPlan), и сайт (applyPull в pull.mjs) */
export function beginBackup(profile) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    dir: path.join(stateDir(profile), 'backup', stamp),
    manifest: {
      at: Date.now(),
      added: [],
      replaced: [],
      removed: [],
      tfcNew: [],
      edited: [],
      prevState: loadState(profile),
    },
  };
}

/**
 * Копия файла перед правкой на месте (tfc admin changes): путь любой — и вне папки версии (папка сервера),
 * поэтому в описи — полный путь, а копия — под edited/<n>
 */
export function editBackup(backup, file) {
  const m = backup.manifest;
  if (m.edited.some((e) => e.target === file)) return;
  const saved = `edited/${m.edited.length}`;
  fs.mkdirSync(path.join(backup.dir, 'edited'), { recursive: true });
  fs.copyFileSync(file, path.join(backup.dir, ...saved.split('/')));
  m.edited.push({ target: file, saved });
}

/** Убрать файл в копию; list — куда записать путь (replaced или removed) */
export function toBackup(backup, file, snapPath, list) {
  move(file, path.join(backup.dir, 'files', ...snapPath.split('/')));
  backup.manifest[list].push(snapPath);
}

/** Записать опись копии; ничего не тронули — копии нет (null) */
export function finishBackup(profile, backup) {
  const m = backup.manifest;
  if (!(m.added.length + m.replaced.length + m.removed.length + m.tfcNew.length + m.edited.length)) return null;
  fs.mkdirSync(backup.dir, { recursive: true });
  fs.writeFileSync(path.join(backup.dir, 'manifest.json'), `${JSON.stringify(m, null, 1)}\n`);
  pruneBackups(profile);
  return backup.dir;
}

/**
 * Применить план снимка. Возвращает убранные старые версии модов. backup — из beginBackup;
 * cache — HashCache из scanLocal (запомнить хеши записанного, чтобы не перечитывать);
 * skip — пути сайта (аддоны): их не считаем ни модами сборки, ни дублями.
 */
export async function applyPlan({ api, profile, plan, snapshot, cache, backup, skip = new Set(), onlyNew = false }) {
  const dest = (f) => localPath(profile, f.path);
  const toWrite = [...plan.add, ...plan.update];
  assertNotLocked([...plan.update, ...plan.remove].map(dest));
  const blob = await fetchAll(api, { profile, list: [...toWrite, ...plan.conflict] });

  const state = loadState(profile);
  const manifest = backup.manifest;
  manifest.snapshot = snapshot.id;
  const keep = (f, to = 'replaced') => toBackup(backup, dest(f), f.path, to);

  for (const f of plan.update) keep(f);
  for (const f of plan.remove) {
    keep(f, 'removed');
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
  // Ключи смысла записанного и совпавшего: следующий pull отличит правку игрока от перезаписи игрой
  state.norms = {
    ...state.norms,
    ...normsOf([...toWrite, ...plan.same].map((f) => ({ path: f.path, file: dest(f) }))),
  };
  for (const f of plan.remove) delete state.norms[f.path];

  // Старые версии обновлённых модов: свой jar игрока с тем же id мода, что у jar сборки
  const duplicates = [];
  const snapJars = (snapshot.files ?? []).filter((f) => f.kind === 'mod' && !skip.has(f.path));
  const extraJars = plan.extra.filter((f) => f.kind === 'mod' && !skip.has(f.path));
  if (!onlyNew && snapJars.length && extraJars.length) {
    const owner = new Map();
    for (const f of snapJars) {
      const file = dest(f);
      if (fs.existsSync(file)) for (const id of modIdsOf(file)) owner.set(id, f.path);
    }
    for (const f of extraJars) {
      const ids = modIdsOf(f.file).filter((id) => owner.has(id));
      if (!ids.length) continue;
      assertNotLocked([f.file]);
      keep(f, 'removed');
      duplicates.push({ path: f.path, ids, by: owner.get(ids[0]) });
    }
  }

  state.snapshot = snapshot.id;
  saveState(profile, state);
  cache.save();
  fs.rmSync(path.join(stateDir(profile), 'dl'), { recursive: true, force: true });
  return { duplicates };
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

export function pruneBackups(profile) {
  const all = backups(profile);
  for (const d of all.slice(0, Math.max(0, all.length - BACKUPS))) fs.rmSync(d, { recursive: true, force: true });
}

/** Отменить последний pull: убрать добавленное, вернуть заменённое и убранное */
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
  // Поставленное и тут же убранное в том же pull (jar сборки вместо аддона) — до pull его не было
  const added = new Set(m.added);
  for (const p of [...m.replaced, ...m.removed]) {
    const f = localPath(profile, p);
    if (f && !added.has(p)) move(path.join(last, 'files', ...p.split('/')), f);
  }
  m.removed = m.removed.filter((p) => !added.has(p));
  for (const e of m.edited ?? []) fs.copyFileSync(path.join(last, ...e.saved.split('/')), e.target);
  saveState(profile, m.prevState);
  fs.rmSync(last, { recursive: true, force: true });
  return m;
}
