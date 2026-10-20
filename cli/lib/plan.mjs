/**
 * Сверка папки игры со снимком сборки: что докачать, обновить, убрать, где правка игрока.
 *
 * Правила (docs/plans/pack-cli.md, «Правила синхронизации»):
 * - удаляем только то, что ставила сама программа (`.tfc/state.json`) и чего больше нет в сборке;
 *   свои моды игрока не трогаем, только показываем;
 * - конфиг или скрипт, который игрок поменял после прошлой синхронизации, не перезаписываем молча:
 *   рядом кладём `*.tfc-new` (или перезаписываем с --force, копия остаётся);
 * - клиентские конфиги (`*-client.toml` и т. п.) только добавляются: у каждого игрока свои;
 * - на сервере (папка с server.properties) моды по умолчанию не трогаем: в сборке хоста есть клиентские моды.
 */
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './scan.mjs';

/** Группы для команд: tfc sync mods config … */
export const GROUPS = {
  mods: ['mod'],
  config: ['config', 'defaultconfig', 'serverconfig'],
  kubejs: ['kubejs'],
  resourcepacks: ['resourcepack'],
  datapacks: ['world-datapack'],
  world: ['world-data'],
};

export const DEFAULT_KINDS = {
  client: ['mod', 'config', 'defaultconfig', 'kubejs', 'resourcepack'],
  server: ['config', 'defaultconfig', 'serverconfig', 'kubejs', 'world-datapack'],
};

const EDITABLE = new Set(['config', 'defaultconfig', 'serverconfig', 'kubejs']);
const isClientConfig = (p) => /^(config|defaultconfigs)\/.*[-_]client\.(toml|json5?|cfg|properties|txt)$/i.test(p);

export function kindsOf(groups, side) {
  if (!groups.length) return DEFAULT_KINDS[side] ?? DEFAULT_KINDS.client;
  const out = new Set();
  for (const g of groups) {
    const k = GROUPS[g];
    if (!k) throw new Error(`не знаю «${g}» — можно: ${Object.keys(GROUPS).join(', ')}`);
    for (const x of k) out.add(x);
  }
  return [...out];
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

// ---------------------------------------------------------------- план

/**
 * snapshot — снимок с сервера; local — Map из scanLocal; state — что ставили раньше.
 * Возвращает { add, update, conflict, keepClient, remove, keptModified, extra, same, noWorld }:
 * элементы — { path, kind, sha256, size, local? }.
 */
export function makePlan(snapshot, local, state, kinds, { force = false, hasWorld = true } = {}) {
  const inScope = (kind) => kinds.includes(kind);
  const plan = {
    add: [],
    update: [],
    conflict: [],
    keepClient: [],
    remove: [],
    keptModified: [],
    extra: [],
    same: [],
    noWorld: [],
  };
  const inSnap = new Set();
  for (const f of snapshot?.files ?? []) {
    if (!inScope(f.kind)) continue;
    inSnap.add(f.path);
    if (f.path.startsWith('world/') && !hasWorld) {
      plan.noWorld.push(f);
      continue;
    }
    const l = local.get(f.path);
    if (!l) plan.add.push(f);
    else if (l.sha256 === f.sha256) plan.same.push(f);
    else if (isClientConfig(f.path)) plan.keepClient.push({ ...f, local: l });
    else if (EDITABLE.has(f.kind) && state.files[f.path] && state.files[f.path] !== l.sha256 && !force)
      plan.conflict.push({ ...f, local: l });
    else plan.update.push({ ...f, local: l });
  }
  for (const [p, l] of local) {
    if (inSnap.has(p) || !inScope(l.kind)) continue;
    const was = state.files[p];
    if (!was) plan.extra.push(l);
    else if (was === l.sha256 || force) plan.remove.push(l);
    else plan.keptModified.push(l);
  }
  return plan;
}

export const bytesOf = (list) => list.reduce((s, f) => s + (f.size ?? 0), 0);
export const changes = (plan) => plan.add.length + plan.update.length + plan.conflict.length + plan.remove.length;
