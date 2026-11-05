/**
 * Подписка профиля на предложенные обновления (staging). `tfc pull` такого профиля считает сборкой виртуальный снимок
 * «текущая сборка + обновления поверх»: дальше всё идёт обычной сверкой (makePlan), поэтому файлы сборки обновляются
 * как всегда, файлы обновления остаются, а отписка возвращает обычное состояние следующим же pull.
 *
 * В `.tfc/state.json`: staging — [{ id, note }] в порядке подписки (позднее главнее), stagingPaths — пути, которые
 * дали обновления: только по ним сверка выходит за обычные части сборки (на сервере моды не трогаем, а jar обновления
 * ставим и после отписки убираем), stagingDrop — { jar сборки: jar обновления } для одного мода под разными именами.
 * Обновления читает только ключ администратора, игроки подписаться не могут.
 *
 * Споры: файл обновления главнее файла сборки, даже если сборка его поменяла (предупреждение). jar обновления убирает
 * другие jar того же мода по имени без версии и аддон сайта с этим модом, закрепление аддона не снимает: вернётся после
 * отписки. Обновление одобрено или отклонено — подписка снимается сама. См. docs/tfc-app.md.
 */
import fs from 'node:fs';
import { isModJar, jarKey } from '@tfc/pack-server/paths';
import { modIdsOf } from './jarid.mjs';
import { localPath } from './scan.mjs';

export { isModJar, jarKey };

/**
 * Снимок + обновления по порядку. → { snapshot, paths: файлы обновлений, removed: что они убрали, notes }.
 * Снимок не меняется, id у нового тот же: state.snapshot по-прежнему показывает текущую сборку.
 */
export function overlaySnapshot(current, updates) {
  const files = new Map(current.files.map((f) => [f.path, f]));
  const paths = new Set();
  const removed = new Set();
  const notes = [];
  const drop = (p) => {
    files.delete(p);
    paths.delete(p);
    removed.add(p);
  };
  for (const u of updates) {
    for (const p of u.remove ?? []) drop(p);
    // Подтверждённому датапаку не нужна копия в мире: две версии спорили бы
    for (const d of u.datapacks ?? []) for (const p of d.worldPaths ?? []) drop(p);
    for (const f of u.files ?? []) {
      if (isModJar(f.path))
        for (const other of [...files.values()])
          if (other.path !== f.path && other.kind === 'mod' && jarKey(other.path) === jarKey(f.path)) {
            notes.push(`${other.path} заменён на ${f.path} из обновления ${u.id}`);
            drop(other.path);
          }
      if (paths.has(f.path) && files.get(f.path)?.sha256 !== f.sha256)
        notes.push(`${f.path} есть в нескольких обновлениях — беру из ${u.id} (подписан позже)`);
      files.set(f.path, f);
      paths.add(f.path);
      removed.delete(f.path);
    }
  }
  // Заменённый обновлением закреплённый датапак остаётся закреплённым, уже с новым ZIP
  const replaced = new Map(updates.flatMap((u) => u.datapacks ?? []).flatMap((d) => (d.replaces ? [[d.id, d]] : [])));
  const datapacks = current.datapacks?.map((d) => {
    const r = replaced.get(d.id);
    return r ? { ...d, sha256: r.sha256, contentHash: r.contentHash, revision: r.revision } : d;
  });
  return {
    snapshot: { ...current, files: [...files.values()], ...(datapacks ? { datapacks } : {}) },
    paths,
    removed,
    notes,
  };
}

/** Пути обновления, которые в сборке поменялись после предложения */
async function driftNotes(api, u, current) {
  if (!u.base || u.base === current.id) return [];
  let base;
  try {
    base = await api.get(`/pack/snapshots/${encodeURIComponent(u.base)}`);
  } catch {
    return []; // старый снимок удалён — сравнить не с чем
  }
  const was = new Map(base.files.map((f) => [f.path, f.sha256]));
  const now = new Map(current.files.map((f) => [f.path, f.sha256]));
  return (u.files ?? [])
    .filter((f) => was.get(f.path) !== now.get(f.path) && now.get(f.path) !== f.sha256)
    .map((f) => `${f.path}: сборка его поменяла после обновления ${u.id} — пока подписка, остаётся версия обновления`);
}

/**
 * Подписки профиля на сервере. ids — список [{ id, note }]. Без подписок null: игрок не ходит в /admin. →
 * { updates, keep, dropped: [{ id, why }], snapshot, paths, removed, notes, datapackIds, jars }
 */
export async function stagingOverlay(api, ids, current) {
  if (!ids?.length) return null;
  if (!api) throw new Error('профиль подписан на обновления — нужен ключ: tfc login <ключ>');
  let all;
  try {
    ({ updates: all } = await api.get('/admin/updates'));
  } catch (e) {
    if (e.status !== 403) throw e;
    throw new Error(
      'профиль подписан на обновления, а они доступны только ключу администратора. Отписаться: tfc admin updates unsubscribe all',
    );
  }
  const updates = [];
  const dropped = [];
  for (const { id } of ids) {
    const u = all.find((x) => x.id === id);
    if (!u) dropped.push({ id, why: 'его больше нет на сервере' });
    else if (u.status === 'approved') dropped.push({ id, why: `одобрено — уже в сборке ${u.snapshot ?? ''}`.trim() });
    else if (u.status === 'rejected') dropped.push({ id, why: 'отклонено' });
    else updates.push(u);
  }
  const over = current
    ? overlaySnapshot(current, updates)
    : { snapshot: null, paths: new Set(), removed: new Set(), notes: [] };
  const notes = [...over.notes];
  if (current) for (const u of updates) notes.push(...(await driftNotes(api, u, current)));
  return {
    ...over,
    updates,
    dropped,
    notes,
    keep: updates.map((u) => ({ id: u.id, note: u.note })),
    datapackIds: new Set(updates.flatMap((u) => (u.datapacks ?? []).map((d) => d.id))),
    jars: [...over.paths].filter(isModJar),
    drop: {},
  };
}

/** Убрать jar сборки из снимка подписки: его заменяет jar обновления by. Запоминается в state.stagingDrop до отписки */
function dropJar(staging, p, by) {
  staging.drop[p] = by;
  staging.removed.add(p);
  staging.snapshot.files = staging.snapshot.files.filter((f) => f.path !== p);
}

/** id мода → jar обновления, для тех jar, что уже на диске (имя может не совпадать, а мод тот же) */
function stagedModIds(profile, staging) {
  const ids = new Map();
  for (const p of staging.jars) {
    const file = localPath(profile, p);
    if (fs.existsSync(file)) for (const id of modIdsOf(file)) ids.set(id, p);
  }
  return ids;
}

/** Прошлые замены (state.stagingDrop), пока их jar в подписках */
export function applyStagingDrops(staging, drops) {
  if (!staging?.snapshot) return;
  for (const [p, by] of Object.entries(drops ?? {})) if (staging.paths.has(by)) dropJar(staging, p, by);
}

/**
 * Аддон сайта и jar обновления — один мод, хотя имена разные: главный jar обновления, аддон убираем из плана и из папки.
 * jar с тем же именем в снимке (аддоны бывают и в сборке) тоже не ставим.
 */
export function stagingWinsById(profile, plan, staging) {
  if (!plan || !staging?.snapshot) return;
  const ids = stagedModIds(profile, staging);
  if (!ids.size) return;
  const by = (x) =>
    x.jar && !staging.paths.has(x.path)
      ? modIdsOf(x.jar)
          .map((id) => ids.get(id))
          .find(Boolean)
      : undefined;
  for (const x of [...plan.add, ...plan.update, ...plan.same]) if (by(x)) dropJar(staging, x.path, by(x));
  for (const x of [...plan.update, ...plan.same].filter(by))
    plan.remove.push({ id: x.id, name: x.name, path: x.path, file: x.file, sha256: x.sha256 });
  for (const k of ['add', 'update', 'same']) plan[k] = plan[k].filter((x) => !by(x));
}

/**
 * jar сборки на диске с тем же модом, что jar обновления, под другим именем. Такой мод виден только по файлам: до pull
 * (убрать из снимка подписки) и сразу после него, когда jar обновления только что лёг. except — пути, которые уже
 * убирает план. → [{ path, file, by }]
 */
export function stagingClashes(profile, staging, except = new Set()) {
  if (!staging?.snapshot) return [];
  const ids = stagedModIds(profile, staging);
  if (!ids.size) return [];
  const out = [];
  for (const f of staging.snapshot.files) {
    if (f.kind !== 'mod' || staging.paths.has(f.path) || except.has(f.path)) continue;
    const file = localPath(profile, f.path);
    if (!fs.existsSync(file)) continue;
    const hit = modIdsOf(file).find((id) => ids.has(id));
    if (hit) out.push({ path: f.path, file, by: ids.get(hit) });
  }
  for (const c of out) dropJar(staging, c.path, c.by);
  return out;
}

/** Что отписка и подписка пишут в state.json после удачного pull */
export function stagingState(state, staging, ids, { allParts }) {
  const keep = staging ? staging.keep : ids;
  const now = staging ? [...staging.paths, ...staging.removed] : [];
  const paths = allParts ? now : [...new Set([...(state.stagingPaths ?? []), ...now])];
  const next = { ...state };
  if (keep?.length) next.staging = keep;
  else delete next.staging;
  if (paths.length) next.stagingPaths = paths;
  else delete next.stagingPaths;
  if (keep?.length && staging?.drop && Object.keys(staging.drop).length) next.stagingDrop = staging.drop;
  else delete next.stagingDrop;
  return next;
}
