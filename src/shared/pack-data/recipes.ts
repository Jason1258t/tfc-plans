import { useEffect, useState } from 'react';
import type { ItemIndex } from './items';
import { filterKeys, matchFilter, type FilterTarget, type KjsFilter } from './recipeFilter';
import { collectRefs, recipeRefs } from './recipeRefs';

/**
 * Каталог рецептов сборки (public/recipes.json, собирается вместе с библиотекой предметов из jar).
 * Грузится только на странице датапаков: ~7 МБ, в сжатом виде ~0.4 МБ.
 */
export interface RawRecipe {
  /** «ns:path» — соответствует файлу data/<ns>/recipe/<path>.json */
  i: string;
  /** Тип рецепта; пусто — заглушка-удаление */
  t: string;
  /** jar-источник; kubejs/<слой>/data — датапак KubeJS, kubejs/<слой>/server_scripts/… — скрипт */
  s: string;
  j: Record<string, unknown>;
  /** Рецепт добавлен скриптом KubeJS: где */
  k?: { file: string; line: number; code: string; explicitId: boolean };
}

/** Правило KubeJS из public/kubejs.json (scripts/kubejs.mjs) */
export interface KjsRule {
  kind: 'remove' | 'replaceInput' | 'replaceOutput';
  filter: KjsFilter;
  from?: unknown;
  to?: unknown;
  layer: string;
  /** «pack/server_scripts/recipes/remove.js» */
  file: string;
  line: number;
  /** Строка вызова в скрипте */
  code: string;
  /** Где в скрипте записан сам id (удаление циклом по массиву) */
  idLine?: number;
  idCode?: string;
}

export interface KubejsData {
  generatedAt: number;
  layers: { name: string; source: string; scripts: number; rules: number; added: number; data: number }[];
  rules: KjsRule[];
  recipes: RawRecipe[];
  errors: { layer: string; file: string; message: string }[];
}

/** Откуда рецепт: мод, датапак kubejs/data или скрипт KubeJS */
export type RecipeOrigin = 'mod' | 'kubejs-data' | 'kubejs-script';

export interface Recipe extends RawRecipe {
  /** Предметы/жидкости на выходе и входе (id, теги — с «#») */
  outputs: string[];
  inputs: string[];
  /** Рецепт отключён в сборке заглушкой neoforge:false */
  removed: boolean;
  origin: RecipeOrigin;
  /** Номера правил KubeJS (catalog.kubejs.rules), которые удаляют рецепт; maybe — фильтр не разобрать */
  kjsRemoved: number[];
  kjsMaybe: number[];
  /** replaceInput / replaceOutput, которые его меняют */
  kjsChanged: number[];
  /** Строка для поиска */
  hay: string;
}

export interface RecipeCatalog {
  list: Recipe[];
  byId: Map<string, Recipe>;
  /** тип → число рецептов, по убыванию */
  types: [string, number][];
  /** Скрипты KubeJS сборки, если импортированы (npm run kubejs) */
  kubejs: KubejsData | null;
}

export const recipePath = (id: string) => {
  const [ns, p] = id.split(':');
  return `data/${ns}/recipe/${p}.json`;
};

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

const fetchJson = <T>(name: string, fallback: T): Promise<T> =>
  fetch(`${import.meta.env.BASE_URL}${name}`)
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : fallback))
    .catch(() => fallback);

export const targetOf = (r: { i: string; t: string; j: Record<string, unknown> }): FilterTarget => ({
  id: r.i,
  type: r.t,
  group: typeof r.j.group === 'string' ? r.j.group : undefined,
  ...recipeRefs(r.j),
});

/** Какие правила KubeJS задевают рецепт (удаления — только для рецептов из датапаков, как в игре) */
export function kubejsHits(rules: KjsRule[], target: FilterTarget) {
  const removed: number[] = [];
  const maybe: number[] = [];
  const changed: number[] = [];
  rules.forEach((rule, n) => {
    const m = matchFilter(rule.filter, target);
    if (rule.kind === 'remove') {
      if (m === true) removed.push(n);
      else if (m === null) maybe.push(n);
    } else if (m === true) {
      // replaceInput({}, from, to) проходит фильтр у всех рецептов, а меняет только те, где есть from
      const has = matchFilter({ [rule.kind === 'replaceInput' ? 'input' : 'output']: rule.from as KjsFilter }, target);
      if (has !== false) changed.push(n);
    }
  });
  return { removed, maybe, changed };
}

/** Чем фильтр задел рецепт: только id (можно обойти другим id) или шире */
export const ruleIsIdOnly = (rule: KjsRule) => filterKeys(rule.filter).every((k) => k === 'id');

export function loadRecipes(): Promise<RecipeCatalog> {
  promise ??= Promise.all([
    fetchJson<RawRecipe[]>('recipes.json', []),
    fetchJson<KubejsData | null>('kubejs.json', null),
  ]).then(([raw, kubejs]) => {
    // kubejs/data и рецепты скриптов с тем же id заменяют рецепт мода
    const merged = new Map(raw.map((r) => [r.i, r]));
    for (const r of kubejs?.recipes ?? []) merged.set(r.i, r);
    const rules = kubejs?.rules ?? [];
    const list: Recipe[] = [...merged.values()].map((r) => {
      const outs = new Set<string>();
      const ins = new Set<string>();
      collectRefs(r.j, false, outs, ins);
      const origin: RecipeOrigin = r.k ? 'kubejs-script' : r.s.startsWith('kubejs/') ? 'kubejs-data' : 'mod';
      const target = { id: r.i, type: r.t, group: typeof r.j.group === 'string' ? r.j.group : undefined };
      const hits =
        origin === 'kubejs-script'
          ? { removed: [], maybe: [], changed: [] }
          : kubejsHits(rules, { ...target, inputs: [...ins], outputs: [...outs] });
      return {
        ...r,
        outputs: [...outs],
        inputs: [...ins],
        removed: isRemoval(r.j),
        origin,
        kjsRemoved: hits.removed,
        kjsMaybe: hits.maybe,
        kjsChanged: hits.changed,
        hay: `${r.i} ${r.t} ${[...outs].join(' ')}`.toLowerCase(),
      };
    });
    const counts = new Map<string, number>();
    for (const r of list) if (r.t) counts.set(r.t, (counts.get(r.t) ?? 0) + 1);
    loaded = {
      list,
      byId: new Map(list.map((r) => [r.i, r])),
      types: [...counts].sort((a, b) => b[1] - a[1]),
      kubejs,
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
export type RecipeStatus = 'active' | 'kjs-removed' | 'kjs-changed' | 'kjs-added' | 'kjs-data' | 'stub';

export const STATUS_LABEL: Record<RecipeStatus, string> = {
  active: 'Работают в игре',
  'kjs-removed': 'Удалены KubeJS',
  'kjs-changed': 'Изменены KubeJS',
  'kjs-added': 'Добавлены скриптами KubeJS',
  'kjs-data': 'Из kubejs/data',
  stub: 'Отключены заглушкой датапака',
};

export function hasStatus(r: Recipe, s: RecipeStatus): boolean {
  switch (s) {
    case 'active':
      return !r.removed && !r.kjsRemoved.length;
    case 'kjs-removed':
      return r.kjsRemoved.length > 0;
    case 'kjs-changed':
      return r.kjsChanged.length > 0;
    case 'kjs-added':
      return r.origin === 'kubejs-script';
    case 'kjs-data':
      return r.origin === 'kubejs-data';
    case 'stub':
      return r.removed;
  }
}

export function searchRecipes(
  cat: RecipeCatalog,
  opts: {
    query?: string;
    type?: string;
    itemId?: string;
    usage?: boolean;
    items?: ItemIndex | null;
    status?: RecipeStatus;
  },
  limit = 200,
): Recipe[] {
  const words = (opts.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const res: Recipe[] = [];
  for (const r of cat.list) {
    if (opts.type && r.t !== opts.type) continue;
    if (opts.status && !hasStatus(r, opts.status)) continue;
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
