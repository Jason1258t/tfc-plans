import { collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { authReady, db } from '../firebase';
import type { Datapack } from '../types';
import { itemRefsOf } from './recipes';

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
  /** modId → markdown с Modrinth */
  changelogs?: Record<string, string>;
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
