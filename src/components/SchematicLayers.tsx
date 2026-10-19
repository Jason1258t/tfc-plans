import { ChevronDown, ChevronUp, Layers, Maximize, Minus, Plus, RotateCcw, Trash2, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { iconUrl, itemName, useItems } from '../lib/items';
import { EMPTY_BLOCKS, REMOVE, type Schematic } from '../lib/schematic';
import {
  buildGrid,
  canUndo,
  cellInfo,
  editCells,
  namesByState,
  propsByState,
  revertEdits,
  stateOf,
  undoEdit,
} from '../lib/schematicEdit';
import { cx } from '../lib/util';
import { ItemIcon } from './ItemIcon';
import { ItemPicker } from './ItemPicker';
import './SchematicLayers.css';

interface Props {
  schematic: Schematic;
  /** Общие замены по id (список на странице) — рисуем уже с ними */
  replace: Map<string, string>;
  onChange: (s: Schematic) => void;
  /** Общая замена id во всех схемах (как в списке блоков); null — отменить */
  onSetTarget: (id: string, to: string | null) => void;
  onClose: () => void;
}

/** Масштаб — пикселей на блок */
const MIN_ZOOM = 2;
const MAX_ZOOM = 96;
/** Сдвиг мыши, после которого нажатие — перетаскивание, а не клик */
const DRAG_PX = 4;

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

interface Menu {
  x: number;
  z: number;
  /** Положение окна в области холста */
  left: number;
  top: number;
}

/**
 * Редактор схемы по слоям: вид сверху на один слой, масштаб колесом, сдвиг перетаскиванием.
 * ЛКМ по блоку — окно замены, ПКМ (можно провести) — убрать блоки. Ctrl+Z — отмена.
 */
export function SchematicLayers({ schematic: s, replace, onChange, onSetTarget, onClose }: Props) {
  const items = useItems();
  const grid = useMemo(() => buildGrid(s), [s]);
  const names = useMemo(() => namesByState(s), [s]);
  const props = useMemo(() => propsByState(s), [s]);
  const [sx, sy, sz] = grid.size;

  const [y, setY] = useState(grid.minY);
  const layerY = Math.min(Math.max(0, y), Math.max(0, sy - 1));
  const [ghost, setGhost] = useState(true);
  const [view, setView] = useState({ zoom: 16, ox: 0, oy: 0 });
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [scope, setScope] = useState<Scope>('cell');
  const [highlight, setHighlight] = useState<string | null>(null);
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
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);

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

  const undo = useCallback(() => {
    if (!canUndo(s)) return;
    setMenu(null);
    onChange(undoEdit(s));
  }, [s, onChange]);

  // Клавиши: Esc, отмена, слои. В поле ввода — только Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea');
      if (e.key === 'Escape') {
        // Список выбора предмета закрывается сам (и гасит событие); здесь — окно замены, потом редактор
        e.preventDefault();
        if (menu) setMenu(null);
        else onClose();
        return;
      }
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
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
  }, [menu, onClose, undo, sy]);

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

    const drawBlock = (id: string, px: number, py: number, alpha: number) => {
      const url = iconUrl(items?.byId.get(id));
      const img = url ? image(url, again) : null;
      ctx.globalAlpha = alpha;
      if (img) ctx.drawImage(img, px, py, zoom, zoom);
      else {
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
            const name = names[stateOf(s, b)];
            const eff = name && effective(name);
            if (eff && eff !== REMOVE && !EMPTY_BLOCKS.has(eff)) drawBlock(eff, px, py, 0.18);
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
        drawBlock(eff, px, py, 1);
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

    const outline = (c: { x: number; z: number } | null, col: string) => {
      if (!c) return;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + c.x * zoom + 1, oy + c.z * zoom + 1, zoom - 2, zoom - 2);
    };
    outline(hover, color('--text'));
    outline(menu, accent);
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
    drag.current = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false };
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
    setView((v) => ({ ...v, ox: d.ox + dx, oy: d.oy + dy }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const st = strokeRef.current;
    if (st) {
      if (st.size) onChange(editCells(s, [...st], REMOVE));
      setStroke(null);
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || e.button !== 0) return;
    const c = cellOf(e);
    if (indexAt(c.x, c.z) < 0) {
      setMenu(null);
      return;
    }
    // Окно — справа снизу от курсора, но в пределах области
    const W = 300;
    const H = 330;
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
  const hoverInfo = hover
    ? (() => {
        const i = indexAt(hover.x, hover.z);
        return i >= 0 ? cellInfo(s, i) : null;
      })()
    : null;

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
    if (to !== REMOVE && !items?.byId.has(to)) return;
    if (scope === 'all') onSetTarget(info.name, to);
    else onChange(editCells(s, scopeCells(info.name), to));
    setMenu(null);
  };

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
        : itemName(items?.byId.get(id), id.split(':').pop() ?? id);

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
        <button className="btn sm" onClick={undo} disabled={!canUndo(s)} title="Отменить правку (Ctrl+Z)">
          <Undo2 size={14} />
          Отменить
        </button>
        <button
          className="btn ghost sm"
          onClick={() => confirm('Вернуть все блоки, изменённые в этом редакторе?') && onChange(revertEdits(s))}
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
        <button className="btn sm icon" onClick={() => stepY(-1)} disabled={layerY <= 0} aria-label="Слой ниже">
          <ChevronDown size={16} />
        </button>
        <span className="layers-y">
          Слой <b>{layerY + 1}</b> из {sy}
        </span>
        <button className="btn sm icon" onClick={() => stepY(1)} disabled={layerY >= sy - 1} aria-label="Слой выше">
          <ChevronUp size={16} />
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
        <span className="faint small">{layerTotal} блоков</span>
        <label className="toggle sm-toggle" title="Бледно показывать блоки слоя ниже там, где на этом слое пусто">
          <input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} />
          Слой ниже
        </label>
        <span className="grow" />
        <button className="btn ghost sm icon" onClick={() => zoomAt(box.w / 2, box.h / 2, 1 / 1.4)} aria-label="Мельче">
          <Minus size={15} />
        </button>
        <button className="btn ghost sm icon" onClick={() => zoomAt(box.w / 2, box.h / 2, 1.4)} aria-label="Крупнее">
          <Plus size={15} />
        </button>
        <button className="btn ghost sm" onClick={fit} title="Вписать схему в окно">
          <Maximize size={14} />
          Вписать
        </button>
      </div>

      <div className="layers-main">
        <div className="layers-canvas" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => ((drag.current = null), setStroke(null))}
            onPointerLeave={() => setHover(null)}
            onContextMenu={(e) => e.preventDefault()}
          />
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
          <div className="layers-hint faint small">
            ЛКМ — заменить · ПКМ (можно провести) — убрать · колесо — масштаб · перетаскивание — сдвиг · ↑↓ — слои ·
            Ctrl+Z — отмена
          </div>
          {menu && info && (
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
              <ItemPicker small autoFocus placeholder="Заменить на…" onPick={(it) => apply(it.i)} />
              <div className="row">
                <button className="btn sm danger" onClick={() => apply(REMOVE)}>
                  <Trash2 size={14} />
                  Убрать
                </button>
                {scope === 'all' && replace.has(info.name) && (
                  <button className="btn ghost sm" onClick={() => (onSetTarget(info.name, null), setMenu(null))}>
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
