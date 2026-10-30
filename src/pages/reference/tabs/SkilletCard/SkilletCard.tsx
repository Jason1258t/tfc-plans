import { Plus, X } from 'lucide-react';
import { Button, Input, Select } from '@/shared/ui';
import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { CONFIG_ORIGIN_LABEL, useModConfig, type ConfigOrigin, type ModConfig } from '@/entities/pack-config';
import type { TagCatalog } from '@/shared/pack-data';
import { itemName, type ItemIndex, ItemIcon } from '@/shared/pack-data';
import {
  calcSkillet,
  skilletNutrients,
  skilletProducts,
  skilletTitle,
  type FoodValues,
  type MealConfigKey,
  type SkilletEntry,
  type SkilletMatch,
  type SkilletMeal,
  type SkilletPick,
  type SkilletState,
} from '@/lib/meals';
import { NUTRIENTS, type Nutrient } from '@/lib/reference';
import { cx } from '@/shared/lib';
import mealStyles from '../MealsTab/MealsTab.module.css';
import styles from './SkilletCard.module.css';

const NUTRIENT_LABEL: Record<Nutrient, string> = {
  grain: 'зерновые',
  fruit: 'фрукты',
  vegetables: 'овощи',
  protein: 'белок',
  dairy: 'молочное',
};
/** Виды продуктов Cuisine Delight (перечисление FoodType) */
const TYPE_LABEL: Record<string, string> = {
  meat: 'мясо',
  seafood: 'рыба и морепродукты',
  veg: 'овощи и фрукты',
  carb: 'крупы и тесто',
  none: 'добавки',
};
const STATE_LABEL: Record<SkilletState, string> = {
  ok: 'готово',
  raw: 'недожарено',
  over: 'пережарено',
  both: 'сырое и пригорело',
};
const ru = (v: number, digits = 2) => String(Math.round(v * 10 ** digits) / 10 ** digits).replace('.', ',');
const sec = (ticks: number) => ru(ticks / 20, 1);
const pct = (v: number) => `${Math.round(v * 100)} %`;

type Setting = { value: number; origin: ConfigOrigin } | null;
type Shell = ComponentType<{ icons: ReactNode; title: string; sub: ReactNode; amount?: string; children: ReactNode }>;
type FoodLookup = (id: string) => FoodValues | undefined;

/** Настройка мода: конфиг сервера → конфиг сборки → значение из кода */
function pick(k: MealConfigKey | null | undefined, server: ModConfig | null | undefined, common: typeof server) {
  if (!k) return null;
  for (const [doc, origin] of [
    [server, 'server'],
    [common, 'config'],
  ] as const) {
    let v: unknown = doc?.values;
    for (const part of k.key.split('.'))
      v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined;
    if (typeof v === 'number') return { value: v, origin } as Setting;
  }
  return typeof k.default === 'number' ? ({ value: k.default, origin: 'default' } as Setting) : null;
}

const entryLine = (e: SkilletEntry) =>
  [
    e.min > 0 ? `жарить ${sec(e.min)}–${sec(e.max)} с` : `жарить не дольше ${sec(e.max)} с`,
    `мешать не реже раза в ${sec(e.stir)} с`,
    e.raw > 0 ? `сырое −${pct(e.raw)}` : '',
    e.over > 0 ? `пережаренное −${pct(e.over)}` : '',
    e.size !== 1 ? `вес ${e.size}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

function Calc({
  s,
  order,
  cat,
  items,
  food,
  capacity,
  set,
}: {
  s: SkilletMeal;
  order: Nutrient[];
  cat: TagCatalog | null;
  items: ItemIndex | null;
  food: FoodLookup;
  capacity: number;
  set: { servings: number; cap: number; penalty: number };
}) {
  const name = (id: string) => itemName(items?.byId.get(id), id);
  const [rows, setRows] = useState<SkilletPick[]>([{ id: '', count: 1, state: 'ok' }]);
  const products = useMemo(() => skilletProducts(s, cat), [s, cat]);
  // В списке — продукты, у которых на сковороде есть питательность; одноимённые из разных модов подписаны модом
  const options = useMemo(
    () =>
      [...products.keys()]
        .filter((id) => skilletNutrients(s, order, id, food, cat)?.values.some((v) => v > 0))
        .sort((a, b) => name(a).localeCompare(name(b), 'ru')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, items, food],
  );
  const label = (id: string) =>
    options.some((o) => o !== id && name(o) === name(id)) ? `${name(id)} (${id.split(':')[0]})` : name(id);
  const update = (i: number, patch: Partial<SkilletPick>) =>
    setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const used = rows.reduce((n, r) => n + (r.id ? r.count : 0), 0);
  const picked = rows.filter((r) => r.id);
  const r = picked.length ? calcSkillet(s, order, picked, food, cat, set) : null;
  return (
    <details className={mealStyles.calc}>
      <summary>Калькулятор</summary>
      <div className={styles.rows}>
        {rows.map((row, i) => (
          <div key={i} className={styles.row}>
            <Select value={row.id} onChange={(e) => update(i, { id: e.target.value })}>
              <option value="">— продукт —</option>
              {options.map((id) => (
                <option key={id} value={id}>
                  {label(id)}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              min={1}
              max={Number.isFinite(capacity) ? capacity : undefined}
              value={row.count}
              title="Сколько штук"
              onChange={(e) => update(i, { count: Math.max(1, Math.min(capacity, Number(e.target.value) || 1)) })}
            />
            <Select
              value={row.state}
              title="Как приготовлен"
              onChange={(e) => update(i, { state: e.target.value as SkilletState })}
            >
              {(Object.keys(STATE_LABEL) as SkilletState[]).map((st) => (
                <option key={st} value={st}>
                  {STATE_LABEL[st]}
                </option>
              ))}
            </Select>
            <Button
              variant="ghost"
              size="sm"
              icon
              title="Убрать"
              disabled={rows.length === 1}
              onClick={() => setRows((x) => x.filter((_, k) => k !== i))}
            >
              <X size={14} />
            </Button>
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={() => setRows((x) => [...x, { id: '', count: 1, state: 'ok' }])}>
        <Plus size={14} /> продукт
      </Button>
      {used > capacity && (
        <p className={cx('small', styles.warn)}>
          Выбрано {used} шт., а на сковороду помещается {capacity}.
        </p>
      )}
      {!r ? (
        <p className="faint small">Выберите хотя бы один продукт.</p>
      ) : (
        <div className={cx(mealStyles.result, 'small')}>
          <span>
            <b>Качество {r.score} %</b>
            {!r.edible && ' — несъедобно'}
          </span>
          {r.dishes.map((id) => (
            <span key={id} className={mealStyles.chip}>
              <ItemIcon id={id} size={20} tip={false} />
              <b>{name(id)}</b>
            </span>
          ))}
          {r.dishes.length > 1 && <span className="faint">(счёт равный — какое из них выйдет, не определить)</span>}
          {r.servings ? <span>порций: {r.servings}, в каждой:</span> : null}
          <span>сытость {r.hunger}</span>
          <span>насыщение {ru(r.saturation)}</span>
          <span>вода {ru(r.water)}</span>
          {NUTRIENTS.filter((n) => r.nutrients[n]).map((n) => (
            <span key={n}>
              {NUTRIENT_LABEL[n]} {ru(r.nutrients[n] ?? 0)}
            </span>
          ))}
          <span>порча ×{ru(r.decay)}</span>
        </div>
      )}
    </details>
  );
}

const matchLine = (m: SkilletMatch, name: (id: string) => string) => {
  const what = [
    ...(m.foodType ? [TYPE_LABEL[m.foodType] ?? m.foodType] : []),
    ...m.items.map(name),
    ...m.tags.map((t) => `#${t}`),
  ].join(' / ');
  return `${what} ${Math.round(m.min * 100)}–${Math.min(100, Math.round(m.max * 100))} %`;
};

/** Карточка «Сковорода Cuisine Delight»: как готовить, формула питательности TFC, продукты, названия блюд */
export function SkilletCard({
  s,
  order,
  cat,
  items,
  food,
  Shell,
}: {
  s: SkilletMeal;
  order: Nutrient[];
  cat: TagCatalog | null;
  items: ItemIndex | null;
  food: FoodLookup;
  Shell: Shell;
}) {
  const name = (id: string) => itemName(items?.byId.get(id), id);
  const addonFile = s.nutrients.servingsConfig?.file ?? s.nutrients.capConfig?.file ?? '';
  const baseFile = s.capacityConfig?.file ?? '';
  const addonServer = useModConfig(addonFile, 'server');
  const addonCommon = useModConfig(addonFile, 'config');
  const baseServer = useModConfig(baseFile, 'server');
  const baseCommon = useModConfig(baseFile, 'config');
  const servings = pick(s.nutrients.servingsConfig, addonServer, addonCommon);
  const cap = pick(s.nutrients.capConfig, addonServer, addonCommon);
  const penalty = pick(s.penalty?.config, addonServer, addonCommon);
  const capacity = pick(s.capacityConfig, baseServer, baseCommon);
  const origin = (x: Setting) => (x ? ` (${CONFIG_ORIGIN_LABEL[x.origin]})` : '');

  // Продукты записи с питательностью на сковороде; без неё продукт можно жарить, но блюду он ничего не даст
  const groups = useMemo(
    () => {
      const all = [...skilletProducts(s, cat)];
      return s.entries.map((e) => {
        const ids = all.filter(([, x]) => x === e).map(([id]) => id);
        const list = ids
          .map((id) => ({ id, n: skilletNutrients(s, order, id, food, cat) }))
          .filter((x) => x.n?.values.some((v) => v > 0))
          .sort((a, b) => name(a.id).localeCompare(name(b.id), 'ru'));
        return { e, list, hidden: ids.length - list.length };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, cat, items, food],
  );
  const shown = groups.filter((g) => g.list.length > 0);
  // Одинаковые названия у продуктов разных модов («Сырая говядина» в TFC и в ванили) — дописываем мод
  const names = new Map<string, number>();
  for (const g of shown) for (const x of g.list) names.set(name(x.id), (names.get(name(x.id)) ?? 0) + 1);
  const label = (id: string) => ((names.get(name(id)) ?? 0) > 1 ? `${name(id)} (${id.split(':')[0]})` : name(id));
  const hidden = groups.reduce((n, g) => n + g.hidden, 0);
  const waterFrom = s.water.from.map((n) => NUTRIENT_LABEL[n]).join(' + ');
  const onlyPlaced = s.hook?.hooked.includes('useOn') && s.hook.missed.includes('use');

  return (
    <Shell
      icons={
        <>
          {s.block && <ItemIcon id={s.block} size={28} />}
          {s.plate && <ItemIcon id={s.plate} size={28} />}
        </>
      }
      title={skilletTitle(s, name)}
      sub={`формула из кода мода ${s.ns}`}
      amount={capacity ? `до ${capacity.value} продуктов` : undefined}
    >
      <section>
        <h4>Как готовить</h4>
        <ul className={cx(mealStyles.portions, 'small')}>
          <li>
            Продукты кладут на горячую сковороду, помешивают лопаткой и снимают тарелкой
            {capacity ? `; помещается ${capacity.value}${origin(capacity)}` : ''}.
          </li>
          <li>
            У каждого продукта своё время: снятый раньше — сырой, позже — пережаренный; если долго не мешать — пригорает
            (штраф как за пережаренный).
          </li>
          {s.slow && (
            <li>
              На слабом огне (<code>#{s.slow.tag}</code>) время идёт в {ru(1 / s.slow.speed)} раза медленнее.
            </li>
          )}
          <li>
            <b>Качество</b> = 100 % минус штрафы продуктов, взвешенные по их весу
            {s.minScore !== undefined ? `; ниже ${s.minScore} % блюдо несъедобно` : ''}.
          </li>
          {onlyPlaced && (
            <li>
              <b>Снимайте блюдо со сковороды, стоящей блоком.</b> Расчёт питательности TFC подключён только к этому
              способу; если снять тарелкой со сковороды в руке, блюдо останется без питательных групп.
            </li>
          )}
        </ul>
      </section>
      <section>
        <h4>Что получится</h4>
        <ul className={cx(mealStyles.portions, 'small')}>
          <li>
            <b>Питательные группы:</b> сумма по всем продуктам
            {s.nutrients.dropMin ? '; самая маленькая группа обнуляется' : ''}; остальное × качество
            {servings ? ` ÷ ${ru(servings.value)}${origin(servings)}` : ''}
            {cap ? `; не больше ${ru(cap.value)} на группу${origin(cap)}` : ''}
          </li>
          {s.servingsInDish && servings && (
            <li>
              <b>Порций в блюде:</b> {ru(servings.value)} — значения ниже и в калькуляторе даны на одну порцию
            </li>
          )}
          <li>
            <b>Вода:</b> ({waterFrom}){s.water.mul !== 1 ? ` × ${ru(s.water.mul)}` : ''} — от итоговых групп
          </li>
          <li>
            <b>Насыщение:</b> {ru(s.saturationPerItem)} за каждый продукт
          </li>
          <li>
            <b>Порча:</b> наибольшая среди продуктов × {ru(s.decay.mul)}
          </li>
          <li>
            <b>Всегда:</b> сытость {s.hunger}
          </li>
          {s.penalty && penalty && (
            <li>
              <b>{name(s.penalty.item)}</b> (набор не подошёл ни под одно блюдо): группы ещё × {ru(penalty.value)}
              {origin(penalty)}. У остальных блюд название на питательность не влияет.
            </li>
          )}
        </ul>
      </section>
      <section>
        <h4>Продукты</h4>
        <div className={styles.groups}>
          {shown.map(({ e, list }, i) => (
            <details key={i} className={mealStyles.tag}>
              <summary>
                <b>
                  {TYPE_LABEL[e.type] ?? e.type}: {list.length === 1 ? name(list[0].id) : `${list.length} предм.`}
                </b>{' '}
                <span className="faint">{entryLine(e)}</span>
              </summary>
              <ul className={cx(styles.products, 'small')}>
                {list.map(({ id, n }) => (
                  <li key={id}>
                    <ItemIcon id={id} size={20} tip={false} />
                    <span className="grow">{label(id)}</span>
                    <span className="faint">
                      {order
                        .map((g, k) => (n!.values[k] ? `${NUTRIENT_LABEL[g]} ${ru(n!.values[k])}` : ''))
                        .filter(Boolean)
                        .join(', ')}
                      {n!.cooked ? ' — как жареный' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
        <p className="faint small">
          Питательность — на одну штуку до деления на порции. «Как жареный» — у продукта своя запись для сковороды, она
          заменяет его обычную питательность.
          {hidden > 0 ? ` Ещё ${hidden} продуктов жарить можно, но питательности TFC у них нет — не показаны.` : ''}
        </p>
      </section>
      <section>
        <details className={mealStyles.tag}>
          <summary>
            <b>Названия блюд</b> <span className="faint">{s.dishes.length} рецептов, доли продуктов по весу</span>
          </summary>
          <ul className={cx(styles.products, 'small')}>
            {s.dishes.map((d) => (
              <li key={d.recipe}>
                <ItemIcon id={d.item} size={20} tip={false} />
                <span className="grow">
                  <b>{name(d.item)}</b>
                  {d.list.length ? `: ${d.list.map((m) => matchLine(m, name)).join('; ')}` : ': всё остальное'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </section>
      <Calc
        s={s}
        order={order}
        cat={cat}
        items={items}
        food={food}
        capacity={capacity?.value ?? Infinity}
        set={{ servings: servings?.value ?? 1, cap: cap?.value ?? Infinity, penalty: penalty?.value ?? 1 }}
      />
    </Shell>
  );
}
