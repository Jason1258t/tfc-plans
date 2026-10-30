/**
 * Крыши: двускатная, вальмовая, односкатная, плоская с парапетом. Скат строится как поле расстояний до края
 * крыши (со свесом): высота растёт к коньку, ступени смотрят в сторону подъёма — так в игре ставит игрок, глядя
 * вверх по скату (facing = куда поднимается ступень, StairBlock 1.21.1).
 * Где крыши объёмов пересекаются (Г, Т, П), над планом объёма остаётся более высокая — так получаются ендовы;
 * свес высокого объёма над крышей низкого не съедает её.
 */
import { ROLE, orient, type Role, type Shape } from './grid.ts';
import { inPlan, type Box, type Layout } from './massing.ts';

interface Cell {
  y: number;
  role: Role;
  shape: Shape;
  o: number;
}
interface Candidate {
  box: Box;
  /** Верх ската над клеткой, в блоках (полблока — .5) */
  surface: number;
  cells: Cell[];
}

const N = 0;
const E = 1;
const S = 2;
const W = 3;

/** Расстояние до края крыши и сторона подъёма (-1 — вершина, подъёма нет) */
function distance(box: Box, x: number, z: number): { d: number; asc: number } | null {
  const r = box.v.roof;
  const o = r.overhang;
  const X0 = box.x0 - o;
  const X1 = box.x1 + o;
  const Z0 = box.z0 - o;
  const Z1 = box.z1 + o;
  if (x < X0 || x > X1 || z < Z0 || z > Z1) return null;
  const axis = r.axis === 'auto' ? (box.v.w >= box.v.d ? 'x' : 'z') : r.axis;
  const dn = z - Z0;
  const ds = Z1 - z;
  const dw = x - X0;
  const de = X1 - x;
  if (r.kind === 'shed') return axis === 'x' ? { d: dn, asc: S } : { d: dw, asc: E };
  const sides: [number, number][] =
    r.kind === 'hip'
      ? [
          [dn, S],
          [ds, N],
          [dw, E],
          [de, W],
        ]
      : axis === 'x'
        ? [
            [dn, S],
            [ds, N],
          ]
        : [
            [dw, E],
            [de, W],
          ];
  const d = Math.min(...sides.map((s) => s[0]));
  const at = sides.filter((s) => s[0] === d).map((s) => s[1]);
  // Минимум с двух противоположных сторон — вершина ската (конёк при нечётном пролёте)
  const peak = at.some((a) => at.includes((a + 2) % 4));
  return { d, asc: peak ? -1 : at[0] };
}

function candidate(box: Box, x: number, z: number): Candidate | null {
  const here = distance(box, x, z);
  if (!here) return null;
  const r = box.v.roof;
  const yb = box.top + 1;
  const k = here.d - r.overhang;
  // Конёк — клетки, выше которых по соседству ничего нет (у вальмы диагональ ребра — не конёк: рядом есть выше)
  let ridge = r.kind !== 'shed';
  for (let dz = -1; dz <= 1 && ridge; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const n = (dx || dz) && distance(box, x + dx, z + dz);
      if (n && n.d > here.d) {
        ridge = false;
        break;
      }
    }
  const role: Role = ridge ? 'ridge' : 'roof';
  const facing = Math.max(0, here.asc);
  if (r.pitch === 1) {
    if (here.asc < 0)
      return {
        box,
        surface: yb + k + 0.5,
        cells: [
          { y: yb + k - 1, role, shape: 'full', o: 0 },
          { y: yb + k, role, shape: 'slab', o: orient(facing) },
        ],
      };
    return { box, surface: yb + k + 1, cells: [{ y: yb + k, role, shape: 'stairs', o: orient(facing) }] };
  }
  // Пологая: через клетку плита и целый блок — подъём на полблока за клетку
  if (k % 2 === 0)
    return { box, surface: yb + k / 2 + 0.5, cells: [{ y: yb + k / 2, role, shape: 'slab', o: orient(facing) }] };
  return { box, surface: yb + (k + 1) / 2, cells: [{ y: yb + (k - 1) / 2, role, shape: 'full', o: orient(facing) }] };
}

export function roofs({ grid: g, boxes }: Layout) {
  const bottom = new Int16Array(g.X * g.Z).fill(-1);
  const pitched = boxes.filter((b) => b.v.roof.kind !== 'flat');
  for (let z = 0; z < g.Z; z++)
    for (let x = 0; x < g.X; x++) {
      const list = pitched.map((b) => candidate(b, x, z)).filter((c): c is Candidate => !!c);
      const keep = list.filter(
        (c) =>
          !list.some(
            (o) =>
              o !== c &&
              inPlan(o.box, x, z) &&
              (o.surface > c.surface || (o.surface === c.surface && o.box.i < c.box.i)),
          ),
      );
      for (const c of keep)
        for (const cell of c.cells) {
          const before = g.roleAt(x, cell.y, z);
          g.fill(x, cell.y, z, cell.role, cell.shape, cell.o);
          if (before !== g.roleAt(x, cell.y, z)) {
            const p = x + g.X * z;
            g.roofed[p] = 1;
            if (bottom[p] < 0 || cell.y < bottom[p]) bottom[p] = cell.y;
          }
        }
    }

  for (const b of boxes) {
    if (b.v.roof.kind === 'flat') {
      for (let z = b.z0; z <= b.z1; z++)
        for (let x = b.x0; x <= b.x1; x++) {
          const r = g.roleAt(x, b.top, z);
          if (r === ROLE.ceiling) g.relabel(x, b.top, z, 'roof');
          if (r === ROLE.wall) g.fill(x, b.top + 1, z, 'parapet');
          if (r === ROLE.ceiling || r === ROLE.wall) g.roofed[x + g.X * z] = 1;
        }
      continue;
    }
    // Фронтоны и чердак: от верха стен до низа крыши над клеткой
    for (let z = b.z0; z <= b.z1; z++)
      for (let x = b.x0; x <= b.x1; x++) {
        const under = bottom[x + g.X * z];
        if (under < 0) continue;
        const r = g.roleAt(x, b.top, z);
        for (let y = b.top + 1; y < under; y++)
          if (r === ROLE.wall) g.fill(x, y, z, 'gable');
          else if (r === ROLE.ceiling) g.fill(x, y, z, 'interior', 'air');
      }
  }
}

/** Труба у торца главного объёма: от пола первого этажа до двух блоков над крышей */
export function chimney({ grid: g, boxes }: Layout) {
  const b = boxes[0];
  const axis = b.v.roof.axis === 'auto' ? (b.v.w >= b.v.d ? 'x' : 'z') : b.v.roof.axis;
  const x = axis === 'x' ? b.x1 - 2 : Math.floor((b.x0 + b.x1) / 2);
  const z = axis === 'x' ? Math.floor((b.z0 + b.z1) / 2) : b.z1 - 2;
  if (!inPlan(b, x, z)) return;
  let roofTop = b.top;
  for (let y = b.top; y < g.Y; y++) {
    const r = g.roleAt(x, y, z);
    if (r === ROLE.roof || r === ROLE.ridge || r === ROLE.parapet) roofTop = y;
  }
  for (let y = b.y0 + 1; y <= Math.min(roofTop + 2, g.Y - 1); y++) g.set(x, y, z, 'chimney');
}
