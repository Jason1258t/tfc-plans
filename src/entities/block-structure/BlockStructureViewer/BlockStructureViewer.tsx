import { ChevronDown, ChevronUp, FlipHorizontal2, RotateCcw, X } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { blockEntry, iconUrl, itemName, ItemIcon, useItems } from '@/shared/pack-data';
import { cx } from '@/shared/lib';
import { Button, Segmented } from '@/shared/ui';
import type { ParsedNbt } from '@tfc/core/nbt';
import { SchematicView3D, viewSchematic, type Vec } from '@/entities/schematic';
import { blockForm, materials, nbtFromShape, type BlockForm, type BlockShape, type BlockState } from '../model';
import styles from './BlockStructureViewer.module.css';

/** Больше блоков запасной CSS-3D не тянет (каждая видимая грань — элемент): тогда только слои */
const ISO_LIMIT = 3000;

/** Есть ли WebGL: без него — запасной вид на CSS 3D (грубые формы, иконки на гранях) */
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Выделяем блок вместе с такими же: копикаты — по материалу */
const keyOf = (s: BlockState) => (s.m ? `${s.id}|${s.m}` : s.id);
const iconOf = (s: BlockState) => s.m ?? s.id;

export interface ViewerAlt {
  /** Подпись второй вкладки вида («Итог» у мультиблока IE) */
  label: string;
  render: (mirrored: boolean) => ReactNode;
}

/**
 * Блочная структура по слоям: объёмный вид (поворот мышью/пальцем) и слой сверху с осями, ползунок слоёв,
 * выделение блока (щелчок по клетке, кубу или материалу — подсвечены все такие же, внизу название, свойства и
 * координаты), материалы. Общий для мультиблоков IE, схем библиотеки и построек в гайдах.
 */
export function BlockStructureViewer({
  shape,
  trigger = null,
  initialLayer,
  mirror,
  alt,
  withMaterials,
  nbt,
  name = 'structure',
}: {
  shape: BlockShape;
  /** Исходный файл структуры (схема из библиотеки) — объёмный вид рисует по нему; нет — собирается из shape */
  nbt?: ParsedNbt;
  /** Имя для 3D-вида (ключ кеша) */
  name?: string;
  /** Клетка, которую подсвечиваем рамкой (блок для удара молотом IE) */
  trigger?: [number, number, number] | null;
  initialLayer?: number;
  /** Можно строить зеркально — кнопка «Зеркально» */
  mirror?: boolean;
  alt?: ViewerAlt;
  withMaterials?: boolean;
}) {
  const [mirrored, setMirrored] = useState(false);
  const [view, setView] = useState<'build' | 'alt'>('build');
  const sy = shape.size[1];
  const [layer, setLayer] = useState(initialLayer ?? sy - 1);
  const [picked, setPicked] = useState<{ key: string; at?: [number, number, number] } | null>(null);
  const top = Math.max(0, Math.min(layer, sy - 1));
  const showAlt = view === 'alt' && !!alt;
  const pick = (state: BlockState, at?: [number, number, number]) =>
    setPicked((p) => (p?.key === keyOf(state) && !at ? null : { key: keyOf(state), at }));
  const pickAt = (b: [number, number, number, number]) => pick(shape.palette[b[3]], [b[0], b[1], b[2]]);
  const [gl, setGl] = useState(hasWebGL);
  const schematic = useMemo(() => viewSchematic(nbt ?? nbtFromShape(shape), name), [nbt, shape, name]);
  /** Выделенные: все блоки того же вида — подсветка в 3D */
  const pickedPos = useMemo(
    () =>
      picked
        ? shape.blocks.filter((b) => keyOf(shape.palette[b[3]]) === picked.key).map((b) => [b[0], b[1], b[2]] as Vec)
        : [],
    [picked, shape],
  );
  const pickPos = (pos: Vec | null) => {
    const b = pos && shape.blocks.find((x) => x[0] === pos[0] && x[1] === pos[1] && x[2] === pos[2]);
    if (b) pickAt(b);
  };
  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar}>
        {alt && (
          <Segmented
            role="tablist"
            label="Вид"
            value={showAlt}
            onChange={(v) => setView(v ? 'alt' : 'build')}
            options={[
              { value: false, label: 'Постройка' },
              { value: true, label: alt.label },
            ]}
          />
        )}
        {mirror && (
          <Button variant="ghost" className={cx(mirrored && styles.on)} onClick={() => setMirrored((v) => !v)}>
            <FlipHorizontal2 size={15} /> {mirrored ? 'Зеркально' : 'Как в книге'}
          </Button>
        )}
        {!showAlt && (
          <div className={styles.layerCtl}>
            <Button
              size="sm"
              icon
              aria-label="Слой ниже"
              title="Слой ниже"
              disabled={top <= 0}
              onClick={() => setLayer(top - 1)}
            >
              <ChevronDown size={16} />
            </Button>
            <input
              type="range"
              min={0}
              max={sy - 1}
              value={top}
              onChange={(e) => setLayer(Number(e.target.value))}
              aria-label="Слой"
              aria-valuetext={`слой ${top + 1} из ${sy}`}
            />
            <Button
              size="sm"
              icon
              aria-label="Слой выше"
              title="Слой выше"
              disabled={top >= sy - 1}
              onClick={() => setLayer(top + 1)}
            >
              <ChevronUp size={16} />
            </Button>
            <span className="small" aria-live="polite">
              слой {top + 1} из {sy}
            </span>
          </div>
        )}
      </div>
      {showAlt ? (
        alt.render(mirrored)
      ) : (
        <>
          <div className={styles.views}>
            {gl ? (
              <div className={styles.glView}>
                <SchematicView3D
                  viewer
                  schematic={schematic}
                  maxY={top < sy - 1 ? top : undefined}
                  textured
                  selected={pickedPos}
                  trigger={trigger}
                  mirrored={mirrored}
                  onPick={pickPos}
                  onFail={() => shape.blocks.length <= ISO_LIMIT && setGl(false)}
                />
                <span className={cx(styles.isoHint, 'faint', 'small')}>
                  тяните — повернуть, Ctrl+колесо или щипок — масштаб, щелчок — выделить блок
                </span>
              </div>
            ) : shape.blocks.length <= ISO_LIMIT ? (
              <Iso
                shape={shape}
                trigger={trigger}
                upTo={top}
                mirrored={mirrored}
                picked={picked?.key ?? null}
                onPick={pickAt}
              />
            ) : (
              <div className={cx(styles.iso, styles.isoOff, 'empty')}>
                Блоков {shape.blocks.length} — объёмный вид не рисую, смотрите слои
              </div>
            )}
            <LayerGrid
              shape={shape}
              trigger={trigger}
              y={top}
              mirrored={mirrored}
              picked={picked?.key ?? null}
              onPick={pickAt}
            />
          </div>
          {picked && <PickedInfo shape={shape} picked={picked} onClose={() => setPicked(null)} />}
        </>
      )}
      {withMaterials && <MaterialList shape={shape} picked={picked?.key ?? null} onPick={(s) => pick(s)} />}
    </div>
  );
}

// ---------------------------------------------------------------- выделенный блок

function PickedInfo({
  shape,
  picked,
  onClose,
}: {
  shape: BlockShape;
  picked: { key: string; at?: [number, number, number] };
  onClose: () => void;
}) {
  const items = useItems();
  const states = shape.palette.filter((s) => keyOf(s) === picked.key);
  const at = picked.at;
  const here = at && shape.blocks.find((b) => b[0] === at[0] && b[1] === at[1] && b[2] === at[2]);
  const state = here ? shape.palette[here[3]] : states[0];
  if (!state) return null;
  const count = shape.blocks.filter((b) => keyOf(shape.palette[b[3]]) === picked.key).length;
  const props = Object.entries(state.p ?? {}).filter(([k]) => k !== 'waterlogged' || state.p?.[k] === 'true');
  return (
    <div className={styles.pickedInfo} role="status">
      <ItemIcon id={iconOf(state)} size={28} />
      <div className="grow">
        <b>{itemName(items?.byId.get(state.id), state.id)}</b>
        {state.m && <> · материал «{itemName(items?.byId.get(state.m), state.m)}»</>}
        <span className="faint small"> {state.id}</span>
        <div className="small">
          {at && (
            <>
              x {at[0]} · y {at[1]} (слой {at[1] + 1}) · z {at[2]} ·{' '}
            </>
          )}
          всего {count}
          {props.length > 0 && <span className="faint"> · {props.map(([k, v]) => `${k}=${v}`).join(', ')}</span>}
        </div>
      </div>
      <Button variant="ghost" icon size="sm" aria-label="Снять выделение" onClick={onClose}>
        <X size={14} />
      </Button>
    </div>
  );
}

function MaterialList({
  shape,
  picked,
  onPick,
}: {
  shape: BlockShape;
  picked: string | null;
  onPick: (s: BlockState) => void;
}) {
  const items = useItems();
  const list = useMemo(() => materials(shape), [shape]);
  return (
    <div className={styles.materials}>
      <div className="faint small">Материалы — нажмите, чтобы найти на схеме</div>
      {/* Не ul/li: внутри статьи их перехватывают стили Markdown (маркеры, отступы) */}
      <div role="list" className={styles.matList}>
        {list.map(({ state, count }) => (
          <div role="listitem" key={keyOf(state)}>
            <button
              type="button"
              aria-pressed={picked === keyOf(state)}
              className={cx(styles.mat, picked === keyOf(state) && styles.on)}
              onClick={() => onPick(state)}
            >
              <ItemIcon id={iconOf(state)} size={22} tip={false} />
              <span className="grow">
                {itemName(items?.byId.get(state.id), state.id)}
                {state.m && <span className="faint"> · {itemName(items?.byId.get(state.m), state.m)}</span>}
              </span>
              <b>{count}</b>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- объёмный вид

/** Ширина элемента; 0 — ещё не измерили */
function useWidth(ref: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

const FACE_SHADE = { top: 1, bottom: 0.45, front: 0.85, back: 0.7, left: 0.75, right: 0.6 };
type Face = keyof typeof FACE_SHADE;
const NEIGHBOR: Record<Face, [number, number, number]> = {
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
};

function Iso({
  shape,
  trigger,
  upTo,
  mirrored,
  picked,
  onPick,
}: {
  shape: BlockShape;
  trigger: [number, number, number] | null;
  upTo: number;
  mirrored: boolean;
  picked: string | null;
  onPick: (b: [number, number, number, number]) => void;
}) {
  const items = useItems();
  const [rot, setRot] = useState({ yaw: -35, pitch: -28 });
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null);
  const [sx, sy, sz] = shape.size;
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  // Размер клетки — по диагонали структуры, чтобы при любом повороте она помещалась в окно (и в узкую колонку)
  const fit = Math.min(270, width ? width * 0.8 : 270);
  const S = Math.max(4, Math.min(44, Math.floor(fit / Math.hypot(sx, sy, sz))));
  const forms = useMemo(() => shape.palette.map(blockForm), [shape]);
  const cubes = useMemo(() => {
    const set = new Set<string>();
    for (const b of shape.blocks) if (b[1] <= upTo && forms[b[3]] === 'cube') set.add(`${b[0]},${b[1]},${b[2]}`);
    return set;
  }, [shape, forms, upTo]);

  const onDown = (e: ReactPointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ...rot, moved: false };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
    setRot({
      yaw: d.yaw + (e.clientX - d.x) * 0.5,
      pitch: Math.max(-89, Math.min(10, d.pitch - (e.clientY - d.y) * 0.4)),
    });
  };
  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    // Щелчок без поворота — выделить блок под курсором
    const i = Number((e.target as Element).closest?.('[data-b]')?.getAttribute('data-b'));
    if (Number.isInteger(i) && shape.blocks[i]) onPick(shape.blocks[i]);
  };

  return (
    <div
      ref={box}
      className={styles.iso}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => (drag.current = null)}
      role="img"
      aria-label={`Объёмный вид ${sx}×${sy}×${sz}, показаны слои 1–${upTo + 1}`}
    >
      <div className={styles.isoScene} style={{ transform: `rotateX(${rot.pitch}deg) rotateY(${rot.yaw}deg)` }}>
        <div
          className={styles.isoFloor}
          style={{
            width: sx * S,
            height: sz * S,
            transform: `translate(-50%, -50%) translateY(${(sy / 2) * S}px) rotateX(90deg)`,
          }}
        >
          <span>▼ лицевая сторона</span>
        </div>
        {shape.blocks.map((b, i) => {
          if (b[1] > upTo) return null;
          const state = shape.palette[b[3]];
          const form = forms[b[3]];
          const x = mirrored ? sx - 1 - b[0] : b[0];
          const isTrigger = !!trigger && b[0] === trigger[0] && b[1] === trigger[1] && b[2] === trigger[2];
          const url = iconUrl(blockEntry(items, iconOf(state)));
          const faces = (Object.keys(FACE_SHADE) as Face[]).filter((f) => {
            if (form !== 'cube') return true;
            const [dx, dy, dz] = NEIGHBOR[f];
            return !cubes.has(`${b[0] + (mirrored ? -dx : dx)},${b[1] + dy},${b[2] + dz}`);
          });
          if (!faces.length) return null;
          return (
            <Cube
              key={i}
              index={i}
              S={S}
              pos={[(x - sx / 2 + 0.5) * S, -(b[1] - sy / 2 + 0.5) * S, (b[2] - sz / 2 + 0.5) * S]}
              form={form}
              faces={faces}
              url={url}
              trigger={isTrigger}
              current={b[1] === upTo && upTo < sy - 1}
              picked={picked !== null && keyOf(state) === picked}
              dim={picked !== null && keyOf(state) !== picked}
            />
          );
        })}
      </div>
      <Button
        variant="ghost"
        icon
        className={styles.isoReset}
        aria-label="Вернуть вид"
        onClick={() => setRot({ yaw: -35, pitch: -28 })}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <RotateCcw size={14} />
      </Button>
      <span className={cx(styles.isoHint, 'faint', 'small')}>тяните, чтобы повернуть; щелчок — выделить блок</span>
    </div>
  );
}

function Cube({
  index,
  S,
  pos,
  form,
  faces,
  url,
  trigger,
  current,
  picked,
  dim,
}: {
  index: number;
  S: number;
  pos: [number, number, number];
  form: BlockForm;
  faces: Face[];
  url: string | null;
  trigger: boolean;
  current: boolean;
  picked: boolean;
  dim: boolean;
}) {
  const w = form === 'post' ? S * 0.375 : S;
  const h = form === 'slab-bottom' || form === 'slab-top' ? S / 2 : S;
  const dy = form === 'slab-bottom' ? S / 4 : form === 'slab-top' ? -S / 4 : 0;
  const face = (f: Face) => {
    const [fw, fh] = f === 'top' || f === 'bottom' ? [w, w] : [w, h];
    const t = {
      front: `translateZ(${w / 2}px)`,
      back: `rotateY(180deg) translateZ(${w / 2}px)`,
      right: `rotateY(90deg) translateZ(${w / 2}px)`,
      left: `rotateY(-90deg) translateZ(${w / 2}px)`,
      top: `rotateX(90deg) translateZ(${h / 2}px)`,
      bottom: `rotateX(-90deg) translateZ(${h / 2}px)`,
    }[f];
    return (
      <div
        key={f}
        className={styles.face}
        style={{
          width: fw,
          height: fh,
          marginLeft: -fw / 2,
          marginTop: -fh / 2,
          transform: t,
          backgroundImage: url ? `url(${url})` : undefined,
          filter: `brightness(${FACE_SHADE[f]})`,
        }}
      />
    );
  };
  return (
    <div
      data-b={index}
      className={cx(
        styles.cube,
        trigger && styles.trigger,
        current && styles.current,
        !url && styles.noicon,
        picked && styles.picked,
        dim && styles.dim,
      )}
      style={{ transform: `translate3d(${pos[0]}px, ${pos[1] + dy}px, ${pos[2]}px)` }}
    >
      {faces.map(face)}
    </div>
  );
}

// ---------------------------------------------------------------- слой сверху

function LayerGrid({
  shape,
  trigger,
  y,
  mirrored,
  picked,
  onPick,
}: {
  shape: BlockShape;
  trigger: [number, number, number] | null;
  y: number;
  mirrored: boolean;
  picked: string | null;
  onPick: (b: [number, number, number, number]) => void;
}) {
  const items = useItems();
  const [sx, , sz] = shape.size;
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  // Клетка — чтобы слой влез в колонку (минус подписи оси z); меньше 16 px — прокрутка вбок
  const room = width ? Math.min(300, width - 44) : 300;
  const cell = Math.max(16, Math.min(36, Math.floor(room / sx), Math.floor(300 / Math.max(sx, sz))));
  const at = new Map<string, [number, number, number, number]>();
  for (const b of shape.blocks) if (b[1] === y) at.set(`${mirrored ? sx - 1 - b[0] : b[0]},${b[2]}`, b);
  const tx = trigger ? (mirrored ? sx - 1 - trigger[0] : trigger[0]) : -1;
  // Подписи осей: у широких схем — каждая пятая
  const step = Math.max(sx, sz) > 16 ? 5 : 1;
  const label = (n: number) => (n % step === 0 ? n : '');
  return (
    <div ref={box} className={styles.layer}>
      <div
        className={styles.grid}
        style={{ gridTemplateColumns: `auto repeat(${sx}, ${cell}px)` }}
        role="grid"
        aria-label={`Слой ${y + 1}, вид сверху`}
      >
        <span className={styles.axis} aria-hidden>
          z\x
        </span>
        {Array.from({ length: sx }, (_, x) => (
          <span key={`x${x}`} className={styles.axis} aria-hidden>
            {label(mirrored ? sx - 1 - x : x)}
          </span>
        ))}
        {Array.from({ length: sz }, (_, z) => [
          <span key={`z${z}`} className={styles.axis} aria-hidden>
            {label(z)}
          </span>,
          ...Array.from({ length: sx }, (_, x) => {
            const b = at.get(`${x},${z}`);
            const isTrigger = !!trigger && trigger[1] === y && tx === x && trigger[2] === z;
            if (!b)
              return (
                <div
                  key={`${x},${z}`}
                  className={cx(styles.cell, 'empty', isTrigger && styles.trigger)}
                  style={{ width: cell }}
                />
              );
            const state = shape.palette[b[3]];
            const isPicked = picked !== null && keyOf(state) === picked;
            return (
              <button
                type="button"
                key={`${x},${z}`}
                className={cx(
                  styles.cell,
                  isTrigger && styles.trigger,
                  isPicked && styles.picked,
                  picked !== null && !isPicked && styles.dim,
                )}
                style={{ width: cell }}
                aria-label={`${itemName(items?.byId.get(state.id), state.id)}, x ${b[0]}, z ${b[2]}`}
                onClick={() => onPick(b)}
              >
                <ItemIcon id={iconOf(state)} size={cell - 6} />
              </button>
            );
          }),
        ])}
      </div>
      <div className={cx(styles.front, 'faint', 'small')}>▼ лицевая сторона (+z) — здесь стоит игрок</div>
    </div>
  );
}
