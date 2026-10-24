import { collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { authReady, db } from '@/shared/api';
import type { Datapack } from '@/entities/datapack';
import { loadAddonVersions } from '../../../data/addonVersions';
import { ADDONS } from '../../../lib/addons';
import { addonChangelogsFrom, type AddonVersion } from '../../../lib/addonVersions';
import { itemRefsOf } from '@/shared/pack-data';

/** Запись об обновлении сборки — пишет scripts/pack-release.mjs при деплое */
export interface ModRef {
  id: string;
  name: string;
  version: string;
  /** Версия до обновления */
  from?: string;
}

export interface PatchNotes {
  body: string;
  source: 'agent' | 'manual';
  updatedBy: string;
  updatedAt: number;
}

export interface PackUpdate {
  id: string;
  createdAt: number;
  deployedBy: string;
  /** Первая запись: прошлого снимка не было, в mods.added — вся сборка */
  baseline: boolean;
  mods: { added: ModRef[]; removed: ModRef[]; updated: ModRef[] };
  items?: { added: string[]; removed: string[] };
  recipes?: { added: string[]; removed: string[]; changed: string[] };
  /** Точные количества (списки выше урезаны до 3000) */
  totals?: {
    itemsAdded: number;
    itemsRemoved: number;
    recipesAdded: number;
    recipesRemoved: number;
    recipesChanged: number;
  };
  counts: { mods: [number, number]; items: [number, number]; recipes: [number, number] };
  newRecipeTypes?: string[];
  /** modId → markdown с Modrinth или ченджлог версий нашего аддона */
  changelogs?: Record<string, string>;
  /** Откуда ченджлог: Modrinth или версии нашего аддона (addonVersions); в старых записях поля нет */
  changelogSources?: Record<string, 'modrinth' | 'addon'>;
  notes?: PatchNotes;
}

let cache: PackUpdate[] | null = null;
const listeners = new Set<(u: PackUpdate[]) => void>();
let unsub: (() => void) | null = null;

/** Подписка на ленту обновлений (одна на приложение, новые сверху) */
export function usePackUpdates(): PackUpdate[] | null {
  const [list, setList] = useState(cache);
  useEffect(() => {
    listeners.add(setList);
    if (!unsub && db) {
      let cancelled = false;
      unsub = () => {
        cancelled = true;
      };
      authReady.then(() => {
        if (cancelled) return;
        unsub = onSnapshot(
          query(collection(db!, 'packUpdates'), orderBy('createdAt', 'desc')),
          (snap) => {
            cache = snap.docs.map((d) => ({ ...(d.data() as Omit<PackUpdate, 'id'>), id: d.id }));
            listeners.forEach((l) => l(cache!));
          },
          (e) => console.warn('packUpdates:', e.message),
        );
      });
    } else if (!db) queueMicrotask(() => setList([]));
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}

export async function saveNotes(id: string, body: string, source: PatchNotes['source'], nick: string) {
  await authReady;
  await updateDoc(doc(db!, 'packUpdates', id), {
    notes: { body, source, updatedBy: nick, updatedAt: Date.now() } satisfies PatchNotes,
  });
}

// ---------------------------------------------------------------- «новое» в шапке

const SEEN_KEY = 'tfc-tm:updates-seen';
export function lastSeenUpdate(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0);
  } catch {
    return 0;
  }
}
export function markUpdatesSeen(at: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(at));
    window.dispatchEvent(new Event('tfc-updates-seen'));
  } catch {
    /* приватный режим — бейдж просто останется */
  }
}

// ---------------------------------------------------------------- датапаки под угрозой

export interface DatapackRisk {
  pack: Datapack;
  path: string;
  reason: string;
}

/** Записи датапаков сайта, которые затронуло это обновление: их рецепт пропал/изменился или пропали предметы */
export function datapackRisks(u: PackUpdate, packs: Datapack[]): DatapackRisk[] {
  const removedRecipes = new Set(u.recipes?.removed ?? []);
  const changedRecipes = new Set(u.recipes?.changed ?? []);
  const removedItems = new Set(u.items?.removed ?? []);
  const out: DatapackRisk[] = [];
  for (const pack of packs) {
    for (const e of pack.entries) {
      if (e.sourceRecipe && removedRecipes.has(e.sourceRecipe))
        out.push({ pack, path: e.path, reason: `рецепт ${e.sourceRecipe} удалён из сборки` });
      else if (e.sourceRecipe && changedRecipes.has(e.sourceRecipe) && e.kind !== 'remove')
        out.push({ pack, path: e.path, reason: `рецепт ${e.sourceRecipe} изменён модом — сверьте` });
      if (removedItems.size && e.path.endsWith('.json')) {
        try {
          const gone = itemRefsOf(JSON.parse(e.content)).filter((id) => removedItems.has(id));
          if (gone.length) out.push({ pack, path: e.path, reason: `пропали предметы: ${gone.slice(0, 4).join(', ')}` });
        } catch {
          /* битый JSON покажет сам редактор */
        }
      }
    }
  }
  return out;
}

/** id мода по id предмета/рецепта — для группировки по модам */
export const nsOf = (id: string) => id.split(':')[0];

// ---------------------------------------------------------------- ченджлоги наших аддонов

const versionsCache = new Map<string, Promise<AddonVersion[]>>();

/** Наши аддоны среди добавленных и обновлённых модов записи */
export const addonModsOf = (u: PackUpdate) => {
  const ids = new Set(ADDONS.map((a) => a.id));
  return [...u.mods.added, ...u.mods.updated].filter((m) => ids.has(m.id)).map((m) => m.id);
};

/**
 * Запись с ченджлогами наших аддонов: у старых записей (до 2026-10-23) их не было — подставляем из addonVersions
 * за «было → стало», ничего не записывая. Версии аддона читаются один раз на страницу.
 */
export async function withAddonChangelogs(u: PackUpdate): Promise<PackUpdate> {
  if (u.baseline) return u;
  const need = addonModsOf(u).filter((id) => u.changelogSources?.[id] !== 'addon');
  if (!need.length) return u;
  const missing = need.filter((id) => !versionsCache.has(id));
  if (missing.length) {
    const all = loadAddonVersions(missing);
    for (const id of missing)
      versionsCache.set(
        id,
        all.then((m) => m.get(id) ?? []),
      );
    all.catch(() => missing.forEach((id) => versionsCache.delete(id)));
  }
  const versions = (await Promise.all(need.map((id) => versionsCache.get(id)!))).flat();
  const logs = addonChangelogsFrom(u.mods, ADDONS, versions, 8000);
  if (!Object.keys(logs).length) return u;
  const sources = { ...(u.changelogSources ?? {}) };
  for (const id of Object.keys(logs)) sources[id] = 'addon';
  return { ...u, changelogs: { ...(u.changelogs ?? {}), ...logs }, changelogSources: sources };
}

/** То же хуком: enabled — когда список изменений открыт (не тратим чтения на свёрнутые карточки) */
export function useAddonChangelogs(u: PackUpdate, enabled: boolean): PackUpdate {
  const [full, setFull] = useState<PackUpdate | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    withAddonChangelogs(u)
      .then((x) => alive && setFull(x))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [u, enabled]);
  return full && full.id === u.id ? { ...u, changelogs: full.changelogs, changelogSources: full.changelogSources } : u;
}
