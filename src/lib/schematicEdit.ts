import { T, type Compound, type Tag } from './nbt';
import { countBlocks, nameOf, paletteLists, posOf, REMOVE, type Schematic, type Vec } from './schematic';

/**
 * Правка схемы по клеткам (редактор слоёв): меняет parsed на месте — блок получает другую запись палитры
 * или убирается из списка. Массив blocks каждый раз новый, старый остаётся в истории — отмена дешёвая.
 */

/** Слои схемы: y → индексы в списке blocks по клеткам x + z·sx (-1 — пусто) */
export interface Grid {
  size: Vec;
  layers: Map<number, Int32Array>;
  /** Самый нижний и верхний слой, где есть блоки */
  minY: number;
  maxY: number;
}

const blocksOf = (s: Schematic): Tag[] => {
  const b = s.parsed.root.value.get('blocks');
  return b?.type === T.List ? b.value : [];
};

export function buildGrid(s: Schematic): Grid {
  const list = blocksOf(s);
  let size = s.size;
  if (!size) {
    const hi: Vec = [0, 0, 0];
    for (const b of list) {
      const p = posOf(b);
      if (p) for (let i = 0; i < 3; i++) hi[i] = Math.max(hi[i], p[i] + 1);
    }
    size = hi;
  }
  const [sx, , sz] = size;
  const layers = new Map<number, Int32Array>();
  let minY = Infinity;
  let maxY = -Infinity;
  list.forEach((b, i) => {
    const p = posOf(b);
    if (!p) return;
    const [x, y, z] = p;
    if (x < 0 || z < 0 || x >= sx || z >= sz || y < 0 || y >= size[1]) return;
    let layer = layers.get(y);
    if (!layer) layers.set(y, (layer = new Int32Array(sx * sz).fill(-1)));
    layer[x + z * sx] = i;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  if (!Number.isFinite(minY)) minY = maxY = 0;
  return { size, layers, minY, maxY };
}

/** Что стоит в клетке: id в исходнике (с правками слоёв), свойства и NBT блока */
export interface CellInfo {
  index: number;
  pos: Vec;
  name: string;
  props: [string, string][];
  hasNbt: boolean;
}

export function cellInfo(s: Schematic, index: number): CellInfo | null {
  const b = blocksOf(s)[index];
  const pos = b && posOf(b);
  if (!pos || b.type !== T.Compound) return null;
  const st = b.value.get('state');
  const entry = st?.type === T.Int ? paletteLists(s.parsed.root.value)[0]?.[st.value] : undefined;
  const name = entry ? nameOf(entry) : null;
  if (!entry || !name) return null;
  return { index, pos, name, props: propsOf(entry), hasNbt: b.value.has('nbt') };
}

function propsOf(entry: Tag): [string, string][] {
  if (entry.type !== T.Compound) return [];
  const p = entry.value.get('Properties');
  if (p?.type !== T.Compound) return [];
  return [...p.value].map(([k, v]) => [k, v.type === T.String ? v.value : String(v.value)]);
}

/** Имя блока по индексу в списке — быстро, для отрисовки */
export function namesByState(s: Schematic): (string | null)[] {
  return (paletteLists(s.parsed.root.value)[0] ?? []).map(nameOf);
}

export function stateOf(s: Schematic, index: number): number {
  const b = blocksOf(s)[index];
  if (b?.type !== T.Compound) return -1;
  const st = b.value.get('state');
  return st?.type === T.Int ? st.value : -1;
}

/** Свойства записи палитры — для стрелок направления на рисунке */
export function propsByState(s: Schematic): Map<string, string>[] {
  return (paletteLists(s.parsed.root.value)[0] ?? []).map((e) => new Map(propsOf(e)));
}

// ---------------------------------------------------------------- правка и отмена

interface Snapshot {
  blocks: Tag[];
  paletteLens: number[];
}

/** История правок по схеме — переживает закрытие редактора, пока схема открыта на странице */
const history = new WeakMap<Schematic['parsed'], Snapshot[]>();
const MAX_HISTORY = 100;

function snapshot(s: Schematic): Snapshot {
  return { blocks: blocksOf(s), paletteLens: paletteLists(s.parsed.root.value).map((p) => p.length) };
}

export const canUndo = (s: Schematic) => (history.get(s.parsed)?.length ?? 0) > 0;

/** Схема после правки: новые счётчики и номер правки (parsed тот же объект) */
const bumped = (s: Schematic, rev: number): Schematic => ({ ...s, counts: countBlocks(s.parsed), rev });

function setBlocks(s: Schematic, list: Tag[]) {
  const root = s.parsed.root.value;
  const b = root.get('blocks');
  if (b?.type === T.List) b.value = list;
  else root.set('blocks', { type: T.List, elemType: T.Compound, value: list });
}

const propsKey = (entry: Tag) => JSON.stringify(propsOf(entry).sort(([a], [b]) => a.localeCompare(b)));

/**
 * Поставить в клетки (индексы в списке blocks) другой блок или убрать их. Свойства (facing, axis…) и NBT
 * блока сохраняются, как при общей замене. Записи палитры добавляются во все палитры с тем же индексом.
 */
export function editCells(s: Schematic, indices: number[], to: string): Schematic {
  if (!indices.length) return s;
  const stack = history.get(s.parsed) ?? [];
  stack.push(snapshot(s));
  if (stack.length > MAX_HISTORY) stack.shift();
  history.set(s.parsed, stack);

  const list = blocksOf(s);
  if (to === REMOVE) {
    const drop = new Set(indices);
    setBlocks(
      s,
      list.filter((_, i) => !drop.has(i)),
    );
    return bumped(s, s.rev + 1);
  }

  const palettes = paletteLists(s.parsed.root.value);
  const palette = palettes[0];
  /** Старый индекс палитры → новый (тот же набор свойств, другое имя) */
  const mapped = new Map<number, number>();
  const target = (state: number) => {
    let n = mapped.get(state);
    if (n !== undefined) return n;
    const src = palette[state];
    const key = propsKey(src);
    n = palette.findIndex((e) => nameOf(e) === to && propsKey(e) === key);
    if (n < 0) {
      for (const p of palettes) {
        const base = p[state] ?? src;
        const value: Compound = base.type === T.Compound ? new Map(base.value) : new Map();
        value.set('Name', { type: T.String, value: to });
        p.push({ type: T.Compound, value });
      }
      n = palette.length - 1;
    }
    mapped.set(state, n);
    return n;
  };
  const next = [...list];
  for (const i of indices) {
    const b = next[i];
    if (b?.type !== T.Compound) continue;
    const st = b.value.get('state');
    if (st?.type !== T.Int || nameOf(palette[st.value]) === to) continue;
    next[i] = { type: T.Compound, value: new Map(b.value).set('state', { type: T.Int, value: target(st.value) }) };
  }
  setBlocks(s, next);
  return bumped(s, s.rev + 1);
}

export function undoEdit(s: Schematic): Schematic {
  const snap = history.get(s.parsed)?.pop();
  if (!snap) return s;
  setBlocks(s, snap.blocks);
  // Записи палитры, добавленные после снимка, больше никому не нужны
  paletteLists(s.parsed.root.value).forEach((p, i) => (p.length = snap.paletteLens[i] ?? p.length));
  return bumped(s, s.rev + 1);
}

/** Вернуть схему к виду до первой правки в этом редакторе */
export function revertEdits(s: Schematic): Schematic {
  const stack = history.get(s.parsed);
  if (!stack?.length) return s;
  stack.splice(1);
  return undoEdit(s);
}
