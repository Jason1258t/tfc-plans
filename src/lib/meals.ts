import { useEffect, useState } from 'react';
import type { Nutrient } from './reference';
import { directMembers, flattenTag, tagKey, type TagCatalog } from './tags';

/**
 * Сборные блюда (public/meals.json, собирает scripts/mods/meals.mjs): еда, питательность которой зависит от того,
 * что в неё положили. Семейства — из рецептов с модификатором tfc:meal, суп и салат — из кода TFC.
 */
export interface MealFood {
  hunger: number;
  saturation: number;
  water: number;
  decay: number;
  nutrients: Partial<Record<Nutrient, number>>;
}

/** Доля ингредиента в блюде: множители к его питательным группам, воде и насыщению */
export interface MealPortion {
  items?: string[];
  tags?: string[];
  nutrient: number;
  water: number;
  saturation: number;
  /** Доля основы (хлеб у сэндвича) — у каждого блюда семейства основа своя */
  base: boolean;
}

export interface MealSlot {
  key: string;
  items: string[];
  tags: string[];
  /** Еда (в рецепте стоит «не испорчено») или инструмент/посуда */
  food: boolean;
  min: number;
  max: number;
}

export interface MealDish {
  item: string;
  bases: string[];
  recipes: string[];
  /** Что получается дальше с той же питательностью (сырая пицца → пицца из печи) */
  next?: { item: string; type: string; recipe: string };
}

export interface MealFamily {
  id: string;
  dishes: MealDish[];
  slots: MealSlot[];
  /** Сколько штук основы идёт в блюдо (0 — основы нет) */
  baseCount: number;
  base: MealFood;
  portions: MealPortion[];
  types: string[];
  sources: string[];
  recipes: number;
}

/** Суп и салат: всё складывается и умножается на scale (у супа — ещё делится на число порций) */
export interface ComputedMeal {
  kind: string;
  hunger: number;
  decay: number;
  baseWater?: number;
  baseSaturation?: number;
  scale?: number;
  /** Порций из n ингредиентов: floor(n / div) + add */
  servings?: { div: number; add: number };
  slots?: number;
  tags?: string[];
  results: { nutrient: Nutrient; item: string }[];
  pots?: {
    recipe: string;
    count: number;
    tags: string[];
    fluid: string | null;
    amount: number | null;
    duration: number | null;
    temperature: number | null;
  }[];
}

export interface Meals {
  families: MealFamily[];
  computed: ComputedMeal[];
}

let promise: Promise<Meals | null> | null = null;
let loaded: Meals | null | undefined;

export function loadMeals(): Promise<Meals | null> {
  promise ??= fetch(`${import.meta.env.BASE_URL}meals.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Meals>) : null))
    .catch(() => null)
    .then((d) => (loaded = d?.families ? d : null));
  return promise;
}

/** undefined — грузится, null — файла нет (библиотека собрана старой версией) */
export function useMeals(): Meals | null | undefined {
  const [meals, setMeals] = useState(loaded);
  useEffect(() => {
    if (meals === undefined) loadMeals().then(setMeals);
  }, [meals]);
  return meals;
}

/** Общее название семейства: «Бутерброд на … хлебе» из названий всех его блюд */
export function familyTitle(names: string[]): string {
  if (names.length < 2) return names[0] ?? '';
  const words = names.map((n) => n.split(' '));
  const shortest = Math.min(...words.map((w) => w.length));
  let head = 0;
  while (head < shortest && words.every((w) => w[head] === words[0][head])) head++;
  let tail = 0;
  while (tail < shortest - head && words.every((w) => w[w.length - 1 - tail] === words[0][words[0].length - 1 - tail]))
    tail++;
  if (!head && !tail) return names[0];
  const first = words[0];
  return [...first.slice(0, head), '…', ...first.slice(first.length - tail)].join(' ');
}

export const COMPUTED_TITLE: Record<string, string> = { soups: 'Суп', salads: 'Салат' };

/** Предметы тега со всеми вложенными тегами, с учётом правок KubeJS */
export function tagItems(cat: TagCatalog | null, tag: string): string[] {
  if (!cat) return [];
  return flattenTag(cat, 'item', directMembers(cat.byKey.get(tagKey('item', tag))));
}

export interface MealRef {
  key: string;
  title: string;
}

/**
 * В какие сборные блюда годится продукт: предмет → блюда, где он стоит в слоте сам или через тег начинки.
 * Основа (хлеб) и инструменты не считаются. name — название предмета для заголовка семейства.
 */
export function mealsByItem(meals: Meals, cat: TagCatalog, name: (id: string) => string): Map<string, MealRef[]> {
  const out = new Map<string, MealRef[]>();
  const add = (id: string, ref: MealRef) => {
    const list = out.get(id) ?? [];
    if (!list.some((r) => r.title === ref.title)) list.push(ref);
    out.set(id, list);
  };
  for (const c of meals.computed) {
    const ref = { key: c.kind, title: COMPUTED_TITLE[c.kind] ?? c.kind };
    const tags = [...(c.tags ?? []), ...(c.pots ?? []).flatMap((p) => p.tags)].filter((t) => !/bowl/.test(t));
    for (const t of new Set(tags)) for (const id of tagItems(cat, t)) add(id, ref);
  }
  for (const f of meals.families) {
    const ref = { key: f.id, title: familyTitle(f.dishes.map((d) => name(d.item))) };
    for (const s of f.slots) {
      if (!s.food) continue;
      for (const id of s.items) add(id, ref);
      for (const t of s.tags) for (const id of tagItems(cat, t)) add(id, ref);
    }
  }
  return out;
}

// ---------------------------------------------------------------- калькулятор

/** Питательность продукта из справочника еды — то, что складывается в блюдо */
export interface FoodValues {
  saturation: number;
  water: number;
  nutrients: Partial<Record<Nutrient, number>>;
}

export interface MealResult extends MealFood {
  /** Суп: сколько порций получится; значения result — на одну порцию */
  servings?: number;
  /** Суп и салат: какой предмет получится (по самой большой питательной группе) */
  item?: string;
}

const NUTRIENT_ORDER: Nutrient[] = ['grain', 'fruit', 'vegetables', 'protein', 'dairy'];

/**
 * Блюдо из рецепта tfc:meal (как MealModifier.apply): значения блюда + по каждому продукту
 * «его значение × множитель доли × количество». Долю выбирает первая подходящая по ингредиенту,
 * доля без ингредиента — для остальных; продукт без доли ничего не добавляет.
 */
export function calcMeal(
  f: MealFamily,
  picked: { id: string; base?: boolean }[],
  food: (id: string) => FoodValues | undefined,
  cat: TagCatalog | null,
): MealResult {
  const out: MealResult = { ...f.base, nutrients: { ...f.base.nutrients } };
  const portionFor = (p: { id: string; base?: boolean }) =>
    f.portions.find((x) => {
      if (x.base) return !!p.base;
      if (!x.items?.length && !x.tags?.length) return true;
      return !!x.items?.includes(p.id) || !!x.tags?.some((t) => tagItems(cat, t).includes(p.id));
    });
  for (const p of picked) {
    const v = food(p.id);
    const portion = portionFor(p);
    if (!v || !portion) continue;
    out.water += v.water * portion.water;
    out.saturation += v.saturation * portion.saturation;
    for (const n of NUTRIENT_ORDER)
      if (v.nutrients[n]) out.nutrients[n] = (out.nutrients[n] ?? 0) + (v.nutrients[n] ?? 0) * portion.nutrient;
  }
  return out;
}

/** Суп и салат (как SoupPotRecipe / SaladContainer): сумма по продуктам × scale, у супа — ещё / число порций */
export function calcComputed(
  c: ComputedMeal,
  picked: string[],
  food: (id: string) => FoodValues | undefined,
): MealResult {
  const servings = c.servings ? Math.floor(picked.length / c.servings.div) + c.servings.add : undefined;
  const k = (c.scale ?? 1) / (servings ?? 1);
  const out: MealResult = {
    hunger: c.hunger,
    decay: c.decay,
    water: c.baseWater ?? 0,
    saturation: c.baseSaturation ?? 0,
    nutrients: {},
    servings,
  };
  for (const id of picked) {
    const v = food(id);
    if (!v) continue;
    out.water += v.water * k;
    out.saturation += v.saturation * k;
    for (const n of NUTRIENT_ORDER)
      if (v.nutrients[n]) out.nutrients[n] = (out.nutrients[n] ?? 0) + (v.nutrients[n] ?? 0) * k;
  }
  // Вид блюда — первая из самых больших групп (сравнение строгое, порядок групп как в игре)
  let best: Nutrient | null = null;
  for (const n of NUTRIENT_ORDER) if ((out.nutrients[n] ?? 0) > (best ? (out.nutrients[best] ?? 0) : 0)) best = n;
  out.item = c.results.find((r) => r.nutrient === best)?.item;
  return out;
}
