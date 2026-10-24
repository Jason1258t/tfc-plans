import { T, type Compound } from './nbt';

/**
 * Копикаты (заполняемые блоки Create и Create: Copycats+): модель в jar пустая (minecraft:block/air), игра вырезает
 * форму из модели блока-материала. Здесь — реестр форм по id блока и материалы из nbt блока схемы.
 * Формы — из кода модов: Create 6.0.10 AllShapes (STEP_BOTTOM/TOP, CASING_3PX), Copycats+ 3.0.8 CCShapes
 * (MutableAABB.rotateX/Y/Z, flip — повороты вокруг центра блока, Direction.toYRot: south 0, west 90, north 180, east 270).
 * Блока нет в реестре — не копикат для отрисовки (запасная форма как раньше).
 */

/** Коробка в пикселях: x0 y0 z0 x1 y1 z1 */
export type Box16 = [number, number, number, number, number, number];
/** Часть формы: коробка и имя части с отдельным материалом (многосоставные копикаты Copycats+), '' — общий */
export interface CopycatPart {
  box: Box16;
  part: string;
}
export interface Material {
  id: string;
  p: Map<string, string>;
}

export const COPYCAT_BASE = 'create:copycat_base';

// ---------------------------------------------------------------- коробки и повороты (как MutableAABB)

const norm = ([a, b, c, d, e, f]: Box16): Box16 => [
  Math.min(a, d),
  Math.min(b, e),
  Math.min(c, f),
  Math.max(a, d),
  Math.max(b, e),
  Math.max(c, f),
];
const aabb = (sx: number, sy: number, sz: number, mx = 0, my = 0, mz = 0): Box16 => [
  mx,
  my,
  mz,
  mx + sx,
  my + sy,
  mz + sz,
];
const n = (v: number) => 16 - v;
const mod = (a: number) => ((a % 360) + 360) % 360;
function rotY(b: Box16, angle: number): Box16 {
  const [x0, y0, z0, x1, y1, z1] = b;
  const a = mod(angle);
  if (a === 90) return norm([n(z0), y0, x0, n(z1), y1, x1]);
  if (a === 180) return norm([n(x0), y0, n(z0), n(x1), y1, n(z1)]);
  if (a === 270) return norm([z0, y0, n(x0), z1, y1, n(x1)]);
  return b;
}
function rotX(b: Box16, angle: number): Box16 {
  const [x0, y0, z0, x1, y1, z1] = b;
  const a = mod(angle);
  if (a === 90) return norm([x0, z0, n(y0), x1, z1, n(y1)]);
  if (a === 180) return norm([x0, n(y0), n(z0), x1, n(y1), n(z1)]);
  if (a === 270) return norm([x0, n(z0), y0, x1, n(z1), y1]);
  return b;
}
function rotZ(b: Box16, angle: number): Box16 {
  const [x0, y0, z0, x1, y1, z1] = b;
  const a = mod(angle);
  if (a === 90) return norm([y0, n(x0), z0, y1, n(x1), z1]);
  if (a === 180) return norm([n(x0), n(y0), z0, n(x1), n(y1), z1]);
  if (a === 270) return norm([n(y0), x0, z0, n(y1), x1, z1]);
  return b;
}
const flipX = (b: Box16, on: boolean): Box16 => (on ? norm([n(b[0]), b[1], b[2], n(b[3]), b[4], b[5]]) : b);
const flipY = (b: Box16, on: boolean): Box16 => (on ? norm([b[0], n(b[1]), b[2], b[3], n(b[4]), b[5]]) : b);
const flipZ = (b: Box16, on: boolean): Box16 => (on ? norm([b[0], b[1], n(b[2]), b[3], b[4], n(b[5])]) : b);

const Y_ROT: Record<string, number> = { south: 0, west: 90, north: 180, east: 270 };
/** CCShapes.directions: горизонтальные — rotateY(toYRot), up — rotateX(90), down — rotateX(-90) */
const toDirection = (b: Box16, d: string): Box16 =>
  d === 'up' ? rotX(b, 90) : d === 'down' ? rotX(b, -90) : rotY(b, Y_ROT[d] ?? 0);
/** CCShapes.axes: z — как есть, y — rotateX(90), x — rotateY(-90) */
const toAxis = (b: Box16, axis: string): Box16 => (axis === 'y' ? rotX(b, 90) : axis === 'x' ? rotY(b, -90) : b);
const toHalf = (b: Box16, half: string | undefined) => flipY(b, half === 'top');
const one = (box: Box16): CopycatPart[] => [{ box, part: '' }];
const layers = (p: Map<string, string>) => Math.min(8, Math.max(1, Number(p.get('layers') ?? 1)));

// ---------------------------------------------------------------- формы по блокам

type Shape = (p: Map<string, string>) => CopycatPart[];

/** Ступенька Create: STEP_BOTTOM/TOP — половина по высоте со стороны facing */
const createStep: Shape = (p) => {
  const [y0, y1] = p.get('half') === 'top' ? [8, 16] : [0, 8];
  return one(rotY([0, y0, 8, 16, y1, 16], Y_ROT[p.get('facing') ?? 'south'] ?? 0));
};
/** Панель Create: CASING_3PX — пластина 3 px со стороны, противоположной facing */
const createPanel: Shape = (p) => {
  const f = p.get('facing') ?? 'up';
  const b: Box16 = [0, 0, 0, 16, 3, 16];
  return one(f === 'up' ? b : f === 'down' ? flipY(b, true) : toDirection(rotX(b, 90), f));
};

/** Многосоставные Copycats+: часть есть — своя коробка и свой материал */
const slab: Shape = (p) => {
  const axis = p.get('axis') ?? 'y';
  const t = p.get('type') ?? 'bottom';
  const out: CopycatPart[] = [];
  if (t !== 'top') out.push({ box: toAxis(aabb(16, 16, 8), axis), part: 'bottom' });
  if (t !== 'bottom') out.push({ box: toAxis(aabb(16, 16, 8, 0, 0, 8), axis), part: 'top' });
  return out;
};
const bytes: Shape = (p) => {
  const out: CopycatPart[] = [];
  for (const y of ['bottom', 'top'])
    for (const z of ['north', 'south'])
      for (const x of ['west', 'east']) {
        const part = `${y}_${z}${x}`;
        if (p.get(part) !== 'true') continue;
        out.push({ box: aabb(8, 8, 8, x === 'east' ? 8 : 0, y === 'top' ? 8 : 0, z === 'south' ? 8 : 0), part });
      }
  return out;
};
/** CopycatBytePanelBlock.calculateMultiFaceShape */
const BP_H: Record<string, string> = {
  down: 'east',
  up: 'east',
  north: 'west',
  south: 'east',
  east: 'north',
  west: 'south',
};
const BP_V: Record<string, string> = { down: 'south', up: 'north', north: 'up', south: 'up', east: 'up', west: 'up' };
const AXIS_OF: Record<string, number> = { east: 0, west: 0, up: 1, down: 1, south: 2, north: 2 };
const POSITIVE = new Set(['east', 'up', 'south']);
const BP_PART = ['bottom_right', 'bottom_left', 'top_right', 'top_left'];
const bytePanel: Shape = (p) => {
  const f = p.get('facing') ?? 'north';
  const h = BP_H[f];
  const v = BP_V[f];
  const out: CopycatPart[] = [];
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      const part = BP_PART[i + j * 2];
      if (p.get(part) !== 'true') continue;
      const min = [0, 0, 0];
      const size = [8, 8, 8];
      size[AXIS_OF[f]] = 3;
      min[AXIS_OF[h]] = POSITIVE.has(h) ? i * 8 : 8 - i * 8;
      min[AXIS_OF[v]] = POSITIVE.has(v) ? j * 8 : 8 - j * 8;
      min[AXIS_OF[f]] = POSITIVE.has(f) ? 13 : 0;
      out.push({ box: aabb(size[0], size[1], size[2], min[0], min[1], min[2]), part });
    }
  return out;
};
/** CCShapes.HALF_PANEL */
const halfPanel: Shape = (p) => {
  const f = p.get('facing') ?? 'north';
  const offset = p.get('offset') ?? 'north';
  let b = rotZ(aabb(16, 8, 3, 0, 8, 13), -(Y_ROT[offset] ?? 0));
  b = toDirection(b, f);
  if (f === 'east' || f === 'west') b = flipY(rotX(b, -90), f === 'west');
  if (f === 'north') b = flipX(b, true);
  if (f === 'up') b = flipZ(b, true);
  return one(b);
};
const layer: Shape = (p) => one(toDirection(aabb(16, 16, layers(p) * 2), p.get('facing') ?? 'up'));
const cornerSlice: Shape = (p) => {
  const l = layers(p) * 2;
  return one(toDirection(toHalf(aabb(l, l, l, 16 - l, 0, 16 - l), p.get('half')), p.get('facing') ?? 'north'));
};
const slice: Shape = (p) => {
  const l = layers(p) * 2;
  return one(toDirection(toHalf(aabb(16, l, l, 0, 0, 16 - l), p.get('half')), p.get('facing') ?? 'north'));
};
const verticalSlice: Shape = (p) => {
  const l = layers(p) * 2;
  return one(toDirection(aabb(l, 16, l, 16 - l, 0, 16 - l), p.get('facing') ?? 'north'));
};
const verticalStep: Shape = (p) => one(toDirection(aabb(8, 16, 8, 8, 0, 8), p.get('facing') ?? 'north'));
const beam: Shape = (p) => one(toAxis(aabb(8, 8, 16, 4, 4, 0), p.get('axis') ?? 'y'));
const board: Shape = (p) => {
  // Многосоставная доска: по стороне — свой материал
  const out: CopycatPart[] = [];
  for (const d of ['north', 'south', 'east', 'west', 'up', 'down'])
    if (p.get(d) === 'true') out.push({ box: toDirection(aabb(16, 16, 1, 0, 0, 15), d), part: d });
  return out;
};
/** Склон — лесенка из 8 плит по 2 px (CCShapes.SLOPE, коллизия) */
const slope: Shape = (p) =>
  Array.from({ length: 8 }, (_, i) => ({
    box: toDirection(toHalf(aabb(16, ((i + 1) / 8) * 16, 2, 0, 0, i * 2), p.get('half')), p.get('facing') ?? 'north'),
    part: '',
  }));
/** Ступеньки — как у ванильных (StairBlock): плита + ступень по shape */
const stairs: Shape = (p) => {
  const top = p.get('half') === 'top';
  const out: Box16[] = [top ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16]];
  const [s0, s1] = top ? [0, 8] : [8, 16];
  const f = p.get('facing') ?? 'north';
  const shape = p.get('shape') ?? 'straight';
  // Ступень у стороны facing (в системе «facing = north»: z 0..8), потом поворот
  const local: Box16[] = [];
  if (shape === 'straight') local.push([0, s0, 0, 16, s1, 8]);
  else if (shape === 'outer_left') local.push([0, s0, 0, 8, s1, 8]);
  else if (shape === 'outer_right') local.push([8, s0, 0, 16, s1, 8]);
  else if (shape === 'inner_left') local.push([0, s0, 0, 16, s1, 8], [0, s0, 8, 8, s1, 16]);
  else local.push([0, s0, 0, 16, s1, 8], [8, s0, 8, 16, s1, 16]);
  const turn = (Y_ROT[f] ?? 180) - 180;
  for (const b of local) out.push(rotY(b, turn));
  return out.map((box) => ({ box, part: '' }));
};

const SHAPES: Record<string, Shape> = {
  'create:copycat_step': createStep,
  'create:copycat_panel': createPanel,
  'copycats:copycat_block': () => one([0, 0, 0, 16, 16, 16]),
  'copycats:copycat_slab': slab,
  'copycats:copycat_byte': bytes,
  'copycats:copycat_byte_panel': bytePanel,
  'copycats:copycat_half_panel': halfPanel,
  'copycats:copycat_layer': layer,
  'copycats:copycat_corner_slice': cornerSlice,
  'copycats:copycat_slice': slice,
  'copycats:copycat_vertical_slice': verticalSlice,
  'copycats:copycat_vertical_step': verticalStep,
  'copycats:copycat_beam': beam,
  'copycats:copycat_board': board,
  'copycats:copycat_slope': slope,
  'copycats:copycat_stairs': stairs,
};

export const isCopycat = (id: string) => id in SHAPES;
export const copycatParts = (id: string, p: Map<string, string>): CopycatPart[] => SHAPES[id]?.(p) ?? [];

// ---------------------------------------------------------------- материалы из nbt

function readState(tag: Compound | null): Material | null {
  const name = tag?.get('Name');
  if (name?.type !== T.String || name.value === 'minecraft:air') return null;
  const p = new Map<string, string>();
  const props = tag!.get('Properties');
  if (props?.type === T.Compound) for (const [k, v] of props.value) p.set(k, String(v.value));
  return { id: name.value, p };
}

/**
 * Материалы копиката: '' — общий (Create, CopycatBlockEntity: Material), части многосоставных Copycats+ —
 * material_data.<часть>.material. Нет материала — copycat_base.
 */
export function copycatMaterials(nbt: Compound | null): Map<string, Material> {
  const out = new Map<string, Material>();
  const m = nbt?.get('Material');
  out.set('', (m?.type === T.Compound && readState(m.value)) || { id: COPYCAT_BASE, p: new Map() });
  const data = nbt?.get('material_data');
  if (data?.type === T.Compound)
    for (const [part, v] of data.value) {
      const mat = v.type === T.Compound ? v.value.get('material') : undefined;
      out.set(part, (mat?.type === T.Compound && readState(mat.value)) || { id: COPYCAT_BASE, p: new Map() });
    }
  return out;
}
