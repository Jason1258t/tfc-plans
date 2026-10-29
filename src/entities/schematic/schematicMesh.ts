import {
  bakeElements,
  blockModel,
  partialQuads,
  loadBlockModels,
  type Dir as ModelDir,
  type Quad,
  type RawElement,
} from './blockModels';
import { codeParts, hasCodeParts } from './createParts';
import { COPYCAT_BASE, copycatMaterials, copycatParts, isCopycat, type Material } from './copycats';
import { placedBy, textureUrl, type ItemIndex } from '@/shared/pack-data';
import { copycatMaterialTarget, EMPTY_BLOCKS, REMOVE, exportSchematic, type Schematic } from './schematic';
import { blockNbtOf, buildGrid, namesByState, propsByState, stateOf } from './schematicEdit';
import { drawnByCode, FULL, shapeOf, type Box } from './schematicShape';
import { readNbt } from '@tfc/core/nbt';
import { sizeOf, DEFAULT_SHAPE } from '@tfc/core/schematicFile';

/**
 * Геометрия схемы для 3D: блок — грани его модели из jar (entities/schematic/blockModels.ts), а нет модели (рисует код:
 * сундук, ремень Create; OBJ) — один или несколько параллелепипедов по грубой форме (shapeOf: плита, ступенька,
 * люк, забор, вал Create…). Невидимые грани между сплошными блоками не строятся (cullface модели).
 * Без three.js — только массивы; рисуют их SchematicView3D и превью библиотеки.
 */

/** Прозрачные целые блоки: не закрывают соседей (стекло, листва, жидкости) */
const SEE_THROUGH = /glass|leaves|ice\b|_ice|slime|honey_block|spawner|water|lava|cobweb|scaffolding/;
/** Текстуры в оттенках серого, которые игра красит по биому */
const TINTED = /leaves|grass|vine|lily_pad|fern|sugar_cane/;

// ---------------------------------------------------------------- отводы жидкостной трубы Create

/**
 * Жидкостная труба Create: модель в jar — только стенки сердцевины, к каждой соединённой стороне игра добавляет
 * части по соседу (FluidPipeBlockEntity.StandardPipeFluidTransportBehaviour.getRenderedRimAttachment, Create 6.0.10).
 * Части — модели block/fluid_pipe/{connection,rim_connector,rim,drain}/north.json, повёрнутые к стороне.
 */
const PIPE = 'create:fluid_pipe';
const PIPE_TEX = 'create/block/pipes';
const PIPE_PARTS: Record<'connection' | 'rim_connector' | 'rim' | 'drain', RawElement[]> = {
  connection: [
    {
      from: [4, 4, 0],
      to: [12, 12, 4],
      faces: {
        east: { uv: [0, 0, 4, 2], rotation: 90 },
        west: { uv: [0, 2, 4, 0], rotation: 90 },
        up: { uv: [0, 2, 4, 0], rotation: 180 },
        down: { uv: [0, 0, 4, 2], rotation: 180 },
      },
    },
  ],
  rim_connector: [
    {
      from: [4, 4, 0],
      to: [12, 12, 4],
      faces: {
        east: { uv: [4, 0, 8, 2], rotation: 90 },
        west: { uv: [4, 2, 8, 0], rotation: 90 },
        up: { uv: [4, 2, 8, 0], rotation: 180 },
        down: { uv: [4, 0, 8, 2], rotation: 180 },
      },
    },
  ],
  rim: [
    {
      from: [3, 3, 0],
      to: [13, 13, 2],
      faces: {
        north: { uv: [11, 11, 16, 16] },
        east: { uv: [10.5, 11, 9.5, 16] },
        south: { uv: [11, 11, 16, 16] },
        west: { uv: [9.5, 16, 10.5, 11] },
        up: { uv: [10.5, 11, 9.5, 16], rotation: 270 },
        down: { uv: [9.5, 16, 10.5, 11], rotation: 270 },
      },
    },
  ],
  drain: [
    {
      from: [2.95, 2.95, -1.1],
      to: [13.05, 13.05, 2],
      faces: {
        north: { uv: [11, 11, 16, 16] },
        east: { uv: [10.5, 11, 9, 16] },
        south: { uv: [11, 11, 16, 16] },
        west: { uv: [9, 16, 10.5, 11] },
        up: { uv: [9, 11, 10.5, 16], rotation: 90 },
        down: { uv: [10.5, 16, 9, 11], rotation: 90 },
      },
    },
    {
      from: [4.95, 4.95, -3.95],
      to: [11.05, 11.05, -0.95],
      faces: {
        north: { uv: [13, 8, 16, 11] },
        east: { uv: [12, 8, 13.5, 11] },
        west: { uv: [12, 8, 13.5, 11], rotation: 180 },
        up: { uv: [12, 8, 13.5, 11], rotation: 270 },
        down: { uv: [12, 8, 13.5, 11], rotation: 90 },
      },
    },
  ],
};
/** Поворот модели «на север» к стороне: [x, y] варианта */
const TURN: Record<ModelDir, [number, number]> = {
  north: [0, 0],
  east: [0, 90],
  south: [0, 180],
  west: [0, 270],
  up: [270, 0],
  down: [90, 0],
};
const OPPOSITE: Record<ModelDir, ModelDir> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
  up: 'down',
  down: 'up',
};
const AXIS: Record<ModelDir, string> = { north: 'z', south: 'z', east: 'x', west: 'x', up: 'y', down: 'y' };
const pipeBaked = new Map<string, Quad[]>();
const pipePart = (part: keyof typeof PIPE_PARTS, d: ModelDir) => {
  const key = `${part}/${d}`;
  let q = pipeBaked.get(key);
  if (!q) pipeBaked.set(key, (q = bakeElements(PIPE_PARTS[part], PIPE_TEX, ...TURN[d])));
  return q;
};
/** Прямая труба: соединены ровно две противоположные стороны — ось, иначе null (FluidPropagator.getStraightPipeAxis) */
function straightAxis(p: Map<string, string>): string | null {
  const on = (Object.keys(TURN) as ModelDir[]).filter((d) => p.get(d) === 'true');
  return on.length === 2 && OPPOSITE[on[0]] === on[1] ? AXIS[on[0]] : null;
}
/** Части отвода трубы к стороне d по соседу (id и свойства; null — пусто) */
function pipeAttachment(d: ModelDir, self: Map<string, string>, nb: { id: string; p: Map<string, string> } | null) {
  if (self.get(d) !== 'true') return [];
  const back = nb?.p.get(OPPOSITE[d]) === 'true';
  let kind: 'none' | 'connection' | 'detailed' | 'rim' | 'drain';
  if (!nb) kind = 'rim';
  else if (nb.id === 'create:mechanical_pump') kind = nb.p.get('facing') === OPPOSITE[d] ? 'none' : 'detailed';
  else if (nb.id === 'create:encased_fluid_pipe') kind = 'rim';
  else if (nb.id === PIPE) kind = back ? (straightAxis(self) === AXIS[d] ? 'connection' : 'detailed') : 'rim';
  else if (nb.id === 'create:glass_fluid_pipe') kind = 'rim';
  // Свои трубы, клапаны и насосы Create и аддонов — без фланца; остальное (бак, бассейн…) — слив
  else if (/pipe|valve|pump/.test(nb.id)) kind = 'detailed';
  else kind = 'drain';
  if (kind === 'none') return [];
  if (kind === 'connection') return pipePart('connection', d);
  const extra = kind === 'rim' ? pipePart('rim', d) : kind === 'drain' ? pipePart('drain', d) : [];
  return [...pipePart('rim_connector', d), ...extra];
}
/** Невидимые в игре блоки (свет прожектора IE, барьер) — в 3D не рисуются */
const INVISIBLE = /(^|:)(fake_light|barrier|light|structure_void)$/;

// ---------------------------------------------------------------- копикаты

const copycatBaked = new Map<string, Quad[]>();
/**
 * Грани копиката: коробки формы (entities/schematic/copycats.ts), на каждой стороне — текстура материала части с той же стороны,
 * uv по положению грани (как вырезает игра). Материал заменён по заменам схемы.
 */
function copycatQuads(
  id: string,
  p: Map<string, string>,
  mats: Map<string, Material>,
  replace: Map<string, string>,
  items: ItemIndex,
): Quad[] {
  const parts = copycatParts(id, p);
  const matOf = (part: string): Material => {
    const m = mats.get(part) ?? mats.get('') ?? { id: COPYCAT_BASE, p: new Map() };
    // Та же замена, что в файле (schematicFile: replaceCopycatMaterials)
    const to = copycatMaterialTarget(m.id, replace);
    if (!to) return m;
    return to === COPYCAT_BASE ? { id: COPYCAT_BASE, p: new Map() } : { id: to, p: m.p };
  };
  const used = parts.map((x) => matOf(x.part));
  const key = `${id}[${[...p].join()}]${used.map((m) => `${m.id}[${[...m.p].join()}]`).join('|')}`;
  const hit = copycatBaked.get(key);
  if (hit) return hit;
  const faceCache = new Map<string, Partial<Record<ModelDir, { tex: string; tint?: boolean }>>>();
  const facesOf = (mat: Material) => {
    const k = `${mat.id}[${[...mat.p].join()}]`;
    let f = faceCache.get(k);
    if (f) return f;
    f = {};
    const model = blockModel(mat.id, mat.p) ?? blockModel(COPYCAT_BASE, new Map());
    const fallback = texturesOf(mat.id, items);
    for (const d of Object.keys(NORMAL) as ModelDir[]) {
      const nv = NORMAL[d];
      let best: Quad | null = null;
      let area = 0;
      for (const q of model?.quads ?? []) {
        if (!q.tex || q.n[0] * nv[0] + q.n[1] * nv[1] + q.n[2] * nv[2] < 0.9) continue;
        const [a, b, c] = q.p;
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const s = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
        if (s > area) [best, area] = [q, s];
      }
      const t = d === 'up' || d === 'down' ? fallback.top : fallback.side;
      f[d] = best ? { tex: best.tex!, tint: best.tint } : { tex: t ?? 'create/block/copycat_base' };
    }
    faceCache.set(k, f);
    return f;
  };
  const els: RawElement[] = parts.map(({ box: [x0, y0, z0, x1, y1, z1] }, i) => {
    const tex = facesOf(used[i]);
    const edge: Record<ModelDir, boolean> = {
      down: y0 === 0,
      up: y1 === 16,
      north: z0 === 0,
      south: z1 === 16,
      west: x0 === 0,
      east: x1 === 16,
    };
    const faces: RawElement['faces'] = {};
    for (const d of Object.keys(edge) as ModelDir[]) faces[d] = { ...tex[d], cullface: edge[d] ? d : undefined };
    return { from: [x0, y0, z0], to: [x1, y1, z1], faces };
  });
  const q = bakeElements(els, 'create/block/copycat_base');
  copycatBaked.set(key, q);
  return q;
}
const NORMAL: Record<ModelDir, [number, number, number]> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  south: [0, 0, 1],
  north: [0, 0, -1],
};

// ---------------------------------------------------------------- текстуры

/** Пути текстур, которые точно лежат в /icons: все t из библиотеки предметов */
let knownTextures: Set<string> | null = null;
const known = (items: ItemIndex) =>
  (knownTextures ??= new Set(items.list.map((i) => i.t).filter((t): t is string => !!t)));

/** Текстура граней: сбоку и сверху. Сначала текстура блока с тем же путём, потом иконка предмета */
function texturesOf(id: string, items: ItemIndex): { side: string | null; top: string | null } {
  const [ns, path = ''] = id.split(':');
  const has = known(items);
  const t = placedBy(items, id)?.t;
  const pick = (...c: (string | undefined)[]) => c.find((x): x is string => !!x && has.has(x)) ?? null;
  const block = `${ns}/block/${path}`;
  const side = pick(t?.includes('/block/') ? t : undefined, block, `${block}_side`, t);
  const top = pick(`${block}_top`, `${block}_end`, side ?? undefined);
  return { side, top: top ?? side };
}

const images = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(path: string) {
  let p = images.get(path);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = textureUrl(path);
    });
    images.set(path, p);
  }
  return p;
}

/** Цвет блока без текстуры — по id, чтобы одинаковые блоки были одного цвета */
function hashColor(id: string): [number, number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const hue = (((h % 360) + 360) % 360) / 360;
  // hsl(h, 45%, 55%) → rgb
  const s = 0.45;
  const l = 0.55;
  const q = l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [f(hue + 1 / 3), f(hue), f(hue - 1 / 3)];
}

const TILE = 16;

/** Атлас: все текстуры схемы плитками 16×16 (анимированные — первый кадр) и средний цвет каждой */
export interface Atlas {
  canvas: HTMLCanvasElement;
  /** путь текстуры → [u0, v0, u1, v1] в долях атласа (v снизу, как в three) */
  uv: Map<string, [number, number, number, number]>;
  color: Map<string, [number, number, number]>;
}

async function buildAtlas(paths: string[]): Promise<Atlas> {
  const loaded = (await Promise.all(paths.map(async (p) => [p, await loadImage(p)] as const))).filter(
    (x): x is readonly [string, HTMLImageElement] => !!x[1],
  );
  const cols = Math.max(1, Math.ceil(Math.sqrt(loaded.length)));
  const rows = Math.max(1, Math.ceil(loaded.length / cols));
  const canvas = document.createElement('canvas');
  canvas.width = cols * TILE;
  canvas.height = rows * TILE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  const uv = new Map<string, [number, number, number, number]>();
  const color = new Map<string, [number, number, number]>();
  // Отступ внутрь плитки — чтобы на краях не подмешивались соседние
  const e = 0.02;
  loaded.forEach(([path, img], i) => {
    const x = (i % cols) * TILE;
    const y = Math.floor(i / cols) * TILE;
    const w = img.naturalWidth;
    ctx.drawImage(img, 0, 0, w, Math.min(w, img.naturalHeight), x, y, TILE, TILE);
    const W = canvas.width;
    const H = canvas.height;
    uv.set(path, [(x + e) / W, 1 - (y + TILE - e) / H, (x + TILE - e) / W, 1 - (y + e) / H]);
    const d = ctx.getImageData(x, y, TILE, TILE).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let k = 0; k < d.length; k += 4) {
      if (d[k + 3] < 128) continue;
      r += d[k];
      g += d[k + 1];
      b += d[k + 2];
      n++;
    }
    if (n) color.set(path, [r / n / 255, g / n / 255, b / n / 255]);
  });
  return { canvas, uv, color };
}

// ---------------------------------------------------------------- сборка

export interface MeshData {
  positions: Float32Array;
  /** Свет грани (с подкраской листвы) — умножается на текстуру */
  light: Float32Array;
  /** Свет × средний цвет текстуры — упрощённый вид без текстур */
  flat: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  atlas: Atlas;
  /** Габарит схемы в блоках */
  size: [number, number, number];
  faces: number;
  blocks: number;
}

/** Освещение граней «как в игре»: верх светлый, низ тёмный, бока по-разному */
const SHADE = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.65, west: 0.65 };

/** Затенение грани модели по нормали (повёрнутые элементы — смесь по осям, как в scripts/mcp/render.mjs) */
const shadeOf = ([x, y, z]: [number, number, number]) =>
  x * x * SHADE.east + y * y * (y > 0 ? SHADE.up : SHADE.down) + z * z * SHADE.north;

/** Окраска граней с tintindex (её задаёт код игры): листва и трава — зелёным, вода — синим */
const tintOf = (id: string): [number, number, number] =>
  /water/.test(id) ? [0.25, 0.42, 0.9] : /redstone/.test(id) ? [0.9, 0.2, 0.15] : [0.55, 0.8, 0.4];

/** Грани: направление, сосед, вершины (CCW снаружи) через функцию от бокса */
type Dir = keyof typeof SHADE;
const DIRS: { dir: Dir; n: [number, number, number] }[] = [
  { dir: 'up', n: [0, 1, 0] },
  { dir: 'down', n: [0, -1, 0] },
  { dir: 'east', n: [1, 0, 0] },
  { dir: 'west', n: [-1, 0, 0] },
  { dir: 'south', n: [0, 0, 1] },
  { dir: 'north', n: [0, 0, -1] },
];

function corners(dir: Dir, b: Box): [number, number, number][] {
  const [x0, y0, z0, x1, y1, z1] = b;
  switch (dir) {
    case 'up':
      return [
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
        [x0, y1, z0],
      ];
    case 'down':
      return [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ];
    case 'east':
      return [
        [x1, y0, z1],
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
      ];
    case 'west':
      return [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
      ];
    case 'south':
      return [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ];
    case 'north':
      return [
        [x1, y0, z0],
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
      ];
  }
}

/** Координаты текстуры для точки грани (доли плитки, v снизу) */
function faceUv(dir: Dir, [x, y, z]: [number, number, number]): [number, number] {
  switch (dir) {
    case 'up':
      return [x, 1 - z];
    case 'down':
      return [x, z];
    case 'east':
      return [1 - z, y];
    case 'west':
      return [z, y];
    case 'south':
      return [x, y];
    case 'north':
      return [1 - x, y];
  }
}

/** Лежит ли грань бокса на границе клетки (тогда её может закрыть сосед) */
const onEdge = (dir: Dir, b: Box) =>
  dir === 'up'
    ? b[4] === 1
    : dir === 'down'
      ? b[1] === 0
      : dir === 'east'
        ? b[3] === 1
        : dir === 'west'
          ? b[0] === 0
          : dir === 'south'
            ? b[5] === 1
            : b[2] === 0;

/** Не больше стольких клеток: занятость хранится массивом на весь объём */
const MAX_CELLS = 16_000_000;

/**
 * Собрать геометрию схемы с общими заменами. maxY — показывать слои не выше этого (срез).
 * Блоки с id не из сборки рисуются цветом по id.
 */
export async function buildMesh(
  s: Schematic,
  replace: Map<string, string>,
  items: ItemIndex,
  opts: { maxY?: number } = {},
): Promise<MeshData> {
  // 3D показывает итоговый файл (с заменами и формой), а не исходник: иначе площадка
  // и другие элементы формы не видны. Форма применяется через общий applyEdits.
  const sh = s.shape;
  const shapeChanged =
    !!sh && (sh.crop || sh.clearAir || sh.platform || sh.sides !== 0 || sh.bottom !== 0 || sh.top !== 1);
  if (shapeChanged) {
    try {
      const bytes = await exportSchematic(s, replace);
      const parsed = await readNbt(bytes);
      s = {
        ...s,
        parsed,
        size: sizeOf(parsed.root.value) ?? s.size,
        shape: { ...DEFAULT_SHAPE },
      };
      // replace не меняем: имена блоков уже заменены в parsed, но replace всё ещё нужен
      // для подстановки материалов копикатов (их id лежат в nbt клетки, а не в палитре)
    } catch {
      // оставляем исходник
    }
  }
  const grid = buildGrid(s);
  const [sx, sy, sz] = grid.size;
  if (sx * sy * sz > MAX_CELLS) throw new Error(`Схема ${sx}×${sy}×${sz} слишком большая для 3D`);
  const names = namesByState(s);
  const props = propsByState(s);
  const maxY = Math.min(sy - 1, opts.maxY ?? sy - 1);

  // Что рисовать для каждой записи палитры
  interface Meta {
    id: string;
    boxes: Box[];
    /** Целый непрозрачный куб — закрывает соседей */
    opaque: boolean;
    /** Прозрачный целый блок: грани между одинаковыми не рисуем */
    clear: boolean;
    side: string | null;
    top: string | null;
    tint: boolean;
    /** Грани модели из jar; null — запасная форма boxes */
    quads: Quad[] | null;
    /** Жидкостная труба Create: к модели добавляются отводы по соседям */
    pipe: boolean;
    /** Копикат: грани по материалу из nbt клетки (copycatQuads) */
    copycat: boolean;
    p: Map<string, string>;
  }
  const namespaces = new Set<string>();
  for (const name of names) {
    const id = name && (replace.get(name) ?? name);
    if (id && id !== REMOVE) namespaces.add(id.includes(':') ? id.split(':')[0] : 'minecraft');
  }
  // Материалы копикатов: их модели тоже нужны
  const materials = new Map<number, Map<string, Material>>();
  if (names.some((n) => n && isCopycat(replace.get(n) ?? n)))
    for (const [, layer] of grid.layers)
      for (const bi of layer) {
        if (bi < 0) continue;
        const n = names[stateOf(s, bi)];
        if (!n || !isCopycat(replace.get(n) ?? n)) continue;
        const mats = copycatMaterials(blockNbtOf(s, bi));
        materials.set(bi, mats);
        for (const m of mats.values()) {
          const id = replace.get(m.id) ?? m.id;
          if (id !== REMOVE) namespaces.add(id.split(':')[0]);
        }
      }
  await loadBlockModels(namespaces);
  const metas: (Meta | null)[] = names.map((name, st) => {
    if (!name) return null;
    const id = replace.get(name) ?? name;
    if (id === REMOVE || EMPTY_BLOCKS.has(id) || INVISIBLE.test(id)) return null;
    const p = props[st] ?? new Map();
    const pipe = id === PIPE;
    const copycat = isCopycat(id);
    let model = copycat ? { quads: [], full: false } : drawnByCode(id) && !pipe ? null : blockModel(id, p);
    // Части, которые игра рисует кодом (ремень, полувалы, голова пресса Create); нет их в данных — как раньше
    if (hasCodeParts(id)) {
      const parts = codeParts(id, p).map((r) => partialQuads(r.model, r.turns));
      if (parts.length && parts.every((q) => q))
        model = { quads: [...(model?.quads ?? []), ...parts.flatMap((q) => q!)], full: model?.full ?? false };
    }
    const boxes = model ? [] : shapeOf(id, p);
    const full = model ? model.full : boxes.length === 1 && boxes[0] === FULL;
    const see = SEE_THROUGH.test(id);
    const tex = model ? { side: null, top: null } : texturesOf(id, items);
    return {
      id,
      boxes,
      opaque: full && !see,
      clear: see,
      ...tex,
      tint: TINTED.test(id),
      quads: model?.quads ?? null,
      pipe: pipe && !!model,
      copycat,
      p,
    };
  });

  // Занятость: индекс записи палитры по клетке (-1 — пусто)
  const cell = new Int32Array(sx * sy * sz).fill(-1);
  /** Грани копикатов по клетке */
  const own = new Map<number, Quad[]>();
  const at = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= sx || y > maxY || z >= sz ? -1 : cell[(y * sz + z) * sx + x];
  let blocks = 0;
  for (const [y, layer] of grid.layers) {
    if (y > maxY) continue;
    for (let i = 0; i < layer.length; i++) {
      if (layer[i] < 0) continue;
      const st = stateOf(s, layer[i]);
      const m = metas[st];
      if (!m) continue;
      cell[y * sz * sx + i] = st;
      if (m.copycat)
        own.set(y * sz * sx + i, copycatQuads(m.id, m.p, materials.get(layer[i]) ?? new Map(), replace, items));
      blocks++;
    }
  }

  const paths = new Set<string>();
  for (const m of metas) {
    if (m?.side) paths.add(m.side);
    if (m?.top) paths.add(m.top);
    for (const q of m?.quads ?? []) if (q.tex) paths.add(q.tex);
    if (m?.pipe) paths.add(PIPE_TEX);
  }
  for (const qs of own.values()) for (const q of qs) if (q.tex) paths.add(q.tex);
  const atlas = await buildAtlas([...paths]);

  const pos: number[] = [];
  const light: number[] = [];
  const flat: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const white: [number, number, number, number] = [0, 0, 0, 0];
  const NB: Record<ModelDir, [number, number, number]> = {
    up: [0, 1, 0],
    down: [0, -1, 0],
    east: [1, 0, 0],
    west: [-1, 0, 0],
    south: [0, 0, 1],
    north: [0, 0, -1],
  };
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  for (let y = 0; y <= maxY; y++)
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const st = cell[(y * sz + z) * sx + x];
        if (st < 0) continue;
        const m = metas[st]!;
        if (m.quads) {
          let quads = m.copycat ? (own.get((y * sz + z) * sx + x) ?? []) : m.quads;
          if (m.pipe) {
            quads = [...quads];
            for (const d of Object.keys(TURN) as ModelDir[]) {
              const n = NB[d];
              const nb = at(x + n[0], y + n[1], z + n[2]);
              const nm = nb >= 0 ? metas[nb] : null;
              quads.push(...pipeAttachment(d, m.p, nm && { id: nm.id, p: nm.p }));
            }
          }
          for (const q of quads) {
            if (q.cull) {
              const n = NB[q.cull];
              const nb = at(x + n[0], y + n[1], z + n[2]);
              const nm = nb >= 0 ? metas[nb] : null;
              if (nm && (nm.opaque || (m.clear && nm.clear && nm.id === m.id))) continue;
            }
            const base = (q.tex && atlas.color.get(q.tex)) || hashColor(m.id);
            const r = (q.tex && atlas.uv.get(q.tex)) || white;
            const shade = q.shade ? shadeOf(q.n) : 1;
            const tint = q.tint ? tintOf(m.id) : [1, 1, 1];
            const v0 = pos.length / 3;
            for (let k = 0; k < 4; k++) {
              const c = q.p[k];
              pos.push(x + c[0], y + c[1], z + c[2]);
              const [u, v] = q.uv[k];
              uvs.push(r[0] + (r[2] - r[0]) * clamp01(u / 16), r[3] - (r[3] - r[1]) * clamp01(v / 16));
              light.push(shade * tint[0], shade * tint[1], shade * tint[2]);
              flat.push(shade * tint[0] * base[0], shade * tint[1] * base[1], shade * tint[2] * base[2]);
            }
            if (q.both) idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 1);
            else idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
          }
          continue;
        }
        for (const { dir, n } of DIRS) {
          const nb = at(x + n[0], y + n[1], z + n[2]);
          const nm = nb >= 0 ? metas[nb] : null;
          const hiddenByNeighbor = nm && (nm.opaque || (m.clear && nm.clear && nm.id === m.id));
          const tex = dir === 'up' || dir === 'down' ? m.top : m.side;
          const base = (tex && atlas.color.get(tex)) || hashColor(m.id);
          const uvRect = (tex && atlas.uv.get(tex)) || white;
          const shade = SHADE[dir];
          const tint = m.tint ? [0.55, 0.8, 0.4] : [1, 1, 1];
          for (const b of m.boxes) {
            if (hiddenByNeighbor && onEdge(dir, b)) continue;
            const v0 = pos.length / 3;
            for (const c of corners(dir, b)) {
              pos.push(x + c[0], y + c[1], z + c[2]);
              const [fu, fv] = faceUv(dir, c);
              uvs.push(uvRect[0] + (uvRect[2] - uvRect[0]) * fu, uvRect[1] + (uvRect[3] - uvRect[1]) * fv);
              light.push(shade * tint[0], shade * tint[1], shade * tint[2]);
              flat.push(shade * tint[0] * base[0], shade * tint[1] * base[1], shade * tint[2] * base[2]);
            }
            idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
          }
        }
      }

  return {
    positions: new Float32Array(pos),
    light: new Float32Array(light),
    flat: new Float32Array(flat),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(idx),
    atlas,
    size: [sx, sy, sz],
    faces: idx.length / 6,
    blocks,
  };
}
