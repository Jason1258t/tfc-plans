/**
 * Объёмы → коробка здания: фундамент, стены по общему контуру, перекрытия, воздух внутри.
 * Стены — по контуру объединения объёмов на каждой высоте: на стыке двух объёмов стены нет, комнаты соединены.
 * Контур берётся по восьми соседям, иначе во внутреннем углу Г-образного плана осталась бы дыра.
 */
import { Grid } from './grid.ts';
import type { BuildingSpec, Volume } from './spec.ts';

/** Объём в координатах сетки */
export interface Box {
  i: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  /** Верхний ряд стен (он же уровень верхнего перекрытия) */
  top: number;
  floors: number;
  floorH: number;
  v: Volume;
}

export interface Layout {
  grid: Grid;
  boxes: Box[];
  /** Сдвиг: клетка сетки = координаты спецификации + сдвиг */
  ox: number;
  oz: number;
}

/** Сколько блоков крыша может подняться над верхом стен */
function roofRise(v: Volume) {
  const o = v.roof.overhang;
  const span = v.roof.kind === 'shed' ? Math.max(v.w, v.d) : Math.min(v.w, v.d);
  const half = v.roof.kind === 'shed' ? span + 2 * o : Math.ceil((span + 2 * o) / 2);
  return v.roof.kind === 'flat' ? 2 : Math.ceil(half * v.roof.pitch) + 2;
}

export function layout(spec: BuildingSpec): Layout {
  const vs = spec.volumes;
  const pad = Math.max(...vs.map((v) => v.roof.overhang)) + 1;
  const minX = Math.min(...vs.map((v) => v.x)) - pad;
  const minZ = Math.min(...vs.map((v) => v.z)) - pad;
  const maxX = Math.max(...vs.map((v) => v.x + v.w - 1)) + pad;
  const maxZ = Math.max(...vs.map((v) => v.z + v.d - 1)) + pad;
  const maxY = Math.max(...vs.map((v) => v.y + v.floors * v.floorH + roofRise(v))) + (spec.details.chimney ? 3 : 1);
  const ox = -minX;
  const oz = -minZ;
  const grid = new Grid(maxX - minX + 1, maxY + 1, maxZ - minZ + 1);
  const boxes = vs.map((v, i) => ({
    i,
    x0: v.x + ox,
    z0: v.z + oz,
    x1: v.x + ox + v.w - 1,
    z1: v.z + oz + v.d - 1,
    y0: v.y,
    top: v.y + v.floors * v.floorH,
    floors: v.floors,
    floorH: v.floorH,
    v,
  }));
  return { grid, boxes, ox, oz };
}

export const inPlan = (b: Box, x: number, z: number) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;

/** Первый объём, который занимает клетку на этой высоте (от фундамента до верхнего ряда стен) */
export function boxAt(boxes: Box[], x: number, y: number, z: number): Box | null {
  for (const b of boxes) if (y >= b.y0 && y <= b.top && inPlan(b, x, z)) return b;
  return null;
}

export function massing({ grid: g, boxes }: Layout) {
  for (let y = 0; y < g.Y; y++)
    for (let z = 0; z < g.Z; z++)
      for (let x = 0; x < g.X; x++) {
        const b = boxAt(boxes, x, y, z);
        if (!b) continue;
        const i = g.idx(x, y, z);
        g.inside[i] = 1;
        g.volume[i] = b.i + 1;
      }
  for (let y = 0; y < g.Y; y++)
    for (let z = 0; z < g.Z; z++)
      for (let x = 0; x < g.X; x++) {
        const i = g.idx(x, y, z);
        if (!g.inside[i]) continue;
        const b = boxes[g.volume[i] - 1];
        if (boxes.some((o) => o.y0 === y && inPlan(o, x, z))) {
          g.set(x, y, z, 'foundation');
          continue;
        }
        let edge = false;
        for (let dz = -1; dz <= 1 && !edge; dz++)
          for (let dx = -1; dx <= 1; dx++)
            if ((dx || dz) && !g.insideAt(x + dx, y, z + dz)) {
              edge = true;
              break;
            }
        if (edge) {
          g.set(x, y, z, 'wall');
          continue;
        }
        const k = (y - b.y0) / b.floorH;
        if (Number.isInteger(k) && k >= 1) g.set(x, y, z, k >= b.floors ? 'ceiling' : 'floor');
        else g.set(x, y, z, 'interior', 'air');
      }
}
