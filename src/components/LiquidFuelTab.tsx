import { ArrowRight, Ban, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { datapacksStore } from '../data/store';
import { itemName, type ItemIndex } from '../lib/items';
import { methodLabel, type EngineStats, type FuelRecipe, type LiquidFamily, type LiquidStack } from '../lib/reference';
import type { Datapack } from '../types';
import { ItemIcon } from './ItemIcon';

/**
 * Жидкое топливо: нефть и её переработка, бензин, дизель, этанол, растительное масло, биодизель.
 * Данные из jar (scripts/reference.mjs): типы топлива Create: Diesel Generators, генератор IE,
 * горелки Create Liquid Fuel и рецепты получения. Семейства — по тегам c:*, поэтому одноимённые
 * жидкости разных модов (этанол IE и CDG) взаимозаменяемы там, где рецепт принимает тег.
 */

/** Порядок семейств: нефть и её продукты, затем био */
const ORDER = [
  'c:crude_oil',
  'c:gasoline',
  'c:diesel',
  'c:ethanol',
  'c:plantoil',
  'c:biodiesel',
  'c:high_power_biodiesel',
];

const stripBucket = (s: string) =>
  s
    .replace(/^Ведро\s+/i, '')
    .replace(/^Bucket of\s+/i, '')
    .replace(/\s+Bucket$/i, '');

function fluidName(f: LiquidFamily['fluids'][number], items: ItemIndex | null): string {
  if (f.name?.ru) return f.name.ru;
  if (f.name?.en) return f.name.en;
  // Без перевода жидкости — по названию ведра («Ведро X» → «X»)
  const bucket = items?.byId.get(f.bucket);
  return bucket ? stripBucket(bucket.r ?? bucket.e) : f.id;
}

/** Название и иконку семейства берём в первую очередь у CDG, затем IE — у них «общие» имена (растительное масло, этанол) */
const PREFERRED = ['createdieselgenerators', 'immersiveengineering'];
const rank = (id: string) => {
  const i = PREFERRED.indexOf(id.split(':')[0]);
  return i < 0 ? PREFERRED.length : i;
};
const byPreference = (fam: LiquidFamily) => [...fam.fluids].sort((a, b) => rank(a.id) - rank(b.id));

const familyName = (fam: LiquidFamily, items: ItemIndex | null) => {
  const n = fluidName(byPreference(fam)[0], items);
  return n.charAt(0).toUpperCase() + n.slice(1);
};

/** Иконка жидкости — ведро с текстурой, по тому же порядку модов */
const familyIcon = (fam: LiquidFamily, items: ItemIndex | null) =>
  byPreference(fam)
    .map((f) => f.bucket)
    .find((b) => items?.byId.get(b)?.t) ?? null;

export function LiquidFuelTab({ families, items }: { families: LiquidFamily[]; items: ItemIndex | null }) {
  const [query, setQuery] = useState('');
  const [packs, setPacks] = useState<Datapack[]>([]);
  useEffect(() => datapacksStore.subscribe(setPacks), []);

  // Рецепты, которые наши датапаки удаляют — пометим в списке «как получить»
  const removedBy = useMemo(() => {
    const m = new Map<string, Datapack>();
    for (const p of packs)
      for (const e of p.entries) if (e.kind === 'remove' && e.sourceRecipe) m.set(e.sourceRecipe, p);
    return m;
  }, [packs]);

  const byTag = useMemo(() => new Map(families.map((f) => [f.tag, f])), [families]);
  const sorted = useMemo(
    () =>
      [...families].sort(
        (a, b) => (ORDER.indexOf(a.tag) + 1 || 99) - (ORDER.indexOf(b.tag) + 1 || 99) || a.tag.localeCompare(b.tag),
      ),
    [families],
  );
  const q = query.trim().toLowerCase();
  const visible = sorted.filter(
    (f) =>
      !q ||
      familyName(f, items).toLowerCase().includes(q) ||
      f.tag.includes(q) ||
      f.fluids.some((x) => x.id.includes(q) || fluidName(x, items).toLowerCase().includes(q)),
  );
  const burnable = sorted.filter((f) => f.engines || f.ieGenerator || f.blazeBurner || f.burner);

  return (
    <>
      <div className="ref-filters">
        <label className="search grow">
          <Search size={15} className="faint" />
          <input
            placeholder="Нефть, бензин, дизель, этанол, биодизель…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <OilCard items={items} />

      {burnable.length > 0 && !q && <BurnTable families={burnable} items={items} />}

      <div className="ref-minerals">
        {visible.map((f) => (
          <FamilyCard key={f.tag} fam={f} items={items} byTag={byTag} removedBy={removedBy} />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- нефть

function OilCard({ items }: { items: ItemIndex | null }) {
  const icon = (id: string) => (items?.byId.has(id) ? <ItemIcon id={id} size={20} /> : null);
  return (
    <section className="ref-card lf-oil">
      <header className="ref-card-head">
        {icon('createdieselgenerators:crude_oil_bucket')}
        <div className="grow">
          <h2>Где взять нефть</h2>
          <div className="faint small">
            Create: Diesel Generators — по коду мода 1.3.8, значения конфига по умолчанию
          </div>
        </div>
      </header>
      <ul className="lf-facts">
        <li>
          Нефть лежит <b>под чанками</b>, а не жилами: у каждого чанка свой запас, он считается по сиду мира шумом —
          поэтому нефтяные чанки идут пятнами. Ниже порога (4 млн mB) нефти в чанке нет, выше 10 млн mB — чанк
          бесконечный.
        </li>
        <li>
          «Нефтяные биомы» CDG (саванна, пустыня, бэдлендс, океаны) дают ×2 запаса, но это ванильные биомы — в мире TFC
          их нет. Поэтому богатых зон нет: везде обычный множитель ×1,3, и нефть может оказаться где угодно, в том числе
          под морем.
        </li>
        <li>
          Найти: {icon('createdieselgenerators:oil_scanner')}{' '}
          <b>{itemName(items?.byId.get('createdieselgenerators:oil_scanner'), 'детектор нефти')}</b> показывает запас
          чанка. Добыть: <b>станок-качалка</b> {icon('createdieselgenerators:pumpjack_crank')}
          {icon('createdieselgenerators:pumpjack_bearing')}
          {icon('createdieselgenerators:pumpjack_head')}
          {icon('createdieselgenerators:pumpjack_hole')} над чанком с нефтью.
        </li>
        <li>
          Сырую нефть сразу не сжечь — её перегоняют в <b>дистилляционной колонне</b> на бензин и дизель (ниже).
        </li>
      </ul>
      <p className="faint small" style={{ margin: 0 }}>
        Пороги и множители задаются в конфиге CDG на сервере, а запас чанка может переопределить KubeJS — если на
        сервере что-то меняли, реальность может отличаться.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- где сжигать

const fmtEngine = (e: EngineStats | null) =>
  e ? (
    <>
      {e.speed} об/мин · <b>{e.strength.toLocaleString('ru-RU')}</b> SU
    </>
  ) : (
    <span className="faint">—</span>
  );

function BurnTable({ families, items }: { families: LiquidFamily[]; items: ItemIndex | null }) {
  const rate = families.find((f) => f.engines?.normal)?.engines?.normal?.burnRate;
  return (
    <section className="ref-card">
      <header className="ref-card-head">
        <div className="grow">
          <h2>Где сжигать</h2>
          <div className="faint small">
            Дизельные генераторы Create: Diesel Generators — скорость и сила (SU), расход{' '}
            {rate ? `${+(rate * 20).toFixed(2)} mB/с` : '—'} у всех видов топлива. Горелка — множитель времени горения в
            горелке Create. Генератор IE — время горения из рецепта топлива (больше — экономнее).
          </div>
        </div>
      </header>
      <div className="ref-table-wrap">
        <table className="ref-table lf-burn">
          <thead>
            <tr>
              <th>Топливо</th>
              <th>Дизельный генератор</th>
              <th className="hide-sm">Модульный</th>
              <th className="hide-sm">Огромный</th>
              <th>Горелка</th>
              <th>Генератор IE</th>
            </tr>
          </thead>
          <tbody>
            {families.map((f) => {
              const icon = familyIcon(f, items);
              return (
                <tr key={f.tag}>
                  <td>
                    <div className="ref-ing">
                      {icon ? <ItemIcon id={icon} size={22} /> : <span className="ref-ing-blank" />}
                      <span>{familyName(f, items)}</span>
                    </div>
                  </td>
                  <td>{fmtEngine(f.engines?.normal ?? null)}</td>
                  <td className="hide-sm">{fmtEngine(f.engines?.modular ?? null)}</td>
                  <td className="hide-sm">{fmtEngine(f.engines?.huge ?? null)}</td>
                  <td className="num">
                    {f.burner != null ? `×${f.burner}` : ''}
                    {f.blazeBurner && (
                      <span className="faint small">
                        {f.burner != null ? ' · ' : ''}
                        {f.blazeBurner.superHeat ? 'перегрев' : 'нагрев'}
                      </span>
                    )}
                    {f.burner == null && !f.blazeBurner && <span className="faint">—</span>}
                  </td>
                  <td className="num">{f.ieGenerator?.burnTime ?? <span className="faint">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- семейство: как получить

const HEAT: Record<string, string> = { heated: 'нагрев', superheated: 'перегрев' };

function StackView({
  st,
  items,
  byTag,
}: {
  st: LiquidStack;
  items: ItemIndex | null;
  byTag: Map<string, LiquidFamily>;
}) {
  if (st.kind === 'fluid' || st.kind === 'fluidTag') {
    const fam =
      st.kind === 'fluidTag' ? byTag.get(st.id) : [...byTag.values()].find((f) => f.fluids.some((x) => x.id === st.id));
    const one = fam?.fluids.find((x) => x.id === st.id);
    const name = one ? fluidName(one, items) : fam ? familyName(fam, items) : st.id;
    const icon = fam ? familyIcon(fam, items) : null;
    return (
      <span className="lf-stack" title={st.id}>
        {icon && <ItemIcon id={icon} size={18} />}
        {st.amount != null && <b>{st.amount} mB</b>} {name.toLowerCase()}
      </span>
    );
  }
  const id = st.kind === 'tag' ? st.items?.[0] : st.id;
  const label = st.kind === 'tag' ? `#${st.id}` : itemName(items?.byId.get(st.id), st.id);
  return (
    <span className="lf-stack" title={st.kind === 'tag' ? `${st.id}: ${(st.items ?? []).join(', ')}` : st.id}>
      {id && <ItemIcon id={id} size={18} />}
      {st.count && st.count > 1 ? `${st.count}× ` : ''}
      {st.kind === 'tag' && id ? itemName(items?.byId.get(id), id) : label}
      {st.kind === 'tag' && (st.items?.length ?? 0) > 1 && <span className="faint small"> и др.</span>}
      {st.kind === 'tag' && !st.items?.length && (
        <span className="lf-empty small"> — в сборке нет таких предметов</span>
      )}
      {st.chance != null && st.chance < 1 && <span className="faint small"> {Math.round(st.chance * 100)}%</span>}
    </span>
  );
}

function RecipeLine({
  r,
  items,
  byTag,
  removed,
}: {
  r: FuelRecipe;
  items: ItemIndex | null;
  byTag: Map<string, LiquidFamily>;
  removed?: Datapack;
}) {
  const meta = [
    r.meta.heat && (HEAT[r.meta.heat] ?? r.meta.heat),
    r.meta.time && `${+(r.meta.time / 20).toFixed(1)} с`,
    r.meta.energy && `${r.meta.energy.toLocaleString('ru-RU')} RF`,
  ].filter(Boolean);
  return (
    <li className={removed ? 'lf-removed' : undefined}>
      <span className="lf-io">
        {r.inputs.map((s, i) => (
          <StackView key={i} st={s} items={items} byTag={byTag} />
        ))}
        <ArrowRight size={13} className="faint" />
        {r.outputs.map((s, i) => (
          <StackView key={i} st={s} items={items} byTag={byTag} />
        ))}
      </span>
      {(meta.length > 0 || r.meta.catalyst) && (
        <span className="faint small">
          {meta.join(' · ')}
          {r.meta.catalyst && (
            <>
              {meta.length ? ' · ' : ''}катализатор <StackView st={r.meta.catalyst} items={items} byTag={byTag} />
            </>
          )}
        </span>
      )}
      {removed && (
        <Link className="small lf-removed-tag" to={`/datapacks?pack=${removed.id}`} title={r.id}>
          <Ban size={12} /> удаляется датапаком «{removed.name}»
        </Link>
      )}
    </li>
  );
}

/** Сколько жидкости семейства даёт рецепт — для сортировки «выгоднее сверху» */
const yieldOf = (r: FuelRecipe, fam: LiquidFamily) =>
  r.outputs
    .filter(
      (o) =>
        (o.kind === 'fluid' && fam.fluids.some((f) => f.id === o.id)) || (o.kind === 'fluidTag' && o.id === fam.tag),
    )
    .reduce((s, o) => s + (o.amount ?? 0), 0);

function FamilyCard({
  fam,
  items,
  byTag,
  removedBy,
}: {
  fam: LiquidFamily;
  items: ItemIndex | null;
  byTag: Map<string, LiquidFamily>;
  removedBy: Map<string, Datapack>;
}) {
  const icon = familyIcon(fam, items);
  const groups = useMemo(() => {
    const m = new Map<string, FuelRecipe[]>();
    for (const r of fam.produce) m.set(r.type, [...(m.get(r.type) ?? []), r]);
    for (const list of m.values()) list.sort((a, b) => yieldOf(b, fam) - yieldOf(a, fam));
    return [...m];
  }, [fam]);
  return (
    <section className="ref-card">
      <header className="ref-card-head">
        {icon ? <ItemIcon id={icon} size={32} /> : null}
        <div className="grow">
          <h2>{familyName(fam, items)}</h2>
          <div className="lf-fluids faint small">
            <code>#{fam.tag}</code>
            {fam.fluids.length > 1 && (
              <span>
                {' '}
                · взаимозаменяемы, где рецепт принимает тег:{' '}
                {fam.fluids.map((f) => `${fluidName(f, items)} (${f.id.split(':')[0]})`).join(', ')}
              </span>
            )}
          </div>
        </div>
      </header>
      {fam.tag === 'c:crude_oil' ? (
        <p className="faint small" style={{ margin: 0 }}>
          Рецептами не делается — только добыча станком-качалкой (см. выше).
        </p>
      ) : groups.length === 0 ? (
        <p className="faint small" style={{ margin: 0 }}>
          Рецептов получения в сборке нет.
        </p>
      ) : (
        groups.map(([type, list]) => (
          <MethodGroup key={type} type={type} list={list} items={items} byTag={byTag} removedBy={removedBy} />
        ))
      )}
    </section>
  );
}

const recipesCount = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  const word =
    m10 === 1 && m100 !== 11 ? 'рецепт' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'рецепта' : 'рецептов';
  return `${n} ${word}`;
};

function MethodGroup({
  type,
  list,
  items,
  byTag,
  removedBy,
}: {
  type: string;
  list: FuelRecipe[];
  items: ItemIndex | null;
  byTag: Map<string, LiquidFamily>;
  removedBy: Map<string, Datapack>;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 6);
  return (
    <div className="lf-method">
      <h4>
        {methodLabel(type)} <span className="faint small">{list.length > 1 ? recipesCount(list.length) : ''}</span>
      </h4>
      <ul className="lf-recipes">
        {shown.map((r) => (
          <RecipeLine key={r.id} r={r} items={items} byTag={byTag} removed={removedBy.get(r.id)} />
        ))}
      </ul>
      {list.length > shown.length && (
        <button className="btn ghost sm" onClick={() => setAll(true)}>
          Ещё {list.length - shown.length}
        </button>
      )}
    </div>
  );
}
