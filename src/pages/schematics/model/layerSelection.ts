import { useCallback, useMemo, useRef, useState } from 'react';
import { connectedGroup, editCells, posOfIndex, stateOf, type Grid } from '@/lib/schematicEdit';
import { REMOVE, type Schematic, type Vec } from '@/lib/schematic';
import type { ItemIndex } from '@/shared/pack-data';
import { isBlock } from '@/shared/pack-data';
import type { ReplaceFavorite } from '@/entities/schematic';

export const NO_CELLS: ReadonlySet<number> = new Set();
/** Два клика по одной клетке за это время (мс) — двойной */
const DOUBLE_MS = 350;

/** «блок / блока / блоков» */
export function plural(n: number) {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'блок';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'блока';
  return 'блоков';
}

interface Args {
  s: Schematic;
  names: (string | null)[];
  grid: Grid;
  effective: (name: string) => string;
  favorites: ReplaceFavorite[];
  items: ItemIndex | null;
  smartTargets: (ids: string[]) => Promise<Map<string, string>>;
  changeCells: (s: Schematic) => void;
  closeMenu: () => void;
}

/**
 * Выделение блоков в редакторе слоёв и действия над ним: клик/Shift/двойной клик, группа по объёму,
 * замена, удаление, умная замена и избранное. Набор — набор блоков (индексы в списке blocks), общий для слоя и 3D;
 * правка схемы его сбрасывает.
 */
export function useLayerSelection({
  s,
  names,
  grid,
  effective,
  favorites,
  items,
  smartTargets,
  changeCells,
  closeMenu,
}: Args) {
  /** Выделение — к той версии схемы, где оно сделано: после правки индексы другие, и оно пропадает */
  const [sel, setSel] = useState<{ of: Schematic; cells: ReadonlySet<number> } | null>(null);
  const selected = sel && sel.of === s ? sel.cells : NO_CELLS;
  /** Итог действия над выделением (умная замена, избранное) — строка в панели */
  const [selNote, setSelNote] = useState<string | null>(null);
  const select = (cells: Iterable<number>) => {
    const next = new Set(selected);
    for (const c of cells) next.add(c);
    setSel({ of: s, cells: next });
  };
  const unselect = (cells: Iterable<number>) => {
    const next = new Set(selected);
    for (const c of cells) next.delete(c);
    setSel({ of: s, cells: next });
  };
  const clearSelection = useCallback(() => (setSel(null), setSelNote(null)), []);
  const [smartBusy, setSmartBusy] = useState(false);
  /** Прошлый клик: клетка, время и был ли блок выделен до него — для двойного клика с Shift */
  const lastClick = useRef<{ key: string; t: number; was: boolean } | null>(null);

  const selectOnly = (cells: Iterable<number>) => setSel({ of: s, cells: new Set(cells) });
  const setSelection = (cells: Iterable<number> | null) => setSel(cells ? { of: s, cells: new Set(cells) } : null);
  const resetClick = () => {
    lastClick.current = null;
  };

  /** Shift: добавить к выделению или, если всё уже выделено, снять */
  const toggle = (cells: number[], off: boolean) => (off ? unselect(cells) : select(cells));

  /** Группа: соединённые блоки того же вида (с общими заменами — как видно на рисунке); на слое или по объёму */
  const groupOf = (index: number, volume = false) => {
    const name = names[stateOf(s, index)];
    const eff = name && effective(name);
    return connectedGroup(
      s,
      grid,
      index,
      (i) => {
        const n = names[stateOf(s, i)];
        return !!n && effective(n) === eff;
      },
      !volume,
    );
  };

  /**
   * Клик выделения — на слое и в 3D. Shift — переключить блок (повторный Shift+клик снимает), двойной клик — всю
   * группу; без Shift двойной клик выделяет только её. Первый клик двойного уже переключил блок — решаем по тому,
   * был ли он выделен до него. false — обычный одиночный клик, его разбирает вызывающий.
   */
  const selectClick = (idx: number, key: string, shift: boolean, now: number, volume: boolean) => {
    const last = lastClick.current;
    const double = !!last && now - last.t < DOUBLE_MS && last.key === key;
    const was = selected.has(idx);
    lastClick.current = double ? null : { key, t: now, was };
    if (shift) {
      if (double) toggle(groupOf(idx, volume), !!last?.was);
      else toggle([idx], was);
      return true;
    }
    if (double) {
      selectOnly(groupOf(idx, volume));
      return true;
    }
    return false;
  };

  /** Действие над выделением — одна правка, её можно отменить */
  const applySelection = (to: string) => {
    if (!selected.size) return;
    if (to !== REMOVE && !isBlock(items, to)) return;
    changeCells(editCells(s, [...selected], to));
    clearSelection();
    closeMenu();
  };
  /** Избранное: первая избранная цель по id в исходнике (или по общей замене), только из сборки */
  const favoriteFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of favorites) if (!m.has(f.from) && isBlock(items, f.to)) m.set(f.from, f.to);
    return (name: string) => m.get(name) ?? m.get(effective(name));
  }, [favorites, items, effective]);
  const applyFavorites = () => {
    const cells = [...selected];
    const hit = cells.filter((i) => {
      const n = names[stateOf(s, i)];
      return !!n && !!favoriteFor(n);
    }).length;
    if (!hit) {
      setSelNote('Для этих блоков нет избранных замен');
      return;
    }
    changeCells(editCells(s, cells, favoriteFor));
    clearSelection();
    setSelNote(`Из избранного заменено ${hit} ${plural(hit)}`);
  };
  const applySmart = async () => {
    const cells = [...selected];
    const ids = [...new Set(cells.map((i) => names[stateOf(s, i)]).filter((n): n is string => !!n))];
    setSmartBusy(true);
    setSelNote(null);
    try {
      const map = await smartTargets(ids);
      const ok = new Map([...map].filter(([, to]) => isBlock(items, to)));
      const hit = cells.filter((i) => ok.has(names[stateOf(s, i)] ?? '')).length;
      if (!hit) {
        setSelNote('Умная замена ничего не подобрала');
        return;
      }
      changeCells(editCells(s, cells, (n) => ok.get(n)));
      clearSelection();
      setSelNote(`Умная замена: ${hit} ${plural(hit)}`);
    } catch (err) {
      setSelNote(`Умная замена не удалась: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSmartBusy(false);
    }
  };
  const selectedPos = useMemo(
    () => [...selected].map((i) => posOfIndex(s, i)).filter((p) => p !== null) as Vec[],
    [s, selected],
  );

  return {
    selected,
    selNote,
    setSelNote,
    smartBusy,
    select,
    unselect,
    clearSelection,
    selectOnly,
    setSelection,
    resetClick,
    toggle,
    groupOf,
    selectClick,
    applySelection,
    applyFavorites,
    applySmart,
    selectedPos,
  };
}
