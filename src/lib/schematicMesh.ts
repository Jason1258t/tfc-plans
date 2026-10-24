import {
  bakeElements,
  blockModel,
  loadBlockModels,
  type Dir as ModelDir,
  type Quad,
  type RawElement,
} from './blockModels';
import { COPYCAT_BASE, copycatMaterials, copycatParts, isCopycat, type Material } from './copycats';
import { placedBy, textureUrl, type ItemIndex } from './items';
import { EMPTY_BLOCKS, REMOVE, type Schematic } from './schematic';
import { blockNbtOf, buildGrid, namesByState, propsByState, stateOf } from './schematicEdit';

/**
 * Геометрия схемы для 3D: блок — грани его модели из jar (src/lib/blockModels.ts), а нет модели (рисует код:
 * сундук, ремень Create; OBJ) — один или несколько параллелепипедов по грубой форме (shapeOf: плита, ступенька,
 * люк, забор, вал Create…). Невидимые грани между сплошными блоками не строятся (cullface модели).
 * Без three.js — только массивы; рисуют их SchematicView3D и превью библиотеки.
 */

/** Параллелепипед в долях блока: x0 y0 z0 x1 y1 z1 */
type Box = [number, number, number, number, number, number];

const FULL: Box = [0, 0, 0, 1, 1, 1];
const px = (n: number) => n / 16;

/** Прозрачные целые блоки: не закрывают соседей (стекло, листва, жидкости) */
const SEE_THROUGH = /glass|leaves|ice\b|_ice|slime|honey_block|spawner|water|lava|cobweb|scaffolding/;
/** Жидкость как блок: вода, лава, fluid/… модов (не «жидкостная труба» и т. п.) */
const FLUID = /(^|:)(water|lava)$|[:/]fluid\//;
/** Текстуры в оттенках серого, которые игра красит по биому */
const TINTED = /leaves|grass|vine|lily_pad|fern|sugar_cane/;
/**
 * Модель в jar — только часть блока, остальное рисует код игры: берём запасную форму. Жидкостная труба Create
 * (в модели одни стенки, отводы дорисовывает PipeAttachmentModel) в 3D — модель + отводы ниже, в слоях — иконка
 */
const CODE_DRAWN = /(^|:)fluid_pipe$/;
export const drawnByCode = (id: string) => CODE_DRAWN.test(id);

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
 * Грани копиката: коробки формы (lib/copycats.ts), на каждой стороне — текстура материала части с той же стороны,
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
    const to = replace.get(m.id);
    if (!to) return m;
    return to === REMOVE ? { id: COPYCAT_BASE, p: new Map() } : { id: to, p: m.p };
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

function shapeOf(id: string, p: Map<string, string>): Box[] {
  const name = id.split(':')[1] ?? id;
  const facing = p.get('facing') ?? p.get('horizontal_facing') ?? 'north';
  const axis =
    p.get('axis') ?? (facing === 'east' || facing === 'west' ? 'x' : facing === 'up' || facing === 'down' ? 'y' : 'z');
  /** Пластина у стороны side толщиной t */
  const plate = (side: string, t: number): Box =>
    side === 'north'
      ? [0, 0, 0, 1, 1, t]
      : side === 'south'
        ? [0, 0, 1 - t, 1, 1, 1]
        : side === 'west'
          ? [0, 0, 0, t, 1, 1]
          : side === 'east'
            ? [1 - t, 0, 0, 1, 1, 1]
            : side === 'down'
              ? [0, 0, 0, 1, t, 1]
              : [0, 1 - t, 0, 1, 1, 1];
  const opposite: Record<string, string> = {
    north: 'south',
    south: 'north',
    east: 'west',
    west: 'east',
    up: 'down',
    down: 'up',
  };
  /** Стержень вдоль оси шириной w (в пикселях) */
  const rod = (w: number): Box => {
    const a = px(8 - w / 2);
    const b = px(8 + w / 2);
    return axis === 'x' ? [0, a, a, 1, b, b] : axis === 'y' ? [a, 0, a, b, 1, b] : [a, a, 0, b, b, 1];
  };
  /** Диск поперёк оси: диаметр d, толщина t (в пикселях) */
  const disc = (d: number, t: number): Box => {
    const a = px(8 - d / 2);
    const b = px(8 + d / 2);
    const c = px(8 - t / 2);
    const e = px(8 + t / 2);
    return axis === 'x' ? [c, a, a, e, b, b] : axis === 'y' ? [a, c, a, b, e, b] : [a, a, c, b, b, e];
  };
  const arms = (w: number, y0: number, y1: number, on: (side: string) => boolean): Box[] => {
    const a = px(8 - w / 2);
    const b = px(8 + w / 2);
    const out: Box[] = [];
    if (on('north')) out.push([a, y0, 0, b, y1, a]);
    if (on('south')) out.push([a, y0, b, b, y1, 1]);
    if (on('west')) out.push([0, y0, a, a, y1, b]);
    if (on('east')) out.push([b, y0, a, 1, y1, b]);
    return out;
  };
  const conn = (side: string) => {
    const v = p.get(side);
    return !!v && v !== 'false' && v !== 'none';
  };

  if (FLUID.test(id)) return [[0, 0, 0, 1, px(14), 1]];
  if (name.endsWith('_slab') || name.includes('/slab/') || name.endsWith('slab')) {
    const t = p.get('type');
    return t === 'double' ? [FULL] : t === 'top' ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
  }
  if (name.includes('stairs')) {
    const top = p.get('half') === 'top';
    const base: Box = top ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
    const [y0, y1] = top ? [0, 0.5] : [0.5, 1];
    // Ступень — половина или четверть клетки: стороны, к которым она прижата
    const part = (sides: string[]): Box => {
      const x = sides.includes('west') ? [0, 0.5] : sides.includes('east') ? [0.5, 1] : [0, 1];
      const z = sides.includes('north') ? [0, 0.5] : sides.includes('south') ? [0.5, 1] : [0, 1];
      return [x[0], y0, z[0], x[1], y1, z[1]];
    };
    // Левая сторона — против часовой от facing (как StairBlock): у north — west
    const left: Record<string, string> = { north: 'west', west: 'south', south: 'east', east: 'north' };
    const back = opposite[facing] ?? 'south';
    const l = left[facing] ?? 'west';
    const r = opposite[l] ?? 'east';
    switch (p.get('shape')) {
      case 'outer_left':
        return [base, part([facing, l])];
      case 'outer_right':
        return [base, part([facing, r])];
      case 'inner_left':
        return [base, part([facing]), part([back, l])];
      case 'inner_right':
        return [base, part([facing]), part([back, r])];
      default:
        return [base, part([facing])];
    }
  }
  // Лестница-ладдер висит на стене позади себя (facing — куда смотрит); IE «покрытые лесами» — целый блок
  if (name.includes('ladder') && !name.includes('scaffold') && !/metal_ladder_(alu|steel)$/.test(name))
    return [plate(opposite[facing] ?? 'south', px(1))];
  // Create: шлюз на ремне — у края ремня, шлюз на блоке — на грани того блока, к которому прикреплён
  if (name.endsWith('_belt_funnel') && p.has('facing')) return [plate(facing, px(8))];
  if (name.endsWith('_funnel') && p.has('facing'))
    return [plate(opposite[facing] ?? 'south', facing === 'up' || facing === 'down' ? px(10) : px(5))];
  if (name === 'depot' || name.endsWith('_depot')) return [[0, 0, 0, 1, px(13), 1]];
  if (name === 'belt' || name === 'belt_connector') return [[0, 0, 0, 1, px(12), 1]];
  if (name.endsWith('chute')) return [[px(2), 0, px(2), px(14), 1, px(14)]];
  // Крепление верёвки (Simulated): узел у грани, к которой прикреплено; анкер TFC — столбик
  if (name === 'rope_connector') {
    const [a, b] = [px(3), px(13)];
    const s = opposite[facing] ?? 'down';
    const d = px(6);
    return [
      s === 'north'
        ? [a, a, 0, b, b, d]
        : s === 'south'
          ? [a, a, 1 - d, b, b, 1]
          : s === 'west'
            ? [0, a, a, d, b, b]
            : s === 'east'
              ? [1 - d, a, a, 1, b, b]
              : s === 'down'
                ? [a, 0, a, b, d, b]
                : [a, 1 - d, a, b, 1, b],
    ];
  }
  if (name.endsWith('rope_anchor')) return [[px(6), 0, px(6), px(10), 1, px(10)]];
  if (name === 'chest' || name === 'trapped_chest' || name.endsWith('_chest') || name.includes('/chest/'))
    return [[px(1), 0, px(1), px(15), px(14), px(15)]];
  if (name.includes('trapdoor')) {
    if (p.get('open') === 'true') return [plate(opposite[facing] ?? 'south', px(3))];
    return [plate(p.get('half') === 'top' ? 'up' : 'down', px(3))];
  }
  if (name.includes('door')) return [plate(opposite[facing] ?? 'south', px(3))];
  if (name.includes('fence_gate')) {
    const ns = facing === 'north' || facing === 'south';
    return [ns ? [0, px(5), px(7), 1, 1, px(9)] : [px(7), px(5), 0, px(9), 1, 1]];
  }
  if (name.includes('fence')) {
    return [[px(6), 0, px(6), px(10), 1, px(10)], ...arms(2, px(6), px(9), conn), ...arms(2, px(12), px(15), conn)];
  }
  if (name.endsWith('_wall') || name.includes('/wall/')) {
    return [[px(4), 0, px(4), px(12), 1, px(12)], ...arms(6, 0, px(14), conn)];
  }
  if (name.includes('pane') || name.endsWith('_bars') || name === 'iron_bars') {
    return [[px(7), 0, px(7), px(9), 1, px(9)], ...arms(2, 0, 1, conn)];
  }
  if (name.includes('carpet') || name.includes('rail') || name.includes('lily_pad')) return [[0, 0, 0, 1, px(1), 1]];
  if (name.includes('pressure_plate')) return [[px(1), 0, px(1), px(15), px(1), px(15)]];
  if (name === 'snow') return [[0, 0, 0, 1, px(2 * Number(p.get('layers') ?? 1)), 1]];
  if (name.includes('torch')) return [[px(7), 0, px(7), px(9), px(10), px(9)]];
  if (name.includes('lantern')) return [[px(5), 0, px(5), px(11), px(9), px(11)]];
  if (name.includes('chain')) return [rod(3)];
  if (name.includes('button')) return [[px(5), 0, px(6), px(11), px(2), px(10)]];
  if (/(^|\/|_)(shaft|axis)$/.test(name) || name.endsWith('_shaft') || name === 'shaft') return [rod(4)];
  if (name.includes('large_cogwheel')) return [disc(24, 4), rod(4)];
  if (name.includes('cogwheel')) return [disc(14, 4), rod(4)];
  // Труба с соединениями по сторонам (жидкостная труба Create): сердцевина и отводы к соединённым сторонам
  if (name.includes('pipe') && ['north', 'south', 'east', 'west', 'up', 'down'].some((d) => p.has(d))) {
    const [a, b] = [px(4), px(12)];
    const out: Box[] = [[a, a, a, b, b, b]];
    if (conn('north')) out.push([a, a, 0, b, b, a]);
    if (conn('south')) out.push([a, a, b, b, b, 1]);
    if (conn('west')) out.push([0, a, a, a, b, b]);
    if (conn('east')) out.push([b, a, a, 1, b, b]);
    if (conn('down')) out.push([a, 0, a, b, a, b]);
    if (conn('up')) out.push([a, b, a, b, 1, b]);
    return out;
  }
  if (name.includes('pipe') && !name.includes('pump')) return [rod(8)];
  if (
    /(flower|sapling|tulip|dandelion|poppy|orchid|allium|bluet|daisy|mushroom|candle|lever|fern|grass$|bush|crop|seed|sign|banner|head|skull|pot$)/.test(
      name,
    )
  )
    return [[px(4), 0, px(4), px(12), px(12), px(12)]];
  return [FULL];
}

/** Целый куб по упрощённой форме — в редакторе слоёв рисуется текстурой, остальное — моделью */
export const isFullCube = (id: string, props: Map<string, string>) => {
  const boxes = shapeOf(id, props);
  return boxes.length === 1 && boxes[0] === FULL;
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
    const model = copycat ? { quads: [], full: false } : CODE_DRAWN.test(id) && !pipe ? null : blockModel(id, p);
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
