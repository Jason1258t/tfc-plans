import { ArrowRight, Search } from 'lucide-react';
import { SectionShell, Segmented, Select, Card, CardHead, Table, TableWrap } from '@/shared/ui';
import { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { BotanyTab } from './tabs/BotanyTab';
import { DishesTab } from './tabs/DishesTab';
import { MealsTab } from './tabs/MealsTab';
import { mealsByItem, useMeals, type Meals } from '@/lib/meals';
import { useTags, ItemIcon, itemName, useItems, type ItemIndex } from '@/shared/pack-data';
import { LiquidFuelTab } from './tabs/LiquidFuelTab';
import { MapPage } from '@/pages/map';
import { MultiblocksTab } from '@/features/reference-tabs';
import { GuidesTab } from './tabs/GuidesTab';
import { GUIDES_SUBS, type GuidesSub } from '@/features/guides';
import { PowerTab } from './tabs/PowerTab';
import { POWER_SUBS, type PowerSub } from '@/lib/power';
import type { BotanySub } from '@/lib/botany';
import {
  formatTicks,
  GRADE_LABEL,
  ingotOf,
  metalName,
  methodLabel,
  NUTRIENTS,
  useReference,
  veinTypeLabel,
  veinVariant,
  type Food,
  type Fuel,
  type Nutrient,
  type Reference,
  type Vein,
} from '@/lib/reference';
import { cx } from '@/shared/lib';
import { useSearchTrack } from '@/shared/api';
import './ReferenceShared.css';
import shell from './ReferenceShell.module.css';
import styles from './ReferencePage.module.css';

type Tab = 'ores' | 'fuel' | 'metals' | 'food' | 'botany' | 'power' | 'multiblocks' | 'guides' | 'map';
const TABS: { id: Tab; label: string }[] = [
  { id: 'ores', label: 'Руды' },
  { id: 'fuel', label: 'Топливо' },
  { id: 'metals', label: 'Металлы' },
  { id: 'food', label: 'Еда' },
  { id: 'botany', label: 'Ботаника' },
  { id: 'power', label: 'Электричество' },
  { id: 'multiblocks', label: 'Мультиблоки' },
  { id: 'guides', label: 'Гайды' },
  { id: 'map', label: 'Карта' },
];

/** Справочник по данным сборки: жилы руд, топливо, еда, температуры металлов */
export function ReferencePage() {
  const [params] = useSearchParams();
  // Прежние адреса: аддоны — теперь своя страница, гайды электричества — вкладка «Гайды»
  if (params.get('tab') === 'addons') {
    const rest = new URLSearchParams(params);
    rest.delete('tab');
    return <Navigate to={`/addons${rest.size ? `?${rest}` : ''}`} replace />;
  }
  if (params.get('tab') === 'power' && params.get('sub') === 'guides') {
    const g = params.get('g');
    return <Navigate to={`/reference?tab=guides${g ? `&g=${encodeURIComponent(g)}` : ''}`} replace />;
  }
  return <Reference />;
}

function Reference() {
  const [params, setParams] = useSearchParams();
  // tab=liquid — прежний адрес жидкого топлива, теперь это подраздел «Топлива»
  const oldLiquid = params.get('tab') === 'liquid';
  const tab = oldLiquid ? 'fuel' : ((TABS.find((t) => t.id === params.get('tab'))?.id ?? 'ores') as Tab);
  const liquid = oldLiquid || (tab === 'fuel' && params.get('sub') === 'liquid');
  const ref = useReference();
  const items = useItems();
  const meals = useMeals();
  const mealCount = meals
    ? meals.families.length + meals.computed.length + (meals.dynamic?.length ?? 0) + (meals.skillet ? 1 : 0)
    : 0;

  return (
    <main className={cx(shell.page, tab === 'map' && shell.pageWide)}>
      <div className={shell.head}>
        <div className="grow">
          <h1>Справочник</h1>
          <p className="faint small">
            Данные из jar сборки; еда, металлы и плавка руд — с учётом датапака и скриптов KubeJS сборки. Остальное, что
            сервер переопределяет датапаком или KubeJS, здесь не видно.
          </p>
        </div>
      </div>
      <Segmented
        role="tablist"
        tabs
        className={styles.tabs}
        value={tab}
        onChange={(id) => setParams(id === 'ores' ? {} : { tab: id }, { replace: true })}
        options={TABS.map((t) => ({ value: t.id, label: t.label }))}
      />
      {tab === 'map' ? (
        <MapPage />
      ) : tab === 'guides' ? (
        <GuidesTab
          sub={GUIDES_SUBS.find((s) => s.id === params.get('sub'))?.id ?? 'power'}
          onSub={(k: GuidesSub) =>
            setParams(k === 'power' ? { tab: 'guides' } : { tab: 'guides', sub: k }, { replace: true })
          }
          guide={params.get('g')}
          onGuide={(g) => {
            const next: Record<string, string> = { tab: 'guides' };
            const sub = params.get('sub');
            if (sub && sub !== 'power' && GUIDES_SUBS.some((s) => s.id === sub)) next.sub = sub;
            if (g) next.g = g;
            setParams(next);
          }}
        />
      ) : tab === 'multiblocks' ? (
        <MultiblocksTab
          slug={params.get('mb')}
          onSlug={(mb) => setParams(mb ? { tab: 'multiblocks', mb } : { tab: 'multiblocks' }, { replace: true })}
        />
      ) : tab === 'power' ? (
        <PowerTab
          sub={POWER_SUBS.find((s) => s.id === params.get('sub'))?.id ?? 'link'}
          onSub={(k: PowerSub) =>
            setParams(k === 'link' ? { tab: 'power' } : { tab: 'power', sub: k }, { replace: true })
          }
        />
      ) : ref === undefined ? (
        <div className="empty">Загружаю справочник…</div>
      ) : ref === null ? (
        <div className="empty">Справочник не собран — выполните npm run mods</div>
      ) : tab === 'ores' ? (
        <OresTab ref_={ref} items={items} />
      ) : tab === 'fuel' ? (
        <SectionShell
          navLabel="Разделы топлива"
          nav={
            <>
              <button className={cx(!liquid && 'active')} onClick={() => setParams({ tab: 'fuel' }, { replace: true })}>
                <span>Твёрдое</span>
                <span className="faint small">{ref.fuels.length}</span>
              </button>
              <button
                className={cx(liquid && 'active')}
                onClick={() => setParams({ tab: 'fuel', sub: 'liquid' }, { replace: true })}
              >
                <span>Жидкое</span>
                <span className="faint small">{ref.liquid?.families.length ?? ''}</span>
              </button>
            </>
          }
        >
          <div className={shell.fuelMain}>
            {!liquid ? (
              <FuelTab fuels={ref.fuels} items={items} />
            ) : ref.liquid ? (
              <LiquidFuelTab families={ref.liquid.families} items={items} />
            ) : (
              <div className="empty">Справочник собран старой версией — выполните npm run mods</div>
            )}
          </div>
        </SectionShell>
      ) : tab === 'food' ? (
        <SectionShell
          navLabel="Разделы еды"
          nav={
            <>
              <button
                className={cx(params.get('sub') !== 'meals' && params.get('sub') !== 'dishes' && 'active')}
                onClick={() => setParams({ tab: 'food' }, { replace: true })}
              >
                <span>Продукты</span>
                <span className="faint small">{ref.foods.length}</span>
              </button>
              <button
                className={cx(params.get('sub') === 'meals' && 'active')}
                onClick={() => setParams({ tab: 'food', sub: 'meals' }, { replace: true })}
              >
                <span>Сборные блюда</span>
                <span className="faint small">{mealCount || ''}</span>
              </button>
              <button
                className={cx(params.get('sub') === 'dishes' && 'active')}
                onClick={() => setParams({ tab: 'food', sub: 'dishes' }, { replace: true })}
              >
                <span>Готовые блюда</span>
              </button>
            </>
          }
        >
          <div className={shell.fuelMain}>
            {params.get('sub') === 'meals' ? (
              <MealsTab items={items} foods={ref.foods} initialQuery={params.get('q') ?? ''} />
            ) : params.get('sub') === 'dishes' ? (
              <DishesTab items={items} foods={ref.foods} />
            ) : (
              <FoodTab foods={ref.foods} items={items} meals={meals ?? null} />
            )}
          </div>
        </SectionShell>
      ) : tab === 'botany' ? (
        <BotanyTab
          foods={ref.foods}
          sub={
            (['crop', 'bush', 'tree', 'plant', 'greenhouse'] as const).find((k) => k === params.get('sub')) ?? 'crop'
          }
          onSub={(k: BotanySub) =>
            setParams(k === 'crop' ? { tab: 'botany' } : { tab: 'botany', sub: k }, { replace: true })
          }
        />
      ) : (
        <MetalsTab ref_={ref} items={items} />
      )}
    </main>
  );
}

const lower = (s: string | undefined) => (s ?? '').toLowerCase().replaceAll('ё', 'е');
/** Совпадение по основе слов (первые 4 буквы): «олово» находит «оловянный» */
function matches(hay: string, query: string) {
  const words = lower(query).split(/\s+/).filter(Boolean);
  return words.every((w) => hay.includes(w.length > 4 ? w.slice(0, Math.max(4, w.length - 2)) : w));
}
const nameHay = (ids: string[], items: ItemIndex | null) =>
  lower(ids.map((id) => `${id} ${items?.byId.get(id)?.e ?? ''} ${items?.byId.get(id)?.r ?? ''}`).join(' '));

// ---------------------------------------------------------------- руды

interface MineralGroup {
  mineral: string;
  /** Предмет для иконки и названия */
  main: string;
  veins: Vein[];
  hay: string;
}

function OresTab({ ref_, items }: { ref_: Reference; items: ItemIndex | null }) {
  const [query, setQuery] = useState('');
  const [rock, setRock] = useState('');
  const [showRocks, setShowRocks] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, MineralGroup>();
    for (const v of ref_.veins) {
      if (v.kind === 'other') continue;
      for (const m of v.minerals) {
        const g = map.get(m.mineral) ?? { mineral: m.mineral, main: '', veins: [], hay: '' };
        if (!g.veins.includes(v)) g.veins.push(v);
        const main =
          m.items.find((i) => i.grade === 'normal') ?? m.items.find((i) => i.grade === 'single') ?? m.items[0];
        if (!g.main && main) g.main = main.item;
        map.set(m.mineral, g);
      }
    }
    for (const g of map.values()) {
      const ids = new Set<string>([g.main]);
      for (const v of g.veins)
        for (const m of v.minerals) if (m.mineral === g.mineral) m.items.forEach((i) => ids.add(i.item));
      // Металл на выходе тоже участвует в поиске: «олово» найдёт касситерит
      const chainEnd = ref_.chains[g.main]?.at(-1)?.item;
      const smelt = ref_.smelt[chainEnd ?? g.main];
      const ingot = smelt ? ingotOf(smelt.fluid, items) : null;
      if (ingot) ids.add(ingot);
      g.veins.sort((a, b) => (a.minY ?? 0) - (b.minY ?? 0));
      g.hay = nameHay([...ids], items) + ' ' + lower(smelt?.fluid);
    }
    return [...map.values()].sort((a, b) =>
      itemName(items?.byId.get(a.main), a.main).localeCompare(itemName(items?.byId.get(b.main), b.main), 'ru'),
    );
  }, [ref_, items]);

  const rocks = useMemo(() => {
    const set = new Set<string>();
    for (const v of ref_.veins) if (v.kind === 'ore') v.rocks.forEach((r) => set.add(r));
    return [...set].sort((a, b) =>
      itemName(items?.byId.get(a), a).localeCompare(itemName(items?.byId.get(b), b), 'ru'),
    );
  }, [ref_, items]);

  const [yMin, yMax] = useMemo(() => {
    const ys = ref_.veins.flatMap((v) => [v.minY ?? 0, v.maxY ?? 0]);
    return [Math.min(...ys), Math.max(...ys)];
  }, [ref_]);

  const visible = groups
    .filter((g) => showRocks || g.veins.some((v) => v.kind === 'ore'))
    .filter((g) => !query.trim() || matches(g.hay, query))
    .map((g) => ({ ...g, veins: rock ? g.veins.filter((v) => v.rocks.includes(rock)) : g.veins }))
    .filter((g) => g.veins.length);
  useSearchTrack('ores', query, visible.length);

  return (
    <>
      <div className={shell.filters}>
        <label className={cx(shell.search, 'grow')} data-tour="ref-search">
          <Search size={15} className="faint" />
          <input
            placeholder="Руда или металл: касситерит, олово, железо…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Select value={rock} onChange={(e) => setRock(e.target.value)} aria-label="Порода">
          <option value="">Любая порода</option>
          {rocks.map((r) => (
            <option key={r} value={r}>
              {itemName(items?.byId.get(r), r)}
            </option>
          ))}
        </Select>
        <label className={cx('row', 'small', styles.check)}>
          <input type="checkbox" checked={showRocks} onChange={(e) => setShowRocks(e.target.checked)} />
          Дайки и гравий
        </label>
      </div>
      <p className={cx('faint', 'small', shell.note)}>
        Редкость — в среднем одна жила на столько чанков. Высоты — Y, где может начинаться жила. Руду в этой сборке не
        плавят напрямую: путь до металла показан цепочкой.
      </p>
      {visible.length === 0 ? (
        <div className="empty">Ничего не найдено</div>
      ) : (
        <div className={shell.minerals}>
          {visible.map((g) => (
            <MineralCard key={g.mineral} group={g} ref_={ref_} items={items} yRange={[yMin, yMax]} rock={rock} />
          ))}
        </div>
      )}
    </>
  );
}

function MineralCard({
  group,
  ref_,
  items,
  yRange,
  rock,
}: {
  group: MineralGroup;
  ref_: Reference;
  items: ItemIndex | null;
  yRange: [number, number];
  rock: string;
}) {
  const chain = ref_.chains[group.main];
  const end = chain?.at(-1)?.item ?? group.main;
  const smelt = ref_.smelt[end];
  const ingot = smelt ? ingotOf(smelt.fluid, items) : null;
  const grades = group.veins[0].minerals.find((m) => m.mineral === group.mineral)?.items ?? [];
  // Руда плавится сама (без цепочки): выход металла зависит от сорта
  const direct = chain ? [] : grades.filter((i) => ref_.smelt[i.item]);

  return (
    <Card>
      <CardHead>
        <ItemIcon id={group.main} size={32} />
        <div className="grow">
          <h2>{itemName(items?.byId.get(group.main), group.main)}</h2>
          <div className={styles.grades}>
            {grades.map((i) => (
              <span key={i.item} className={styles.grade} title={itemName(items?.byId.get(i.item), i.item)}>
                <ItemIcon id={i.item} size={18} />
                {GRADE_LABEL[i.grade]}
              </span>
            ))}
          </div>
        </div>
        {smelt && (
          <div className={styles.metal} title={smelt.fluid}>
            {ingot && <ItemIcon id={ingot} size={24} />}
            <div>
              <div>{metalName(smelt.fluid, items)}</div>
              <div className="faint small">плавится при {Math.round(smelt.temp)} °C</div>
            </div>
          </div>
        )}
      </CardHead>

      {(chain || (smelt && direct.length > 0)) && (
        <div className={styles.chain} aria-label="Путь до металла">
          <ItemIcon id={group.main} size={22} />
          {(chain ?? []).map((s) => (
            <span key={s.item} className={styles.step}>
              <span className={styles.stepArrow}>
                <ArrowRight size={14} />
                <span className="faint small">{s.methods.map(methodLabel).join(' / ')}</span>
              </span>
              <ItemIcon id={s.item} size={22} />
            </span>
          ))}
          {smelt && (
            <span className={styles.step}>
              <span className={styles.stepArrow}>
                <ArrowRight size={14} />
                <span
                  className="faint small"
                  title={
                    direct.length > 1
                      ? direct.map((i) => `${GRADE_LABEL[i.grade]} — ${ref_.smelt[i.item].mb} mB`).join(', ')
                      : undefined
                  }
                >
                  нагрев {Math.round(smelt.temp)} °C,{' '}
                  {direct.length > 1 ? direct.map((i) => ref_.smelt[i.item].mb).join(' / ') : smelt.mb} mB
                </span>
              </span>
              {ingot ? <ItemIcon id={ingot} size={22} /> : <code className="small">{smelt.fluid}</code>}
            </span>
          )}
        </div>
      )}

      <div className={styles.veinsWrap}>
        <table className={styles.veins}>
          <thead>
            <tr>
              <th>Жила</th>
              <th>Высота Y</th>
              <th>Редкость</th>
              <th>Состав</th>
              <th>Размер</th>
              <th>Породы</th>
            </tr>
          </thead>
          <tbody>
            {group.veins.map((v) => (
              <tr key={v.id}>
                <td>
                  <div>{veinVariant(v)}</div>
                  <div className="faint small" title={`${v.id} · ${v.source}`}>
                    {veinTypeLabel(v.type)}
                    {v.indicator?.blocks[0] && (
                      <>
                        {' · признак '}
                        <span className={styles.indicator} title="Признак на поверхности">
                          <ItemIcon id={v.indicator.blocks[0]} size={16} />
                        </span>
                      </>
                    )}
                  </div>
                </td>
                <td>
                  <YBar min={v.minY} max={v.maxY} range={yRange} />
                </td>
                <td>{v.rarity ? `1 / ${v.rarity}` : '—'}</td>
                <td>
                  <Shares items={v.minerals.find((m) => m.mineral === group.mineral)?.items ?? []} />
                </td>
                <td>
                  {v.size ?? v.radius ?? '—'}
                  {v.density != null && <span className="faint small"> · {Math.round(v.density * 100)}%</span>}
                </td>
                <td>
                  <div className={styles.rocks}>
                    {v.rocks.map((r) => (
                      <span key={r} data-active={rock === r}>
                        <ItemIcon id={r} size={18} />
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Доли сортов в жиле: «15 · 25 · 60» с цветом сорта */
function Shares({ items }: { items: { item: string; grade: string; share: number }[] }) {
  if (items.length <= 1) return <span className="faint">—</span>;
  return (
    <span className={styles.shares}>
      {items.map((i) => (
        <span key={i.item} data-grade={i.grade} title={GRADE_LABEL[i.grade as keyof typeof GRADE_LABEL]}>
          {i.share}%
        </span>
      ))}
    </span>
  );
}

function YBar({ min, max, range }: { min: number | null; max: number | null; range: [number, number] }) {
  if (min == null || max == null) return <span className="faint">—</span>;
  const span = range[1] - range[0] || 1;
  return (
    <div className={styles.y}>
      <span>
        {min}…{max}
      </span>
      <div className={styles.yTrack} aria-hidden>
        <div
          className={styles.yFill}
          style={{ left: `${((min - range[0]) / span) * 100}%`, width: `${((max - min) / span) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- топливо

function IngredientCell({ ids, label, items }: { ids: string[]; label: string | null; items: ItemIndex | null }) {
  const first = ids[0];
  return (
    <div className={shell.ing}>
      {first ? <ItemIcon id={first} size={24} /> : <span className={shell.ingBlank} />}
      <div className={shell.ingName}>
        <span>{first ? itemName(items?.byId.get(first), first) : (label ?? '?')}</span>
        {ids.length > 1 && (
          <span className="faint small" title={ids.map((i) => itemName(items?.byId.get(i), i)).join(', ')}>
            {label?.startsWith('#') ? `${label} · ` : ''}ещё {ids.length - 1}
          </span>
        )}
      </div>
    </div>
  );
}

type SortDir = { key: string; desc: boolean };
function useSort(initial: SortDir) {
  const [sort, setSort] = useState(initial);
  const toggle = (key: string) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }));
  const th = (key: string, label: string, className?: string) => (
    <th
      key={key}
      className={cx('sortable', className)}
      onClick={() => toggle(key)}
      aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined}
    >
      {label}
      {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </th>
  );
  return { sort, th };
}

function sortBy<T>(list: T[], get: (x: T) => number | string, desc: boolean) {
  return [...list].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, 'ru') : Number(x) - Number(y);
    return desc ? -c : c;
  });
}

function FuelTab({ fuels, items }: { fuels: Fuel[]; items: ItemIndex | null }) {
  const [query, setQuery] = useState('');
  const { sort, th } = useSort({ key: 'temp', desc: true });
  const name = (f: Fuel) => itemName(items?.byId.get(f.items[0]), f.items[0] ?? f.ingredient ?? '');
  const list = sortBy(
    fuels.filter((f) => !query.trim() || matches(nameHay(f.items, items) + lower(f.ingredient ?? ''), query)),
    (f) =>
      sort.key === 'name' ? name(f) : (((f as unknown as Record<string, number | null>)[sort.key] ?? 0) as number),
    sort.desc,
  );
  useSearchTrack('fuel', query, list.length);
  return (
    <>
      <div className={cx(shell.filters, shell.filtersEnd)}>
        <label className={cx(shell.search, 'grow')} data-tour="ref-search">
          <Search size={15} className="faint" />
          <input placeholder="Уголь, кокс, торф…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <p className={cx('faint', 'small', shell.note)}>
        Для горна, костра и печей TFC (дерево и деревянные изделия не показываются). Чистота влияет на то, насколько
        топливо годится для горна (меньше — больше дыма и ниже эффективность).
      </p>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              {th('name', 'Топливо')}
              {th('temp', 'Температура')}
              {th('duration', 'Горит')}
              {th('purity', 'Чистота')}
            </tr>
          </thead>
          <tbody>
            {list.map((f) => (
              <tr key={f.id}>
                <td>
                  <IngredientCell ids={f.items} label={f.ingredient} items={items} />
                </td>
                <td className="num">{f.temp != null ? `${Math.round(f.temp)} °C` : '—'}</td>
                <td className="num">{formatTicks(f.duration)}</td>
                <td className="num">{f.purity != null ? `${Math.round(f.purity * 100)}%` : '100%'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </>
  );
}

// ---------------------------------------------------------------- еда

const NUTRIENT_LABEL: Record<Nutrient, string> = {
  grain: 'Зерно',
  fruit: 'Фрукты',
  vegetables: 'Овощи',
  protein: 'Белок',
  dairy: 'Молочное',
};

function FoodTab({ foods, items, meals }: { foods: Food[]; items: ItemIndex | null; meals: Meals | null }) {
  // В какие сборные блюда годится продукт — те же связи, что в ботанике
  const tags = useTags();
  const fits = useMemo(
    () => (meals && tags ? mealsByItem(meals, tags, (id) => itemName(items?.byId.get(id), id)) : null),
    [meals, tags, items],
  );
  const mealsOf = (f: Food) => [...new Set(f.items.flatMap((id) => (fits?.get(id) ?? []).map((r) => r.title)))];
  const [query, setQuery] = useState('');
  const [nutrient, setNutrient] = useState<Nutrient | ''>('');
  const { sort, th } = useSort({ key: 'hunger', desc: true });
  const name = (f: Food) => itemName(items?.byId.get(f.items[0]), f.items[0] ?? f.ingredient ?? '');
  const value = (f: Food): number | string => {
    if (sort.key === 'name') return name(f);
    if ((NUTRIENTS as readonly string[]).includes(sort.key)) return f.nutrients[sort.key as Nutrient] ?? 0;
    return (f as unknown as Record<string, number>)[sort.key] ?? 0;
  };
  const list = sortBy(
    foods
      .filter((f) => !nutrient || (f.nutrients[nutrient] ?? 0) > 0)
      .filter((f) => !query.trim() || matches(nameHay(f.items, items) + lower(f.ingredient ?? ''), query)),
    value,
    sort.desc,
  );
  useSearchTrack('food', query, list.length);
  return (
    <>
      <div className={cx(shell.filters, shell.filtersEnd)}>
        <label className={cx(shell.search, 'grow')} data-tour="ref-search">
          <Search size={15} className="faint" />
          <input placeholder="Хлеб, говядина, ягоды…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Select
          value={nutrient}
          onChange={(e) => setNutrient(e.target.value as Nutrient | '')}
          aria-label="Питательная группа"
        >
          <option value="">Все группы</option>
          {NUTRIENTS.map((n) => (
            <option key={n} value={n}>
              {NUTRIENT_LABEL[n]}
            </option>
          ))}
        </Select>
      </div>
      <p className={cx('faint', 'small', shell.note)}>
        Порча — множитель скорости: больше 1 портится быстрее. {list.length} из {foods.length}.
      </p>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              {th('name', 'Еда')}
              {th('hunger', 'Сытость')}
              {th('saturation', 'Насыщ.')}
              {th('water', 'Вода')}
              {NUTRIENTS.map((n) => th(n, NUTRIENT_LABEL[n], `nut nut-${n}`))}
              {th('decay', 'Порча')}
              <th title="В какие сборные блюда годится продукт">В блюда</th>
            </tr>
          </thead>
          <tbody>
            {list.map((f) => (
              <tr key={f.id}>
                <td>
                  <IngredientCell ids={f.items} label={f.ingredient} items={items} />
                </td>
                <td className="num">{f.hunger || '—'}</td>
                <td className="num">{f.saturation || '—'}</td>
                <td className="num">{f.water || '—'}</td>
                {NUTRIENTS.map((n) => (
                  <td key={n} className={cx('num nut', `nut-${n}`, !f.nutrients[n] && 'zero')}>
                    {f.nutrients[n] ?? '·'}
                  </td>
                ))}
                <td className={cx('num', f.decay > 1.5 && 'warn')}>×{f.decay}</td>
                <td className="num">
                  {mealsOf(f).length > 0 ? (
                    <Link
                      to={`/reference?tab=food&sub=meals&q=${encodeURIComponent(name(f))}`}
                      title={mealsOf(f).join('\n')}
                    >
                      {mealsOf(f).length}
                    </Link>
                  ) : (
                    <span className="zero">·</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </>
  );
}

// ---------------------------------------------------------------- металлы

function MetalsTab({ ref_, items }: { ref_: Reference; items: ItemIndex | null }) {
  const [query, setQuery] = useState('');
  const { sort, th } = useSort({ key: 'melt', desc: false });
  const rows = ref_.metals.map((m) => {
    const ingot = m.fluid ? ingotOf(m.fluid, items) : null;
    return { ...m, ingot, name: m.fluid ? metalName(m.fluid, items) : m.id };
  });
  const list = sortBy(
    rows.filter((m) => !query.trim() || matches(lower(`${m.name} ${m.fluid} ${m.id}`), query)),
    (m) => (sort.key === 'name' ? m.name : (m.melt ?? 0)),
    sort.desc,
  );
  useSearchTrack('metals', query, list.length);
  return (
    <>
      <div className={shell.filters}>
        <label className={cx(shell.search, 'grow')} data-tour="ref-search">
          <Search size={15} className="faint" />
          <input placeholder="Медь, бронза, сталь…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              {th('name', 'Металл')}
              {th('melt', 'Плавится при')}
              <th>Жидкость</th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td>
                  <div className={shell.ing}>
                    {m.ingot ? <ItemIcon id={m.ingot} size={24} /> : <span className={shell.ingBlank} />}
                    <span>{m.name}</span>
                    {m.source.startsWith('kubejs/') && (
                      <span
                        className="kjs-badge added"
                        title={
                          m.modMelt != null
                            ? `Изменено датапаком сборки (${m.source}); в моде — ${Math.round(m.modMelt)} °C`
                            : `Из датапака сборки (${m.source})`
                        }
                      >
                        kubejs/data
                      </span>
                    )}
                  </div>
                </td>
                <td className="num">{m.melt != null ? `${Math.round(m.melt)} °C` : '—'}</td>
                <td>
                  <code className="faint small">{m.fluid}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </>
  );
}
