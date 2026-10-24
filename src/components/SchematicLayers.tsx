import {
  Box,
  ChevronDown,
  ChevronUp,
  Layers,
  Maximize,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  Sparkles,
  SquareDashedMousePointer,
  Star,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { blockEntry, blockIcon, isBlock, itemName, useItems } from '../lib/items';
import { EMPTY_BLOCKS, REMOVE, type Schematic, type Vec } from '../lib/schematic';
import { blockTopView } from '../lib/blockModels';
import { drawnByCode, isFullCube } from '../lib/schematicMesh';
import {
  buildGrid,
  canRedo,
  canUndo,
  cellInfo,
  connectedGroup,
  editCells,
  frameObject,
  namesByState,
  posOfIndex,
  propsByState,
  redoEdit,
  revertEdits,
  stateOf,
  undoEdit,
} from '../lib/schematicEdit';
import type { ReplaceFavorite } from '../types';
import { cx } from '../lib/util';
import { ItemIcon } from './ItemIcon';
import { ItemPicker } from './ItemPicker';
import './SchematicLayers.css';

// three.js — отдельным куском, грузится только при переходе в 3D
const SchematicView3D = lazy(() => import('./SchematicView3D'));

interface Props {
  schematic: Schematic;
  /** Общие замены по id (список на странице) — рисуем уже с ними */
  replace: Map<string, string>;
  onChange: (s: Schematic) => void;
  /** Общая замена id во всех схемах (как в списке блоков); null — отменить */
  onSetTarget: (id: string, to: string | null) => void;
  /** Избранные замены — подставить в выделенные блоки */
  favorites: ReplaceFavorite[];
  /** Умная замена (правила или агент, как настроено на странице): id → новый id */
  smartTargets: (ids: string[]) => Promise<Map<string, string>>;
  onClose: () => void;
}

/** Масштаб — пикселей на блок */
const MIN_ZOOM = 2;
const MAX_ZOOM = 96;
/** Сдвиг мыши, после которого нажатие — перетаскивание, а не клик */
const DRAG_PX = 4;
/** Два клика по одной клетке за это время (мс) — двойной */
const DOUBLE_MS = 350;

type Scope = 'cell' | 'layer' | 'all';
const SCOPES: [Scope, string][] = [
  ['cell', 'Этот блок'],
  ['layer', 'Такие же на слое'],
  ['all', 'Все такие (общая замена)'],
];

// Иконки для холста: общий кеш на страницу
const images = new Map<string, HTMLImageElement>();
function image(url: string, onLoad: () => void) {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  if (!img.complete) img.addEventListener('load', onLoad, { once: true });
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Цвет блока без иконки — по id, чтобы одинаковые блоки были одного цвета */
function hashColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return `hsl(${((h % 360) + 360) % 360} 45% 55%)`;
}

const FACING: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

/**
 * Действие редактора для отмены/повтора: правка клеток (снимки — в schematicEdit) или общая замена
 * из окна (до и после; null — замены нет). Список — на схему, переживает закрытие редактора.
 */
type Action = { kind: 'cells' } | { kind: 'global'; id: string; before: string | null; after: string | null };
const actionLog = new WeakMap<Schematic['parsed'], { undo: Action[]; redo: Action[] }>();
const MAX_ACTIONS = 200;

function logOf(s: Schematic) {
  let l = actionLog.get(s.parsed);
  if (!l) actionLog.set(s.parsed, (l = { undo: [], redo: [] }));
  return l;
}

/** Новое действие: в отмену, повтор сбрасывается */
function recordAction(s: Schematic, a: Action) {
  const l = logOf(s);
  l.undo.push(a);
  if (l.undo.length > MAX_ACTIONS) l.undo.shift();
  l.redo = [];
}

/** Снять действие из отмены (или повтора) и переложить в другой список */
function takeAction(s: Schematic, dir: 'undo' | 'redo') {
  const l = logOf(s);
  const a = (dir === 'undo' ? l.undo : l.redo).pop();
  if (a) (dir === 'undo' ? l.redo : l.undo).push(a);
  return a;
}

const NO_CELLS: ReadonlySet<number> = new Set();

/** «блок / блока / блоков» */
function plural(n: number) {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'блок';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'блока';
  return 'блоков';
}

interface Menu {
  x: number;
  z: number;
  /** Положение окна в области холста */
  left: number;
  top: number;
}

/**
 * Редактор схемы по слоям: вид сверху на один слой, масштаб колесом, сдвиг перетаскиванием.
 * ЛКМ по блоку — окно замены, ПКМ (можно провести) — убрать блоки. Ctrl+Z / Ctrl+Shift+Z — отмена и повтор.
 * Двойной клик — выделить группу; Shift+клик — добавить к выделению, повторный — снять;
 * Shift+перетаскивание — рамка: блоки в ней (без воздуха) добавляются, а если все уже выделены — снимаются.
 * Выделение — набор блоков (индексы в списке blocks), общий для слоя и 3D; правка схемы его сбрасывает.
 */
export function SchematicLayers({
  schematic: s,
  replace,
  onChange,
  onSetTarget,
  favorites,
  smartTargets,
  onClose,
}: Props) {
  const items = useItems();
  const grid = useMemo(() => buildGrid(s), [s]);
  const names = useMemo(() => namesByState(s), [s]);
  const props = useMemo(() => propsByState(s), [s]);
  const [sx, sy, sz] = grid.size;

  const [y, setY] = useState(grid.minY);
  const layerY = Math.min(Math.max(0, y), Math.max(0, sy - 1));
  const [ghost, setGhost] = useState(true);
  const [mode, setMode] = useState<'2d' | '3d'>('3d');
  /** 3D: показывать только слои до текущего */
  const [cut, setCut] = useState(false);
  const [textured, setTextured] = useState(true);
  const [view, setView] = useState({ zoom: 16, ox: 0, oy: 0 });
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [scope, setScope] = useState<Scope>('cell');
  const [highlight, setHighlight] = useState<string | null>(null);
  /** Выделение — к той версии схемы, где оно сделано: после правки индексы другие, и оно пропадает */
  const [sel, setSel] = useState<{ of: Schematic; cells: ReadonlySet<number> } | null>(null);
  const selected = sel && sel.of === s ? sel.cells : NO_CELLS;
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
  const clearSelection = () => (setSel(null), setSelNote(null));
  /** Итог действия над выделением (умная замена, избранное) — строка в панели */
  const [selNote, setSelNote] = useState<string | null>(null);
  const [smartBusy, setSmartBusy] = useState(false);
  /** Клетки под ПКМ, пока кнопку не отпустили: рисуются убранными, применяются одной правкой */
  const [stroke, setStrokeState] = useState<Set<number> | null>(null);
  // Ref — события мыши приходят быстрее перерисовки, а набор нужен сразу
  const strokeRef = useRef<Set<number> | null>(null);
  const setStroke = (st: Set<number> | null) => {
    strokeRef.current = st;
    setStrokeState(st);
  };
  const [, redraw] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  /** Нажатая ЛКМ: сдвиг вида или (с Shift / Ctrl / Cmd) рамка выделения */
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean; area: boolean } | null>(null);
  /** Рамка выделения (Shift+перетаскивание) в клетках: от и до, включительно; off — снимет выделение */
  const [area, setArea] = useState<{ x0: number; z0: number; x1: number; z1: number; off: boolean } | null>(null);
  /** Прошлый клик: клетка, время и был ли блок выделен до него — для двойного клика с Shift */
  const lastClick = useRef<{ key: string; t: number; was: boolean } | null>(null);
  /** 3D: блок под курсором (индекс в списке blocks, -1 — нет) */
  const [hover3d, setHover3d] = useState(-1);

  const layer = grid.layers.get(layerY);
  const below = grid.layers.get(layerY - 1);
  const effective = useCallback((name: string) => replace.get(name) ?? name, [replace]);

  // Размер области холста
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!box.w || !box.h) return;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(box.w / sx, box.h / sz) * 0.9));
    setView({ zoom, ox: (box.w - sx * zoom) / 2, oy: (box.h - sz * zoom) / 2 });
  }, [box.w, box.h, sx, sz]);

  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !box.w) return;
    fitted.current = true;
    fit();
  }, [box.w, fit]);

  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const k = zoom / v.zoom;
      return { zoom, ox: px - (px - v.ox) * k, oy: py - (py - v.oy) * k };
    });
  }, []);

  // Колесо — масштаб под курсором (пассивный слушатель не даст отменить прокрутку страницы)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const indexAt = (x: number, z: number) => (x >= 0 && z >= 0 && x < sx && z < sz ? (layer?.[x + z * sx] ?? -1) : -1);

  const [, bumpLog] = useState(0);
  const { undo: undoList, redo: redoList } = logOf(s);
  const record = (a: Action) => {
    recordAction(s, a);
    bumpLog((n) => n + 1);
  };
  /** Правка клеток — через историю схемы */
  const changeCells = (next: Schematic) => {
    if (next === s) return;
    record({ kind: 'cells' });
    onChange(next);
  };
  const setGlobal = (id: string, after: string | null) => {
    const before = replace.get(id) ?? null;
    if (before === after) return;
    record({ kind: 'global', id, before, after });
    onSetTarget(id, after);
  };

  const step = useCallback(
    (dir: 'undo' | 'redo') => {
      const a = takeAction(s, dir);
      if (!a) return;
      setMenu(null);
      bumpLog((n) => n + 1);
      if (a.kind === 'global') onSetTarget(a.id, dir === 'undo' ? a.before : a.after);
      else if (dir === 'undo' ? canUndo(s) : canRedo(s)) onChange(dir === 'undo' ? undoEdit(s) : redoEdit(s));
    },
    [s, onChange, onSetTarget],
  );
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);

  /** Delete: убрать выделенное — одной правкой, её можно отменить (через ref — свежие схема и выделение) */
  const removeSelected = useRef(() => {});
  useEffect(() => {
    removeSelected.current = () => {
      changeCells(editCells(s, [...selected], REMOVE));
      clearSelection();
      setMenu(null);
    };
  });

  // Клавиши: Esc, отмена, Delete, слои. В поле ввода — только Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea');
      if (e.key === 'Escape') {
        // Список выбора предмета закрывается сам (и гасит событие); здесь — окно замены, потом редактор
        e.preventDefault();
        if (menu) setMenu(null);
        else if (selected.size) clearSelection();
        else onClose();
        return;
      }
      if (typing) return;
      // По физической клавише: в русской раскладке e.key — «я» и «н»
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.code === 'KeyY') {
        e.preventDefault();
        redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
        e.preventDefault();
        removeSelected.current();
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        setY((v) => Math.min(sy - 1, v + 1));
        setMenu(null);
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        setY((v) => Math.max(0, v - 1));
        setMenu(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, selected, onClose, undo, redo, sy]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ---------------------------------------------------------------- рисование

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box.w) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.w * dpr);
    canvas.height = Math.round(box.h * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, box.w, box.h);
    const css = getComputedStyle(canvas);
    const color = (v: string) => css.getPropertyValue(v).trim();
    const { zoom, ox, oy } = view;
    const again = () => redraw((n) => n + 1);

    // Подложка схемы
    ctx.fillStyle = color('--surface');
    ctx.fillRect(ox, oy, sx * zoom, sz * zoom);

    const x0 = Math.max(0, Math.floor(-ox / zoom));
    const z0 = Math.max(0, Math.floor(-oy / zoom));
    const x1 = Math.min(sx, Math.ceil((box.w - ox) / zoom));
    const z1 = Math.min(sz, Math.ceil((box.h - oy) / zoom));

    const drawBlock = (id: string, st: number, px: number, py: number, alpha: number) => {
      const p = props[st] ?? new Map();
      // Вид сверху по модели из jar; нет модели (рисует код) — иконка предмета
      const top = drawnByCode(id) ? null : blockTopView(id, p, again);
      if (top) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(top, px, py, zoom, zoom);
        ctx.globalAlpha = 1;
        return;
      }
      if (top === undefined) return;
      const icon = blockIcon(blockEntry(items, id), isFullCube(id, p));
      const img = icon ? image(icon.url, again) : null;
      ctx.globalAlpha = alpha;
      if (img) {
        // Нарисованная модель уже сглажена — уменьшать плавно; текстуру 16×16 — по пикселям
        ctx.imageSmoothingEnabled = !!icon?.smooth;
        ctx.drawImage(img, px, py, zoom, zoom);
        ctx.imageSmoothingEnabled = false;
      } else {
        ctx.fillStyle = hashColor(id);
        ctx.fillRect(px + zoom * 0.08, py + zoom * 0.08, zoom * 0.84, zoom * 0.84);
      }
      ctx.globalAlpha = 1;
    };

    const danger = color('--danger');
    const accent = color('--accent');
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        const px = ox + x * zoom;
        const py = oy + z * zoom;
        const idx = layer?.[x + z * sx] ?? -1;
        if (idx < 0) {
          // Пустая клетка: блок слоя ниже — бледно, чтобы видеть, на что опирается слой
          const b = ghost ? (below?.[x + z * sx] ?? -1) : -1;
          if (b >= 0) {
            const bst = stateOf(s, b);
            const name = names[bst];
            const eff = name && effective(name);
            if (eff && eff !== REMOVE && !EMPTY_BLOCKS.has(eff)) drawBlock(eff, bst, px, py, 0.18);
          }
          continue;
        }
        const st = stateOf(s, idx);
        const name = names[st];
        if (!name) continue;
        const eff = stroke?.has(idx) ? REMOVE : effective(name);
        if (eff === REMOVE) {
          ctx.strokeStyle = danger;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = Math.max(1, zoom / 12);
          ctx.beginPath();
          ctx.moveTo(px + zoom * 0.25, py + zoom * 0.25);
          ctx.lineTo(px + zoom * 0.75, py + zoom * 0.75);
          ctx.moveTo(px + zoom * 0.75, py + zoom * 0.25);
          ctx.lineTo(px + zoom * 0.25, py + zoom * 0.75);
          ctx.stroke();
          ctx.globalAlpha = 1;
          continue;
        }
        if (EMPTY_BLOCKS.has(eff)) {
          // Явный воздух (расчищает место при вставке) — точка
          if (zoom >= 6) {
            ctx.fillStyle = color('--text-3');
            ctx.globalAlpha = 0.5;
            ctx.fillRect(px + zoom / 2 - 1, py + zoom / 2 - 1, 2, 2);
            ctx.globalAlpha = 1;
          }
          continue;
        }
        drawBlock(eff, st, px, py, 1);
        if (eff !== name && zoom >= 10) {
          // Блок с общей заменой — уголок
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.moveTo(px + zoom, py);
          ctx.lineTo(px + zoom, py + zoom * 0.3);
          ctx.lineTo(px + zoom * 0.7, py);
          ctx.fill();
        }
        const facing = FACING[props[st]?.get('facing') ?? props[st]?.get('horizontal_facing') ?? ''];
        if (facing && zoom >= 18) {
          // Стрелка направления (facing) к краю клетки
          const [dx, dz] = facing;
          const cx0 = px + zoom / 2 + dx * zoom * 0.3;
          const cz0 = py + zoom / 2 + dz * zoom * 0.3;
          const w = zoom * 0.14;
          ctx.beginPath();
          ctx.moveTo(cx0 + dx * w, cz0 + dz * w);
          ctx.lineTo(cx0 - dx * w + dz * w, cz0 - dz * w + dx * w);
          ctx.lineTo(cx0 - dx * w - dz * w, cz0 - dz * w - dx * w);
          ctx.closePath();
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1;
          ctx.fill();
          ctx.stroke();
        }
        if (highlight && eff === highlight) {
          ctx.strokeStyle = color('--imp-2');
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 1, py + 1, zoom - 2, zoom - 2);
        }
      }

    // Сетка
    if (zoom >= 8) {
      ctx.strokeStyle = color('--border');
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        const px = Math.round(ox + x * zoom) + 0.5;
        ctx.moveTo(px, oy + z0 * zoom);
        ctx.lineTo(px, oy + z1 * zoom);
      }
      for (let z = z0; z <= z1; z++) {
        const py = Math.round(oy + z * zoom) + 0.5;
        ctx.moveTo(ox + x0 * zoom, py);
        ctx.lineTo(ox + x1 * zoom, py);
      }
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color('--border-strong');
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox, oy, sx * zoom, sz * zoom);

    // Выделение — заливка и рамка поверх блока (и поверх воздуха и убранных)
    if (selected.size && layer) {
      ctx.fillStyle = accent;
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1, Math.min(3, zoom / 8));
      for (let z = z0; z < z1; z++)
        for (let x = x0; x < x1; x++) {
          if (!selected.has(layer[x + z * sx])) continue;
          const px = ox + x * zoom;
          const py = oy + z * zoom;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(px, py, zoom, zoom);
          ctx.globalAlpha = 1;
          ctx.strokeRect(px + 1, py + 1, zoom - 2, zoom - 2);
        }
    }

    const outline = (c: { x: number; z: number } | null, col: string) => {
      if (!c) return;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + c.x * zoom + 1, oy + c.z * zoom + 1, zoom - 2, zoom - 2);
    };
    outline(hover, color('--text'));
    outline(menu, accent);

    if (area) {
      // Рамка выделения: пунктир, при снятии — красный
      const col = area.off ? danger : accent;
      const rx = ox + Math.min(area.x0, area.x1) * zoom;
      const rz = oy + Math.min(area.z0, area.z1) * zoom;
      const rw = (Math.abs(area.x1 - area.x0) + 1) * zoom;
      const rh = (Math.abs(area.z1 - area.z0) + 1) * zoom;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(rx, rz, rw, rh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(rx + 1, rz + 1, rw - 2, rh - 2);
      ctx.setLineDash([]);
    }
  });

  // ---------------------------------------------------------------- мышь

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

  const onPointerDown = (e: React.PointerEvent) => {
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

  const onPointerMove = (e: React.PointerEvent) => {
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

  /** Shift: добавить к выделению или, если всё уже выделено, снять */
  const toggle = (cells: number[], off: boolean) => (off ? unselect(cells) : select(cells));

  const onPointerUp = (e: React.PointerEvent) => {
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
      lastClick.current = null;
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

  // ---------------------------------------------------------------- окно замены

  const menuIdx = menu ? indexAt(menu.x, menu.z) : -1;
  const info = menuIdx >= 0 ? cellInfo(s, menuIdx) : null;
  const hoverIdx = mode === '3d' ? hover3d : hover ? indexAt(hover.x, hover.z) : -1;
  const hoverInfo = hoverIdx >= 0 ? cellInfo(s, hoverIdx) : null;

  /** Клетки, к которым применяется действие окна */
  const scopeCells = (name: string): number[] => {
    if (!layer || !info) return [];
    if (scope === 'cell') return [info.index];
    const out: number[] = [];
    for (const idx of layer) if (idx >= 0 && names[stateOf(s, idx)] === name) out.push(idx);
    return out;
  };

  const sameOnLayer =
    info && layer ? layer.filter((idx) => idx >= 0 && names[stateOf(s, idx)] === info.name).length : 0;

  const apply = (to: string) => {
    if (!info) return;
    if (to !== REMOVE && !isBlock(items, to)) return;
    if (scope === 'all') setGlobal(info.name, to);
    else changeCells(editCells(s, scopeCells(info.name), to));
    setMenu(null);
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
      setSel({ of: s, cells: new Set(groupOf(idx, volume)) });
      return true;
    }
    return false;
  };

  /** 3D: клик — выделить блок (Shift — переключить), двойной — группу по объёму, мимо схемы — снять выделение */
  const pick3d = (pos: Vec | null, e: { shiftKey: boolean; timeStamp: number }) => {
    const idx = pos ? indexAtPos(pos) : -1;
    if (idx < 0) {
      lastClick.current = null;
      if (!e.shiftKey) clearSelection();
      return;
    }
    if (!selectClick(idx, pos!.join(','), e.shiftKey, e.timeStamp, true)) setSel({ of: s, cells: new Set([idx]) });
  };
  /**
   * 3D, рамка ЛКМ: объект в ней (см. frameObject) — новое выделение; с Shift — добавить, а если всё уже выделено — снять
   */
  const frame3d = (inFrame: (p: Vec) => boolean, e: { shiftKey: boolean }) => {
    lastClick.current = null;
    const solid = (i: number) => {
      const n = names[stateOf(s, i)];
      const eff = n && effective(n);
      return !!eff && eff !== REMOVE && !EMPTY_BLOCKS.has(eff);
    };
    const kind = (i: number) => effective(names[stateOf(s, i)] ?? '');
    const cells = frameObject(grid, inFrame, solid, kind, cut ? layerY : undefined);
    setSelNote(cells.length ? null : 'В рамке нет отдельного объекта');
    if (!e.shiftKey) setSel(cells.length ? { of: s, cells: new Set(cells) } : null);
    else toggle(cells, cells.length > 0 && cells.every((i) => selected.has(i)));
  };
  const indexAtPos = ([x, y, z]: Vec) =>
    x >= 0 && z >= 0 && x < sx && z < sz ? (grid.layers.get(y)?.[x + z * sx] ?? -1) : -1;

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
  const menuGroup = info ? groupOf(info.index) : [];
  const menuSelected = info ? selected.has(info.index) : false;

  /** Действие над выделением — одна правка, её можно отменить */
  const applySelection = (to: string) => {
    if (!selected.size) return;
    if (to !== REMOVE && !isBlock(items, to)) return;
    changeCells(editCells(s, [...selected], to));
    clearSelection();
    setMenu(null);
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
  const selectedOnLayer = layer ? layer.reduce((a, i) => a + (i >= 0 && selected.has(i) ? 1 : 0), 0) : 0;
  const selectedPos = useMemo(
    () => [...selected].map((i) => posOfIndex(s, i)).filter((p) => p !== null),
    [s, selected],
  );

  /** Блоки текущего слоя (с общими заменами) — легенда */
  const legend = (() => {
    const m = new Map<string, number>();
    if (layer)
      for (const idx of layer) {
        if (idx < 0) continue;
        const name = names[stateOf(s, idx)];
        if (!name) continue;
        const eff = effective(name);
        m.set(eff, (m.get(eff) ?? 0) + 1);
      }
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  })();

  const shownName = (id: string) =>
    id === REMOVE
      ? 'Удалён из схемы'
      : EMPTY_BLOCKS.has(id)
        ? 'Воздух'
        : itemName(blockEntry(items, id), id.split(':').pop() ?? id);

  const layerTotal = layer ? layer.reduce((a, i) => a + (i >= 0 ? 1 : 0), 0) : 0;
  const stepY = (d: number) => {
    setY(Math.min(sy - 1, Math.max(0, layerY + d)));
    setMenu(null);
  };

  return createPortal(
    <div className="layers-overlay" role="dialog" aria-modal="true" aria-label={`Слои схемы ${s.fileName}`}>
      <div className="layers-head">
        <Layers size={18} className="faint" />
        <h2 className="grow">
          {s.fileName}
          <span className="faint small">
            {' '}
            · {sx}×{sy}×{sz}
          </span>
        </h2>
        <button className="btn sm" onClick={undo} disabled={!undoList.length} title="Отменить (Ctrl+Z)">
          <Undo2 size={14} />
          Отменить
        </button>
        <button
          className="btn sm"
          onClick={redo}
          disabled={!redoList.length}
          title="Повторить отменённое (Ctrl+Shift+Z или Ctrl+Y)"
        >
          <Redo2 size={14} />
          Повторить
        </button>
        <button
          className="btn ghost sm"
          onClick={() => confirm('Вернуть все блоки, изменённые в этом редакторе?') && changeCells(revertEdits(s))}
          disabled={!canUndo(s)}
          title="Вернуть схему к виду до правок по слоям"
        >
          <RotateCcw size={14} />
          Сбросить правки
        </button>
        <button className="btn ghost icon" onClick={onClose} aria-label="Закрыть">
          <X size={18} />
        </button>
      </div>

      <div className="layers-toolbar">
        <div className="layers-mode" role="tablist" aria-label="Вид">
          <button
            role="tab"
            aria-selected={mode === '2d'}
            className={cx('btn sm', mode === '2d' && 'on')}
            onClick={() => setMode('2d')}
          >
            <Layers size={14} />
            Слой
          </button>
          <button
            role="tab"
            aria-selected={mode === '3d'}
            className={cx('btn sm', mode === '3d' && 'on')}
            onClick={() => (setMode('3d'), setMenu(null))}
          >
            <Box size={14} />
            3D
          </button>
        </div>
        <span className="layers-step">
          <button
            className="btn sm icon"
            onClick={() => stepY(-1)}
            disabled={layerY <= 0}
            aria-label="Слой ниже"
            title="Слой ниже"
          >
            <ChevronDown size={16} />
          </button>
          <input
            type="range"
            className="layers-range"
            min={0}
            max={Math.max(0, sy - 1)}
            value={layerY}
            onChange={(e) => {
              setY(Number(e.target.value));
              setMenu(null);
            }}
            aria-label="Слой"
          />
          <button
            className="btn sm icon"
            onClick={() => stepY(1)}
            disabled={layerY >= sy - 1}
            aria-label="Слой выше"
            title="Слой выше"
          >
            <ChevronUp size={16} />
          </button>
        </span>
        <span className="layers-y">
          Слой <b>{layerY + 1}</b> из {sy}
        </span>
        <span className="faint small">{layerTotal} блоков</span>
        {mode === '2d' ? (
          <>
            <label className="toggle sm-toggle" title="Бледно показывать блоки слоя ниже там, где на этом слое пусто">
              <input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} />
              Слой ниже
            </label>
            <span className="grow" />
            <button
              className="btn ghost sm icon"
              onClick={() => zoomAt(box.w / 2, box.h / 2, 1 / 1.4)}
              aria-label="Мельче"
            >
              <Minus size={15} />
            </button>
            <button
              className="btn ghost sm icon"
              onClick={() => zoomAt(box.w / 2, box.h / 2, 1.4)}
              aria-label="Крупнее"
            >
              <Plus size={15} />
            </button>
            <button className="btn ghost sm" onClick={fit} title="Вписать схему в окно">
              <Maximize size={14} />
              Вписать
            </button>
          </>
        ) : (
          <>
            <label className="toggle sm-toggle" title="Скрыть слои выше выбранного — заглянуть внутрь">
              <input type="checkbox" checked={cut} onChange={(e) => setCut(e.target.checked)} />
              Срез по слою
            </label>
            <label
              className="toggle sm-toggle"
              title="Текстуры блоков; без них — средний цвет текстуры, проще и быстрее"
            >
              <input type="checkbox" checked={textured} onChange={(e) => setTextured(e.target.checked)} />
              Текстуры
            </label>
            <span className="grow" />
          </>
        )}
      </div>

      <div className="layers-main">
        <div className="layers-canvas" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => ((drag.current = null), setStroke(null), setArea(null))}
            onPointerLeave={() => setHover(null)}
            onContextMenu={(e) => e.preventDefault()}
          />
          {mode === '3d' && (
            <Suspense fallback={<div className="view3d faint small">Загружаю 3D…</div>}>
              <SchematicView3D
                schematic={s}
                replace={replace}
                maxY={cut ? layerY : undefined}
                textured={textured}
                selected={selectedPos}
                onPick={pick3d}
                onHover={(p) => setHover3d(p ? indexAtPos(p) : -1)}
                onFrame={frame3d}
              />
              <div className="layers-hint faint small">
                Клик — выделить блок · двойной клик — группу · рамка ЛКМ — выделить объект (без пола и стен) · Shift —
                добавить, повторно — снять · Delete — убрать · зажатое колесо (или Alt+ЛКМ) — вращать вокруг точки под
                курсором · ПКМ — сдвигать · колесо — масштаб · ↑↓ — слой среза · блоки по моделям из сборки, у части
                блоков — упрощённая форма
              </div>
            </Suspense>
          )}
          {hoverInfo && !menu && (
            <div className="layers-hover small">
              <b>{shownName(effective(hoverInfo.name))}</b>
              <code>{effective(hoverInfo.name)}</code>
              {effective(hoverInfo.name) !== hoverInfo.name && (
                <span className="faint">в исходнике: {hoverInfo.name}</span>
              )}
              <span className="faint">
                x {hoverInfo.pos[0]}, y {hoverInfo.pos[1]}, z {hoverInfo.pos[2]}
                {hoverInfo.props.length > 0 && ` · ${hoverInfo.props.map(([k, v]) => `${k}=${v}`).join(', ')}`}
              </span>
            </div>
          )}
          <div className={cx('layers-hint faint small', mode === '3d' && 'hidden')}>
            ЛКМ — заменить · двойной клик — выделить группу · Shift+клик или рамка — выделить, повторно — снять · ПКМ
            (можно провести) — убрать · колесо — масштаб · перетаскивание — сдвиг · ↑↓ — слои · Ctrl+Z / Ctrl+Shift+Z —
            отмена и повтор · Delete — убрать выделенное · Esc — снять выделение
          </div>
          {selected.size === 0 && selNote && (
            <div className="layers-selection small" role="status">
              <div className="row">
                <span className="grow faint">{selNote}</span>
                <button className="btn ghost sm icon" onClick={() => setSelNote(null)} aria-label="Скрыть">
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
          {selected.size > 0 && (
            <div className="layers-selection small" role="region" aria-label="Выделение">
              <div className="row">
                <SquareDashedMousePointer size={15} className="faint" />
                <span className="grow">
                  Выбрано <b>{selected.size}</b> {plural(selected.size)}
                  {selectedOnLayer !== selected.size && <span className="faint"> · на слое {selectedOnLayer}</span>}
                </span>
                <button className="btn ghost sm" onClick={clearSelection} title="Снять выделение (Esc)">
                  Сбросить
                </button>
              </div>
              <div className="row">
                <span className="grow">
                  <ItemPicker
                    small
                    blocksOnly
                    placeholder="Заменить выбранные на…"
                    onPick={(it) => applySelection(it.i)}
                  />
                </span>
                <button
                  className="btn sm danger"
                  onClick={() => applySelection(REMOVE)}
                  title="Убрать выбранные (Delete)"
                >
                  <Trash2 size={14} />
                  Убрать
                </button>
              </div>
              <div className="row">
                <button
                  className="btn ghost sm"
                  onClick={applySmart}
                  disabled={smartBusy}
                  title="Подобрать замены для выбранных блоков — правилами или агентом, как настроена умная замена на странице"
                >
                  <Sparkles size={14} />
                  {smartBusy ? 'Подбираю…' : 'Умная замена'}
                </button>
                <button
                  className="btn ghost sm"
                  onClick={applyFavorites}
                  disabled={!favorites.length}
                  title="Поставить избранные замены в выбранные блоки (если вариантов несколько — первый)"
                >
                  <Star size={14} />
                  Из избранного
                </button>
              </div>
              {selNote && <div className="faint">{selNote}</div>}
            </div>
          )}
          {mode === '2d' && menu && info && (
            <div className="layers-menu" style={{ left: menu.left, top: menu.top }}>
              <div className="row">
                <ItemIcon id={effective(info.name)} size={28} />
                <span className="grow layers-menu-names">
                  <span>{shownName(effective(info.name))}</span>
                  <code>{effective(info.name)}</code>
                </span>
                <button className="btn ghost sm icon" onClick={() => setMenu(null)} aria-label="Закрыть окно">
                  <X size={15} />
                </button>
              </div>
              <div className="faint small">
                x {info.pos[0]}, y {info.pos[1]}, z {info.pos[2]}
                {effective(info.name) !== info.name && <> · в исходнике {info.name}</>}
                {info.props.length > 0 && <> · {info.props.map(([k, v]) => `${k}=${v}`).join(', ')}</>}
              </div>
              <div className="layers-scope" role="radiogroup" aria-label="К чему применить">
                {SCOPES.map(([k, label]) => (
                  <label key={k} className="small">
                    <input type="radio" name="layers-scope" checked={scope === k} onChange={() => setScope(k)} />
                    {label}
                    {k === 'layer' && <span className="faint"> ({sameOnLayer})</span>}
                  </label>
                ))}
              </div>
              <ItemPicker small blocksOnly autoFocus placeholder="Заменить на…" onPick={(it) => apply(it.i)} />
              <div className="row layers-menu-select">
                <button
                  className="btn ghost sm"
                  onClick={() => {
                    if (menuSelected) unselect([info.index]);
                    else select([info.index]);
                    setMenu(null);
                  }}
                >
                  <SquareDashedMousePointer size={14} />
                  {menuSelected ? 'Снять выделение' : 'Выделить'}
                </button>
                <button
                  className="btn ghost sm"
                  onClick={() => (select(menuGroup), setMenu(null))}
                  title="Соединённые блоки этого вида на слое — добавить к выделению"
                >
                  Выделить группу <span className="faint">({menuGroup.length})</span>
                </button>
              </div>
              <div className="row">
                <button className="btn sm danger" onClick={() => apply(REMOVE)}>
                  <Trash2 size={14} />
                  Убрать
                </button>
                {scope === 'all' && replace.has(info.name) && (
                  <button className="btn ghost sm" onClick={() => (setGlobal(info.name, null), setMenu(null))}>
                    Отменить общую замену
                  </button>
                )}
              </div>
              {scope === 'all' && (
                <p className="faint small layers-note">
                  Общая замена — как в списке блоков: для всех открытых схем, по id {info.name}.
                </p>
              )}
            </div>
          )}
        </div>

        <aside className="layers-legend">
          <h3 className="small">На этом слое</h3>
          {legend.length === 0 && <p className="faint small">Пусто</p>}
          <ul>
            {legend.map(([id, n]) => (
              <li
                key={id}
                className={cx(highlight === id && 'on')}
                onMouseEnter={() => setHighlight(id)}
                onMouseLeave={() => setHighlight(null)}
                title={id}
              >
                {id === REMOVE ? <Trash2 size={18} className="faint" /> : <ItemIcon id={id} size={20} tip={false} />}
                <span className="grow">{shownName(id)}</span>
                <span className="faint">×{n}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>,
    document.body,
  );
}
