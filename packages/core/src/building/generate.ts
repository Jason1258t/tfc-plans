/**
 * Генератор построек целиком: параметры → роли → блоки → .nbt. Порядок важен: проёмы режут готовые стены,
 * крыша садится на верх стен и заполняет фронтоны, производные роли смотрят уже на всё вместе.
 */
import { roleCounts, type Role } from './grid.ts';
import { type Has } from './families.ts';
import { paint, type Painted } from './fill.ts';
import { layout, massing, type Layout } from './massing.ts';
import { openings } from './openings.ts';
import { chimney, roofs } from './roof.ts';
import { deriveRoles } from './roles.ts';
import { checkSpec, normalizeSpec, type BuildingSpec } from './spec.ts';
import { materials, toNbt } from './toNbt.ts';

export interface Generated {
  spec: BuildingSpec;
  layout: Layout;
  painted: Painted;
  roles: Map<Role, number>;
  materials: Map<string, number>;
}

/** Только роли, без блоков — для подсветки ролей и проверок */
export function buildRoles(input: BuildingSpec): { spec: BuildingSpec; layout: Layout } {
  const spec = normalizeSpec(input);
  const errors = checkSpec(spec);
  if (errors.length) throw new Error(`Параметры постройки: ${errors.join('; ')}`);
  const l = layout(spec);
  massing(l);
  openings(l, spec);
  roofs(l);
  if (spec.details.chimney) chimney(l);
  deriveRoles(l, spec.details);
  for (const ov of spec.overrides) if (ov.role) l.grid.relabel(ov.pos[0] + l.ox, ov.pos[1], ov.pos[2] + l.oz, ov.role);
  return { spec, layout: l };
}

export function generate(input: BuildingSpec, has: Has): Generated {
  const { spec, layout: l } = buildRoles(input);
  const painted = paint(l, spec, has);
  return { spec, layout: l, painted, roles: roleCounts(l.grid), materials: materials(painted) };
}

export async function generateNbt(input: BuildingSpec, has: Has): Promise<Generated & { bytes: Uint8Array }> {
  const g = generate(input, has);
  return { ...g, bytes: await toNbt(g.painted) };
}
