import { Download } from 'lucide-react';
import { Segmented, ButtonLink, Card, SectionShell, Table, TableWrap, tableStyles } from '@/shared/ui';
import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { BlockStructureViewer } from '@/entities/block-structure';
import { itemName, useItems, type ItemIndex, sourceName, useTags, ItemIcon } from '@/shared/pack-data';
import {
  alternatives,
  materials,
  mbName,
  mbSlug,
  MOD_LABEL,
  useMultiblocks,
  type MbManual,
  type MbShape,
  type Multiblock,
  type MultiblockData,
} from '@/lib/multiblocks';
import { machineRates, usePower, useSettings, type PowerData, type Setting } from '@/lib/power';
import { cx } from '@/shared/lib';
import styles from './MultiblocksTab.module.css';

/**
 * Справочник → «Мультиблоки»: структуры IE и Advanced TFC Tech как в книге инженера — объёмный вид (3D редактора
 * схем: модели блоков из jar), слои,
 * блок для удара молотом, материалы с допустимыми заменами, расход энергии и рецепты машины.
 * Данные — scripts/mods/multiblocks.mjs (шаблоны и код из jar сборки).
 */

const HAMMER = 'immersiveengineering:hammer';

const MultiblockFormed = lazy(() => import('../MultiblockFormed'));

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
    <SectionShell
      navLabel="Мультиблоки"
      nav={
        <>
          {groups.map((ns) => (
            <div key={ns} className={styles.navGroup}>
              <div className={cx(styles.navMod, 'faint', 'small')}>{MOD_LABEL[ns] ?? ns}</div>
              {data.list
                .filter((m) => m.ns === ns)
                .map((m) => (
                  <button
                    key={m.id}
                    aria-pressed={m === current}
                    onClick={() => onSlug(m === data.list[0] ? null : mbSlug(m, data.list))}
                  >
                    <span className={styles.navItem}>
                      <ItemIcon id={mbIcon(m, items) ?? undefined} size={18} tip={false} />
                      {mbName(m)}
                    </span>
                  </button>
                ))}
            </div>
          ))}
        </>
      }
    >
      <div>
        <MultiblockCard key={current.id} m={current} data={data} />
      </div>
    </SectionShell>
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
    <div className={styles.card}>
      <Card>
        <div className={styles.head}>
          <ItemIcon id={mbIcon(m, items) ?? undefined} size={40} />
          <div className="grow">
            <h2>{mbName(m)}</h2>
            <div className="faint small">
              {m.name.ru && m.name.en !== m.name.ru ? `${m.name.en} · ` : ''}
              {MOD_LABEL[m.ns] ?? m.ns} · {sx}×{sy}×{sz} (ширина × высота × глубина) · блоков {count}
            </div>
          </div>
          <ButtonLink variant="ghost" href={`${import.meta.env.BASE_URL}multiblocks/${shape.nbt}`} download>
            <Download size={15} /> Схема .nbt
          </ButtonLink>
        </div>
        {m.replaces && (
          <p className={styles.note}>
            Шаблон заменён модом <b>{sourceName(m.source)}</b>: здесь показан его вариант, а не исходный из{' '}
            {sourceName(m.replaces)}.
          </p>
        )}
        <ol className={styles.steps}>
          <li>
            Поставьте блоки по слоям снизу вверх (см. схему ниже). Пустые клетки — любые: воздух или что угодно, IE их
            не проверяет.
          </li>
          {triggerState && trigger && (
            <li>
              Встаньте <b>со стороны лицевой грани</b> (на схеме — снизу) и ударьте
              <ItemIcon id={HAMMER} size={18} className={styles.stepIcon} /> молотом инженера по блоку{' '}
              <b>{itemName(items?.byId.get(triggerState.id), triggerState.id)}</b> — слой {trigger[1] + 1}, подсвечен
              рамкой. Конструкция повернётся к вам той стороной, по которой ударили.
            </li>
          )}
          <li>
            {m.mirror
              ? 'Можно строить и зеркально (лево ↔ право) — IE примет оба варианта.'
              : 'Только как на схеме: зеркальный вариант эта печь не принимает.'}
          </li>
        </ol>
        {m.extra && (
          <Segmented
            className={styles.fullToggle}
            value={full}
            onChange={setFull}
            options={[
              { value: false, label: 'Сама машина' },
              { value: true, label: 'Целиком (как в книге)' },
            ]}
          />
        )}
        <MbViewer key={String(full)} m={m} shape={shape} trigger={trigger} formedOk={!full} />
      </Card>
      <Materials m={m} shape={shape} data={data} />
      <MachineInfo m={m} />
      {m.manual.map((e) => (
        <ManualEntry key={`${e.ns}:${e.entry}`} e={e} m={m} />
      ))}
    </div>
  );
}

/** Общий просмотр структуры + своё у IE: «Итог» (модель собранной машины), зеркало, блок для молота */
function MbViewer({
  m,
  shape,
  trigger,
  formedOk = true,
}: {
  m: Multiblock;
  shape: MbShape;
  trigger: [number, number, number] | null;
  /** Итоговый вид относится к этой форме (не к «целиком, как в книге») */
  formedOk?: boolean;
}) {
  const formed = formedOk ? m.formed : undefined;
  return (
    <BlockStructureViewer
      shape={shape}
      name={`ie:${shape.nbt}`}
      trigger={trigger}
      mirror={m.mirror}
      alt={
        formed && {
          label: 'Итог',
          render: (mirrored) => (
            <Suspense fallback={<div className={cx(styles.formedFallback, 'empty')}>Загружаю просмотр…</div>}>
              <MultiblockFormed formed={formed} size={shape.size} mirrored={mirrored} />
              <p className={cx('faint', 'small', styles.formedFoot)}>
                Модель собранной машины из jar мода, поставлена на место постройки
                {formed.rough ? ' (совпадение с постройкой неполное)' : ''}. Подвижные части (барабаны, поршни, лопасти)
                мод рисует отдельно — здесь их нет.
              </p>
            </Suspense>
          ),
        }
      }
    />
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
    <div className={styles.embed}>
      <div className={styles.head}>
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
      <MbViewer m={m} shape={shape} trigger={trigger} formedOk={!(full && m.extra)} />
      {withMaterials && <Materials m={m} shape={shape} data={data} />}
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
    <Card>
      <h3 className={styles.h}>Материалы</h3>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <th>Блок</th>
              <th className={tableStyles.numeric}>Штук</th>
              <th>Чем можно заменить</th>
            </tr>
          </thead>
          <tbody>
            {list.map(({ state, count }) => {
              const alt = tags ? alternatives(tags, data, m, state.id) : null;
              return (
                <tr key={state.id}>
                  <td>
                    <span className={styles.mat}>
                      <ItemIcon id={state.id} size={22} />
                      <span>
                        {itemName(items?.byId.get(state.id), state.id)}
                        <span className="faint small"> {state.id}</span>
                      </span>
                    </span>
                  </td>
                  <td className={tableStyles.numeric}>{count}</td>
                  <td>
                    {alt ? (
                      <>
                        <button
                          className={cx(styles.linkbtn, 'small')}
                          onClick={() => setOpen(open === state.id ? null : state.id)}
                        >
                          любой из #{alt.tag} ({alt.members.length})
                        </button>
                        {open === state.id && (
                          <div className={styles.alts}>
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
        </Table>
      </TableWrap>
      <p className="faint small">
        Замены — по коду IE: блок из тега-заменителя (хранилища и листовой металл по металлам, стальные и алюминиевые
        леса и заборы, обработанное дерево) подходит вместо любого блока того же тега; состав тегов — с правками KubeJS
        сборки. Направление и форма блока (ступенька лесов, сторона плиты) IE не проверяет. «Схема .nbt» — шаблон IE в
        формате структуры Minecraft: его можно положить в папку schematics и строить схематичной пушкой Create (в игре
        не проверялось).
      </p>
    </Card>
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
    <Card>
      <h3 className={styles.h}>Работа</h3>
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
    </Card>
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
    <Card className={cx(fromOther && styles.other)}>
      <div className={styles.manualHead}>
        <h3 className={styles.h}>
          {fromOther ? `Изменение: ${sourceName(e.jar)}` : 'Из книги инженера'} — {e.title}
        </h3>
        {e.subtitle && <span className="faint small">«{e.subtitle}»</span>}
        {e.lang === 'en' && <span className="faint small">· по-английски, как в игре</span>}
        {e.en && (
          <button className={cx(styles.linkbtn, 'small')} onClick={() => setShowEn((v) => !v)}>
            {showEn ? 'по-русски' : 'оригинал'}
          </button>
        )}
      </div>
      <div className={styles.manual}>
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
    </Card>
  );
}
