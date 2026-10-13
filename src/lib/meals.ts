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
  /** Наборы начинок, для которых есть рецепт: ключ слота → сколько штук */
  combos?: Record<string, number>[];
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
  /** Вместо scale: множитель «1 − fade × число продуктов», на порции не делится (вонючий суп Firmalife) */
  fade?: number;
  /** Мод, в коде которого формула */
  mod?: string;
  /** Блюдо одного вида — предмет на выходе */
  item?: string;
  /** За раз собирается столько блюд, сколько в наименьшей стопке продуктов и посуды, но не больше batch */
  batch?: number;
  /** Наименьшее число продуктов для блюда из окна сборки */
  minItems?: number;
  /** Порций из n ингредиентов: floor(n / div) + add */
  servings?: { div: number; add: number };
  slots?: number;
  tags?: string[];
  results: { nutrient: Nutrient; item: string }[];
  pots?: {
    recipe: string;
    count: number;
    tags: string[];
    /** Обязательные продукты рецепта, названные прямо; входят в count */
    fixed?: string[];
    fluid: string | null;
    amount: number | null;
    duration: number | null;
    temperature: number | null;
  }[];
}

/** Настройка мода, от которой зависит формула: ключ в TOML, значение по умолчанию из кода, файл конфига */
export interface MealConfigKey {
  key: string;
  default: number | null;
  file: string | null;
}

/**
 * Блюдо аддона без рецепта (вок и кастрюля Kaleidoscope через ktfcc): если набор продуктов не подошёл ни под один
 * рецепт посуды, а все продукты входят в тег, питательность считается формулой из кода аддона.
 */
export interface DynamicMeal {
  id: string;
  kind: string;
  ns: string;
  hunger: number;
  /** Насыщение за каждый положенный продукт */
  saturationPerItem: number;
  /** Порча: наибольшая среди продуктов × mul */
  decay: { of: 'max'; mul: number };
  /** Группы: сумма по продуктам; dropMin — самая малая обнуляется; × множитель; cap — не больше предела */
  nutrients: {
    dropMin: boolean;
    mult: boolean;
    cap: boolean;
    multConfig?: MealConfigKey | null;
    capConfig?: MealConfigKey | null;
  };
  /** Вода: сумма итоговых групп from × mul + add */
  water: { from: Nutrient[]; mul: number; add: number };
  ingredientTag?: string;
  carrierTag?: string;
  ticks?: number;
  slots?: number;
  /** Предмет посуды */
  block?: string;
  results: { nutrient: Nutrient; item: string }[];
}

/** Запись продукта для сковороды Cuisine Delight: время в тиках, штрафы — доля оценки */
export interface SkilletEntry {
  items: string[];
  tags: string[];
  /** Вид продукта: meat, seafood, veg, carb, none */
  type: string;
  /** Жарить не меньше min и не больше max */
  min: number;
  max: number;
  /** Наибольший перерыв между помешиваниями */
  stir: number;
  /** Штраф за недожаренное и за пережаренное/пригоревшее */
  raw: number;
  over: number;
  /** Вес продукта в оценке и в долях рецепта */
  size: number;
}

export interface SkilletMatch {
  items: string[];
  tags: string[];
  /** Любой продукт этого вида */
  foodType?: string;
  min: number;
  max: number;
  score: number;
  bonus: number;
}

/**
 * Сковорода Cuisine Delight (meals.json → skillet, собирает scripts/mods/cuisine.mjs): продукты жарят и снимают
 * тарелкой, питательность TFC считает аддон совместимости из продуктов и оценки готовки.
 */
export interface SkilletMeal {
  id: string;
  ns: string;
  hunger: number;
  saturationPerItem: number;
  decay: { of: 'max'; mul: number };
  nutrients: {
    dropMin: boolean;
    /** Оценка делится на это число (проценты) */
    scoreDivisor: number | null;
    /** Сумма делится на число порций */
    servingsConfig: MealConfigKey | null;
    capConfig: MealConfigKey | null;
  };
  /** В блюде столько же порций, на сколько делится сумма */
  servingsInDish: boolean;
  water: { from: Nutrient[]; mul: number; add: number };
  entries: SkilletEntry[];
  /** Питательность продукта «в жареном виде» (по порядку групп) — заменяет его собственную */
  cooked: { items: string[]; tags: string[]; nutrients: number[] }[];
  dishes: { recipe: string; item: string; list: SkilletMatch[] }[];
  /** Блюдо, у которого группы дополнительно умножаются на настройку */
  penalty?: { item: string; config: MealConfigKey | null };
  /** Оценка ниже — блюдо несъедобно */
  minScore?: number;
  /** На блоках из тега время идёт медленнее */
  slow?: { speed: number; tag: string };
  heatTag?: string;
  capacityConfig?: MealConfigKey | null;
  /** Какие способы снять блюдо аддон подменил (useOn — по стоящей сковороде), а какие нет (use — сковорода в руке) */
  hook?: { hooked: string[]; missed: string[] };
  block?: string;
  plate?: string;
}

export interface Meals {
  families: MealFamily[];
  computed: ComputedMeal[];
  dynamic?: DynamicMeal[];
  skillet?: SkilletMeal;
  /** Порядок питательных групп в игре (перечисление Nutrient) */
  nutrients?: Nutrient[];
}

/** Заголовок блюда аддона: название посуды */
export const dynamicTitle = (d: DynamicMeal, name: (id: string) => string) =>
  `${d.block ? name(d.block) : d.id}: блюдо без рецепта`;

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

/** Заголовок блюда из кода: суп и салат — по виду, блюдо одного вида — название предмета */
export const computedTitle = (c: ComputedMeal, name: (id: string) => string) =>
  COMPUTED_TITLE[c.kind] ?? (c.item ? name(c.item) : c.kind);

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
    const ref = { key: c.kind, title: computedTitle(c, name) };
    const tags = [...(c.tags ?? []), ...(c.pots ?? []).flatMap((p) => p.tags)].filter((t) => !/bowl/.test(t));
    for (const t of new Set(tags)) for (const id of tagItems(cat, t)) add(id, ref);
  }
  for (const d of meals.dynamic ?? []) {
    const ref = { key: d.id, title: dynamicTitle(d, name) };
    if (d.ingredientTag) for (const id of tagItems(cat, d.ingredientTag)) add(id, ref);
  }
  if (meals.skillet) {
    const ref = { key: meals.skillet.id, title: skilletTitle(meals.skillet, name) };
    for (const id of skilletProducts(meals.skillet, cat).keys()) add(id, ref);
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

/** Заголовок карточки сковороды: название посуды */
export const skilletTitle = (s: SkilletMeal, name: (id: string) => string) =>
  `${s.block ? name(s.block) : s.id}: блюдо на тарелке`;

/** Строка поиска карточки сковороды: названия продуктов и блюд */
export function skilletHay(s: SkilletMeal, cat: TagCatalog | null, name: (id: string) => string): string {
  const ids = [...skilletProducts(s, cat).keys(), ...s.dishes.map((d) => d.item)];
  return `${skilletTitle(s, name)} сковорода ${ids.map((id) => `${name(id)} ${id}`).join(' ')}`;
}

/** Продукт → его запись для сковороды; предмет, названный прямо, важнее попавшего через тег */
export function skilletProducts(s: SkilletMeal, cat: TagCatalog | null): Map<string, SkilletEntry> {
  const out = new Map<string, SkilletEntry>();
  for (const e of s.entries) for (const id of e.items) if (!out.has(id)) out.set(id, e);
  for (const e of s.entries)
    for (const t of e.tags) for (const id of tagItems(cat, t)) if (!out.has(id)) out.set(id, e);
  return out;
}

/** Питательность продукта на сковороде: запись «в жареном виде», иначе его собственная еда TFC */
export function skilletNutrients(
  s: SkilletMeal,
  order: Nutrient[],
  id: string,
  food: (id: string) => FoodValues | undefined,
  cat: TagCatalog | null,
): { values: number[]; cooked: boolean } | null {
  const c = s.cooked.find((x) => x.items.includes(id) || x.tags.some((t) => tagItems(cat, t).includes(id)));
  if (c) return { values: c.nutrients, cooked: true };
  const v = food(id);
  return v ? { values: order.map((n) => v.nutrients[n] ?? 0), cooked: false } : null;
}

// ---------------------------------------------------------------- калькулятор

/** Питательность продукта из справочника еды — то, что складывается в блюдо */
export interface FoodValues {
  /** Множитель порчи продукта — нужен блюдам аддонов */
  decay?: number;
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
  const k = c.fade !== undefined ? 1 - c.fade * picked.length : (c.scale ?? 1) / (servings ?? 1);
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
  out.item = c.item ?? c.results.find((r) => r.nutrient === best)?.item;
  return out;
}

/**
 * Блюдо аддона (как ktfcc Utils.getFinalNutrients + setDynamicNutrientRecipe): группы складываются, самая малая
 * обнуляется (при равных — последняя по порядку групп), остальные × множитель и обрезаются по пределу;
 * вода — из итоговых групп, насыщение — по числу продуктов, порча — наибольшая среди продуктов × коэффициент.
 */
export function calcDynamic(
  d: DynamicMeal,
  order: Nutrient[],
  picked: string[],
  food: (id: string) => FoodValues | undefined,
  mult: number,
  cap: number,
): MealResult {
  const sum = order.map(() => 0);
  let decay = 0;
  for (const id of picked) {
    const v = food(id);
    if (!v) continue;
    order.forEach((n, i) => (sum[i] += v.nutrients[n] ?? 0));
    decay = Math.max(decay, v.decay ?? 0);
  }
  if (d.nutrients.dropMin) {
    const min = Math.min(...sum);
    sum[sum.lastIndexOf(min)] = 0;
  }
  const final = sum.map((v) => {
    const x = d.nutrients.mult ? v * mult : v;
    return d.nutrients.cap ? Math.min(x, cap) : x;
  });
  const nutrients: Partial<Record<Nutrient, number>> = {};
  order.forEach((n, i) => {
    if (final[i]) nutrients[n] = final[i];
  });
  let best = 0;
  final.forEach((v, i) => {
    if (v > final[best]) best = i;
  });
  return {
    hunger: d.hunger,
    decay: decay * d.decay.mul,
    saturation: d.saturationPerItem * picked.length,
    water: d.water.from.reduce((a, n) => a + (nutrients[n] ?? 0), 0) * d.water.mul + d.water.add,
    nutrients,
    item: d.results.find((r) => r.nutrient === order[best])?.item,
  };
}

export type SkilletState = 'ok' | 'raw' | 'over' | 'both';

export interface SkilletPick {
  id: string;
  count: number;
  state: SkilletState;
}

export interface SkilletResult extends MealResult {
  /** Оценка готовки, % */
  score: number;
  edible: boolean;
  /** Подходящие блюда с наибольшим счётом: больше одного — в игре возьмётся первое по порядку загрузки рецептов */
  dishes: string[];
  penalized: boolean;
}

/**
 * Блюдо со сковороды (как CookedFoodData.of + BaseCuisineRecipe.findBestMatch в Cuisine Delight и подмена выдачи
 * тарелкой в cuisinetfc). Оценка = 100 × (1 − Σ размер × штраф / Σ размер); группы = Σ питательность × штук,
 * самая малая обнуляется, × оценка / 100 / число порций, не больше предела; у штрафного блюда — ещё × множитель.
 */
export function calcSkillet(
  s: SkilletMeal,
  order: Nutrient[],
  picked: SkilletPick[],
  food: (id: string) => FoodValues | undefined,
  cat: TagCatalog | null,
  set: { servings: number; cap: number; penalty: number },
): SkilletResult {
  const products = skilletProducts(s, cat);
  const list = picked.flatMap((p) => {
    const entry = products.get(p.id);
    return entry && p.count > 0 ? [{ ...p, entry }] : [];
  });
  let total = 0;
  let lost = 0;
  let count = 0;
  let decay = 0;
  const sum = order.map(() => 0);
  for (const p of list) {
    const size = p.entry.size * p.count;
    const penalty =
      (p.state === 'raw' || p.state === 'both' ? p.entry.raw : 0) +
      (p.state === 'over' || p.state === 'both' ? p.entry.over : 0);
    total += size;
    lost += size * penalty;
    count += p.count;
    const n = skilletNutrients(s, order, p.id, food, cat);
    if (n) n.values.forEach((v, i) => (sum[i] += v * p.count));
    decay = Math.max(decay, food(p.id)?.decay ?? 0);
  }
  const score = total ? Math.round(100 * Math.min(1, Math.max(0, 1 - lost / total))) : 0;

  // Название блюда: доля продуктов (по размеру) должна попасть в [min, max] у каждого условия рецепта
  const share = (m: SkilletMatch) => {
    let hit = 0;
    for (const p of list) {
      const ok =
        m.items.includes(p.id) ||
        m.tags.some((t) => tagItems(cat, t).includes(p.id)) ||
        (m.foodType !== undefined && m.foodType === p.entry.type);
      if (ok) hit += p.entry.size * p.count;
    }
    return total ? hit / total : 0;
  };
  let best = -1;
  let dishes: string[] = [];
  for (const d of s.dishes) {
    let value = 0;
    let ok = true;
    for (const m of d.list) {
      const x = share(m);
      const half = (m.max - m.min) / 2;
      const one =
        !total || x < m.min || x > m.max
          ? 0
          : half > 0 && m.bonus > 0
            ? m.score + (m.bonus * Math.abs(x - (m.min + m.max) / 2)) / half
            : m.score;
      if (one === 0) ok = false;
      value += one;
    }
    if (!ok) continue;
    if (value > best + 1e-9) [best, dishes] = [value, [d.item]];
    else if (Math.abs(value - best) <= 1e-9 && !dishes.includes(d.item)) dishes.push(d.item);
  }
  const penalized = !!s.penalty && dishes.length === 1 && dishes[0] === s.penalty.item;

  if (s.nutrients.dropMin) {
    const min = Math.min(...sum);
    sum[sum.lastIndexOf(min)] = 0;
  }
  const final = sum.map((v) => {
    const x = Math.min((v * score) / (s.nutrients.scoreDivisor ?? 100) / set.servings, set.cap);
    return penalized ? x * set.penalty : x;
  });
  const nutrients: Partial<Record<Nutrient, number>> = {};
  order.forEach((n, i) => {
    if (final[i]) nutrients[n] = final[i];
  });
  return {
    hunger: s.hunger,
    decay: decay * s.decay.mul,
    saturation: s.saturationPerItem * count,
    water: s.water.from.reduce((a, n) => a + (nutrients[n] ?? 0), 0) * s.water.mul + s.water.add,
    nutrients,
    servings: s.servingsInDish ? set.servings : undefined,
    score,
    edible: total > 0 && score >= (s.minScore ?? 0),
    dishes,
    penalized,
  };
}
