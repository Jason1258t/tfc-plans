/**
 * Отделка копикатами: новые клетки в воздухе снаружи здания (наличники вокруг проёмов, балка карниза под краем
 * свеса) и замена стекла на решётку (переплёт). Плавные скаты здесь не ставятся — это замена формы клеток крыши
 * в fill.ts, потому что новых клеток не нужно. Решения принимаются по исходной сетке и применяются разом.
 */
import { DX, DZ, ROLE, orient, type Grid } from './grid.ts';
import type { Layout } from './massing.ts';
import type { BuildingSpec } from './spec.ts';

export function trim({ grid: g }: Layout, spec: BuildingSpec) {
  const t = spec.details.trim;
  if (!t) return;
  if (t.surround) surround(g);
  if (t.cornice) cornice(g);
  if (t.lattice) lattice(g, spec);
}

/** Наличники: панель в воздухе перед каждой клеткой перемычки, подоконника и откоса, что смотрит наружу */
function surround(g: Grid) {
  const put = new Map<number, { x: number; y: number; z: number; role: number; s: number }>();
  for (let y = 0; y < g.Y; y++)
    for (let z = 0; z < g.Z; z++)
      for (let x = 0; x < g.X; x++) {
        const r = g.roleAt(x, y, z);
        if (r !== ROLE.lintel && r !== ROLE.sill && r !== ROLE.jamb) continue;
        for (let s = 0; s < 4; s++) {
          const tx = x + DX[s];
          const tz = z + DZ[s];
          if (g.insideAt(tx, y, tz) || g.roleAt(tx, y, tz) !== ROLE.empty) continue;
          const i = g.idx(tx, y, tz);
          if (!put.has(i)) put.set(i, { x: tx, y, z: tz, role: r, s });
        }
      }
  for (const { x, y, z, role, s } of put.values())
    g.set(x, y, z, role === ROLE.lintel ? 'lintel' : role === ROLE.sill ? 'sill' : 'jamb', 'cpanel', orient(s));
}

/** Карниз: балка в воздухе под крайней клеткой свеса (сосед по направлению ската уже без крыши) */
function cornice(g: Grid) {
  const put: { x: number; y: number; z: number; axis: number }[] = [];
  for (let y = 0; y < g.Y; y++)
    for (let z = 0; z < g.Z; z++)
      for (let x = 0; x < g.X; x++) {
        if (g.roleAt(x, y, z) !== ROLE.eave) continue;
        const f = g.orient[g.idx(x, y, z)] & 3;
        // Край свеса — со стороны, противоположной подъёму ската (ступени смотрят к коньку)
        const out = (f + 2) % 4;
        const nx = x + DX[out];
        const nz = z + DZ[out];
        const roofedNext = nx >= 0 && nz >= 0 && nx < g.X && nz < g.Z && g.roofed[nx + g.X * nz] === 1;
        if (roofedNext || g.roleAt(x, y - 1, z) !== ROLE.empty) continue;
        // Балка вдоль стены: поперёк направления ската
        put.push({ x, y: y - 1, z, axis: f % 2 === 0 ? 1 : 2 });
      }
  for (const { x, y, z, axis } of put) g.set(x, y, z, 'eave', 'cbeam', orient(0, false, axis));
}

/** Переплёт: стекло → решётка. Только когда у роли выбраны блоки — иначе окна остаются стеклянными */
function lattice(g: Grid, spec: BuildingSpec) {
  const rs = spec.roles.lattice;
  if (rs?.on === false || !rs?.fill?.blocks.length) return;
  for (let y = 0; y < g.Y; y++)
    for (let z = 0; z < g.Z; z++)
      for (let x = 0; x < g.X; x++)
        if (g.roleAt(x, y, z) === ROLE.glass) {
          const i = g.idx(x, y, z);
          g.set(x, y, z, 'lattice', 'cpane', g.orient[i]);
        }
}
