import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { blockEntry, isBlock, itemName, useItems } from '@/shared/pack-data';
import { EMPTY_BLOCKS, REMOVE, type Schematic } from '@/lib/schematic';
import { buildGrid, cellInfo, editCells, namesByState, propsByState, revertEdits, stateOf } from '@/lib/schematicEdit';
import type { ReplaceFavorite } from '@/entities/schematic';
import { cx } from '@/shared/lib';
import type { Menu } from '../model/useLayerPointer';
import { useLayerHistory } from '../model/layerHistory';
import { useLayerKeys } from '../model/useLayerKeys';
import { useLayerPointer } from '../model/useLayerPointer';
import { useLayerSelection } from '../model/layerSelection';
import { MAX_ZOOM, MIN_ZOOM, paintLayer } from './layerCanvas';
import { SchematicHoverInfo } from './SchematicHoverInfo';
import { SchematicLayerLegend } from './SchematicLayerLegend';
import { SchematicLayerMenu, type Scope } from './SchematicLayerMenu';
import { SchematicLayers3D } from './SchematicLayers3D';
import { SchematicLayersHead } from './SchematicLayersHead';
import { SchematicLayersToolbar } from './SchematicLayersToolbar';
import { SchematicSelectionPanel } from './SchematicSelectionPanel';
import styles from './SchematicLayers.module.css';

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
  const [menu, setMenu] = useState<Menu | null>(null);
  const [scope, setScope] = useState<Scope>('cell');
  const [highlight, setHighlight] = useState<string | null>(null);
  /** 3D: блок под курсором (индекс в списке blocks, -1 — нет) */
  const [hover3d, setHover3d] = useState(-1);

  const [, redraw] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const layer = grid.layers.get(layerY);
  const below = grid.layers.get(layerY - 1);
  const effective = useCallback((name: string) => replace.get(name) ?? name, [replace]);
  const indexAt = (x: number, z: number) => (x >= 0 && z >= 0 && x < sx && z < sz ? (layer?.[x + z * sx] ?? -1) : -1);

  const closeMenu = useCallback(() => setMenu(null), []);
  const { undoList, redoList, changeCells, setGlobal, undo, redo, canRevert } = useLayerHistory(
    s,
    replace,
    onChange,
    onSetTarget,
    closeMenu,
  );
  const selection = useLayerSelection({
    s,
    names,
    grid,
    effective,
    favorites,
    items,
    smartTargets,
    changeCells,
    closeMenu,
  });
  const pointer = useLayerPointer({
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
    selected: selection.selected,
    menu,
    setMenu,
    toggle: selection.toggle,
    selectClick: selection.selectClick,
    selectOnly: selection.selectOnly,
    setSelection: selection.setSelection,
    clearSelection: selection.clearSelection,
    resetClick: selection.resetClick,
    setSelNote: selection.setSelNote,
  });
  useLayerKeys({
    s,
    menu,
    setMenu,
    selected: selection.selected,
    clearSelection: selection.clearSelection,
    changeCells,
    undo,
    redo,
    sy,
    setY,
    onClose,
  });

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
    paintLayer({
      canvas,
      box,
      view,
      sx,
      sz,
      schematic: s,
      names,
      props,
      layer,
      below,
      ghost,
      items,
      effective,
      stroke: pointer.stroke,
      highlight,
      selected: selection.selected,
      hover: pointer.hover,
      menu,
      area: pointer.area,
      again: () => redraw((n) => n + 1),
    });
  });

  // ---------------------------------------------------------------- окно замены

  const menuIdx = menu ? indexAt(menu.x, menu.z) : -1;
  const info = menuIdx >= 0 ? cellInfo(s, menuIdx) : null;
  const hoverIdx = mode === '3d' ? hover3d : pointer.hover ? indexAt(pointer.hover.x, pointer.hover.z) : -1;
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

  const menuGroup = info ? selection.groupOf(info.index) : [];
  const menuSelected = info ? selection.selected.has(info.index) : false;

  const selectedOnLayer = layer ? layer.reduce((a, i) => a + (i >= 0 && selection.selected.has(i) ? 1 : 0), 0) : 0;

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
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`Слои схемы ${s.fileName}`}>
      <SchematicLayersHead
        fileName={s.fileName}
        sx={sx}
        sy={sy}
        sz={sz}
        undoCount={undoList.length}
        redoCount={redoList.length}
        canRevert={canRevert}
        onUndo={undo}
        onRedo={redo}
        onRevert={() => confirm('Вернуть все блоки, изменённые в этом редакторе?') && changeCells(revertEdits(s))}
        onClose={onClose}
      />

      <SchematicLayersToolbar
        mode={mode}
        onMode2d={() => setMode('2d')}
        onMode3d={() => (setMode('3d'), setMenu(null))}
        layerY={layerY}
        sy={sy}
        layerTotal={layerTotal}
        onStep={stepY}
        onLayerChange={(v) => {
          setY(v);
          setMenu(null);
        }}
        ghost={ghost}
        onGhost={setGhost}
        cut={cut}
        onCut={setCut}
        textured={textured}
        onTextured={setTextured}
        onZoom={(factor) => zoomAt(box.w / 2, box.h / 2, factor)}
        onFit={fit}
      />

      <div className={styles.main}>
        <div className={styles.canvas} ref={wrapRef}>
          <canvas
            ref={canvasRef}
            onPointerDown={pointer.onPointerDown}
            onPointerMove={pointer.onPointerMove}
            onPointerUp={pointer.onPointerUp}
            onPointerCancel={pointer.onPointerCancel}
            onPointerLeave={pointer.onPointerLeave}
            onContextMenu={(e) => e.preventDefault()}
          />
          {mode === '3d' && (
            <SchematicLayers3D
              schematic={s}
              replace={replace}
              maxY={cut ? layerY : undefined}
              textured={textured}
              selected={selection.selectedPos}
              onPick={pointer.pick3d}
              onHover={(p) => setHover3d(p ? pointer.indexAtPos(p) : -1)}
              onFrame={pointer.frame3d}
            />
          )}
          {hoverInfo && !menu && <SchematicHoverInfo info={hoverInfo} effective={effective} label={shownName} />}
          <div className={cx(styles.hint, 'faint', 'small', mode === '3d' && styles.hidden)}>
            ЛКМ — заменить · двойной клик — выделить группу · Shift+клик или рамка — выделить, повторно — снять · ПКМ
            (можно провести) — убрать · колесо — масштаб · перетаскивание — сдвиг · ↑↓ — слои · Ctrl+Z / Ctrl+Shift+Z —
            отмена и повтор · Delete — убрать выделенное · Esc — снять выделение
          </div>
          <SchematicSelectionPanel
            selectedCount={selection.selected.size}
            selectedOnLayer={selectedOnLayer}
            selNote={selection.selNote}
            smartBusy={selection.smartBusy}
            favoritesCount={favorites.length}
            onDismissNote={() => selection.setSelNote(null)}
            onClear={selection.clearSelection}
            onPick={selection.applySelection}
            onRemove={() => selection.applySelection(REMOVE)}
            onSmart={selection.applySmart}
            onFavorites={selection.applyFavorites}
          />
          {mode === '2d' && menu && info && (
            <SchematicLayerMenu
              menu={menu}
              info={info}
              effective={effective}
              label={shownName}
              replace={replace}
              scope={scope}
              onScope={setScope}
              sameOnLayer={sameOnLayer}
              onPick={apply}
              onClose={() => setMenu(null)}
              menuSelected={menuSelected}
              onToggleSelect={() => {
                if (menuSelected) selection.unselect([info.index]);
                else selection.select([info.index]);
                setMenu(null);
              }}
              onSelectGroup={() => (selection.select(menuGroup), setMenu(null))}
              menuGroupLength={menuGroup.length}
              onRemove={() => apply(REMOVE)}
              onClearGlobal={() => (setGlobal(info.name, null), setMenu(null))}
            />
          )}
        </div>

        <SchematicLayerLegend entries={legend} highlight={highlight} onHighlight={setHighlight} label={shownName} />
      </div>
    </div>,
    document.body,
  );
}
