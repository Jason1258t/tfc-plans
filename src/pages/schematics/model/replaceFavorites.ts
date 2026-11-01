import { useEffect, useState } from 'react';
import { replaceFavoritesStore } from '@/entities/schematic';
import type { ReplaceFavorite } from '@/entities/schematic';
import { isPair, parsePair } from '@tfc/core/copycatPairs';
import { isBlock, type ItemIndex } from '@/shared/pack-data';

/** Подписка на избранные замены; null — ещё грузятся */
export function useFavorites(): ReplaceFavorite[] | null {
  const [list, setList] = useState<ReplaceFavorite[] | null>(null);
  useEffect(() => replaceFavoritesStore.subscribe(setList, () => setList([])), []);
  return list;
}

/** Производные блоки: ступеньки, плиты, ограды… — то, что в обоих модах строится как «<основа>_<вид>» */
export const VARIANT_KINDS = [
  { id: 'stairs', name: 'Ступеньки' },
  { id: 'slab', name: 'Плита' },
  { id: 'wall', name: 'Ограда' },
  { id: 'fence', name: 'Забор' },
  { id: 'fence_gate', name: 'Калитка' },
  { id: 'pressure_plate', name: 'Нажимная плита' },
  { id: 'button', name: 'Кнопка' },
] as const;

/**
 * Основы, от которых строится имя производного: сам id, без «s» на конце (deepslate_bricks → deepslate_brick),
 * без «_planks»/«_block» (oak_planks → oak_stairs).
 */
const stems = (id: string): string[] => {
  const out = [id];
  if (id.endsWith('s')) out.push(id.slice(0, -1));
  const bare = id.replace(/_(planks|block)$/, '');
  if (bare !== id) out.push(bare);
  return out;
};

/**
 * Материал по умолчанию для пары: у пары — её материал (с учётом его замены: материала может не быть в сборке),
 * у производного блока — основа (dolomite_stairs → dolomite, oak_stairs → oak_planks, brick_slab → bricks),
 * у цельного блока — он сам. Только блоки сборки.
 */
export function suggestMaterial(source: string, items: ItemIndex | null, replace: Map<string, string>): string | null {
  const pair = parsePair(source);
  if (pair) return [replace.get(pair.material), pair.material].find((id) => id && isBlock(items, id)) ?? null;
  const base = source.replace(new RegExp(`_(${VARIANT_KINDS.map((k) => k.id).join('|')})$`), '');
  const options = base === source ? [source] : [base, `${base}s`, `${base}_planks`, `${base}_block`];
  return options.find((id) => isBlock(items, id)) ?? null;
}

export interface Variant {
  kind: (typeof VARIANT_KINDS)[number];
  /** Производное от исходного блока (есть в библиотеке сборки) */
  from: string;
  /** Производное от целевого блока; null — в библиотеке такого нет */
  to: string | null;
  /** Исходный производный блок есть в загруженных схемах */
  inSchematic: boolean;
}

/**
 * По примеру «from → to» найти такие же замены для ступенек, плит и т. п.:
 * deepslate_bricks → tfc:rock/bricks/dolomite даёт deepslate_brick_stairs → tfc:rock/bricks/dolomite_stairs.
 * Только то, что есть в библиотеке; `present` — id блоков в загруженных схемах.
 */
export function deriveVariants(from: string, to: string, items: ItemIndex, present: Set<string>): Variant[] {
  const out: Variant[] = [];
  if (isPair(from) || isPair(to)) return out;
  for (const kind of VARIANT_KINDS) {
    const src = stems(from)
      .map((s) => `${s}_${kind.id}`)
      .find((id) => id !== from && items.byId.has(id));
    if (!src) continue;
    const dst = stems(to)
      .map((s) => `${s}_${kind.id}`)
      .find((id) => items.byId.has(id));
    out.push({ kind, from: src, to: dst ?? null, inSchematic: present.has(src) });
  }
  return out;
}
