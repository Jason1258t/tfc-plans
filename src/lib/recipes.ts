import { useEffect, useState } from 'react';
import type { ItemIndex } from './items';

/**
 * Каталог рецептов сборки (public/recipes.json, собирается вместе с библиотекой предметов из jar).
 * Грузится только на странице датапаков: ~7 МБ, в сжатом виде ~0.4 МБ.
 */
export interface RawRecipe {
  /** «ns:path» — соответствует файлу data/<ns>/recipe/<path>.json */
  i: string;
  /** Тип рецепта; пусто — заглушка-удаление */
  t: string;
  /** jar-источник */
  s: string;
  j: Record<string, unknown>;
}

export interface Recipe extends RawRecipe {
  /** Предметы/жидкости на выходе и входе (id, теги — с «#») */
  outputs: string[];
  inputs: string[];
  /** Рецепт отключён в сборке заглушкой neoforge:false */
  removed: boolean;
  /** Строка для поиска */
  hay: string;
}

export interface RecipeCatalog {
  list: Recipe[];
  byId: Map<string, Recipe>;
  /** тип → число рецептов, по убыванию */
  types: [string, number][];
}

export const recipePath = (id: string) => {
  const [ns, p] = id.split(':');
  return `data/${ns}/recipe/${p}.json`;
};

const ID_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
/** Ключи, где лежат служебные строки, а не предметы */
const NON_ITEM_KEYS = new Set([
  'type',
  'mode',
  'knapping_type',
  'sound',
  'texture',
  'input_texture',
  'output_texture',
  'category',
  'group',
  'trait',
  'modid',
  'feature',
  'bonus',
]);

function collectRefs(node: unknown, isOut: boolean, outs: Set<string>, ins: Set<string>, key = '') {
  if (typeof node === 'string') {
    if (NON_ITEM_KEYS.has(key) || !ID_RE.test(node)) return;
    const ref = key === 'tag' || key === 'fluid_tag' || key === 'fluidTag' ? `#${node}` : node;
    (isOut ? outs : ins).add(ref);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectRefs(v, isOut, outs, ins, key);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'neoforge:conditions' || k === 'conditions' || k === 'rules' || k === 'operations') continue;
      const out = isOut || /result|output|transitional/i.test(k);
      collectRefs(v, out, outs, ins, k);
    }
  }
}

/** id предметов/жидкостей/блоков в значениях JSON — без ключей, типов, условий и тегов */
export function itemRefsOf(json: unknown): string[] {
  const outs = new Set<string>();
  const ins = new Set<string>();
  collectRefs(json, false, outs, ins);
  return [...new Set([...outs, ...ins])].filter((r) => !r.startsWith('#'));
}

const isRemoval = (j: Record<string, unknown>) => {
  const conds = j['neoforge:conditions'];
  return (
    (Array.isArray(conds) && conds.some((c) => (c as { type?: string })?.type === 'neoforge:false')) ||
    Object.keys(j).length === 0
  );
};

let promise: Promise<RecipeCatalog> | null = null;
let loaded: RecipeCatalog | null = null;

export function loadRecipes(): Promise<RecipeCatalog> {
  promise ??= fetch(`${import.meta.env.BASE_URL}recipes.json`)
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
    .then((raw: RawRecipe[]) => {
      const list: Recipe[] = raw.map((r) => {
        const outs = new Set<string>();
        const ins = new Set<string>();
        collectRefs(r.j, false, outs, ins);
        return {
          ...r,
          outputs: [...outs],
          inputs: [...ins],
          removed: isRemoval(r.j),
          hay: `${r.i} ${r.t} ${[...outs].join(' ')}`.toLowerCase(),
        };
      });
      const counts = new Map<string, number>();
      for (const r of list) if (r.t) counts.set(r.t, (counts.get(r.t) ?? 0) + 1);
      loaded = {
        list,
        byId: new Map(list.map((r) => [r.i, r])),
        types: [...counts].sort((a, b) => b[1] - a[1]),
      };
      return loaded;
    });
  return promise;
}

export function useRecipes(enabled = true): RecipeCatalog | null {
  const [cat, setCat] = useState(loaded);
  useEffect(() => {
    if (enabled && !cat) loadRecipes().then(setCat);
  }, [cat, enabled]);
  return cat;
}

/**
 * Поиск: по id рецепта, типу, id выходов и (если есть библиотека) по названиям предметов на выходе.
 * itemId — «что делает этот предмет» (выход) или «где используется» (вход).
 */
export function searchRecipes(
  cat: RecipeCatalog,
  opts: { query?: string; type?: string; itemId?: string; usage?: boolean; items?: ItemIndex | null },
  limit = 200,
): Recipe[] {
  const words = (opts.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const res: Recipe[] = [];
  for (const r of cat.list) {
    if (opts.type && r.t !== opts.type) continue;
    if (opts.itemId && !(opts.usage ? r.inputs : r.outputs).includes(opts.itemId)) continue;
    if (words.length) {
      let hay = r.hay;
      if (opts.items) {
        for (const o of r.outputs) {
          const it = opts.items.byId.get(o);
          if (it) hay += ` ${it.e.toLowerCase()} ${(it.r ?? '').toLowerCase()}`;
        }
      }
      if (!words.every((w) => hay.includes(w))) continue;
    }
    res.push(r);
    if (res.length >= limit) break;
  }
  return res;
}

// ---------------------------------------------------------------- статистика полей для агента

export interface FieldStat {
  path: string;
  /** доля рецептов типа, где поле встречается, 0..100 */
  pct: number;
  kinds: string;
  examples: string[];
}

/** Какие поля встречаются у рецептов типа и с какими значениями — основа для подсказки агентом */
export function typeFieldStats(cat: RecipeCatalog, type: string, maxFields = 40): FieldStat[] {
  const recipes = cat.list.filter((r) => r.t === type);
  const acc = new Map<string, { n: number; kinds: Set<string>; ex: string[] }>();
  const kind = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
  const walk = (obj: unknown, prefix: string, depth: number) => {
    if (depth > 3 || !obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'type' && !prefix) continue;
      const p = prefix ? `${prefix}.${k}` : k;
      const e = acc.get(p) ?? { n: 0, kinds: new Set<string>(), ex: [] };
      e.n++;
      e.kinds.add(kind(v));
      if ((typeof v !== 'object' || v === null) && e.ex.length < 4 && !e.ex.includes(String(v))) e.ex.push(String(v));
      acc.set(p, e);
      if (Array.isArray(v)) {
        if (v[0] && typeof v[0] === 'object') walk(v[0], `${p}[]`, depth + 1);
      } else walk(v, p, depth + 1);
    }
  };
  for (const r of recipes) walk(r.j, '', 0);
  return [...acc]
    .map(([path, e]) => ({
      path,
      pct: Math.round((e.n / Math.max(1, recipes.length)) * 100),
      kinds: [...e.kinds].join('|'),
      examples: e.ex,
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, maxFields);
}
