import { directMembers, flattenTag, type TagCatalog } from './tags';

/**
 * Сетка крафта из JSON рецепта: верстак (с формой и без), продвинутый крафт TFC, механический крафт Create и
 * рецепты модов того же вида (pattern + key или ingredients). Ковка, кнаппинг и прочие станки — не сетка: null.
 */

/** Клетка сетки: допустимые предметы (тег и варианты — несколько), пусто — клетка пустая */
export interface GridSlot {
  options: string[];
  /** Ингредиент задан тегом */
  tag?: string;
  /** Не разобрали (жидкость, особый ингредиент мода) — что показать вместо иконки */
  unknown?: string;
}

export interface RecipeGrid {
  shaped: boolean;
  width: number;
  height: number;
  /** По строкам, слева направо; null — пустая клетка */
  cells: (GridSlot | null)[];
  result: { id?: string; count: number };
  station: string;
}

/** Самая большая сетка, которую показываем (механический крафт Create — до 9×9 на деле) */
export const MAX_GRID = 9;

const KNAPPING = /knapping/;

/** Ингредиент → допустимые предметы. Теги — по составу с правками KubeJS. */
export function ingredientSlot(value: unknown, tags: TagCatalog | null): GridSlot {
  const ids: string[] = [];
  let tag: string | undefined;
  let unknown: string | undefined;
  const add = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(add);
    if (typeof v === 'string') return v.startsWith('#') ? addTag(v.slice(1)) : void ids.push(v);
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.item === 'string') return void ids.push(o.item);
    if (typeof o.id === 'string' && !o.type) return void ids.push(o.id);
    if (typeof o.tag === 'string') return addTag(o.tag);
    // Обёртки: TFC not_rotten/has_trait (ingredient), NeoForge compound/intersection (children), components (items)
    if (o.ingredient !== undefined) return add(o.ingredient);
    if (Array.isArray(o.children)) return add(o.children);
    if (Array.isArray(o.items) || typeof o.items === 'string') return add(o.items);
    // NeoForge difference: base минус subtracted — показываем base
    if (o.base !== undefined) return add(o.base);
    if (o.fluid !== undefined || o.fluids !== undefined) unknown ??= 'жидкость';
    else unknown ??= typeof o.type === 'string' ? o.type : '?';
  };
  const addTag = (t: string) => {
    tag ??= t;
    const found = tags?.byKey.get(`item|${t}`);
    if (tags && found) ids.push(...flattenTag(tags, 'item', directMembers(found)));
  };
  add(value);
  const options = [...new Set(ids)];
  return {
    options,
    ...(tag ? { tag } : {}),
    ...(!options.length ? { unknown: unknown ?? (tag ? `#${tag}` : '?') } : {}),
  };
}

function resultOf(result: unknown): RecipeGrid['result'] {
  if (typeof result === 'string') return { id: result, count: 1 };
  if (!result || typeof result !== 'object') return { count: 1 };
  const r = result as {
    id?: string;
    item?: string;
    count?: number;
    stack?: { id?: string; item?: string; count?: number };
  };
  const s = r.stack ?? r;
  return { id: s.id ?? s.item, count: s.count ?? r.count ?? 1 };
}

function stationOf(type: string, shaped: boolean) {
  if (type === 'create:mechanical_crafting') return 'Механический крафт Create';
  return shaped ? 'Верстак' : 'Верстак, в любом порядке';
}

export function recipeGrid(r: { t: string; j: Record<string, unknown> }, tags: TagCatalog | null): RecipeGrid | null {
  if (KNAPPING.test(r.t)) return null;
  const { pattern, key, ingredients, result } = r.j;
  if (Array.isArray(pattern) && pattern.every((row) => typeof row === 'string') && key && typeof key === 'object') {
    const rows = pattern as string[];
    const width = Math.max(0, ...rows.map((row) => row.length));
    if (width < 1 || width > MAX_GRID || rows.length > MAX_GRID) return null;
    const k = key as Record<string, unknown>;
    const slots = new Map<string, GridSlot>();
    const slot = (ch: string) => {
      if (!slots.has(ch)) slots.set(ch, ingredientSlot(k[ch], tags));
      return slots.get(ch)!;
    };
    const cells = rows.flatMap((row) =>
      Array.from({ length: width }, (_, x) => {
        const ch = row[x] ?? ' ';
        return ch === ' ' ? null : slot(ch);
      }),
    );
    return { shaped: true, width, height: rows.length, cells, result: resultOf(result), station: stationOf(r.t, true) };
  }
  if (
    Array.isArray(ingredients) &&
    ingredients.length &&
    ingredients.length <= MAX_GRID * MAX_GRID &&
    /craft/.test(r.t)
  ) {
    const width = ingredients.length <= 4 ? 2 : ingredients.length <= 9 ? 3 : Math.ceil(Math.sqrt(ingredients.length));
    const height = Math.ceil(ingredients.length / width);
    const cells = Array.from({ length: width * height }, (_, i) =>
      i < ingredients.length ? ingredientSlot(ingredients[i], tags) : null,
    );
    return { shaped: false, width, height, cells, result: resultOf(result), station: stationOf(r.t, false) };
  }
  return null;
}
