/**
 * Производные роли: по готовой коробке, проёмам и крыше стена делится на углы, цоколь, пояса, перемычки,
 * подоконники и откосы, крыша — на свесы и торцы. Решение принимается по соседям в исходной сетке, а потом
 * применяется разом, поэтому порядок обхода не влияет. Старшинство (кто победит, если клетка подходит под
 * несколько): перемычка > подоконник > откос > продолжение перемычки/подоконника вбок > пояс > цоколь > угол >
 * стена.
 */
import { DX, DZ, ROLE, axisOf, facingOf, orient, type Grid, type Role } from './grid.ts';
import type { Layout } from './massing.ts';
import type { DetailSpec } from './spec.ts';

const isOpening = (r: number) => r === ROLE.glass || r === ROLE.door;
const isPlate = (r: number) => r === ROLE.floor || r === ROLE.ceiling || r === ROLE.roof;
const isRoof = (r: number) => r === ROLE.roof || r === ROLE.ridge;

/** Стороны, в которые клетка стены смотрит наружу */
function exposure(g: Grid, x: number, y: number, z: number) {
  const out: number[] = [];
  for (let s = 0; s < 4; s++) if (!g.insideAt(x + DX[s], y, z + DZ[s])) out.push(s);
  return out;
}

export function deriveRoles({ grid: g }: Layout, d: DetailSpec) {
  const next = new Map<number, { role: Role; o?: number }>();
  const put = (x: number, y: number, z: number, role: Role, o?: number) => next.set(g.idx(x, y, z), { role, o });

  // Высота фундамента под клеткой плана — от неё считается цоколь
  const ground = new Int16Array(g.X * g.Z).fill(-1);
  for (let y = g.Y - 1; y >= 0; y--)
    for (let z = 0; z < g.Z; z++)
      for (let x = 0; x < g.X; x++) if (g.roleAt(x, y, z) === ROLE.foundation) ground[x + g.X * z] = y;

  for (let y = 0; y < g.Y; y++)
    for (let z = 0; z < g.Z; z++)
      for (let x = 0; x < g.X; x++) {
        if (g.roleAt(x, y, z) !== ROLE.wall) continue;
        const exp = exposure(g, x, y, z);
        const ns = exp.find((s) => s % 2 === 0);
        const ew = exp.find((s) => s % 2 === 1);
        // Ось ряда вдоль фасада: у бревенчатой стены бревно лежит вдоль неё
        const runAxis = ns !== undefined ? 1 : 2;
        g.orient[g.idx(x, y, z)] = orient(0, false, runAxis);

        const below = g.roleAt(x, y - 1, z);
        const above = g.roleAt(x, y + 1, z);
        const side = (dy: number, test: (r: number) => boolean) =>
          [0, 1, 2, 3].some((s) => test(g.roleAt(x + DX[s], y + dy, z + DZ[s])));
        let plate = false;
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && isPlate(g.roleAt(x + dx, y, z + dz))) plate = true;
        // Внутренний угол: наружу смотрит только по диагонали (иначе клетка не была бы стеной)
        const concave = exp.length === 0;
        const convex = ns !== undefined && ew !== undefined;
        const gy = ground[x + g.X * z];

        if (isOpening(below)) put(x, y, z, 'lintel');
        else if (above === ROLE.glass) put(x, y, z, 'sill');
        else if (side(0, isOpening)) put(x, y, z, 'jamb');
        else if (d.openingExt && below === ROLE.wall && side(-1, isOpening)) put(x, y, z, 'lintel');
        else if (d.openingExt && above === ROLE.wall && side(1, (r) => r === ROLE.glass)) put(x, y, z, 'sill');
        else if (plate) put(x, y, z, 'belt');
        else if (gy >= 0 && y - gy <= d.plinthH) put(x, y, z, 'plinth');
        else if (convex || concave) {
          // Сруб: на углу брёвна перекрещиваются — ось меняется через ряд
          put(x, y, z, 'corner', orient(0, false, y % 2 ? 1 : 2));
          if (d.quoins && convex) {
            const [qx, qz] = y % 2 ? [x, z - DZ[ns!]] : [x - DX[ew!], z];
            if (g.roleAt(qx, y, qz) === ROLE.wall && !next.has(g.idx(qx, y, qz))) put(qx, y, qz, 'corner');
          }
        }
      }

  // Фахверк: углы, пояса и стойки через frameEvery — каркас, остальное — заполнение
  if (d.frameEvery > 0)
    for (let y = 0; y < g.Y; y++)
      for (let z = 0; z < g.Z; z++)
        for (let x = 0; x < g.X; x++) {
          const i = g.idx(x, y, z);
          if (g.role[i] !== ROLE.wall) continue;
          const now = next.get(i)?.role ?? 'wall';
          const runAxis = axisOf(g.orient[i]);
          if (now === 'corner') put(x, y, z, 'frame', orient(0, false, 0));
          else if (now === 'belt') put(x, y, z, 'frame', orient(0, false, runAxis));
          else if (now === 'wall')
            put(x, y, z, (runAxis === 1 ? x : z) % d.frameEvery === 0 ? 'frame' : 'infill', orient(0, false, 0));
        }

  // Простенки (индустриальный кирпич): сплошные столбы кладки между колоннами окон — роль каркаса.
  // Колонна с окном или дверью на любой высоте остаётся стеной (подоконные и надоконные вставки).
  if (d.piers) {
    const open = new Uint8Array(g.X * g.Z);
    for (let y = 0; y < g.Y; y++)
      for (let z = 0; z < g.Z; z++)
        for (let x = 0; x < g.X; x++) if (isOpening(g.roleAt(x, y, z))) open[x + g.X * z] = 1;
    for (let y = 0; y < g.Y; y++)
      for (let z = 0; z < g.Z; z++)
        for (let x = 0; x < g.X; x++) {
          const i = g.idx(x, y, z);
          if (g.role[i] === ROLE.wall && !next.has(i) && !open[x + g.X * z]) put(x, y, z, 'frame', orient(0, false, 0));
        }
  }

  for (const [i, { role, o }] of next) {
    g.role[i] = ROLE[role];
    if (o !== undefined) g.orient[i] = o;
  }

  // Крыша: свес — за стенами, торец — край ската сбоку
  const plan = new Uint8Array(g.X * g.Z);
  for (let y = 0; y < g.Y; y++)
    for (let z = 0; z < g.Z; z++) for (let x = 0; x < g.X; x++) if (g.insideAt(x, y, z)) plan[x + g.X * z] = 1;
  const roofedAt = (x: number, z: number) => x >= 0 && z >= 0 && x < g.X && z < g.Z && g.roofed[x + g.X * z] === 1;
  for (let y = 0; y < g.Y; y++)
    for (let z = 0; z < g.Z; z++)
      for (let x = 0; x < g.X; x++) {
        const i = g.idx(x, y, z);
        if (!isRoof(g.role[i]) || g.role[i] === ROLE.ridge) continue;
        const f = facingOf(g.orient[i]);
        const l = (f + 1) % 4;
        const r = (f + 3) % 4;
        if (!roofedAt(x + DX[l], z + DZ[l]) || !roofedAt(x + DX[r], z + DZ[r])) g.role[i] = ROLE.verge;
        else if (!plan[x + g.X * z]) g.role[i] = ROLE.eave;
      }
}
