/**
 * Генератор построек целиком: параметры → роли → блоки → .nbt. Порядок важен: проёмы режут готовые стены,
 * крыша садится на верх стен и заполняет фронтоны, производные роли смотрят уже на всё вместе.
 */
import { ROLE, SHAPE, roleCounts, type Role } from './grid.ts';
import { type Has } from './families.ts';
import { paint, type Painted } from './fill.ts';
import { layout, massing, type Layout } from './massing.ts';
import { openings } from './openings.ts';
import { chimney, roofs } from './roof.ts';
import { deriveRoles } from './roles.ts';
import { checkSpec, normalizeSpec, type BuildingSpec, type Override } from './spec.ts';
import { materials, toNbt } from './toNbt.ts';

export interface Generated {
  spec: BuildingSpec;
  layout: Layout;
  painted: Painted;
  roles: Map<Role, number>;
  materials: Map<string, number>;
  /** Правки клеток, которые больше не попадают на постройку (её уменьшили или передвинули) — не применены */
  lost: Override[];
}

/**
 * Только роли, без блоков — для подсветки ролей и проверок. В возвращённых параметрах — только применённые правки
 * клеток; остальные — в lost.
 */
export function buildRoles(input: BuildingSpec): { spec: BuildingSpec; layout: Layout; lost: Override[] } {
  const normalized = normalizeSpec(input);
  const errors = checkSpec(normalized);
  if (errors.length) throw new Error(`Параметры постройки: ${errors.join('; ')}`);
  const l = layout(normalized);
  massing(l);
  openings(l, normalized);
  roofs(l);
  if (normalized.details.chimney) chimney(l);
  deriveRoles(l, normalized.details);
  const { kept, lost } = splitOverrides(l, normalized.overrides);
  const spec = { ...normalized, overrides: kept };
  applyRoleOverrides(l, spec);
  return { spec, layout: l, lost };
}

/**
 * Правка клетки живёт, пока клетка — часть постройки (что-то ставится, хоть воздух интерьера). Иначе после
 * уменьшения постройки правка роли поставила бы висящий блок там, где здания уже нет.
 */
function splitOverrides(l: Layout, overrides: Override[]) {
  const kept: Override[] = [];
  const lost: Override[] = [];
  for (const ov of overrides) {
    const [x, y, z] = [ov.pos[0] + l.ox, ov.pos[1], ov.pos[2] + l.oz];
    (l.grid.roleAt(x, y, z) !== ROLE.empty ? kept : lost).push(ov);
  }
  return { kept, lost };
}

/**
 * Правки ролей по клеткам (кисть в 3D). «Ничего» — клетка не ставится, интерьер — воздух, воздух проёма
 * становится целым блоком роли. Форма уже стоявшего блока (ступень ската, плита) сохраняется: роль меняет только
 * материал.
 */
function applyRoleOverrides(l: Layout, spec: BuildingSpec) {
  const g = l.grid;
  for (const ov of spec.overrides) {
    if (!ov.role) continue;
    const [x, y, z] = [ov.pos[0] + l.ox, ov.pos[1], ov.pos[2] + l.oz];
    const shape = g.shapeAt(x, y, z);
    if (ov.role === 'empty') g.set(x, y, z, 'empty', 'none');
    else if (ov.role === 'interior') g.set(x, y, z, 'interior', 'air');
    else if (shape === SHAPE.none || shape === SHAPE.air) g.set(x, y, z, ov.role, 'full');
    else g.relabel(x, y, z, ov.role);
  }
}

export function generate(input: BuildingSpec, has: Has): Generated {
  const { spec, layout: l, lost } = buildRoles(input);
  const painted = paint(l, spec, has);
  return { spec, layout: l, painted, roles: roleCounts(l.grid), materials: materials(painted), lost };
}

export async function generateNbt(input: BuildingSpec, has: Has): Promise<Generated & { bytes: Uint8Array }> {
  const g = generate(input, has);
  return { ...g, bytes: await toNbt(g.painted) };
}
