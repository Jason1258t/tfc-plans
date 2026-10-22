/**
 * Сверка папки игры со снимком сборки: что докачать, обновить, убрать, где правка игрока.
 *
 * Правила (docs/plans/pack-cli.md, «Правила синхронизации»):
 * - удаляем только то, что ставила сама программа (`.tfc/state.json`) и чего больше нет в сборке;
 *   свои моды игрока не трогаем, только показываем;
 * - конфиг или скрипт, который игрок поменял после прошлой синхронизации, не перезаписываем молча:
 *   рядом кладём `*.tfc-new` (или перезаписываем с --force, копия остаётся);
 * - клиентские конфиги (`*-client.toml` и т. п.) только добавляются: у каждого игрока свои;
 * - конфиг, который игрок (или сама игра) поменял, а в сборке он с прошлого pull не менялся, — оставляем молча;
 *   поменяла только игра (дата в шапке, пустые строки — cli/lib/noise.mjs) — обновляем без .tfc-new;
 * - состояние модов (кеши, история JEI — isStatePath) не ставим и не убираем;
 * - на сервере (папка с server.properties) моды по умолчанию не трогаем: в сборке хоста есть клиентские моды;
 * - пути, которые отдаёт сайт (аддоны, датапаки и скрипты «ставить»), план не трогает — см. siteOwned в pull.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isClientConfig, isStatePath } from '../../server/pack-server/lib/paths.mjs';
import { textKey } from './noise.mjs';
import { stateDir } from './scan.mjs';

/**
 * Части для `tfc pull` и `tfc status`: что берём из снимка сборки (виды файлов снимка) и что с сайта (PULL_KINDS).
 * Аддоны — часть сборки: они идут вместе с модами.
 */
export const PARTS = {
  mods: { snap: ['mod'], site: ['addons'] },
  config: { snap: ['config', 'defaultconfig', 'serverconfig'] },
  kubejs: { snap: ['kubejs'], site: ['kubejs'] },
  resourcepacks: { snap: ['resourcepack'] },
  datapacks: { snap: ['world-datapack'], site: ['datapacks'] },
  world: { snap: ['world-data'] },
  schematics: { site: ['schematics'] },
  addons: { site: ['addons'] },
};

/** Без частей. На сервере моды сборки не трогаем (в ней есть клиентские), аддоны ставим — свои стороны */
const DEFAULT_SNAP = {
  client: ['mod', 'config', 'defaultconfig', 'kubejs', 'resourcepack'],
  server: ['config', 'defaultconfig', 'serverconfig', 'kubejs', 'world-datapack'],
};
const DEFAULT_SITE = {
  client: ['addons', 'kubejs', 'schematics'],
  server: ['addons', 'kubejs', 'datapacks', 'schematics'],
};

const EDITABLE = new Set(['config', 'defaultconfig', 'serverconfig', 'kubejs']);

/**
 * Что тянуть: { snap: виды снимка, site: виды сайта }. Выбран мир — его датапаки тянем и на клиенте
 * (хост играет в своём мире).
 */
export function scopeOf(parts, profile) {
  const side = profile.side === 'server' ? 'server' : 'client';
  if (!parts.length) {
    const snap = new Set(DEFAULT_SNAP[side]);
    const site = new Set(DEFAULT_SITE[side]);
    if (profile.world) {
      snap.add('world-datapack');
      site.add('datapacks');
    }
    return { snap: [...snap], site: [...site] };
  }
  const snap = new Set();
  const site = new Set();
  for (const p of parts) {
    const x = PARTS[p];
    if (!x) throw new Error(`не знаю «${p}» — можно: ${Object.keys(PARTS).join(', ')}`);
    for (const k of x.snap ?? []) snap.add(k);
    for (const k of x.site ?? []) site.add(k);
  }
  return { snap: [...snap], site: [...site] };
}

// ---------------------------------------------------------------- state.json

export function loadState(profile) {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir(profile), 'state.json'), 'utf8'));
  } catch {
    return { snapshot: null, files: {} };
  }
}

export function saveState(profile, state) {
  fs.mkdirSync(stateDir(profile), { recursive: true });
  fs.writeFileSync(path.join(stateDir(profile), 'state.json'), `${JSON.stringify(state, null, 1)}\n`);
}

/**
 * Ключи смысла текстовых конфигов (без шума) для state.norms: по ним pull отличает правку игрока от того, что
 * переписала сама игра. files — [{ path, file }] записанных или совпавших файлов
 */
export function normsOf(files) {
  const out = {};
  for (const f of files) {
    if (!f.file) continue;
    try {
      const k = textKey(f.path, fs.readFileSync(f.file));
      if (k) out[f.path] = k;
    } catch {
      // файла нет — ключа нет
    }
  }
  return out;
}

/** Поменял ли игрок файл по смыслу после прошлого pull; null — неизвестно (старый state.json без ключей) */
function editedByPlayer(state, l) {
  const was = state.norms?.[l.path];
  if (!was) return null;
  try {
    const k = textKey(l.path, fs.readFileSync(l.file));
    return k ? k !== was : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- план

/**
 * snapshot — снимок с сервера; local — Map из scanLocal; state — что ставили раньше; skip — пути, которые
 * отдаёт сайт (их ставит и убирает pull сайта, план их не видит).
 * Возвращает { add, update, conflict, keepClient, keptLocal, remove, keptModified, extra, same, noWorld }:
 * элементы — { path, kind, sha256, size, local? }.
 */
export function makePlan(snapshot, local, state, kinds, { force = false, hasWorld = true, skip = new Set() } = {}) {
  const inScope = (kind) => kinds.includes(kind);
  const plan = {
    add: [],
    update: [],
    conflict: [],
    keepClient: [],
    keptLocal: [],
    remove: [],
    keptModified: [],
    extra: [],
    same: [],
    noWorld: [],
  };
  const inSnap = new Set();
  for (const f of snapshot?.files ?? []) {
    if (!inScope(f.kind) || skip.has(f.path) || isStatePath(f.path)) continue;
    inSnap.add(f.path);
    if (f.path.startsWith('world/') && !hasWorld) {
      plan.noWorld.push(f);
      continue;
    }
    const l = local.get(f.path);
    if (!l) plan.add.push(f);
    else if (l.sha256 === f.sha256) plan.same.push(f);
    else if (isClientConfig(f.path)) plan.keepClient.push({ ...f, local: l });
    else if (EDITABLE.has(f.kind) && state.files[f.path] && state.files[f.path] !== l.sha256 && !force) {
      // В сборке файл с прошлого pull тот же — менять нечего, правку (игрока или игры) оставляем
      if (state.files[f.path] === f.sha256) plan.keptLocal.push({ ...f, local: l });
      // Игра переписала только дату или пустые строки — это не правка игрока, обновляем
      else if (editedByPlayer(state, l) === false) plan.update.push({ ...f, local: l });
      else plan.conflict.push({ ...f, local: l });
    } else plan.update.push({ ...f, local: l });
  }
  for (const [p, l] of local) {
    if (inSnap.has(p) || !inScope(l.kind) || skip.has(p) || isStatePath(p)) continue;
    const was = state.files[p];
    if (!was) plan.extra.push(l);
    else if (was === l.sha256 || force) plan.remove.push(l);
    else plan.keptModified.push(l);
  }
  return plan;
}

export const bytesOf = (list) => list.reduce((s, f) => s + (f.size ?? 0), 0);
export const changes = (plan) => plan.add.length + plan.update.length + plan.conflict.length + plan.remove.length;
