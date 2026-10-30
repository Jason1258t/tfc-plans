import type { Role } from '@tfc/core/building/grid';
import type { Layout } from '@tfc/core/building/massing';
import type { BuildingSpec, Override } from '@tfc/core/building/spec';
import type { Vec } from '@/entities/schematic';

/**
 * Правки по клеткам (кисть): хранятся в параметрах постройки в её координатах (без сдвига сетки), поэтому
 * переживают пересборку, пока клетка существует. Роль — клетка берёт блоки роли (форма ступени/плиты остаётся),
 * блок — конкретный блок (у ступени — ступень этого материала), «ничего» — клетка не ставится.
 */
export type CellEdit = { role: Role } | { block: string } | 'reset';

const key = (p: readonly number[]) => p.join(',');

export const toSpecPos = (l: Layout, [x, y, z]: Vec): Override['pos'] => [x - l.ox, y, z - l.oz];

export function editCells(spec: BuildingSpec, l: Layout, cells: Vec[], edit: CellEdit): BuildingSpec {
  const byPos = new Map(spec.overrides.map((ov) => [key(ov.pos), ov]));
  for (const c of cells) {
    const pos = toSpecPos(l, c);
    const k = key(pos);
    if (edit === 'reset') byPos.delete(k);
    else if ('role' in edit) byPos.set(k, { pos, role: edit.role });
    else byPos.set(k, { ...byPos.get(k), pos, block: edit.block });
  }
  return { ...spec, overrides: [...byPos.values()] };
}

/** Есть ли правка у клетки */
export function editedCells(spec: BuildingSpec, l: Layout): Set<string> {
  return new Set(spec.overrides.map((ov) => key([ov.pos[0] + l.ox, ov.pos[1], ov.pos[2] + l.oz])));
}

export const cellKey = key;
