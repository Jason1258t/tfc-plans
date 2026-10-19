import { ChevronDown, ChevronUp, Download, FlipHorizontal2, RotateCcw } from 'lucide-react';
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { iconUrl, itemName, useItems, type ItemIndex } from '../lib/items';
import {
  alternatives,
  blockForm,
  materials,
  mbName,
  mbSlug,
  MOD_LABEL,
  useMultiblocks,
  type MbForm,
  type MbManual,
  type MbShape,
  type Multiblock,
  type MultiblockData,
} from '../lib/multiblocks';
import { machineRates, usePower, useSettings, type PowerData, type Setting } from '../lib/power';
import { sourceName, useTags } from '../lib/tags';
import { cx } from '../lib/util';
import { ItemIcon } from './ItemIcon';
import './MultiblocksTab.css';

/**
 * Справочник → «Мультиблоки»: структуры IE и Advanced TFC Tech как в книге инженера — объёмный вид, слои,
 * блок для удара молотом, материалы с допустимыми заменами, расход энергии и рецепты машины.
 * Данные — scripts/mods/multiblocks.mjs (шаблоны и код из jar сборки).
 */

const HAMMER = 'immersiveengineering:hammer';

/** Иконка машины; у блоков с объёмной моделью (верстак, молниетвод) её нет — тогда самый частый блок структуры */
function mbIcon(m: Multiblock, items: ItemIndex | null): string | null {
  if (m.block && items?.byId.get(m.block)?.t) return m.block;
  return materials(m).find((x) => items?.byId.get(x.state.id)?.t)?.state.id ?? m.block;
}

export function MultiblocksTab({ slug, onSlug }: { slug: string | null; onSlug: (s: string | null) => void }) {
  const data = useMultiblocks();
  const items = useItems();
  if (data === undefined) return <div className="empty">Загружаю мультиблоки…</div>;
  if (data === null) return <div className="empty">Мультиблоки не собраны — выполните npm run mods</div>;
  const current =
    data.list.find((m) => mbSlug(m, data.list) === slug) ?? data.list.find((m) => m.id === slug) ?? data.list[0];
  const groups = [...new Set(data.list.map((m) => m.ns))];
  return (
    <div className="botany">
      <nav className="botany-nav mb-nav" aria-label="Мультиблоки">
        {groups.map((ns) => (
          <div key={ns} className="mb-nav-group">
            <div className="mb-nav-mod faint small">{MOD_LABEL[ns] ?? ns}</div>
            {data.list
              .filter((m) => m.ns === ns)
              .map((m) => (
                <button
                  key={m.id}
                  className={cx(m === current && 'active')}
                  onClick={() => onSlug(m === data.list[0] ? null : mbSlug(m, data.list))}
                >
                  <span className="mb-nav-item">
                    <ItemIcon id={mbIcon(m, items) ?? undefined} size={18} tip={false} />
                    {mbName(m)}
                  </span>
                </button>
              ))}
          </div>
        ))}
      </nav>
      <div className="botany-main">
        <MultiblockCard key={current.id} m={current} data={data} />
      </div>
    </div>
  );
}

function MultiblockCard({ m, data }: { m: Multiblock; data: MultiblockData }) {
  const [full, setFull] = useState(false);
  const shape: MbShape = full && m.extra ? m.extra : m;
  const trigger = full ? null : m.trigger;
  const [sx, sy, sz] = shape.size;
  const count = shape.blocks.length;
  const triggerState = trigger
    ? shape.palette[
        shape.blocks.find((b) => b[0] === trigger[0] && b[1] === trigger[1] && b[2] === trigger[2])?.[3] ?? -1
      ]
    : undefined;
  const items = useItems();

  return (
    <div className="mb-card">
      <section className="ref-card">
        <div className="mb-head">
          <ItemIcon id={mbIcon(m, items) ?? undefined} size={40} />
          <div className="grow">
            <h2>{mbName(m)}</h2>
            <div className="faint small">
              {m.name.ru && m.name.en !== m.name.ru ? `${m.name.en} · ` : ''}
              {MOD_LABEL[m.ns] ?? m.ns} · {sx}×{sy}×{sz} (ширина × высота × глубина) · блоков {count}
            </div>
          </div>
          <a className="btn ghost" href={`${import.meta.env.BASE_URL}multiblocks/${shape.nbt}`} download>
            <Download size={15} /> Схема .nbt
          </a>
        </div>
        {m.replaces && (
          <p className="mb-note">
            Шаблон заменён модом <b>{sourceName(m.source)}</b>: здесь показан его вариант, а не исходный из{' '}
            {sourceName(m.replaces)}.
          </p>
        )}
        <ol className="mb-steps">
          <li>
            Поставьте блоки по слоям снизу вверх (см. схему ниже). Пустые клетки — любые: воздух или что угодно, IE их
            не проверяет.
          </li>
          {triggerState && trigger && (
            <li>
              Встаньте <b>со стороны лицевой грани</b> (на схеме — снизу) и ударьте <ItemIcon id={HAMMER} size={18} />{' '}
              молотом инженера по блоку <b>{itemName(items?.byId.get(triggerState.id), triggerState.id)}</b> — слой{' '}
              {trigger[1] + 1}, подсвечен рамкой. Конструкция повернётся к вам той стороной, по которой ударили.
            </li>
          )}
          <li>
            {m.mirror
              ? 'Можно строить и зеркально (лево ↔ право) — IE примет оба варианта.'
              : 'Только как на схеме: зеркальный вариант эта печь не принимает.'}
          </li>
        </ol>
        {m.extra && (
          <div className="seg mb-full-toggle" role="tablist">
            <button aria-pressed={!full} onClick={() => setFull(false)}>
              Сама машина
            </button>
            <button aria-pressed={full} onClick={() => setFull(true)}>
              Целиком (как в книге)
            </button>
          </div>
        )}
        <MbViewer key={String(full)} m={m} shape={shape} trigger={trigger} />
      </section>
      <Materials m={m} shape={shape} data={data} />
      <MachineInfo m={m} />
      {m.manual.map((e) => (
        <ManualEntry key={`${e.ns}:${e.entry}`} e={e} m={m} />
      ))}
    </div>
  );
}

/** Объёмный вид и слой сверху с ползунком слоёв и зеркалом — в карточке и в виджете гайда */
function MbViewer({ m, shape, trigger }: { m: Multiblock; shape: MbShape; trigger: [number, number, number] | null }) {
  const [mirrored, setMirrored] = useState(false);
  const sy = shape.size[1];
  const [layer, setLayer] = useState(sy - 1);
  const top = Math.min(layer, sy - 1);
  return (
    <>
      <div className="mb-toolbar">
        {m.mirror && (
          <button className={cx('btn ghost', mirrored && 'active')} onClick={() => setMirrored((v) => !v)}>
            <FlipHorizontal2 size={15} /> {mirrored ? 'Зеркально' : 'Как в книге'}
          </button>
        )}
        <div className="mb-layer-ctl">
          <button
            className="btn sm icon"
            aria-label="Слой ниже"
            title="Слой ниже"
            disabled={top <= 0}
            onClick={() => setLayer(top - 1)}
          >
            <ChevronDown size={16} />
          </button>
          <input
            type="range"
            min={0}
            max={sy - 1}
            value={top}
            onChange={(e) => setLayer(Number(e.target.value))}
            aria-label="Слой"
          />
          <button
            className="btn sm icon"
            aria-label="Слой выше"
            title="Слой выше"
            disabled={top >= sy - 1}
            onClick={() => setLayer(top + 1)}
          >
            <ChevronUp size={16} />
          </button>
          <span className="small">
            слой {top + 1} из {sy}
          </span>
        </div>
      </div>
      <div className="mb-views">
        <Iso shape={shape} trigger={trigger} upTo={top} mirrored={mirrored} />
        <LayerGrid shape={shape} trigger={trigger} y={top} mirrored={mirrored} />
      </div>
    </>
  );
}

/**
 * Виджет гайда «::multiblock id=crusher [full] [materials]»: структура в статье — заголовок со ссылкой на карточку
 * во вкладке «Мультиблоки», объёмный вид и слои; materials — ещё таблица материалов.
 */
export function MultiblockEmbed({ id, full, withMaterials }: { id: string; full?: boolean; withMaterials?: boolean }) {
  const data = useMultiblocks();
  const items = useItems();
  if (data === undefined) return <div className="empty">Загружаю мультиблок…</div>;
  const m = data?.list.find((x) => x.id === id || x.id.split(':')[1] === id);
  if (!data || !m)
    return (
      <div className="empty">
        Нет мультиблока «{id}»{data ? `: ${data.list.map((x) => mbSlug(x, data.list)).join(', ')}` : ''}
      </div>
    );
  const shape: MbShape = full && m.extra ? m.extra : m;
  const trigger = full && m.extra ? null : m.trigger;
  const t = trigger && shape.blocks.find((b) => b[0] === trigger[0] && b[1] === trigger[1] && b[2] === trigger[2]);
  const triggerId = t ? shape.palette[t[3]].id : null;
  return (
    <div className="mb-embed">
      <div className="mb-head">
        <ItemIcon id={mbIcon(m, items) ?? undefined} size={28} />
        <div className="grow">
          <Link to={`/reference?tab=multiblocks&mb=${encodeURIComponent(mbSlug(m, data.list))}`}>
            <b>{mbName(m)}</b>
          </Link>
          <div className="faint small">
            {shape.size.join('×')} · блоков {shape.blocks.length}
            {triggerId && (
              <>
                {' '}
                · молотом — по «{itemName(items?.byId.get(triggerId), triggerId)}» на слое {trigger![1] + 1}
              </>
            )}
          </div>
        </div>
      </div>
      <MbViewer m={m} shape={shape} trigger={trigger} />
      {withMaterials && <Materials m={m} shape={shape} data={data} />}
    </div>
  );
}

// ---------------------------------------------------------------- объёмный вид

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
}: {
  shape: MbShape;
  trigger: [number, number, number] | null;
  upTo: number;
  mirrored: boolean;
}) {
  const items = useItems();
  const [rot, setRot] = useState({ yaw: -35, pitch: -28 });
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const [sx, sy, sz] = shape.size;
  // Размер клетки — по диагонали структуры, чтобы при любом повороте она помещалась в окно
  const S = Math.max(10, Math.min(44, Math.floor(270 / Math.hypot(sx, sy, sz))));
  const forms = useMemo(() => shape.palette.map(blockForm), [shape]);
  const cubes = useMemo(() => {
    const set = new Set<string>();
    for (const b of shape.blocks) if (b[1] <= upTo && forms[b[3]] === 'cube') set.add(`${b[0]},${b[1]},${b[2]}`);
    return set;
  }, [shape, forms, upTo]);

  const onDown = (e: ReactPointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ...rot };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setRot({
      yaw: d.yaw + (e.clientX - d.x) * 0.5,
      pitch: Math.max(-89, Math.min(10, d.pitch - (e.clientY - d.y) * 0.4)),
    });
  };

  return (
    <div
      className="mb-iso"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <div className="mb-iso-scene" style={{ transform: `rotateX(${rot.pitch}deg) rotateY(${rot.yaw}deg)` }}>
        <div
          className="mb-iso-floor"
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
          const url = iconUrl(items?.byId.get(state.id));
          const faces = (Object.keys(FACE_SHADE) as Face[]).filter((f) => {
            if (form !== 'cube') return true;
            const [dx, dy, dz] = NEIGHBOR[f];
            return !cubes.has(`${b[0] + (mirrored ? -dx : dx)},${b[1] + dy},${b[2] + dz}`);
          });
          if (!faces.length) return null;
          return (
            <Cube
              key={i}
              S={S}
              pos={[(x - sx / 2 + 0.5) * S, -(b[1] - sy / 2 + 0.5) * S, (b[2] - sz / 2 + 0.5) * S]}
              form={form}
              faces={faces}
              url={url}
              trigger={isTrigger}
              current={b[1] === upTo && upTo < sy - 1}
            />
          );
        })}
      </div>
      <button
        className="btn ghost icon mb-iso-reset"
        aria-label="Вернуть вид"
        onClick={() => setRot({ yaw: -35, pitch: -28 })}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <RotateCcw size={14} />
      </button>
      <span className="mb-iso-hint faint small">тяните, чтобы повернуть</span>
    </div>
  );
}

function Cube({
  S,
  pos,
  form,
  faces,
  url,
  trigger,
  current,
}: {
  S: number;
  pos: [number, number, number];
  form: MbForm;
  faces: Face[];
  url: string | null;
  trigger: boolean;
  current: boolean;
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
        className="mb-face"
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
      className={cx('mb-cube', trigger && 'trigger', current && 'current', !url && 'noicon')}
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
}: {
  shape: MbShape;
  trigger: [number, number, number] | null;
  y: number;
  mirrored: boolean;
}) {
  const [sx, , sz] = shape.size;
  const cell = Math.max(22, Math.min(36, Math.floor(300 / Math.max(sx, sz))));
  const at = new Map<string, number>();
  for (const b of shape.blocks) if (b[1] === y) at.set(`${mirrored ? sx - 1 - b[0] : b[0]},${b[2]}`, b[3]);
  const tx = trigger ? (mirrored ? sx - 1 - trigger[0] : trigger[0]) : -1;
  return (
    <div className="mb-layer">
      <div className="mb-grid" style={{ gridTemplateColumns: `repeat(${sx}, ${cell}px)` }}>
        {Array.from({ length: sz }, (_, z) =>
          Array.from({ length: sx }, (_, x) => {
            const p = at.get(`${x},${z}`);
            const isTrigger = !!trigger && trigger[1] === y && tx === x && trigger[2] === z;
            return (
              <div key={`${x},${z}`} className={cx('mb-cell', p === undefined && 'empty', isTrigger && 'trigger')}>
                {p !== undefined && <ItemIcon id={shape.palette[p].id} size={cell - 6} />}
              </div>
            );
          }),
        )}
      </div>
      <div className="mb-front faint small">▼ лицевая сторона — здесь стоит игрок</div>
    </div>
  );
}

// ---------------------------------------------------------------- материалы

function Materials({ m, shape, data }: { m: Multiblock; shape: MbShape; data: MultiblockData }) {
  const items = useItems();
  const tags = useTags();
  const [open, setOpen] = useState<string | null>(null);
  const list = materials(shape);
  return (
    <section className="ref-card">
      <h3 className="mb-h">Материалы</h3>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th>Блок</th>
              <th className="num">Штук</th>
              <th>Чем можно заменить</th>
            </tr>
          </thead>
          <tbody>
            {list.map(({ state, count }) => {
              const alt = tags ? alternatives(tags, data, m, state.id) : null;
              return (
                <tr key={state.id}>
                  <td>
                    <span className="mb-mat">
                      <ItemIcon id={state.id} size={22} />
                      <span>
                        {itemName(items?.byId.get(state.id), state.id)}
                        <span className="faint small"> {state.id}</span>
                      </span>
                    </span>
                  </td>
                  <td className="num">{count}</td>
                  <td>
                    {alt ? (
                      <>
                        <button
                          className="mb-linkbtn small"
                          onClick={() => setOpen(open === state.id ? null : state.id)}
                        >
                          любой из #{alt.tag} ({alt.members.length})
                        </button>
                        {open === state.id && (
                          <div className="mb-alts">
                            {alt.members.map((id) => (
                              <ItemIcon key={id} id={id} size={22} />
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="faint small">только этот</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="faint small">
        Замены — по коду IE: блок из тега-заменителя (хранилища и листовой металл по металлам, стальные и алюминиевые
        леса и заборы, обработанное дерево) подходит вместо любого блока того же тега; состав тегов — с правками KubeJS
        сборки. Направление и форма блока (ступенька лесов, сторона плиты) IE не проверяет. «Схема .nbt» — шаблон IE в
        формате структуры Minecraft: его можно положить в папку schematics и строить схематичной пушкой Create (в игре
        не проверялось).
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- энергия и рецепты

const num = (v: number | null, digits = 0) =>
  v !== null && Number.isFinite(v)
    ? (Math.round(v * 10 ** digits) / 10 ** digits).toLocaleString('ru-RU', { maximumFractionDigits: digits })
    : '—';

function useConfigGet(power: PowerData | null | undefined) {
  const ie = useSettings(power?.ie?.file, power?.ie?.keys);
  const att = useSettings(power?.att?.file, power?.att?.keys);
  return { ie: ie.get, att: att.get };
}

function MachineInfo({ m }: { m: Multiblock }) {
  const power = usePower();
  const cfg = useConfigGet(power);
  const machine = power?.ie?.consumers?.machines.find((x) => x.block === m.block);
  const device = power?.ie?.consumers?.devices.find((x) => x.block === m.block);
  if (!machine && !device && !m.recipes.length) return null;
  const r = machine ? machineRates(machine, machine.mod === 'att' ? cfg.att : cfg.ie) : null;
  return (
    <section className="ref-card">
      <h3 className="mb-h">Работа</h3>
      {machine && r && (
        <p>
          Расход: <b>{r.min === r.max ? num(r.min) : `${num(r.min)}–${num(r.max)}`} FE/t</b> на операцию
          {r.min !== r.max && <> (обычно {num(r.median)})</>}
          {machine.parallel && machine.parallel > 1 ? `, одновременно до ${machine.parallel} операций` : ''} — по
          рецептам модов и настройкам сервера. <Link to="/reference?tab=power&sub=ie">Все потребители IE →</Link>
        </p>
      )}
      {device && (
        <p>
          Расход:{' '}
          {device.draws.map((d, i) => {
            const v = cfg.ie(d.key)?.value ?? null;
            return (
              <span key={d.key}>
                {i > 0 && ', '}
                <b>
                  {num(v)} {d.kind === 'action' ? 'FE' : 'FE/t'}
                </b>
                {d.note ? ` ${d.note}` : ''}
              </span>
            );
          })}
          . <Link to="/reference?tab=power&sub=ie">Все потребители IE →</Link>
        </p>
      )}
      {m.recipes.length > 0 && (
        <p>
          Рецепты:{' '}
          {m.recipes.map((x, i) => (
            <span key={x.t}>
              {i > 0 && ' · '}
              <Link to={`/recipes?type=${encodeURIComponent(x.t)}`}>
                {x.t} ({x.n})
              </Link>
            </span>
          ))}{' '}
          <span className="faint small">— число по модам; что убрал KubeJS, видно в каталоге.</span>
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- книга

function ManualEntry({ e, m }: { e: MbManual; m: Multiblock }) {
  const power = usePower();
  const cfg = useConfigGet(power);
  const [showEn, setShowEn] = useState(false);
  const fromOther = e.ns !== m.ns;
  const resolve = (key: string): Setting | null => {
    for (const [keys, get] of [
      [power?.ie?.keys, cfg.ie],
      [power?.att?.keys, cfg.att],
    ] as const) {
      const k = keys?.find((x) => x.key === key || x.key.endsWith(`.${key}`))?.key;
      if (k) return get(k);
    }
    return null;
  };
  const text = showEn && e.en ? e.en : e.text;
  return (
    <section className={cx('ref-card', fromOther && 'mb-other')}>
      <div className="mb-manual-head">
        <h3 className="mb-h">
          {fromOther ? `Изменение: ${sourceName(e.jar)}` : 'Из книги инженера'} — {e.title}
        </h3>
        {e.subtitle && <span className="faint small">«{e.subtitle}»</span>}
        {e.lang === 'en' && <span className="faint small">· по-английски, как в игре</span>}
        {e.en && (
          <button className="mb-linkbtn small" onClick={() => setShowEn((v) => !v)}>
            {showEn ? 'по-русски' : 'оригинал'}
          </button>
        )}
      </div>
      <div className="mb-manual">
        {text.split('\n\n').map((para, i) => (
          <p key={i}>
            {para.split(/(\{config:[^}]+\})/).map((part, j) => {
              const c = part.match(/^\{config:([^}]+)\}$/);
              if (!c) return part;
              const s = resolve(c[1]);
              return s ? (
                <b key={j}>{num(s.value, 2)}</b>
              ) : (
                <span key={j} className="faint" title={`Настройка ${c[1]} — нет в конфиге`}>
                  [?]
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </section>
  );
}
