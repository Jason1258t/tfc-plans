import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { itemName, type ItemIndex } from '../lib/items';
import {
  COMPUTED_TITLE,
  familyTitle,
  tagItems,
  useMeals,
  type ComputedMeal,
  type MealFamily,
  type MealFood,
  type MealPortion,
  type MealSlot,
} from '../lib/meals';
import { NUTRIENTS, type Nutrient } from '../lib/reference';
import { useTags, type TagCatalog } from '../lib/tags';
import { ItemIcon } from './ItemIcon';
import './MealsTab.css';

const NUTRIENT_LABEL: Record<Nutrient, string> = {
  grain: 'зерновые',
  fruit: 'фрукты',
  vegetables: 'овощи',
  protein: 'белок',
  dairy: 'молочное',
};

const ru = (v: number, digits = 3) => String(Math.round(v * 10 ** digits) / 10 ** digits).replace('.', ',');
const lower = (s: string) => s.toLowerCase().replaceAll('ё', 'е');
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
const range = (min: number, max: number) => (min === max ? `${max}` : `${min}–${max}`);

const membersOf = tagItems;

function useNames(items: ItemIndex | null) {
  return (id: string) => itemName(items?.byId.get(id), id);
}

/** Тег начинки: сколько в нём предметов и раскрывающийся список */
function TagMembers({ tag, cat, items }: { tag: string; cat: TagCatalog | null; items: ItemIndex | null }) {
  const name = useNames(items);
  const list = useMemo(
    () => membersOf(cat, tag).sort((a, b) => name(a).localeCompare(name(b), 'ru')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cat, tag, items],
  );
  return (
    <details className="meal-tag">
      <summary>
        <code>#{tag}</code> <span className="faint">{cat ? `${list.length} предм.` : '…'}</span>
      </summary>
      <ul className="meal-members">
        {list.map((id) => (
          <li key={id}>
            <ItemIcon id={id} size={20} tip={false} />
            <span>{name(id)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ItemChips({ ids, items }: { ids: string[]; items: ItemIndex | null }) {
  const name = useNames(items);
  return (
    <span className="meal-chips">
      {ids.map((id) => (
        <span key={id} className="meal-chip">
          <ItemIcon id={id} size={20} tip={false} />
          {name(id)}
        </span>
      ))}
    </span>
  );
}

function SlotRow({ slot, cat, items }: { slot: MealSlot; cat: TagCatalog | null; items: ItemIndex | null }) {
  const alt = slot.items.length + slot.tags.length > 1;
  return (
    <li>
      <b className="meal-count">×{range(slot.min, slot.max)}</b>
      <div className="grow">
        {alt && <span className="faint small">любое из: </span>}
        {slot.items.length > 0 && <ItemChips ids={slot.items} items={items} />}
        {slot.tags.map((t) => (
          <TagMembers key={t} tag={t} cat={cat} items={items} />
        ))}
      </div>
    </li>
  );
}

const baseLine = (f: MealFood) =>
  [
    `сытость ${f.hunger}`,
    `порча ×${ru(f.decay)}`,
    f.saturation ? `насыщение ${ru(f.saturation)}` : '',
    f.water ? `вода ${ru(f.water)}` : '',
    ...NUTRIENTS.filter((n) => f.nutrients[n]).map((n) => `${NUTRIENT_LABEL[n]} ${ru(f.nutrients[n] ?? 0)}`),
  ]
    .filter(Boolean)
    .join(' · ');

const portionLine = (p: MealPortion) =>
  p.nutrient === p.water && p.water === p.saturation
    ? `×${ru(p.nutrient)} от его питательных групп, воды и насыщения`
    : `питательные группы ×${ru(p.nutrient)}, вода ×${ru(p.water)}, насыщение ×${ru(p.saturation)}`;

function FamilyCard({ f, cat, items }: { f: MealFamily; cat: TagCatalog | null; items: ItemIndex | null }) {
  const name = useNames(items);
  const title = familyTitle(f.dishes.map((d) => name(d.item)));
  const foods = f.slots.filter((s) => s.food);
  const tools = f.slots.filter((s) => !s.food);
  const next = f.dishes.find((d) => d.next)?.next;
  return (
    <li className="meal-card">
      <header>
        <span className="meal-icons">
          {f.dishes.slice(0, 6).map((d) => (
            <ItemIcon key={d.item} id={d.item} size={28} />
          ))}
        </span>
        <div className="grow">
          <h3>{title}</h3>
          <span className="faint small">
            {f.dishes.length > 1 ? `${f.dishes.length} ${plural(f.dishes.length, 'вид', 'вида', 'видов')} · ` : ''}
            {f.recipes} {plural(f.recipes, 'рецепт', 'рецепта', 'рецептов')} ·{' '}
            {f.types.some((t) => /shaped/.test(t) && !/shapeless/.test(t))
              ? 'верстак, по узору'
              : 'верстак, в любом порядке'}
          </span>
        </div>
      </header>

      {f.baseCount > 0 && (
        <section>
          <h4>Основа ×{f.baseCount} — на выбор, у каждого вида своя</h4>
          <ul className="meal-bases">
            {f.dishes.map((d) => (
              <li key={d.item}>
                <ItemChips ids={d.bases} items={items} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h4>{f.baseCount > 0 ? 'Начинки' : 'Что класть'}</h4>
        <ul className="meal-slots">
          {foods.map((s) => (
            <SlotRow key={s.key} slot={s} cat={cat} items={items} />
          ))}
        </ul>
      </section>

      {tools.length > 0 && (
        <section>
          <h4>Инструмент и посуда</h4>
          <ul className="meal-slots">
            {tools.map((s) => (
              <SlotRow key={s.key} slot={s} cat={cat} items={items} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h4>Что получится</h4>
        <p className="small">
          Само блюдо: {baseLine(f.base)}.{f.portions.length === 0 && ' Ингредиенты питательности не добавляют.'}
        </p>
        {f.portions.length > 0 && (
          <ul className="meal-portions small">
            {f.portions.map((p, i) => (
              <li key={i}>
                <b>
                  {p.base
                    ? 'Основа'
                    : p.items?.length || p.tags?.length
                      ? [...(p.items ?? []).map(name), ...(p.tags ?? []).map((t) => `#${t}`)].join(', ')
                      : f.portions.length > 1
                        ? 'Остальная еда'
                        : 'Каждый ингредиент-еда'}
                  :
                </b>{' '}
                добавляет {portionLine(p)}
              </li>
            ))}
          </ul>
        )}
        {next && (
          <p className="small">
            Дальше: <ItemChips ids={[next.item]} items={items} /> — питательность переносится без пересчёта.
          </p>
        )}
      </section>
    </li>
  );
}

function ComputedCard({ c, cat, items }: { c: ComputedMeal; cat: TagCatalog | null; items: ItemIndex | null }) {
  const pots = c.pots ?? [];
  const counts = pots.map((p) => p.count);
  const servings = (n: number) => (c.servings ? Math.floor(n / c.servings.div) + c.servings.add : 1);
  const all = [...new Set([...pots.flatMap((p) => p.tags), ...(c.tags ?? [])])];
  // Тег посуды (миски для салата) — не ингредиент
  const tags = all.filter((t) => !/bowl/.test(t));
  const bowls = all.filter((t) => /bowl/.test(t));
  const pot = pots[0];
  const scale = c.scale ?? 1;
  return (
    <li className="meal-card">
      <header>
        <span className="meal-icons">
          {c.results.map((r) => (
            <ItemIcon key={r.item} id={r.item} size={28} />
          ))}
        </span>
        <div className="grow">
          <h3>{COMPUTED_TITLE[c.kind] ?? c.kind}</h3>
          <span className="faint small">{pot ? 'кастрюля' : 'окно сборки салата'} · формула из кода TFC</span>
        </div>
      </header>
      <section>
        <h4>Что класть</h4>
        <ul className="meal-slots">
          <li>
            <b className="meal-count">
              ×{counts.length ? range(Math.min(...counts), Math.max(...counts)) : `до ${c.slots ?? '?'}`}
            </b>
            <div className="grow">
              {tags.map((t) => (
                <TagMembers key={t} tag={t} cat={cat} items={items} />
              ))}
            </div>
          </li>
        </ul>
        {bowls.length > 0 && (
          <ul className="meal-slots">
            <li>
              <b className="meal-count">посуда</b>
              <div className="grow">
                {bowls.map((t) => (
                  <TagMembers key={t} tag={t} cat={cat} items={items} />
                ))}
              </div>
            </li>
          </ul>
        )}
        {pot && (
          <p className="small">
            В кастрюле {pot.amount} мБ воды, варится {pot.duration} тиков
            {pot.duration ? ` (${ru(pot.duration / 20 / 60, 1)} мин)` : ''} при {pot.temperature} °C.
          </p>
        )}
      </section>
      <section>
        <h4>Что получится</h4>
        <ul className="meal-portions small">
          {c.servings && counts.length > 0 && (
            <li>
              <b>Порций:</b> {counts.map((n) => `из ${n} продуктов — ${servings(n)}`).join(', ')}
            </li>
          )}
          <li>
            <b>Питательные группы:</b> сумма по всем продуктам × {ru(scale)}
            {c.servings ? ' и делится на число порций' : ''}
          </li>
          <li>
            <b>Вода и насыщение:</b>{' '}
            {c.baseWater || c.baseSaturation
              ? `вода ${ru(c.baseWater ?? 0)} и насыщение ${ru(c.baseSaturation ?? 0)} у самого блюда плюс `
              : ''}
            сумма по продуктам × {ru(scale)}
            {c.servings ? ' / число порций' : ''}
          </li>
          <li>
            <b>Вид блюда</b> — по самой большой питательной группе:{' '}
            {c.results
              .map((r) => `${NUTRIENT_LABEL[r.nutrient]} → ${itemName(items?.byId.get(r.item), r.item)}`)
              .join('; ')}
          </li>
          <li>
            <b>Всегда:</b> сытость {c.hunger}, порча ×{ru(c.decay)}
          </li>
        </ul>
      </section>
    </li>
  );
}

/** Подвкладка «Сборные блюда»: семейства из рецептов tfc:meal, суп и салат */
export function MealsTab({ items, initialQuery = '' }: { items: ItemIndex | null; initialQuery?: string }) {
  const meals = useMeals();
  const cat = useTags();
  const [query, setQuery] = useState(initialQuery);
  const name = useNames(items);

  /** Строка поиска семейства: названия блюд, основы, начинок и всех предметов из тегов начинок */
  const hay = useMemo(() => {
    const out = new Map<string, string>();
    for (const f of meals?.families ?? []) {
      const ids = [
        ...f.dishes.flatMap((d) => [d.item, ...d.bases]),
        ...f.slots.flatMap((s) => [...s.items, ...s.tags.flatMap((t) => membersOf(cat, t))]),
      ];
      out.set(f.id, lower(ids.map((id) => `${name(id)} ${id}`).join(' ')));
    }
    for (const c of meals?.computed ?? []) {
      const ids = [
        ...c.results.map((r) => r.item),
        ...[...(c.tags ?? []), ...(c.pots ?? []).flatMap((p) => p.tags)].flatMap((t) => membersOf(cat, t)),
      ];
      out.set(c.kind, lower(`${COMPUTED_TITLE[c.kind] ?? ''} ${ids.map((id) => `${name(id)} ${id}`).join(' ')}`));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meals, cat, items]);

  if (meals === undefined) return <div className="empty">Загружаю блюда…</div>;
  if (meals === null) return <div className="empty">Сборные блюда не собраны — выполните npm run mods</div>;

  const words = lower(query).split(/\s+/).filter(Boolean);
  const match = (key: string) => words.every((w) => hay.get(key)?.includes(w));
  const families = meals.families.filter((f) => match(f.id));
  const computed = meals.computed.filter((c) => match(c.kind));

  return (
    <>
      <div className="ref-filters">
        <label className="search grow">
          <Search size={15} className="faint" />
          <input
            placeholder="Блюдо или продукт: сэндвич, сыр, томат…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <p className="faint small ref-note">
        Сборное блюдо — еда, питательность которой складывается из того, что в неё положили: к значениям самого блюда
        прибавляется доля от каждого ингредиента. Поиск по продукту показывает блюда, в которые он годится. Состав тегов
        — с учётом правок KubeJS. В игре не проверялось. Показано {families.length + computed.length} из{' '}
        {meals.families.length + meals.computed.length}.
      </p>
      {families.length + computed.length === 0 ? (
        <div className="empty">Ничего не подходит.</div>
      ) : (
        <ul className="meal-grid">
          {computed.map((c) => (
            <ComputedCard key={c.kind} c={c} cat={cat} items={items} />
          ))}
          {families.map((f) => (
            <FamilyCard key={f.id + f.slots.map((s) => s.key).join()} f={f} cat={cat} items={items} />
          ))}
        </ul>
      )}
    </>
  );
}
