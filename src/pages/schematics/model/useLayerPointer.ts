import { useRef, useState } from 'react';
import { EMPTY_BLOCKS, REMOVE, type Schematic, type Vec } from '@/lib/schematic';
import { editCells, frameObject, stateOf, type Grid } from '@/lib/schematicEdit';

export interface Menu {
  x: number;
  z: number;
  /** Положение окна в области холста */
  left: number;
  top: number;
}

/** Рамка выделения (Shift+перетаскивание) в клетках: от и до, включительно; off — снимет выделение */
export interface Area {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  off: boolean;
}

/** Сдвиг мыши, после которого нажатие — перетаскивание, а не клик */
const DRAG_PX = 4;

interface Args {
  s: Schematic;
  grid: Grid;
  names: (string | null)[];
  sx: number;
  sz: number;
  layer: Int32Array | undefined;
  layerY: number;
  cut: boolean;
  view: { zoom: number; ox: number; oy: number };
  setView: React.Dispatch<React.SetStateAction<{ zoom: number; ox: number; oy: number }>>;
  box: { w: number; h: number };
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  indexAt: (x: number, z: number) => number;
  effective: (name: string) => string;
  changeCells: (next: Schematic) => void;
  selected: ReadonlySet<number>;
  menu: Menu | null;
  setMenu: (menu: Menu | null) => void;
  toggle: (cells: number[], off: boolean) => void;
  selectClick: (idx: number, key: string, shift: boolean, now: number, volume: boolean) => boolean;
  selectOnly: (cells: Iterable<number>) => void;
  setSelection: (cells: Iterable<number> | null) => void;
  clearSelection: () => void;
  resetClick: () => void;
  setSelNote: (note: string | null) => void;
}

/**
 * Мышь и 3D-выделение в редакторе слоёв: нажатие, рамка, ПКМ-стирание, клик по блоку (окно замены),
 * клик/Shift/двойной клик в 3D и рамка объекта. Вся геометрия — от вида холста и сетки слоя.
 */
export function useLayerPointer({
  s,
  grid,
  names,
  sx,
  sz,
  layer,
  layerY,
  cut,
  view,
  setView,
  box,
  canvasRef,
  indexAt,
  effective,
  changeCells,
  selected,
  menu,
  setMenu,
  toggle,
  selectClick,
  selectOnly,
  setSelection,
  clearSelection,
  resetClick,
  setSelNote,
}: Args) {
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);
  /** Клетки под ПКМ, пока кнопку не отпустили: рисуются убранными, применяются одной правкой */
  const [stroke, setStrokeState] = useState<Set<number> | null>(null);
  // Ref — события мыши приходят быстрее перерисовки, а набор нужен сразу
  const strokeRef = useRef<Set<number> | null>(null);
  const setStroke = (st: Set<number> | null) => {
    strokeRef.current = st;
    setStrokeState(st);
  };
  /** Нажатая ЛКМ: сдвиг вида или (с Shift / Ctrl / Cmd) рамка выделения */
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean; area: boolean } | null>(null);
  const [area, setArea] = useState<Area | null>(null);

  const cellOf = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    return { x: Math.floor((px - view.ox) / view.zoom), z: Math.floor((py - view.oy) / view.zoom), px, py };
  };
  const addToStroke = (x: number, z: number) => {
    const idx = indexAt(x, z);
    if (idx < 0) return;
    const st = strokeRef.current;
    if (st && !st.has(idx)) setStroke(new Set(st).add(idx));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен — без захвата */
    }
    if (e.button === 2) {
      setMenu(null);
      const c = cellOf(e);
      const idx = indexAt(c.x, c.z);
      setStroke(new Set(idx >= 0 ? [idx] : []));
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false, area: e.shiftKey };
    if (e.shiftKey) {
      const c = clampCell(cellOf(e));
      setArea({ x0: c.x, z0: c.z, x1: c.x, z1: c.z, off: false });
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = cellOf(e);
    setHover(c.x >= 0 && c.z >= 0 && c.x < sx && c.z < sz ? { x: c.x, z: c.z } : null);
    if (strokeRef.current && e.buttons & 2) addToStroke(c.x, c.z);
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_PX) return;
    d.moved = true;
    if (d.area) {
      const end = clampCell(c);
      setArea((a) => a && withOff({ ...a, x1: end.x, z1: end.z }));
      setMenu(null);
    } else setView((v) => ({ ...v, ox: d.ox + dx, oy: d.oy + dy }));
  };

  /** Клетка в пределах схемы — рамку можно тянуть и за край */
  const clampCell = (c: { x: number; z: number }) => ({
    x: Math.min(sx - 1, Math.max(0, c.x)),
    z: Math.min(sz - 1, Math.max(0, c.z)),
  });

  /** Блоки слоя в рамке, кроме воздуха (его замена заполнила бы пустоту) */
  const areaCells = (a: NonNullable<typeof area>) => {
    const out: number[] = [];
    if (!layer) return out;
    for (let z = Math.min(a.z0, a.z1); z <= Math.max(a.z0, a.z1); z++)
      for (let x = Math.min(a.x0, a.x1); x <= Math.max(a.x0, a.x1); x++) {
        const idx = layer[x + z * sx];
        if (idx < 0) continue;
        const name = names[stateOf(s, idx)];
        if (name && !EMPTY_BLOCKS.has(effective(name))) out.push(idx);
      }
    return out;
  };

  /** Рамка, где всё уже выделено, снимает выделение — как повторный Shift+клик */
  const areaUnselects = (a: NonNullable<typeof area>) => {
    const cells = areaCells(a);
    return cells.length > 0 && cells.every((i) => selected.has(i));
  };

  const withOff = (a: NonNullable<typeof area>) => ({ ...a, off: areaUnselects(a) });

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = strokeRef.current;
    if (st) {
      if (st.size) changeCells(editCells(s, [...st], REMOVE));
      setStroke(null);
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (d?.area) setArea(null);
    if (d?.area && d.moved && area) {
      toggle(areaCells(area), areaUnselects(area));
      return;
    }
    if (!d || d.moved || e.button !== 0) return;
    const c = cellOf(e);
    const idx = indexAt(c.x, c.z);
    if (idx < 0) {
      // Пустое место: закрыть окно, а если его нет и Shift не нажат — снять выделение
      resetClick();
      if (menu) setMenu(null);
      else if (!e.shiftKey) clearSelection();
      return;
    }
    if (selectClick(idx, `${c.x},${layerY},${c.z}`, e.shiftKey, e.timeStamp, false)) {
      setMenu(null);
      return;
    }
    // Окно — справа снизу от курсора, но в пределах области
    const W = 300;
    const H = 370;
    setMenu({
      x: c.x,
      z: c.z,
      left: Math.max(8, Math.min(c.px + 12, box.w - W - 8)),
      top: Math.max(8, Math.min(c.py + 12, box.h - H - 8)),
    });
  };

  /** 3D: клик — выделить блок (Shift — переключить), двойной — группу по объёму, мимо схемы — снять выделение */
  const pick3d = (pos: Vec | null, e: { shiftKey: boolean; timeStamp: number }) => {
    const idx = pos ? indexAtPos(pos) : -1;
    if (idx < 0) {
      resetClick();
      if (!e.shiftKey) clearSelection();
      return;
    }
    if (!selectClick(idx, pos!.join(','), e.shiftKey, e.timeStamp, true)) selectOnly([idx]);
  };
  /**
   * 3D, рамка ЛКМ: объект в ней (см. frameObject) — новое выделение; с Shift — добавить, а если всё уже выделено — снять
   */
  const frame3d = (inFrame: (p: Vec) => boolean, e: { shiftKey: boolean }) => {
    resetClick();
    const solid = (i: number) => {
      const n = names[stateOf(s, i)];
      const eff = n && effective(n);
      return !!eff && eff !== REMOVE && !EMPTY_BLOCKS.has(eff);
    };
    const kind = (i: number) => effective(names[stateOf(s, i)] ?? '');
    const cells = frameObject(grid, inFrame, solid, kind, cut ? layerY : undefined);
    setSelNote(cells.length ? null : 'В рамке нет отдельного объекта');
    if (!e.shiftKey) setSelection(cells.length ? cells : null);
    else toggle(cells, cells.length > 0 && cells.every((i) => selected.has(i)));
  };
  const indexAtPos = ([x, y, z]: Vec) =>
    x >= 0 && z >= 0 && x < sx && z < sz ? (grid.layers.get(y)?.[x + z * sx] ?? -1) : -1;

  return {
    hover,
    area,
    stroke,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => ((drag.current = null), setStroke(null), setArea(null)),
    onPointerLeave: () => setHover(null),
    pick3d,
    frame3d,
    indexAtPos,
  };
}
