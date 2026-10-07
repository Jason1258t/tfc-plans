import { ArrowRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ItemIcon } from '../components/ItemIcon';
import { LiquidFuelTab } from '../components/LiquidFuelTab';
import { itemName, useItems, type ItemIndex } from '../lib/items';
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
} from '../lib/reference';
import { cx } from '../lib/util';
import './ReferencePage.css';

type Tab = 'ores' | 'fuel' | 'liquid' | 'food' | 'metals';
const TABS: { id: Tab; label: string }[] = [
  { id: 'ores', label: 'Руды' },
  { id: 'fuel', label: 'Топливо' },
  { id: 'liquid', label: 'Жидкое топливо' },
  { id: 'food', label: 'Еда' },
  { id: 'metals', label: 'Металлы' },
];

/** Справочник по данным сборки: жилы руд, топливо, еда, температуры металлов */
export function ReferencePage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'ores') as Tab;
  const ref = useReference();
  const items = useItems();

  return (
    <main className="ref-page">
      <div className="ref-head">
        <div className="grow">
          <h1>Справочник</h1>
          <p className="faint small">
            Данные из jar сборки. Если сервер что-то переопределяет датапаком или KubeJS — здесь этого не видно.
          </p>
        </div>
      </div>
      <div className="seg ref-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-pressed={tab === t.id}
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === 'ores' ? {} : { tab: t.id }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {ref === undefined ? (
        <div className="empty">Загружаю справочник…</div>
      ) : ref === null ? (
        <div className="empty">Справочник не собран — выполните npm run items</div>
      ) : tab === 'ores' ? (
        <OresTab ref_={ref} items={items} />
      ) : tab === 'fuel' ? (
        <FuelTab fuels={ref.fuels} items={items} />
      ) : tab === 'liquid' ? (
        ref.liquid ? (
          <LiquidFuelTab families={ref.liquid.families} items={items} />
        ) : (
          <div className="empty">Справочник собран старой версией — выполните npm run items</div>
        )
      ) : tab === 'food' ? (
        <FoodTab foods={ref.foods} items={items} />
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

  return (
    <>
      <div className="ref-filters">
        <label className="search grow">
          <Search size={15} className="faint" />
          <input
            placeholder="Руда или металл: касситерит, олово, железо…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select className="input" value={rock} onChange={(e) => setRock(e.target.value)} aria-label="Порода">
          <option value="">Любая порода</option>
          {rocks.map((r) => (
            <option key={r} value={r}>
              {itemName(items?.byId.get(r), r)}
            </option>
          ))}
        </select>
        <label className="row small ref-check">
          <input type="checkbox" checked={showRocks} onChange={(e) => setShowRocks(e.target.checked)} />
          Дайки и гравий
        </label>
      </div>
      <p className="faint small ref-note">
        Редкость — в среднем одна жила на столько чанков. Высоты — Y, где может начинаться жила. Руду в этой сборке не
        плавят напрямую: путь до металла показан цепочкой.
      </p>
      {visible.length === 0 ? (
        <div className="empty">Ничего не найдено</div>
      ) : (
        <div className="ref-minerals">
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

  return (
    <section className="ref-card">
      <header className="ref-card-head">
        <ItemIcon id={group.main} size={32} />
        <div className="grow">
          <h2>{itemName(items?.byId.get(group.main), group.main)}</h2>
          <div className="ref-grades">
            {grades.map((i) => (
              <span key={i.item} className="ref-grade" title={itemName(items?.byId.get(i.item), i.item)}>
                <ItemIcon id={i.item} size={18} />
                {GRADE_LABEL[i.grade]}
              </span>
            ))}
          </div>
        </div>
        {smelt && (
          <div className="ref-metal" title={smelt.fluid}>
            {ingot && <ItemIcon id={ingot} size={24} />}
            <div>
              <div>{metalName(smelt.fluid, items)}</div>
              <div className="faint small">плавится при {Math.round(smelt.temp)} °C</div>
            </div>
          </div>
        )}
      </header>

      {chain && (
        <div className="ref-chain" aria-label="Путь до металла">
          <ItemIcon id={group.main} size={22} />
          {chain.map((s) => (
            <span key={s.item} className="ref-step">
              <span className="ref-step-arrow">
                <ArrowRight size={14} />
                <span className="faint small">{s.methods.map(methodLabel).join(' / ')}</span>
              </span>
              <ItemIcon id={s.item} size={22} />
            </span>
          ))}
          {smelt && (
            <span className="ref-step">
              <span className="ref-step-arrow">
                <ArrowRight size={14} />
                <span className="faint small">
                  нагрев {Math.round(smelt.temp)} °C, {smelt.mb} mB
                </span>
              </span>
              {ingot ? <ItemIcon id={ingot} size={22} /> : <code className="small">{smelt.fluid}</code>}
            </span>
          )}
        </div>
      )}

      <div className="ref-veins-wrap">
        <table className="ref-veins">
          <thead>
            <tr>
              <th>Жила</th>
              <th>Высота Y</th>
              <th>Редкость</th>
              <th>Состав</th>
              <th className="hide-sm">Размер</th>
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
                        <span className="ref-indicator" title="Признак на поверхности">
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
                <td className="hide-sm">
                  {v.size ?? v.radius ?? '—'}
                  {v.density != null && <span className="faint small"> · {Math.round(v.density * 100)}%</span>}
                </td>
                <td>
                  <div className="ref-rocks">
                    {v.rocks.map((r) => (
                      <span key={r} className={cx(rock === r && 'active')}>
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
    </section>
  );
}

/** Доли сортов в жиле: «15 · 25 · 60» с цветом сорта */
function Shares({ items }: { items: { item: string; grade: string; share: number }[] }) {
  if (items.length <= 1) return <span className="faint">—</span>;
  return (
    <span className="ref-shares">
      {items.map((i) => (
        <span key={i.item} className={`grade-${i.grade}`} title={GRADE_LABEL[i.grade as keyof typeof GRADE_LABEL]}>
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
    <div className="ref-y">
      <span>
        {min}…{max}
      </span>
      <div className="ref-y-track" aria-hidden>
        <div
          className="ref-y-fill"
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
    <div className="ref-ing">
      {first ? <ItemIcon id={first} size={24} /> : <span className="ref-ing-blank" />}
      <div className="ref-ing-name">
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
  return (
    <>
      <div className="ref-filters">
        <label className="search grow">
          <Search size={15} className="faint" />
          <input placeholder="Дерево, уголь, торф…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <p className="faint small ref-note">
        Для горна, костра и печей TFC. Чистота влияет на то, насколько топливо годится для горна (меньше — больше дыма и
        ниже эффективность).
      </p>
      <div className="ref-table-wrap">
        <table className="ref-table">
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
        </table>
      </div>
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

function FoodTab({ foods, items }: { foods: Food[]; items: ItemIndex | null }) {
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
  return (
    <>
      <div className="ref-filters">
        <label className="search grow">
          <Search size={15} className="faint" />
          <input placeholder="Хлеб, говядина, ягоды…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select
          className="input"
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
        </select>
      </div>
      <p className="faint small ref-note">
        Порча — множитель скорости: больше 1 портится быстрее. {list.length} из {foods.length}.
      </p>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              {th('name', 'Еда')}
              {th('hunger', 'Сытость')}
              {th('saturation', 'Насыщ.', 'hide-sm')}
              {th('water', 'Вода', 'hide-sm')}
              {NUTRIENTS.map((n) => th(n, NUTRIENT_LABEL[n], `nut nut-${n}`))}
              {th('decay', 'Порча')}
            </tr>
          </thead>
          <tbody>
            {list.map((f) => (
              <tr key={f.id}>
                <td>
                  <IngredientCell ids={f.items} label={f.ingredient} items={items} />
                </td>
                <td className="num">{f.hunger || '—'}</td>
                <td className="num hide-sm">{f.saturation || '—'}</td>
                <td className="num hide-sm">{f.water || '—'}</td>
                {NUTRIENTS.map((n) => (
                  <td key={n} className={cx('num nut', `nut-${n}`, !f.nutrients[n] && 'zero')}>
                    {f.nutrients[n] ?? '·'}
                  </td>
                ))}
                <td className={cx('num', f.decay > 1.5 && 'warn')}>×{f.decay}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  return (
    <>
      <div className="ref-filters">
        <label className="search grow">
          <Search size={15} className="faint" />
          <input placeholder="Медь, бронза, сталь…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              {th('name', 'Металл')}
              {th('melt', 'Плавится при')}
              <th className="hide-sm">Жидкость</th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td>
                  <div className="ref-ing">
                    {m.ingot ? <ItemIcon id={m.ingot} size={24} /> : <span className="ref-ing-blank" />}
                    <span>{m.name}</span>
                  </div>
                </td>
                <td className="num">{m.melt != null ? `${Math.round(m.melt)} °C` : '—'}</td>
                <td className="hide-sm">
                  <code className="faint small">{m.fluid}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
