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

/** Данные блок-сущности (nbt) блока по индексу в списке blocks */
export function blockNbtOf(s: Schematic, index: number): Compound | null {
  const b = blocksOf(s)[index];
  if (b?.type !== T.Compound) return null;
  const nbt = b.value.get('nbt');
  return nbt?.type === T.Compound ? nbt.value : null;
}

/** Позиция блока по индексу в списке blocks */
export function posOfIndex(s: Schematic, index: number): Vec | null {
  const b = blocksOf(s)[index];
  return b ? posOf(b) : null;
}

/** Соседи по граням, рёбрам и углам: изогнутая оболочка из блоков идёт «лесенкой» и касается только рёбрами */
const NEIGHBOURS: Vec[] = [];
for (let dy = -1; dy <= 1; dy++)
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) NEIGHBOURS.push([dx, dy, dz]);
const FLAT_NEIGHBOURS = NEIGHBOURS.filter(([, dy]) => dy === 0);

/**
 * Группа блоков: соединённые (гранями, рёбрами или углами) блоки, для которых same() верно (обычно — тот же вид), начиная со start.
 * layerOnly — только по горизонтали, в слое start. Возвращает индексы в списке blocks, start — первым.
 */
export function connectedGroup(
  s: Schematic,
  grid: Grid,
  start: number,
  same: (index: number) => boolean,
  layerOnly = false,
): number[] {
  const p = posOfIndex(s, start);
  if (!p) return [];
  const [sx, sy, sz] = grid.size;
  const dirs = layerOnly ? FLAT_NEIGHBOURS : NEIGHBOURS;
  const seen = new Set([start]);
  const out = [start];
  const queue: Vec[] = [p];
  while (queue.length) {
    const [x, y, z] = queue.pop()!;
    for (const [dx, dy, dz] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || ny < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
      const idx = grid.layers.get(ny)?.[nx + nz * sx] ?? -1;
      if (idx < 0 || seen.has(idx)) continue;
      seen.add(idx);
      if (!same(idx)) continue;
      out.push(idx);
      queue.push([nx, ny, nz]);
    }
  }
  return out;
}

/** Плоскость: ось (0 — x, 1 — y, 2 — z) и координата по ней */
const PLANE_AXES = [1, 0, 2] as const;

/** Соседи по граням в плоскости, по оси, поперёк которой она лежит */
const FLAT_FACES: Vec[][] = [0, 1, 2].map((axis) =>
  NEIGHBOURS.filter((d) => d[axis] === 0 && Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) === 1),
);

/** Плоскость — пол или стена, если её материалы (виды от MATERIAL_SHARE выходящих блоков) дают PLANE_SHARE из них */
const MATERIAL_SHARE = 0.2;
const PLANE_SHARE = 0.7;

/**
 * «Объект» в рамке (3D): блоки, которые inFrame считает попавшими в рамку (по всей глубине, не только видимый
 * слой), за вычетом фона. Фон — воздух, края схемы (и срез maxY) и цельные конструкции, которые выходят за рамку.
 * Выходящий блок — в рамке, а рядом (с рёбрами и углами) есть блок за ней.
 * Конструкция — плоскость (пол, стена): выходящие блоки в одной плоскости, растянутые в обе стороны (не линия) и
 * почти все из одного-двух материалов, а сама плоскость уходит за рамку хотя бы в две стороны; фоном становятся
 * блоки этих материалов, соединённые с ними в этой плоскости.
 * Из чего сам объект, не важно. Что выходит за рамку, но не плоскость (труба, вал, ремень), остаётся в объекте,
 * обрезанным рамкой. solid — блок считается блоком (не воздух, не убран); kind — вид блока (материал плоскости).
 * Возвращает индексы в списке blocks.
 */
export function frameObject(
  grid: Grid,
  inFrame: (p: Vec) => boolean,
  solid: (index: number) => boolean,
  kind: (index: number) => string,
  maxY = Infinity,
): number[] {
  const [sx, sy, sz] = grid.size;
  const top = Math.min(sy - 1, maxY);
  const key = (x: number, y: number, z: number) => x + z * sx + y * sx * sz;
  const at = (x: number, y: number, z: number) => {
    if (x < 0 || z < 0 || y < 0 || x >= sx || z >= sz || y > top) return -1;
    const idx = grid.layers.get(y)?.[x + z * sx] ?? -1;
    return idx >= 0 && solid(idx) ? idx : -1;
  };

  // Блоки в рамке: клетка → индекс
  const inside = new Map<number, number>();
  const pos = new Map<number, Vec>();
  for (const [y, layer] of grid.layers) {
    if (y > top) continue;
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const idx = layer[x + z * sx];
        if (idx < 0 || !solid(idx) || !inFrame([x, y, z])) continue;
        const k = key(x, y, z);
        inside.set(k, idx);
        pos.set(k, [x, y, z]);
      }
  }
  const kindOf = (k: number) => kind(inside.get(k)!);

  const crossing: number[] = [];
  for (const [k, [x, y, z]] of pos)
    if (NEIGHBOURS.some(([dx, dy, dz]) => at(x + dx, y + dy, z + dz) >= 0 && !inside.has(key(x + dx, y + dy, z + dz))))
      crossing.push(k);

  // Плоскости: каждый выходящий блок — в ту из своих трёх, где таких больше (при равенстве — пол раньше стен)
  const planeKey = (axis: number, p: Vec) => axis * 1e6 + p[axis];
  const count = new Map<number, number>();
  for (const k of crossing)
    for (const a of PLANE_AXES) count.set(planeKey(a, pos.get(k)!), (count.get(planeKey(a, pos.get(k)!)) ?? 0) + 1);
  const planes = new Map<number, number[]>();
  for (const k of crossing) {
    const p = pos.get(k)!;
    let best: number = PLANE_AXES[0];
    for (const a of PLANE_AXES) if (count.get(planeKey(a, p))! > count.get(planeKey(best, p))!) best = a;
    const pk = planeKey(best, p);
    const list = planes.get(pk) ?? [];
    list.push(k);
    planes.set(pk, list);
  }

  const background = new Set<number>();
  for (const [pk, list] of planes) {
    const axis = Math.floor(pk / 1e6);
    const [u, v] = [0, 1, 2].filter((a) => a !== axis);
    const spread = (a: number) => new Set(list.map((k) => pos.get(k)![a])).size;
    if (list.length < 3 || spread(u) < 2 || spread(v) < 2) continue;
    const kinds = new Map<string, number>();
    for (const k of list) kinds.set(kindOf(k), (kinds.get(kindOf(k)) ?? 0) + 1);
    const materials = new Set([...kinds].filter(([, n]) => n >= list.length * MATERIAL_SHARE).map(([t]) => t));
    const covered = [...materials].reduce((a, t) => a + kinds.get(t)!, 0);
    if (covered < list.length * PLANE_SHARE) continue;
    // Пол и стена продолжаются за рамку хотя бы в две стороны; стенка трубы или башни — только в одну (вниз)
    const escapes = new Set<string>();
    for (const k of list) {
      if (!materials.has(kindOf(k))) continue;
      const [x, y, z] = pos.get(k)!;
      for (const d of FLAT_FACES[axis]) {
        const n: Vec = [x + d[0], y + d[1], z + d[2]];
        const idx = at(...n);
        if (idx >= 0 && !inside.has(key(...n)) && materials.has(kind(idx))) escapes.add(d.join());
      }
    }
    if (escapes.size < 2) continue;
    // Заливка в плоскости — только по её материалам
    const coord = pk % 1e6;
    const dirs = NEIGHBOURS.filter((d) => d[axis] === 0);
    const queue = list.filter((k) => materials.has(kindOf(k)));
    for (const k of queue) background.add(k);
    while (queue.length) {
      const p = pos.get(queue.pop()!)!;
      for (const d of dirs) {
        const n: Vec = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
        if (n[0] < 0 || n[2] < 0 || n[0] >= sx || n[2] >= sz || n[axis] !== coord) continue;
        const nk = key(...n);
        if (!inside.has(nk) || background.has(nk) || !materials.has(kindOf(nk))) continue;
        background.add(nk);
        queue.push(nk);
      }
    }
  }

  const result: number[] = [];
  for (const [k, idx] of inside) if (!background.has(k)) result.push(idx);
  return result;
}

/** Свойства записи палитры — для стрелок направления на рисунке */
export function propsByState(s: Schematic): Map<string, string>[] {
  return (paletteLists(s.parsed.root.value)[0] ?? []).map((e) => new Map(propsOf(e)));
}

// ---------------------------------------------------------------- правка и отмена

interface Snapshot {
  blocks: Tag[];
  /** Копии палитр: отмена убирает добавленные записи, повтор возвращает их */
  palettes: Tag[][];
}

/** История правок по схеме — переживает закрытие редактора, пока схема открыта на странице */
interface History {
  undo: Snapshot[];
  redo: Snapshot[];
}
const histories = new WeakMap<Schematic['parsed'], History>();
const MAX_HISTORY = 100;

function historyOf(s: Schematic): History {
  let h = histories.get(s.parsed);
  if (!h) histories.set(s.parsed, (h = { undo: [], redo: [] }));
  return h;
}

function snapshot(s: Schematic): Snapshot {
  return { blocks: blocksOf(s), palettes: paletteLists(s.parsed.root.value).map((p) => [...p]) };
}

function restore(s: Schematic, snap: Snapshot) {
  setBlocks(s, snap.blocks);
  paletteLists(s.parsed.root.value).forEach((p, i) => {
    const saved = snap.palettes[i];
    if (saved) p.splice(0, p.length, ...saved);
  });
}

/** Новая правка: снимок в отмену, повтор сбрасывается */
function remember(s: Schematic) {
  const h = historyOf(s);
  h.undo.push(snapshot(s));
  if (h.undo.length > MAX_HISTORY) h.undo.shift();
  h.redo = [];
}

export const canUndo = (s: Schematic) => (histories.get(s.parsed)?.undo.length ?? 0) > 0;
export const canRedo = (s: Schematic) => (histories.get(s.parsed)?.redo.length ?? 0) > 0;

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
 * to — один блок для всех или функция: id в исходнике → новый id (undefined — оставить как есть).
 */
export function editCells(
  s: Schematic,
  indices: number[],
  to: string | ((name: string) => string | undefined),
): Schematic {
  if (!indices.length) return s;

  const list = blocksOf(s);
  if (to === REMOVE) {
    remember(s);
    const drop = new Set(indices);
    setBlocks(
      s,
      list.filter((_, i) => !drop.has(i)),
    );
    return bumped(s, s.rev + 1);
  }

  const palettes = paletteLists(s.parsed.root.value);
  const palette = palettes[0];
  const targetName = (state: number) => {
    const name = nameOf(palette[state]);
    if (!name) return undefined;
    const t = typeof to === 'string' ? to : to(name);
    return t && t !== name ? t : undefined;
  };
  /** Старый индекс палитры → новый (тот же набор свойств, другое имя) */
  const mapped = new Map<number, number>();
  const target = (state: number, name: string) => {
    let n = mapped.get(state);
    if (n !== undefined) return n;
    const src = palette[state];
    const key = propsKey(src);
    n = palette.findIndex((e) => nameOf(e) === name && propsKey(e) === key);
    if (n < 0) {
      for (const p of palettes) {
        const base = p[state] ?? src;
        const value: Compound = base.type === T.Compound ? new Map(base.value) : new Map();
        value.set('Name', { type: T.String, value: name });
        p.push({ type: T.Compound, value });
      }
      n = palette.length - 1;
    }
    mapped.set(state, n);
    return n;
  };
  const changes: [number, number, string][] = [];
  for (const i of indices) {
    const b = list[i];
    if (b?.type !== T.Compound) continue;
    const st = b.value.get('state');
    if (st?.type !== T.Int) continue;
    const name = targetName(st.value);
    if (name) changes.push([i, st.value, name]);
  }
  if (!changes.length) return s;
  remember(s);
  const next = [...list];
  for (const [i, state, name] of changes) {
    const b = next[i] as { type: typeof T.Compound; value: Compound };
    next[i] = { type: T.Compound, value: new Map(b.value).set('state', { type: T.Int, value: target(state, name) }) };
  }
  setBlocks(s, next);
  return bumped(s, s.rev + 1);
}

export function undoEdit(s: Schematic): Schematic {
  const h = histories.get(s.parsed);
  const snap = h?.undo.pop();
  if (!h || !snap) return s;
  h.redo.push(snapshot(s));
  restore(s, snap);
  return bumped(s, s.rev + 1);
}

export function redoEdit(s: Schematic): Schematic {
  const h = histories.get(s.parsed);
  const snap = h?.redo.pop();
  if (!h || !snap) return s;
  h.undo.push(snapshot(s));
  restore(s, snap);
  return bumped(s, s.rev + 1);
}

/** Вернуть схему к виду до первой правки в этом редакторе — тоже правка: её можно отменить */
export function revertEdits(s: Schematic): Schematic {
  const first = histories.get(s.parsed)?.undo[0];
  if (!first) return s;
  remember(s);
  restore(s, first);
  return bumped(s, s.rev + 1);
}
