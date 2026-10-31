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
  if (v.roof.kind === 'flat') return 2;
  if (v.roof.kind === 'sawtooth') return Math.ceil((v.roof.tooth ?? 5) * v.roof.pitch) + 2;
  const span = v.roof.kind === 'shed' ? Math.max(v.w, v.d) : Math.min(v.w, v.d);
  const half = v.roof.kind === 'shed' ? span + 2 * o : Math.ceil((span + 2 * o) / 2);
  return Math.ceil(half * v.roof.pitch) + 2;
}

export function layout(spec: BuildingSpec): Layout {
  const vs = spec.volumes;
  const pad = Math.max(...vs.map((v) => v.roof.overhang)) + 1;
  const minX = Math.min(...vs.map((v) => v.x)) - pad;
  const minZ = Math.min(...vs.map((v) => v.z)) - pad;
  const maxX = Math.max(...vs.map((v) => v.x + v.w - 1)) + pad;
  const maxZ = Math.max(...vs.map((v) => v.z + v.d - 1)) + pad;
  const maxY =
    Math.max(...vs.map((v) => v.y + v.floors * v.floorH + roofRise(v))) +
    (spec.details.chimney ? (spec.details.chimneyH ?? 2) + 1 : 1);
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

/** Клетка в плане объёма: прямоугольник или вписанный в него овал (по центру клетки) */
export function inPlan(b: Box, x: number, z: number) {
  if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return false;
  if (b.v.shape !== 'round') return true;
  const rx = (b.x1 - b.x0 + 1) / 2;
  const rz = (b.z1 - b.z0 + 1) / 2;
  const dx = (x - (b.x0 + b.x1) / 2) / rx;
  const dz = (z - (b.z0 + b.z1) / 2) / rz;
  return dx * dx + dz * dz <= 1;
}

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
        // Основание объёма — фундамент, только если под ним нет постройки; у яруса на другом объёме общий ряд —
        // перекрытие нижнего, иначе весь этаж яруса был бы из блоков фундамента
        if (boxes.some((o) => o.y0 === y && inPlan(o, x, z)) && !g.insideAt(x, y - 1, z)) {
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
        // Перекрытие — любой объём, у которого здесь ряд плиты (у ярусов ряд общий: верх нижнего = низ верхнего)
        if (boxes.some((o) => o.top === y && inPlan(o, x, z))) {
          g.set(x, y, z, 'ceiling');
          continue;
        }
        if (boxes.some((o) => y > o.y0 && y < o.top && (y - o.y0) % o.floorH === 0 && inPlan(o, x, z))) {
          g.set(x, y, z, 'floor');
          continue;
        }
        g.set(x, y, z, 'interior', 'air');
      }
}
