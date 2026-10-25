import { useMemo, useState } from 'react';
import type { TagCatalog } from '@/shared/pack-data';
import { itemName, type ItemIndex, ItemIcon } from '@/shared/pack-data';
import {
  calcComputed,
  calcDynamic,
  calcMeal,
  tagItems,
  type ComputedMeal,
  type DynamicMeal,
  type FoodValues,
  type MealFamily,
  type MealResult,
} from '@/lib/meals';
import { NUTRIENTS, type Nutrient } from '@/lib/reference';
import { cx } from '@/shared/lib';
import { Select } from '@/shared/ui';
import styles from './MealsTab.module.css';

const NUTRIENT_LABEL: Record<Nutrient, string> = {
  grain: 'зерновые',
  fruit: 'фрукты',
  vegetables: 'овощи',
  protein: 'белок',
  dairy: 'молочное',
};
const ru = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

export type FoodLookup = (id: string) => FoodValues | undefined;

interface Field {
  key: string;
  label: string;
  options: string[];
  required: boolean;
  base?: boolean;
  /** Ключ слота начинки — для сверки набора с вариантами рецепта */
  slot?: string;
}

function Result({ r, items }: { r: MealResult; items: ItemIndex | null }) {
  return (
    <div className={cx(styles.result, 'small')}>
      {r.item && (
        <span className={styles.chip}>
          <ItemIcon id={r.item} size={20} tip={false} />
          <b>{itemName(items?.byId.get(r.item), r.item)}</b>
        </span>
      )}
      {r.servings ? <span>порций: {r.servings}, в каждой:</span> : null}
      <span>сытость {r.hunger}</span>
      <span>насыщение {ru(r.saturation)}</span>
      <span>вода {ru(r.water)}</span>
      {NUTRIENTS.filter((n) => r.nutrients[n]).map((n) => (
        <span key={n} className={`nut nut-${n}`}>
          {NUTRIENT_LABEL[n]} {ru(r.nutrients[n] ?? 0)}
        </span>
      ))}
      <span>порча ×{ru(r.decay)}</span>
    </div>
  );
}

/** Поля выбора продуктов: список — только еда со значениями в справочнике */
function Fields({
  fields,
  value,
  onChange,
  items,
}: {
  fields: Field[];
  value: Record<string, string>;
  onChange: (key: string, id: string) => void;
  items: ItemIndex | null;
}) {
  const name = (id: string) => itemName(items?.byId.get(id), id);
  // Одинаковые названия у предметов разных модов («Помидор» в TFC и в Farmer's Delight) — дописываем мод
  const label = (options: string[], id: string) =>
    options.some((o) => o !== id && name(o) === name(id)) ? `${name(id)} (${id.split(':')[0]})` : name(id);
  return (
    <div className={styles.calcFields}>
      {fields.map((f) => (
        <label key={f.key}>
          <span className="faint small">{f.label}</span>
          <Select value={value[f.key] ?? ''} onChange={(e) => onChange(f.key, e.target.value)}>
            <option value="">{f.required ? '— выберите —' : '— пусто —'}</option>
            {f.options.map((id) => (
              <option key={id} value={id}>
                {label(f.options, id)}
              </option>
            ))}
          </Select>
        </label>
      ))}
    </div>
  );
}

function useSorted(ids: string[], items: ItemIndex | null, food: FoodLookup) {
  return useMemo(
    () =>
      [...new Set(ids)]
        .filter((id) => food(id))
        .sort((a, b) => itemName(items?.byId.get(a), a).localeCompare(itemName(items?.byId.get(b), b), 'ru')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids.join(), items, food],
  );
}

/** Калькулятор блюда из рецепта: основа (если есть) и по полю на каждое место начинки */
export function FamilyCalc({
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
  const [value, setValue] = useState<Record<string, string>>({});
  const baseOptions = useSorted(
    f.dishes.flatMap((d) => d.bases),
    items,
    food,
  );
  const slots = f.slots.filter((s) => s.food);
  const slotOptions = useMemo(
    () => new Map(slots.map((s) => [s.key, [...s.items, ...s.tags.flatMap((t) => tagItems(cat, t))]])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f, cat],
  );
  const name = (id: string) => itemName(items?.byId.get(id), id);
  const fields: Field[] = [];
  if (f.baseCount > 0)
    fields.push({ key: 'base', label: `Основа ×${f.baseCount}`, options: baseOptions, required: true, base: true });
  for (const s of slots) {
    const options = [...new Set(slotOptions.get(s.key) ?? [])]
      .filter((id) => food(id))
      .sort((a, b) => name(a).localeCompare(name(b), 'ru'));
    const label = s.tags.length ? `#${s.tags[0].split(':')[1]}` : s.items.length === 1 ? name(s.items[0]) : 'на выбор';
    for (let i = 0; i < s.max; i++)
      fields.push({ key: `${s.key}|${i}`, label, options, required: i < s.min, slot: s.key });
  }
  // Единственный вариант подставляется сам
  const chosen = (fl: Field) => value[fl.key] ?? (fl.required && fl.options.length === 1 ? fl.options[0] : '');
  const picked = fields.flatMap((fl) => {
    const id = chosen(fl);
    if (!id) return [];
    return Array.from({ length: fl.base ? f.baseCount : 1 }, () => ({ id, base: fl.base }));
  });
  const missing = fields.filter((fl) => fl.required && !chosen(fl)).length;
  // Набор должен совпасть с одним из вариантов рецепта: у бутерброда с вареньем — варенье ИЛИ заготовка
  // и не больше двух начинок, хотя по отдельности каждый слот допускает больше
  const counts = new Map<string, number>();
  for (const fl of fields) if (!fl.base && chosen(fl)) counts.set(fl.slot!, (counts.get(fl.slot!) ?? 0) + 1);
  const fits = (combo: Record<string, number>) =>
    slots.every((sl) => (combo[sl.key] ?? 0) === (counts.get(sl.key) ?? 0));
  const valid = !f.combos?.length || f.combos.some(fits);
  const slotLabel = new Map(fields.filter((fl) => fl.slot).map((fl) => [fl.slot!, fl.label]));
  // Варианты рецепта, сгруппированные по набору слотов: «#jam ×1 + #usable_in_jam_sandwich ×0–2»
  const multi = new Set(slots.filter((sl) => f.combos?.some((c) => (c[sl.key] ?? 0) > 1)).map((sl) => sl.key));
  const groups = new Map<string, Record<string, number>[]>();
  for (const combo of f.combos ?? []) {
    const key = Object.keys(combo)
      .filter((k) => !multi.has(k))
      .sort()
      .join('|');
    groups.set(key, [...(groups.get(key) ?? []), combo]);
  }
  const shapes = [...groups.values()].map((list) => {
    const shape = new Map<string, number[]>();
    for (const sl of slots)
      if (list.some((c) => (c[sl.key] ?? 0) > 0))
        shape.set(
          sl.key,
          list.map((c) => c[sl.key] ?? 0),
        );
    return shape;
  });
  const shapeText = shapes.map((shape) =>
    [...shape]
      .map(([k, ns]) => {
        const [lo, hi] = [Math.min(...ns), Math.max(...ns)];
        return `${slotLabel.get(k) ?? k} ×${lo === hi ? hi : `${lo}–${hi}`}`;
      })
      .join(' + '),
  );
  const shown = Object.fromEntries(fields.map((fl) => [fl.key, chosen(fl)]));
  return (
    <details className={styles.calc}>
      <summary>Калькулятор</summary>
      <Fields fields={fields} value={shown} onChange={(k, id) => setValue((v) => ({ ...v, [k]: id }))} items={items} />
      {missing > 0 ? (
        <p className="faint small">Заполните обязательные места: осталось {missing}.</p>
      ) : !valid ? (
        <p className="faint small">Такого набора нет в рецептах. Возможные: {shapeText.join('; или ')}.</p>
      ) : (
        <Result r={calcMeal(f, picked, food, cat)} items={items} />
      )}
    </details>
  );
}

/** Калькулятор супа и салата: до N продуктов из тега */
export function ComputedCalc({
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
  const [value, setValue] = useState<Record<string, string>>({});
  const counts = (c.pots ?? []).map((p) => p.count);
  // Обязательные продукты рецепта (паслён в вонючем супе) кладутся всегда — выбирать их не нужно
  const fixed = c.pots?.[0]?.fixed ?? [];
  const max = (counts.length ? Math.max(...counts) : (c.slots ?? 0)) - fixed.length;
  const min = (counts.length ? Math.min(...counts) : 1) - fixed.length;
  const tags = [...new Set([...(c.pots ?? []).flatMap((p) => p.tags), ...(c.tags ?? [])])].filter(
    (t) => !/bowl/.test(t),
  );
  const options = useSorted(
    tags.flatMap((t) => tagItems(cat, t)),
    items,
    food,
  );
  const fields: Field[] = Array.from({ length: max }, (_, i) => ({
    key: String(i),
    label: `Продукт ${i + 1}`,
    options,
    required: i < min,
  }));
  const picked = fields.map((fl) => value[fl.key]).filter(Boolean);
  return (
    <details className={styles.calc}>
      <summary>Калькулятор</summary>
      <Fields fields={fields} value={value} onChange={(k, id) => setValue((v) => ({ ...v, [k]: id }))} items={items} />
      {fixed.length > 0 && (
        <p className="faint small">
          Плюс всегда: {fixed.map((id) => itemName(items?.byId.get(id), id)).join(', ')} — уже учтено.
        </p>
      )}
      {picked.length < min ? (
        <p className="faint small">
          Нужно не меньше {min}: выбрано {picked.length}.
        </p>
      ) : (
        <Result r={calcComputed(c, [...picked, ...fixed], food)} items={items} />
      )}
    </details>
  );
}

/** Калькулятор блюда аддона: до N продуктов из тега, множитель и предел — из настроек мода */
export function DynamicCalc({
  d,
  order,
  cat,
  items,
  food,
  mult,
  cap,
}: {
  d: DynamicMeal;
  order: Nutrient[];
  cat: TagCatalog | null;
  items: ItemIndex | null;
  food: FoodLookup;
  mult: number;
  cap: number;
}) {
  const [value, setValue] = useState<Record<string, string>>({});
  const options = useSorted(d.ingredientTag ? tagItems(cat, d.ingredientTag) : [], items, food);
  const fields: Field[] = Array.from({ length: d.slots ?? 1 }, (_, i) => ({
    key: String(i),
    label: `Продукт ${i + 1}`,
    options,
    required: i === 0,
  }));
  const picked = fields.map((fl) => value[fl.key]).filter(Boolean);
  return (
    <details className={styles.calc}>
      <summary>Калькулятор</summary>
      <Fields fields={fields} value={value} onChange={(k, id) => setValue((v) => ({ ...v, [k]: id }))} items={items} />
      {picked.length === 0 ? (
        <p className="faint small">Выберите хотя бы один продукт.</p>
      ) : (
        <Result r={calcDynamic(d, order, picked, food, mult, cap)} items={items} />
      )}
    </details>
  );
}
