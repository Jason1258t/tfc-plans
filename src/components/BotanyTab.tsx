import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { inRange, PLANT_KIND_LABEL, rangeLabel, useBotany, type Plant, type PlantKind } from '../lib/botany';
import { itemName, useItems, type ItemIndex } from '../lib/items';
import type { Food } from '../lib/reference';
import { cx } from '../lib/util';
import { ItemIcon } from './ItemIcon';
import './BotanyTab.css';

const SUBTABS: PlantKind[] = ['crop', 'bush', 'tree', 'plant'];
type Sort = 'name' | 'minT' | 'maxT';

const lower = (s: string) => s.toLowerCase().replaceAll('ё', 'е');
const prettyName = (n: string) => n.replaceAll('_', ' ');

/** Ботаника: культуры, ягодные кусты, фруктовые деревья — диапазоны температуры и влажности из данных TFC */
export function BotanyTab({ foods, sub, onSub }: { foods: Food[]; sub: PlantKind; onSub: (k: PlantKind) => void }) {
  const plants = useBotany();
  const items = useItems();
  const [query, setQuery] = useState('');
  const [temp, setTemp] = useState('');
  const [hydr, setHydr] = useState('');
  const [sort, setSort] = useState<Sort>('name');

  const counts = useMemo(() => {
    const c: Record<PlantKind, number> = { crop: 0, bush: 0, tree: 0, plant: 0 };
    for (const p of plants ?? []) c[p.k]++;
    return c;
  }, [plants]);
  const foodBy = useMemo(() => {
    const m = new Map<string, Food>();
    for (const f of foods) for (const id of f.items) if (!m.has(id)) m.set(id, f);
    return m;
  }, [foods]);

  const nameOf = (p: Plant) => (p.product ? itemName(items?.byId.get(p.product), p.product) : prettyName(p.n));

  const list = useMemo(() => {
    if (!plants) return [];
    const t = temp.trim() === '' ? null : Number(temp.replace(',', '.'));
    const h = hydr.trim() === '' ? null : Number(hydr.replace(',', '.'));
    const words = lower(query).split(/\s+/).filter(Boolean);
    const name = (p: Plant) => lower(p.product ? itemName(items?.byId.get(p.product), p.product) : prettyName(p.n));
    return plants
      .filter((p) => p.k === sub)
      .filter((p) => {
        const hay = `${name(p)} ${lower(p.i)} ${lower(items?.byId.get(p.product ?? '')?.e ?? '')}`;
        return words.every((w) => hay.includes(w));
      })
      .filter((p) => t === null || Number.isNaN(t) || inRange(t, p.r.minT, p.r.maxT))
      .filter((p) => h === null || Number.isNaN(h) || inRange(h, p.r.minH, p.r.maxH))
      .sort((a, b) =>
        sort === 'name'
          ? name(a).localeCompare(name(b), 'ru')
          : sort === 'minT'
            ? (a.r.minT ?? -99) - (b.r.minT ?? -99)
            : (b.r.maxT ?? 99) - (a.r.maxT ?? 99),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, sub, query, temp, hydr, sort, items]);

  if (plants === undefined) return <div className="empty">Загружаю ботанику…</div>;
  if (plants === null) return <div className="empty">Данных о растениях нет — выполните npm run items</div>;

  return (
    <div className="botany">
      <nav className="botany-nav" aria-label="Разделы ботаники">
        {SUBTABS.filter((k) => k !== 'plant' || counts.plant > 0).map((k) => (
          <button key={k} className={cx(sub === k && 'active')} onClick={() => onSub(k)}>
            <span>{PLANT_KIND_LABEL[k]}</span>
            <span className="faint small">{counts[k]}</span>
          </button>
        ))}
      </nav>

      <div className="botany-main">
        <div className="ref-filters">
          <label className="search grow">
            <Search size={15} className="faint" />
            <input
              placeholder={
                sub === 'crop' ? 'Пшеница, картофель…' : sub === 'bush' ? 'Малина, черника…' : 'Яблоня, олива…'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="botany-field">
            <span className="faint small">Температура, °C</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="напр. 12"
              value={temp}
              onChange={(e) => setTemp(e.target.value)}
            />
          </label>
          <label className="botany-field">
            <span className="faint small">Влажность, %</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="напр. 40"
              value={hydr}
              onChange={(e) => setHydr(e.target.value)}
            />
          </label>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Порядок">
            <option value="name">По названию</option>
            <option value="minT">Сначала холодостойкие</option>
            <option value="maxT">Сначала жаростойкие</option>
          </select>
        </div>
        <p className="faint small ref-note">
          Диапазоны — из данных мода (<code>climate_range</code>): вне них растение не растёт или чахнет. Если границы
          нет в данных, она не показана. Рост, удобрения и сезоны пока не разобраны. {list.length} из {counts[sub]}.
        </p>

        {list.length === 0 ? (
          <div className="empty">Ничего не подходит.</div>
        ) : (
          <ul className="botany-grid">
            {list.map((p) => (
              <PlantCard
                key={p.i}
                p={p}
                name={nameOf(p)}
                food={p.product ? foodBy.get(p.product) : undefined}
                items={items}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PlantCard({ p, name, food, items }: { p: Plant; name: string; food?: Food; items: ItemIndex | null }) {
  const t = rangeLabel(p.r.minT, p.r.maxT, '°C');
  const h = rangeLabel(p.r.minH, p.r.maxH, '%');
  const icon = p.product ?? p.plant ?? p.seed;
  const seedName = p.seed ? itemName(items?.byId.get(p.seed), p.seed) : null;
  return (
    <li className="botany-card">
      <div className="botany-card-head">
        {icon ? <ItemIcon id={icon} size={36} tip={false} /> : <span className="botany-noicon" />}
        <div className="grow">
          <div className="botany-name">{name}</div>
          <code className="faint small">{p.i}</code>
        </div>
      </div>
      <dl className="botany-stats">
        <dt>Температура</dt>
        <dd>{t ?? '—'}</dd>
        <dt>Влажность</dt>
        <dd>{h ?? '—'}</dd>
        {food && (
          <>
            <dt>Плод</dt>
            <dd>
              сытость {food.hunger || '—'} · порча ×{food.decay}
            </dd>
          </>
        )}
        {seedName && (
          <>
            <dt>Семена</dt>
            <dd className="botany-seed">
              <ItemIcon id={p.seed} size={18} tip={false} /> {seedName}
            </dd>
          </>
        )}
      </dl>
    </li>
  );
}
