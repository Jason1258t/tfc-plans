import { Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  itemName,
  type ItemIndex,
  useTags,
  type TagCatalog,
  hasStatus,
  useRecipes,
  ItemIcon,
} from '@/shared/pack-data';
import {
  computedTitle,
  dynamicTitle,
  familyTitle,
  skilletHay,
  tagItems,
  useMeals,
  type ComputedMeal,
  type DynamicMeal,
  type MealConfigKey,
  type MealFamily,
  type MealFood,
  type MealPortion,
  type MealSlot,
} from '@/lib/meals';
import { NUTRIENTS, type Food, type Nutrient } from '@/lib/reference';
import { CONFIG_ORIGIN_LABEL, useModConfig, type ConfigOrigin } from '@/entities/pack-config';
import { ComputedCalc, DynamicCalc, FamilyCalc, type FoodLookup } from '../MealCalc';
import { SkilletCard } from '../SkilletCard';
import { cx } from '@/shared/lib';
import shell from '../../ReferenceShell.module.css';
import styles from './MealsTab.module.css';

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
    <details className={styles.tag}>
      <summary>
        <code>#{tag}</code> <span className="faint">{cat ? `${list.length} предм.` : '…'}</span>
      </summary>
      <ul className={styles.members}>
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
    <span className={styles.chips}>
      {ids.map((id) => (
        <span key={id} className={styles.chip}>
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
      <b className={styles.count}>×{range(slot.min, slot.max)}</b>
      <div className={styles.grow}>
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

/**
 * Карточка блюда фиксированного размера: шапка (значки, название, сколько продуктов) всегда на месте,
 * состав, формула и калькулятор прокручиваются внутри — сетка остаётся ровной при любом объёме текста.
 */
function MealShell({
  icons,
  title,
  sub,
  amount,
  children,
}: {
  icons: ReactNode;
  title: string;
  sub: ReactNode;
  /** Сколько продуктов кладётся */
  amount?: string;
  children: ReactNode;
}) {
  return (
    <li className={styles.card}>
      <header className={styles.head}>
        <span className={styles.icons}>{icons}</span>
        <span className={styles.title}>
          <b title={title}>{title}</b>
          <span className="faint small">{sub}</span>
        </span>
        {amount && <span className={cx(styles.amount, 'small')}>{amount}</span>}
      </header>
      <div className={styles.body}>{children}</div>
    </li>
  );
}

const products = (min: number, max: number) => `${range(min, max)} ${plural(max, 'продукт', 'продукта', 'продуктов')}`;

function FamilyCard({
  f,
  cat,
  items,
  food,
}: {
  f: MealFamily;
  cat: TagCatalog | null;
  items: ItemIndex | null;
  food: FoodLookup;
}) {
  const name = useNames(items);
  const title = familyTitle(f.dishes.map((d) => name(d.item)));
  const foods = f.slots.filter((s) => s.food);
  const tools = f.slots.filter((s) => !s.food);
  const next = f.dishes.find((d) => d.next)?.next;
  const recipeCount = f.dishes.reduce((n, d) => n + d.recipes.length, 0);
  return (
    <MealShell
      icons={f.dishes.slice(0, 2).map((d) => (
        <ItemIcon key={d.item} id={d.item} size={28} />
      ))}
      title={title}
      sub={
        <>
          {f.dishes.length > 1 ? `${f.dishes.length} ${plural(f.dishes.length, 'вид', 'вида', 'видов')} · ` : ''}
          {recipeCount} {plural(recipeCount, 'рецепт', 'рецепта', 'рецептов')} ·{' '}
          {f.types.some((t) => /shaped/.test(t) && !/shapeless/.test(t))
            ? 'верстак, по узору'
            : 'верстак, в любом порядке'}
        </>
      }
      amount={products(
        f.baseCount + foods.reduce((n, x) => n + x.min, 0),
        f.baseCount + foods.reduce((n, x) => n + x.max, 0),
      )}
    >
      {f.baseCount > 0 && (
        <section>
          <h4>Основа ×{f.baseCount} — на выбор, у каждого вида своя</h4>
          <ul className={styles.bases}>
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
        <ul className={styles.slots}>
          {foods.map((s) => (
            <SlotRow key={s.key} slot={s} cat={cat} items={items} />
          ))}
        </ul>
      </section>

      {tools.length > 0 && (
        <section>
          <h4>Инструмент и посуда</h4>
          <ul className={styles.slots}>
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
          <ul className={cx(styles.portions, 'small')}>
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
      <p className="small">
        <span className="faint">Рецепты в каталоге: </span>
        {f.dishes.map((d, i) => (
          <span key={d.item}>
            {i > 0 && ', '}
            <Link to={`/recipes?item=${encodeURIComponent(d.item)}`}>
              {name(d.item)} ({d.recipes.length})
            </Link>
          </span>
        ))}
      </p>
      <FamilyCalc f={f} cat={cat} items={items} food={food} />
    </MealShell>
  );
}

function ComputedCard({
  c,
  cat,
  items,
  food,
}: {
  c: ComputedMeal;
  cat: TagCatalog | null;
  items: ItemIndex | null;
  food: FoodLookup;
}) {
  const pots = c.pots ?? [];
  const counts = pots.map((p) => p.count);
  const servings = (n: number) => (c.servings ? Math.floor(n / c.servings.div) + c.servings.add : 1);
  const all = [...new Set([...pots.flatMap((p) => p.tags), ...(c.tags ?? [])])];
  // Тег посуды (миски для салата) — не ингредиент
  const tags = all.filter((t) => !/bowl/.test(t));
  const bowls = all.filter((t) => /bowl/.test(t));
  const pot = pots[0];
  const scale = c.scale ?? 1;
  const name = useNames(items);
  const fixed = pot?.fixed ?? [];
  // Множитель: постоянный (суп, салат) или убывающий с числом продуктов (вонючий суп)
  const factor = c.fade !== undefined ? `(1 − ${ru(c.fade)} × число продуктов)` : ru(scale);
  const perServing = c.servings && c.fade === undefined;
  return (
    <MealShell
      icons={(c.item ? [c.item] : c.results.slice(0, 2).map((r) => r.item)).map((id) => (
        <ItemIcon key={id} id={id} size={28} />
      ))}
      title={computedTitle(c, name)}
      sub={`${pot ? 'кастрюля' : 'окно сборки салата'} · формула из кода ${!c.mod || c.mod === 'tfc' ? 'TFC' : `мода ${c.mod}`}`}
      amount={
        counts.length
          ? products(Math.min(...counts), Math.max(...counts))
          : c.slots
            ? `до ${c.slots} продуктов`
            : undefined
      }
    >
      <section>
        <h4>Что класть</h4>
        <ul className={styles.slots}>
          <li>
            <b className={styles.count}>
              ×
              {counts.length
                ? range(Math.min(...counts) - fixed.length, Math.max(...counts) - fixed.length)
                : `1–${c.slots ?? '?'}`}
            </b>
            <div className={styles.grow}>
              {tags.map((t) => (
                <TagMembers key={t} tag={t} cat={cat} items={items} />
              ))}
            </div>
          </li>
        </ul>
        {fixed.length > 0 && (
          <ul className={styles.slots}>
            <li>
              <b className={styles.count}>×{fixed.length}</b>
              <div className={styles.grow}>
                <span className="faint small">обязательно: </span>
                <ItemChips ids={fixed} items={items} />
              </div>
            </li>
          </ul>
        )}
        {bowls.length > 0 && (
          <ul className={styles.slots}>
            <li>
              <b className={styles.count}>посуда</b>
              <div className={styles.grow}>
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
        <ul className={cx(styles.portions, 'small')}>
          {c.servings && counts.length > 0 && (
            <li>
              <b>Порций:</b> {counts.map((n) => `из ${n} продуктов — ${servings(n)}`).join(', ')}
            </li>
          )}
          <li>
            <b>Питательные группы:</b> сумма по всем продуктам × {factor}
            {perServing ? ' и делится на число порций' : ''}
            {c.servings && !perServing ? ' — в каждой порции целиком, на порции не делится' : ''}
          </li>
          <li>
            <b>Вода и насыщение:</b>{' '}
            {c.baseWater || c.baseSaturation
              ? `вода ${ru(c.baseWater ?? 0)} и насыщение ${ru(c.baseSaturation ?? 0)} у самого блюда плюс `
              : ''}
            сумма по продуктам × {factor}
            {perServing ? ' / число порций' : ''}
          </li>
          {c.results.length > 0 && (
            <li>
              <b>Вид блюда</b> — по самой большой питательной группе:{' '}
              {c.results.map((r) => `${NUTRIENT_LABEL[r.nutrient]} → ${name(r.item)}`).join('; ')}
            </li>
          )}
          {c.batch && (
            <li>
              <b>За раз:</b> столько блюд, сколько штук в самой маленькой стопке среди продуктов и посуды (до {c.batch}
              ); с каждым взятым блюдом уходит по одной штуке каждого продукта и одна посуда.
              {c.minItems === 1 ? ' Хватит и одного продукта.' : ''}
            </li>
          )}
          <li>
            <b>Всегда:</b> сытость {c.hunger}, порча ×{ru(c.decay)}
          </li>
        </ul>
      </section>
      <ComputedCalc c={c} cat={cat} items={items} food={food} />
    </MealShell>
  );
}

type Setting = { value: number; origin: ConfigOrigin } | null;

function DynamicCard({
  d,
  order,
  cat,
  items,
  food,
  setting,
}: {
  d: DynamicMeal;
  order: Nutrient[];
  cat: TagCatalog | null;
  items: ItemIndex | null;
  food: FoodLookup;
  setting: (k?: MealConfigKey | null) => Setting;
}) {
  const name = useNames(items);
  const mult = d.nutrients.mult ? setting(d.nutrients.multConfig) : null;
  const cap = d.nutrients.cap ? setting(d.nutrients.capConfig) : null;
  const waterFrom = d.water.from.map((n) => NUTRIENT_LABEL[n]).join(' + ');
  return (
    <MealShell
      icons={d.block && <ItemIcon id={d.block} size={28} />}
      title={dynamicTitle(d, name)}
      sub={`формула из кода мода ${d.ns}`}
      amount={d.slots ? products(1, d.slots) : undefined}
    >
      <section>
        <h4>Что класть</h4>
        <ul className={styles.slots}>
          {d.ingredientTag && (
            <li>
              <b className={styles.count}>×1–{d.slots ?? '?'}</b>
              <div className={styles.grow}>
                <TagMembers tag={d.ingredientTag} cat={cat} items={items} />
              </div>
            </li>
          )}
          {d.carrierTag && (
            <li>
              <b className={styles.count}>посуда</b>
              <div className="grow">
                <TagMembers tag={d.carrierTag} cat={cat} items={items} />
              </div>
            </li>
          )}
        </ul>
        <p className="small">
          Срабатывает, когда набор продуктов не подошёл ни под один рецепт этой посуды, а все продукты входят в тег выше
          {d.ticks ? `; готовится ${d.ticks} тиков (${ru(d.ticks / 20, 1)} с)` : ''}. Если хоть один продукт не из тега,
          получится обычное «подозрительное» блюдо мода.
        </p>
      </section>
      <section>
        <h4>Что получится</h4>
        <ul className={cx(styles.portions, 'small')}>
          <li>
            <b>Питательные группы:</b> сумма по всем продуктам
            {d.nutrients.dropMin ? '; самая маленькая группа обнуляется' : ''}
            {mult ? `; остальное × ${ru(mult.value)} (${CONFIG_ORIGIN_LABEL[mult.origin]})` : ''}
            {cap ? `; не больше ${ru(cap.value)} на группу (${CONFIG_ORIGIN_LABEL[cap.origin]})` : ''}
          </li>
          <li>
            <b>Вода:</b> ({waterFrom}){d.water.mul !== 1 ? ` × ${ru(d.water.mul)}` : ''}
            {d.water.add ? ` + ${ru(d.water.add)}` : ''} — от итоговых групп
          </li>
          <li>
            <b>Насыщение:</b> {ru(d.saturationPerItem)} за каждый продукт
          </li>
          <li>
            <b>Порча:</b> наибольшая среди продуктов × {ru(d.decay.mul)}
          </li>
          <li>
            <b>Вид блюда</b> — по самой большой питательной группе:{' '}
            {d.results.map((r) => `${NUTRIENT_LABEL[r.nutrient]} → ${name(r.item)}`).join('; ')}
          </li>
          <li>
            <b>Всегда:</b> сытость {d.hunger}
          </li>
        </ul>
      </section>
      <DynamicCalc
        d={d}
        order={order}
        cat={cat}
        items={items}
        food={food}
        mult={mult?.value ?? 1}
        cap={cap?.value ?? Infinity}
      />
    </MealShell>
  );
}

/** Подвкладка «Сборные блюда»: семейства из рецептов tfc:meal, суп и салат */
export function MealsTab({
  items,
  foods,
  initialQuery = '',
}: {
  items: ItemIndex | null;
  foods: Food[];
  initialQuery?: string;
}) {
  // Питательность продуктов для калькулятора — из справочника еды
  const food = useMemo<FoodLookup>(() => {
    const m = new Map<string, Food>();
    for (const f of foods) for (const id of f.items) if (!m.has(id)) m.set(id, f);
    return (id) => m.get(id);
  }, [foods]);
  const loadedMeals = useMeals();
  const cat = useTags();
  // Рецепты, удалённые KubeJS или отключённые заглушкой, в игре не работают — такие блюда не показываем
  const catalog = useRecipes();
  const { meals, hiddenRecipes } = useMemo(() => {
    if (!loadedMeals || !catalog) return { meals: loadedMeals, hiddenRecipes: 0 };
    let hidden = 0;
    const alive = (id: string) => {
      const r = catalog.byId.get(id);
      const ok = !r || hasStatus(r, 'active');
      if (!ok) hidden++;
      return ok;
    };
    const families = loadedMeals.families
      .map((f) => ({
        ...f,
        dishes: f.dishes.map((d) => ({ ...d, recipes: d.recipes.filter(alive) })).filter((d) => d.recipes.length > 0),
      }))
      .filter((f) => f.dishes.length > 0);
    const computed = loadedMeals.computed
      .map((c) => (c.pots ? { ...c, pots: c.pots.filter((p) => alive(p.recipe)) } : c))
      .filter((c) => !c.pots || c.pots.length > 0);
    const skillet = loadedMeals.skillet && {
      ...loadedMeals.skillet,
      dishes: loadedMeals.skillet.dishes.filter((d) => alive(d.recipe)),
    };
    return { meals: { ...loadedMeals, families, computed, skillet }, hiddenRecipes: hidden };
  }, [loadedMeals, catalog]);
  // Настройки мода, от которых зависят блюда аддонов: конфиг сервера → конфиг сборки → значение из кода
  const cfgFile =
    meals?.dynamic?.map((d) => d.nutrients.multConfig?.file ?? d.nutrients.capConfig?.file).find(Boolean) ?? '';
  const cfgServer = useModConfig(cfgFile, 'server');
  const cfgCommon = useModConfig(cfgFile, 'config');
  const setting = (k?: MealConfigKey | null): Setting => {
    if (!k) return null;
    for (const [doc, origin] of [
      [cfgServer, 'server'],
      [cfgCommon, 'config'],
    ] as const) {
      let v: unknown = k.file === cfgFile ? doc?.values : undefined;
      for (const part of k.key.split('.'))
        v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined;
      if (typeof v === 'number') return { value: v, origin };
    }
    return typeof k.default === 'number' ? { value: k.default, origin: 'default' } : null;
  };
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
        ...(c.pots ?? []).flatMap((p) => p.fixed ?? []),
        ...[...(c.tags ?? []), ...(c.pots ?? []).flatMap((p) => p.tags)].flatMap((t) => membersOf(cat, t)),
      ];
      out.set(c.kind, lower(`${computedTitle(c, name)} ${ids.map((id) => `${name(id)} ${id}`).join(' ')}`));
    }
    for (const d of meals?.dynamic ?? []) {
      const ids = [...d.results.map((r) => r.item), ...(d.ingredientTag ? membersOf(cat, d.ingredientTag) : [])];
      out.set(d.id, lower(`${dynamicTitle(d, name)} ${ids.map((id) => `${name(id)} ${id}`).join(' ')}`));
    }
    if (meals?.skillet) out.set(meals.skillet.id, lower(skilletHay(meals.skillet, cat, name)));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meals, cat, items]);

  if (meals === undefined) return <div className="empty">Загружаю блюда…</div>;
  if (meals === null) return <div className="empty">Сборные блюда не собраны — выполните npm run mods</div>;

  const words = lower(query).split(/\s+/).filter(Boolean);
  const match = (key: string) => words.every((w) => hay.get(key)?.includes(w));
  const families = meals.families.filter((f) => match(f.id));
  const computed = meals.computed.filter((c) => match(c.kind));
  const dynamic = (meals.dynamic ?? []).filter((d) => match(d.id));
  const skillet = meals.skillet && match(meals.skillet.id) ? meals.skillet : null;
  const shownCount = families.length + computed.length + dynamic.length + (skillet ? 1 : 0);

  return (
    <>
      <div className={cx(shell.filters, shell.filtersEnd)}>
        <label className={cx(shell.search, styles.grow)}>
          <Search size={15} className="faint" />
          <input
            placeholder="Блюдо или продукт: сэндвич, сыр, томат…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <p className={cx('faint', 'small', shell.note)}>
        Сборное блюдо — еда, питательность которой складывается из того, что в неё положили: к значениям самого блюда
        прибавляется доля от каждого ингредиента. Поиск по продукту показывает блюда, в которые он годится. Состав тегов
        — с учётом правок KubeJS{hiddenRecipes > 0 ? `; рецептов, удалённых KubeJS, скрыто: ${hiddenRecipes}` : ''}. В
        игре не проверялось. Показано {shownCount} из{' '}
        {meals.families.length + meals.computed.length + (meals.dynamic?.length ?? 0) + (meals.skillet ? 1 : 0)}.
      </p>
      {shownCount === 0 ? (
        <div className="empty">Ничего не подходит.</div>
      ) : (
        <ul className={styles.grid}>
          {computed.map((c) => (
            <ComputedCard key={c.kind} c={c} cat={cat} items={items} food={food} />
          ))}
          {dynamic.map((d) => (
            <DynamicCard
              key={d.id}
              d={d}
              order={meals.nutrients ?? [...NUTRIENTS]}
              cat={cat}
              items={items}
              food={food}
              setting={setting}
            />
          ))}
          {skillet && (
            <SkilletCard
              s={skillet}
              order={meals.nutrients ?? [...NUTRIENTS]}
              cat={cat}
              items={items}
              food={food}
              Shell={MealShell}
            />
          )}
          {families.map((f) => (
            <FamilyCard key={f.id + f.slots.map((s) => s.key).join()} f={f} cat={cat} items={items} food={food} />
          ))}
        </ul>
      )}
    </>
  );
}
