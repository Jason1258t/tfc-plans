/**
 * Окна и вход. Фасад делится на прямые участки стены, которые смотрят наружу (стык объёмов — не фасад);
 * участки ищутся по всей сетке, а не по объёмам, чтобы общая стена двух объёмов не получила окна дважды.
 * Окна — по центру участка с заданным шагом, не ближе клетки к углу; вход — посередине самого длинного участка
 * на нужной стороне.
 */
import { DIRS, DX, DZ, ROLE, orient, type Grid } from './grid.ts';
import { boxAt, type Box, type Layout } from './massing.ts';
import type { BuildingSpec } from './spec.ts';

export interface Run {
  /** Сторона: 0 север, 1 восток, 2 юг, 3 запад — куда смотрит фасад */
  side: number;
  /** Клетки участка вдоль фасада, от a до b включительно (x у севера/юга, z у востока/запада) */
  a: number;
  b: number;
  /** Положение линии фасада: z у севера/юга, x у востока/запада */
  line: number;
}

const cellOf = (r: Run, t: number): [number, number] => (r.side % 2 === 0 ? [t, r.line] : [r.line, t]);

/** Клетка фасада смотрит наружу: стена, а сосед снаружи — не здание */
function exposed(g: Grid, side: number, x: number, y: number, z: number) {
  return g.roleAt(x, y, z) === ROLE.wall && !g.insideAt(x + DX[side], y, z + DZ[side]);
}

/** Участки фасадов на высоте y; keep — какие клетки считать (например, только объёмы с этим этажом) */
export function facadeRuns(g: Grid, y: number, keep: (x: number, z: number) => boolean = () => true): Run[] {
  const out: Run[] = [];
  for (let side = 0; side < 4; side++) {
    const lines = side % 2 === 0 ? g.Z : g.X;
    const len = side % 2 === 0 ? g.X : g.Z;
    for (let line = 0; line < lines; line++) {
      let start = -1;
      for (let t = 0; t <= len; t++) {
        const [x, z] = side % 2 === 0 ? [t, line] : [line, t];
        const ok = t < len && exposed(g, side, x, y, z) && keep(x, z);
        if (ok && start < 0) start = t;
        if (!ok && start >= 0) {
          out.push({ side, a: start, b: t - 1, line });
          start = -1;
        }
      }
    }
  }
  return out;
}

/** Начала окон ширины w с шагом e по участку; от углов — не ближе одной клетки стены */
export function windowStarts(r: Run, w: number, e: number): number[] {
  const lo = r.a + 2;
  const len = r.b - 2 - lo + 1;
  if (w < 1 || len < w) return [];
  const n = Math.floor((len - w) / e) + 1;
  const span = (n - 1) * e + w;
  const first = lo + Math.floor((len - span) / 2);
  return Array.from({ length: n }, (_, i) => first + i * e);
}

export function openings({ grid: g, boxes }: Layout, spec: BuildingSpec) {
  const o = spec.openings;
  const doorSide = DIRS.indexOf(o.door.side);
  // Вход: самый длинный участок на нужной стороне (у Г и Т сторона главного объёма бывает внутренней)
  let door: { run: Run; box: Box; s: number; w: number; h: number } | null = null;
  if (o.door.w > 0) {
    const y = Math.min(...boxes.map((b) => b.y0)) + 1;
    const run = facadeRuns(g, y)
      .filter((r) => r.side === doorSide)
      .sort((p, q) => q.b - q.a - (p.b - p.a))[0];
    const box = run && boxAt(boxes, ...cellAt(run, Math.floor((run.a + run.b) / 2), y));
    const w = run ? Math.min(o.door.w, run.b - run.a - 1) : 0;
    if (run && box && w > 0) {
      const h = Math.min(o.door.h, box.floorH - 1);
      door = { run, box, s: Math.floor((run.a + run.b - w + 1) / 2), w, h };
    }
  }

  // Этажи: у объёмов разной высоты этажа свои ряды окон
  const storeys = new Map<string, { yb: number; floorH: number }>();
  for (const b of boxes)
    for (let k = 0; k < b.floors; k++)
      storeys.set(`${b.y0 + k * b.floorH}/${b.floorH}`, { yb: b.y0 + k * b.floorH, floorH: b.floorH });
  for (const { yb, floorH } of storeys.values()) {
    const y0 = yb + 1 + o.sillH;
    // Окно не выше ряда под следующим перекрытием: перемычка ляжет в ряд пояса
    const y1 = Math.min(yb + o.sillH + o.windowH, yb + floorH - 1);
    if (y1 < y0) continue;
    const ours = (x: number, z: number) => {
      const b = boxAt(boxes, x, y0, z);
      return !!b && b.floorH === floorH && (yb - b.y0) % floorH === 0 && yb < b.top;
    };
    for (const run of facadeRuns(g, y0, ours)) {
      const busy = door && yb === door.box.y0 && door.run.side === run.side && door.run.line === run.line;
      for (const s of windowStarts(run, o.windowW, o.windowEvery)) {
        if (busy && s + o.windowW >= door!.s - 1 && s <= door!.s + door!.w) continue;
        for (let t = s; t < s + o.windowW; t++)
          for (let y = y0; y <= y1; y++) {
            const [x, z] = cellOf(run, t);
            if (exposed(g, run.side, x, y, z))
              g.set(x, y, z, 'glass', 'pane', orient(run.side, false, run.side % 2 ? 2 : 1));
          }
      }
    }
  }

  if (door) {
    const { run, box, s, w, h } = door;
    const inward = (run.side + 2) % 4;
    for (let t = s; t < s + w; t++)
      for (let dy = 1; dy <= h; dy++) {
        const [x, z] = cellOf(run, t);
        const leaf = w <= 2 && dy <= 2;
        g.set(x, box.y0 + dy, z, 'door', leaf ? 'door' : 'air', orient(inward, dy === 2, 0, w === 2 && t === s + 1));
      }
  }
}

const cellAt = (r: Run, t: number, y: number): [number, number, number] => {
  const [x, z] = cellOf(r, t);
  return [x, y, z];
};
