/**
 * Файл схемы (.nbt) с заменами блоков и формой — то, что сайт отдаёт кнопкой «Скачать» и хранит в библиотеке
 * (`schematics`: replace + shape). Подбор замен (fuse.js, Gemini) остаётся в schematic.ts.
 *
 * Импорт только nbt.ts (с расширением .ts) и только стираемый TS: модуль запускает и сайт, и Node
 * (`import '../src/lib/schematicFile.ts'`) — сервер сборки и программа tfc собирают тот же файл, что и сайт.
 */
import { readNbt, T, writeNbt, type Compound, type ParsedNbt, type Tag } from './nbt.ts';
import { COPYCAT_BASE, copycatSlots, fixBlockData, replaceCopycatMaterials } from './schematicBlockFixes.ts';

export { COPYCAT_BASE };

/**
 * Форма схемы при скачивании. crop — обрезать по крайним непустым блокам (воздух и структурная пустота
 * не считаются), sides/bottom/top — сколько пустых блоков оставить вокруг (sides — по X и Z).
 * clearAir — записать воздух во все свободные клетки итогового объёма, чтобы при вставке он расчищал место.
 */
export interface Shape {
  crop: boolean;
  sides: number;
  bottom: number;
  top: number;
  clearAir: boolean;
  /**
   * Площадка: platformHeight слоёв блока platformBlock под всей схемой, ниже нижнего отступа.
   * platformHollow: сплошной только верхний слой, ниже — стенки по периметру, без дна («перевёрнутая коробка»).
   */
  platform: boolean;
  platformHeight: number;
  platformBlock: string;
  platformHollow: boolean;
}

export const DEFAULT_SHAPE: Shape = {
  crop: false,
  sides: 0,
  bottom: 0,
  top: 1,
  clearAir: false,
  platform: false,
  platformHeight: 1,
  platformBlock: 'minecraft:stone',
  platformHollow: false,
};

/** Не больше стольких клеток при записи воздуха: каждая — отдельная запись в файле и в памяти браузера */
const MAX_CLEAR_CELLS = 2_000_000;

export const EMPTY_BLOCKS = new Set([
  'minecraft:air',
  'minecraft:cave_air',
  'minecraft:void_air',
  'minecraft:structure_void',
]);

/** Значение в карте замен: блок убирается из схемы целиком (позиции удаляются, а не заменяются воздухом) */
export const REMOVE = '#remove';

export function paletteLists(root: Compound): Tag[][] {
  const single = root.get('palette');
  if (single?.type === T.List) return [single.value];
  // Структуры с несколькими вариантами палитры (palettes: [[...], [...]])
  const multi = root.get('palettes');
  if (multi?.type === T.List) return multi.value.filter((p) => p.type === T.List).map((p) => p.value as Tag[]);
  return [];
}

export const nameOf = (entry: Tag) => {
  if (entry.type !== T.Compound) return null;
  const n = entry.value.get('Name');
  return n?.type === T.String ? n.value : null;
};

/**
 * id блока → сколько раз встречается; блоки палитры без позиций — с нулём. Материалы копикатов тоже считаются
 * (каждый — предмет, который тратит пушка): иначе материал, который есть только внутри копикатов, нельзя заменить.
 */
export function countBlocks(parsed: ParsedNbt): Map<string, number> {
  const root = parsed.root.value;
  const palettes = paletteLists(root);
  const palette = palettes[0] ?? [];
  const counts = new Map<string, number>();
  const blocks = root.get('blocks');
  if (blocks?.type === T.List) {
    for (const b of blocks.value) {
      if (b.type !== T.Compound) continue;
      const state = b.value.get('state');
      if (state?.type !== T.Int) continue;
      const name = nameOf(palette[state.value]);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      const nbt = b.value.get('nbt');
      if (nbt?.type !== T.Compound) continue;
      for (const { material } of copycatSlots(nbt.value)) {
        const m = nameOf({ type: T.Compound, value: material });
        if (m && m !== COPYCAT_BASE && !EMPTY_BLOCKS.has(m)) counts.set(m, (counts.get(m) ?? 0) + 1);
      }
    }
  }
  // Блоки палитры, которые не встречаются в blocks (бывает) — тоже показываем
  for (const p of palettes.flat()) {
    const name = nameOf(p);
    if (name && !counts.has(name)) counts.set(name, 0);
  }
  return counts;
}

export type Vec = [number, number, number];

export const posOf = (b: Tag): Vec | null => {
  if (b.type !== T.Compound) return null;
  const p = b.value.get('pos');
  if (p?.type !== T.List || p.value.length !== 3) return null;
  const v = p.value.map((x) => (x.type === T.Int ? x.value : NaN));
  return v.some(Number.isNaN) ? null : (v as Vec);
};

/** Индексы палитры, которые после замен — воздух/пустота или удаляются */
function emptyStates(palette: Tag[], replace: Map<string, string>) {
  const out = new Set<number>();
  palette.forEach((entry, i) => {
    const name = nameOf(entry);
    if (!name) return;
    const to = replace.get(name) ?? name;
    if (to === REMOVE || EMPTY_BLOCKS.has(to)) out.add(i);
  });
  return out;
}

/** Итоговый объём: начало в координатах исходника и размер. null — менять нечего */
export function shapeBox(
  parsed: ParsedNbt,
  shape: Shape,
  replace: Map<string, string>,
): { min: Vec; size: Vec } | null {
  if (!shape.crop && !shape.clearAir && !shape.platform) return null;
  const root = parsed.root.value;
  const palette = paletteLists(root)[0] ?? [];
  const blocks = root.get('blocks');
  const list = blocks?.type === T.List ? blocks.value : [];
  const empty = emptyStates(palette, replace);

  const lo: Vec = [Infinity, Infinity, Infinity];
  const hi: Vec = [-Infinity, -Infinity, -Infinity];
  const all = { lo: [...lo] as Vec, hi: [...hi] as Vec };
  for (const b of list) {
    const p = posOf(b);
    if (!p || b.type !== T.Compound) continue;
    const st = b.value.get('state');
    const solid = !(st?.type === T.Int && empty.has(st.value));
    for (let i = 0; i < 3; i++) {
      all.lo[i] = Math.min(all.lo[i], p[i]);
      all.hi[i] = Math.max(all.hi[i], p[i]);
      if (solid) {
        lo[i] = Math.min(lo[i], p[i]);
        hi[i] = Math.max(hi[i], p[i]);
      }
    }
  }
  // Площадка — ещё H слоёв под низом: начало уходит вниз, размер по Y растёт
  const base = shape.platform ? shape.platformHeight : 0;
  const withPlatform = (min: Vec, size: Vec) => ({
    min: [min[0], min[1] - base, min[2]] as Vec,
    size: [size[0], size[1] + base, size[2]] as Vec,
  });
  if (shape.crop && Number.isFinite(lo[0])) {
    const pad: Vec = [shape.sides, shape.bottom, shape.sides];
    const padHi: Vec = [shape.sides, shape.top, shape.sides];
    return withPlatform(
      lo.map((v, i) => v - pad[i]) as Vec,
      lo.map((v, i) => hi[i] - v + 1 + pad[i] + padHi[i]) as Vec,
    );
  }
  // Без обрезки — исходный объём (из size, а если его нет — по блокам)
  const size: Vec =
    sizeOf(root) ?? (all.hi.map((v, i) => (Number.isFinite(v) ? v - Math.min(0, all.lo[i]) + 1 : 0)) as Vec);
  return withPlatform([0, 0, 0], size);
}

/** Размер файла после обрезки — для показа в списке; null, если форма не меняется */
/** Новый файл с заменами и формой (исходник в памяти не меняется) */
export async function applyEdits(parsed: ParsedNbt, replace: Map<string, string>, shape: Shape): Promise<Uint8Array> {
  // Объём считаем по исходнику и исходным именам: в клоне палитра уже с заменами
  const box = shapeBox(parsed, shape, replace);
  if (box && (shape.clearAir || shape.platform)) {
    const cells = box.size[0] * box.size[1] * box.size[2];
    if (cells > MAX_CLEAR_CELLS)
      throw new Error(`Площадка или очистка: ${box.size.join('×')} — слишком большой объём (${cells} клеток)`);
    if (paletteLists(parsed.root.value).length > 1)
      throw new Error('Площадка и очистка пространства не поддерживаются для схем с несколькими палитрами');
  }
  const root = structuredClone(parsed.root);
  const palettes = paletteLists(root.value);
  // Индексы удаляемых блоков — по первой палитре (по ней же считаются блоки в loadSchematic)
  const removed = new Set<number>();
  palettes[0]?.forEach((entry, i) => {
    const name = nameOf(entry);
    if (name && replace.get(name) === REMOVE) removed.add(i);
  });
  for (const palette of palettes) {
    for (const entry of palette) {
      if (entry.type !== T.Compound) continue;
      const name = entry.value.get('Name');
      if (name?.type !== T.String) continue;
      const to = replace.get(name.value);
      // Удалённые остаются в палитре (на них больше нет ссылок) — индексы остальных не сдвигаются
      if (to && to !== REMOVE) entry.value.set('Name', { type: T.String, value: to });
    }
  }
  const blocks = root.value.get('blocks');
  if (removed.size && blocks?.type === T.List) {
    blocks.value = blocks.value.filter((b) => {
      if (b.type !== T.Compound) return true;
      const state = b.value.get('state');
      return !(state?.type === T.Int && removed.has(state.value));
    });
  }
  if (blocks?.type === T.List) fixBlocks(blocks.value, palettes[0] ?? [], replace, legacyItems(root.value));
  if (box) reshape(root.value, box, shape);
  return writeNbt(root, parsed.gzipped);
}

/** Материал копиката после замен: новый id, COPYCAT_BASE — материал убран (блок удалён или стал воздухом), null — без замены */
export function copycatMaterialTarget(id: string, replace: Map<string, string>): string | null {
  const to = replace.get(id);
  if (!to) return null;
  return to === REMOVE || EMPTY_BLOCKS.has(to) ? COPYCAT_BASE : to;
}

/** Предметы в nbt по-старому (Count байтом): схема сохранена до 1.20.5 (DataVersion 3837), игра обновит её при чтении */
function legacyItems(root: Compound) {
  const v = root.get('DataVersion');
  return v?.type === T.Int && v.value < 3837;
}

/** Материалы копикатов по заменам и данные блок-сущностей, несовместимые с блоком после замен (schematicBlockFixes) */
function fixBlocks(blocks: Tag[], palette: Tag[], replace: Map<string, string>, legacy: boolean) {
  const target = (id: string) => copycatMaterialTarget(id, replace);
  for (const b of blocks) {
    if (b.type !== T.Compound) continue;
    const nbt = b.value.get('nbt');
    const state = b.value.get('state');
    if (nbt?.type !== T.Compound || state?.type !== T.Int) continue;
    if (replace.size) replaceCopycatMaterials(nbt.value, target, legacy);
    const name = palette[state.value] && nameOf(palette[state.value]);
    if (!name) continue;
    const fixed = fixBlockData(name, nbt.value);
    if (!fixed) b.value.delete('nbt');
    else if (fixed !== nbt.value) b.value.set('nbt', { type: T.Compound, value: fixed });
  }
}

export const intList = (v: Vec): Tag => ({
  type: T.List,
  elemType: T.Int,
  value: v.map((x) => ({ type: T.Int, value: x })),
});

/** Сдвиг блоков и сущностей в новый объём; блоки вне объёма отбрасываются, свободные клетки — воздух */
function reshape(root: Compound, box: { min: Vec; size: Vec }, shape: Shape) {
  const { min, size } = box;
  const inside = (p: Vec) => p.every((v, i) => v >= 0 && v < size[i]);
  const shift = (p: Vec) => p.map((v, i) => v - min[i]) as Vec;

  const blocks = root.get('blocks');
  const kept: Tag[] = [];
  const occupied = new Set<number>();
  if (blocks?.type === T.List) {
    for (const b of blocks.value) {
      const p = posOf(b);
      if (!p || b.type !== T.Compound) continue;
      const q = shift(p);
      if (!inside(q)) continue;
      b.value.set('pos', intList(q));
      kept.push(b);
      occupied.add((q[1] * size[2] + q[2]) * size[0] + q[0]);
    }
  }

  const cellKey = (x: number, y: number, z: number) => (y * size[2] + z) * size[0] + x;
  const newBlock = (x: number, y: number, z: number, state: number): Tag => ({
    type: T.Compound,
    value: new Map<string, Tag>([
      ['pos', intList([x, y, z])],
      ['state', { type: T.Int, value: state }],
    ]),
  });
  const palette = paletteLists(root)[0];
  /** Индекс блока без свойств в палитре; нет — добавляется в конец */
  const stateOf = (name: string) => {
    let i = palette.findIndex((e) => nameOf(e) === name && e.type === T.Compound && !e.value.has('Properties'));
    if (i < 0) {
      palette.push({ type: T.Compound, value: new Map([['Name', { type: T.String, value: name }]]) });
      i = palette.length - 1;
    }
    return i;
  };

  // Площадка: слои снизу вверх, верхний сплошной, остальные при «пустой» — только периметр.
  // Она ниже всего блока схемы (начало объёма опущено на её высоту), поэтому с блоками не пересекается
  if (shape.platform && shape.platformHeight > 0) {
    const st = stateOf(shape.platformBlock);
    for (let y = 0; y < shape.platformHeight; y++) {
      const solid = !shape.platformHollow || y === shape.platformHeight - 1;
      for (let z = 0; z < size[2]; z++)
        for (let x = 0; x < size[0]; x++) {
          const edge = x === 0 || z === 0 || x === size[0] - 1 || z === size[2] - 1;
          if (!solid && !edge) continue;
          kept.push(newBlock(x, y, z, st));
          occupied.add(cellKey(x, y, z));
        }
    }
  }

  if (shape.clearAir) {
    const air = stateOf('minecraft:air');
    for (let y = 0; y < size[1]; y++)
      for (let z = 0; z < size[2]; z++)
        for (let x = 0; x < size[0]; x++) {
          if (!occupied.has(cellKey(x, y, z))) kept.push(newBlock(x, y, z, air));
        }
  }
  if (blocks?.type === T.List) {
    blocks.value = kept;
    blocks.elemType = T.Compound;
  } else root.set('blocks', { type: T.List, elemType: T.Compound, value: kept });

  // Нормализация пустого списка сущностей: elemType 0 (End) некоторые читатели
  // (в т.ч. проверяющий мод) трактуют как «список повреждён».
  const entList = root.get('entities');
  if (entList?.type === T.List && entList.elemType === 0) entList.elemType = T.Compound;

  root.set('size', intList(size));

  const entities = root.get('entities');
  if (entities?.type === T.List) {
    entities.value = entities.value.filter((e) => {
      if (e.type !== T.Compound) return true;
      const bp = e.value.get('blockPos');
      const pos = e.value.get('pos');
      if (bp?.type === T.List && bp.value.length === 3) {
        const q = shift(bp.value.map((x) => (x.type === T.Int ? x.value : 0)) as Vec);
        if (!inside(q)) return false;
        e.value.set('blockPos', intList(q));
      }
      if (pos?.type === T.List && pos.value.length === 3) {
        e.value.set('pos', {
          type: T.List,
          elemType: T.Double,
          value: pos.value.map((x, i) => ({ type: T.Double, value: (x.type === T.Double ? x.value : 0) - min[i] })),
        });
      }
      return true;
    });
  }
}

/** Габариты из тега size; нет или не три числа — null */
export function sizeOf(root: Compound): Vec | null {
  const sizeTag = root.get('size');
  return sizeTag?.type === T.List && sizeTag.value.length === 3
    ? (sizeTag.value.map((v) => (v.type === T.Int ? v.value : 0)) as Vec)
    : null;
}

/** Замены и форма из записи библиотеки (`schematics`): у старых записей формы нет или не все поля */
export function savedEdits(entry: { replace: { from: string; to: string }[]; shape?: Partial<Shape> }) {
  return {
    replace: new Map(entry.replace.map((r) => [r.from, r.to])),
    shape: { ...DEFAULT_SHAPE, ...entry.shape } as Shape,
  };
}

/** Файл схемы из библиотеки: исходные байты .nbt (как в хранилище) + замены и форма записи */
export async function schematicFromLibrary(
  source: Uint8Array,
  entry: { replace: { from: string; to: string }[]; shape?: Partial<Shape> },
): Promise<Uint8Array> {
  const parsed = await readNbt(source);
  if (!paletteLists(parsed.root.value).length) throw new Error('В файле нет палитры блоков — это не схема');
  const { replace, shape } = savedEdits(entry);
  return applyEdits(parsed, replace, shape);
}
