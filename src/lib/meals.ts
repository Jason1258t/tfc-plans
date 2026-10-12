import { useEffect, useState } from 'react';
import type { Nutrient } from './reference';

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
