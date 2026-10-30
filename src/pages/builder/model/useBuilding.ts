import { useEffect, useMemo, useState } from 'react';
import { generateNbt, type Generated } from '@tfc/core/building/generate';
import { ROLES, type Role } from '@tfc/core/building/grid';
import type { BlockState } from '@tfc/core/building/fill';
import type { BuildingSpec } from '@tfc/core/building/spec';
import { loadSchematic, type Schematic, type Vec } from '@/entities/schematic';
import { isBlock, type ItemIndex } from '@/shared/pack-data';

export interface Built {
  gen: Generated;
  schematic: Schematic;
  bytes: Uint8Array;
}

/** Клетка постройки под курсором: роль и блок */
export interface CellInfo {
  pos: Vec;
  role: Role;
  state: BlockState | null;
}

/** Есть ли блок в сборке — для семейств (ступени, плиты) */
export const hasBlock = (items: ItemIndex) => (id: string) => isBlock(items, id);

/**
 * Постройка по параметрам: перестраивается с небольшой задержкой после правки, чтобы ввод чисел не дёргал 3D.
 * Генерация — в этом потоке: сетки небольшие (до сотни тысяч клеток), занимает миллисекунды.
 */
export function useBuilding(spec: BuildingSpec, items: ItemIndex | null, name: string) {
  const [built, setBuilt] = useState<Built | null>(null);
  const [error, setError] = useState<string | null>(null);
  const has = useMemo(() => (items ? hasBlock(items) : null), [items]);
  useEffect(() => {
    if (!has) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const gen = await generateNbt(spec, has);
        const schematic = await loadSchematic(
          new File([gen.bytes as BlobPart], `${name || 'постройка'}.nbt`, { type: 'application/octet-stream' }),
        );
        if (!live) return;
        setBuilt({ gen, schematic, bytes: gen.bytes });
        setError(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [spec, has, name]);
  return { built, error, has };
}

export function cellAt(built: Built, pos: Vec): CellInfo | null {
  const g = built.gen.layout.grid;
  const [x, y, z] = pos;
  if (!g.in(x, y, z)) return null;
  const i = g.idx(x, y, z);
  const c = built.gen.painted.cells[i];
  return { pos, role: ROLES[g.role[i]], state: c ? built.gen.painted.palette[c - 1] : null };
}

/** Клетки роли — подсветить в 3D */
export function cellsOf(built: Built, role: Role): Vec[] {
  const g = built.gen.layout.grid;
  const code = ROLES.indexOf(role);
  const out: Vec[] = [];
  for (let y = 0; y < g.Y; y++)
    for (let z = 0; z < g.Z; z++)
      for (let x = 0; x < g.X; x++)
        if (g.role[g.idx(x, y, z)] === code && built.gen.painted.cells[g.idx(x, y, z)]) out.push([x, y, z]);
  return out;
}

/**
 * Видимые блоки в рамке: поставленные (не воздух) и хотя бы одной гранью наружу — иначе рамка цепляла бы
 * перекрытия и кладку за фасадом.
 */
export function framedCells(built: Built, inFrame: (pos: Vec) => boolean): Vec[] {
  const g = built.gen.layout.grid;
  const { cells, palette } = built.gen.painted;
  const solid = (x: number, y: number, z: number) => {
    if (!g.in(x, y, z)) return false;
    const c = cells[g.idx(x, y, z)];
    return !!c && palette[c - 1].Name !== 'minecraft:air';
  };
  const out: Vec[] = [];
  for (let y = 0; y < g.Y; y++)
    for (let z = 0; z < g.Z; z++)
      for (let x = 0; x < g.X; x++) {
        if (!solid(x, y, z)) continue;
        const open =
          !solid(x + 1, y, z) ||
          !solid(x - 1, y, z) ||
          !solid(x, y + 1, z) ||
          !solid(x, y - 1, z) ||
          !solid(x, y, z + 1) ||
          !solid(x, y, z - 1);
        if (open && inFrame([x, y, z])) out.push([x, y, z]);
      }
  return out;
}
