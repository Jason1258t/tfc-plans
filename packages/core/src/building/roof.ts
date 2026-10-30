/**
 * Крыши: двускатная, вальмовая, односкатная, шедовая (зубцы с остеклённой гранью), конус (у круглого объёма),
 * плоская с парапетом. Скат строится как поле расстояний до края
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

/** Вид крыши с учётом формы: у круглого объёма скатная крыша — конус, у прямоугольного конус — вальма */
export function roofKind(box: Box) {
  const k = box.v.roof.kind;
  if (box.v.shape === 'round') return k === 'flat' ? 'flat' : 'cone';
  return k === 'cone' ? 'hip' : k;
}

const ridgeAxis = (box: Box) => (box.v.roof.axis === 'auto' ? (box.v.w >= box.v.d ? 'x' : 'z') : box.v.roof.axis);

/** Расстояние до края крыши и сторона подъёма (-1 — вершина, подъёма нет) */
function distance(box: Box, x: number, z: number): { d: number; asc: number } | null {
  const r = box.v.roof;
  const kind = roofKind(box);
  const o = r.overhang;
  if (kind === 'cone') {
    // Овал со свесом; высота — по нормированному расстоянию до края, подъём — к центру по главной оси
    const rx = (box.x1 - box.x0 + 1) / 2 + o;
    const rz = (box.z1 - box.z0 + 1) / 2 + o;
    const dx = x - (box.x0 + box.x1) / 2;
    const dz = z - (box.z0 + box.z1) / 2;
    const t = Math.sqrt((dx * dx) / (rx * rx) + (dz * dz) / (rz * rz));
    if (t > 1) return null;
    const d = Math.floor((1 - t) * Math.min(rx, rz));
    if (Math.abs(dx) < 0.6 && Math.abs(dz) < 0.6) return { d, asc: -1 };
    const asc = Math.abs(dx) * rz >= Math.abs(dz) * rx ? (dx > 0 ? W : E) : dz > 0 ? N : S;
    return { d, asc };
  }
  const X0 = box.x0 - o;
  const X1 = box.x1 + o;
  const Z0 = box.z0 - o;
  const Z1 = box.z1 + o;
  if (x < X0 || x > X1 || z < Z0 || z > Z1) return null;
  const axis = ridgeAxis(box);
  if (kind === 'sawtooth') {
    // Зубцы поперёк конька: в каждом скат поднимается на ширину зубца, потом обрыв со стеклом
    const tooth = r.tooth ?? 5;
    return axis === 'x' ? { d: (z - Z0) % tooth, asc: S } : { d: (x - X0) % tooth, asc: E };
  }
  const dn = z - Z0;
  const ds = Z1 - z;
  const dw = x - X0;
  const de = X1 - x;
  if (kind === 'shed') return axis === 'x' ? { d: dn, asc: S } : { d: dw, asc: E };
  const sides: [number, number][] =
    kind === 'hip'
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

/** Верх ската над клеткой при расстоянии d (в блоках; .5 — плита) */
function surfaceAt(box: Box, d: number) {
  const k = d - box.v.roof.overhang;
  const yb = box.top + 1;
  if (box.v.roof.pitch === 1) return yb + k + 1;
  return k % 2 === 0 ? yb + k / 2 + 0.5 : yb + (k + 1) / 2;
}

function candidate(box: Box, x: number, z: number): Candidate | null {
  const here = distance(box, x, z);
  if (!here) return null;
  const r = box.v.roof;
  const kind = roofKind(box);
  const yb = box.top + 1;
  const k = here.d - r.overhang;
  const c = slope(box, x, z, here, k, yb, kind);
  // Шедовая: над низом зубца — стекло до верха предыдущего зубца (световой фонарь)
  if (kind === 'sawtooth' && here.d === 0) {
    const back = ridgeAxis(box) === 'x' ? distance(box, x, z - 1) : distance(box, x - 1, z);
    if (back && back.d > 0) {
      const from = Math.max(...c.cells.map((cell) => cell.y)) + 1;
      const to = Math.ceil(surfaceAt(box, back.d)) - 1;
      const axis = ridgeAxis(box) === 'x' ? 1 : 2;
      for (let y = from; y <= to; y++) c.cells.push({ y, role: 'glass', shape: 'pane', o: orient(0, false, axis) });
    }
  }
  return c;
}

function slope(
  box: Box,
  x: number,
  z: number,
  here: { d: number; asc: number },
  k: number,
  yb: number,
  kind: string,
): Candidate {
  const r = box.v.roof;
  // Конёк — клетки, выше которых по соседству ничего нет (у вальмы диагональ ребра — не конёк: рядом есть выше)
  let ridge = kind !== 'shed' && kind !== 'sawtooth';
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
  const pitched = boxes.filter((b) => roofKind(b) !== 'flat');
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
    if (roofKind(b) === 'flat') {
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

/**
 * Труба у торца главного объёма (у круглого — по центру): от пола первого этажа до chimneyH над крышей,
 * сечение 1 или 2 клетки (промышленная).
 */
export function chimney({ grid: g, boxes }: Layout, height = 2, size = 1) {
  const b = boxes[0];
  const axis = ridgeAxis(b);
  const cx = Math.floor((b.x0 + b.x1) / 2);
  const cz = Math.floor((b.z0 + b.z1) / 2);
  const round = b.v.shape === 'round';
  const x = round || axis !== 'x' ? cx : b.x1 - 1 - size;
  const z = round || axis === 'x' ? cz : b.z1 - 1 - size;
  const cells: [number, number][] = [];
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) cells.push([x + i, z + j]);
  if (!cells.every(([cx2, cz2]) => inPlan(b, cx2, cz2))) return;
  let roofTop = b.top;
  for (const [px, pz] of cells)
    for (let y = b.top; y < g.Y; y++) {
      const r = g.roleAt(px, y, pz);
      if (r === ROLE.roof || r === ROLE.ridge || r === ROLE.parapet || r === ROLE.glass) roofTop = Math.max(roofTop, y);
    }
  for (const [px, pz] of cells)
    for (let y = b.y0 + 1; y <= Math.min(roofTop + height, g.Y - 1); y++) g.set(px, y, pz, 'chimney');
}
