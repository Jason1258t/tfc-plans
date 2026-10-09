import { filterToJs, type FilterTarget, type KjsFilter } from './recipeFilter';
import { recipeRefs } from './recipeRefs';
import type { KjsRule } from './recipes';

/**
 * Конструктор для рецепта, который режет KubeJS: правка скрипта («снять ограничение»)
 * или рецепт на его основе, который фильтры не заденут.
 *
 * Почему KubeJS-скрипт обходит удаления: RecipesKubeEvent.remove перебирает только рецепты из датапаков
 * (originalRecipes), а рецепты, добавленные в том же событии (event.custom), — отдельный список.
 * Датапак так не может: его рецепты загружаются до скриптов и попадают под фильтры.
 */

/** data/<ns>/recipe/<path>.json → «ns:path» */
export function entryRecipeId(path: string): string | null {
  const m = /^data\/([a-z0-9_.-]+)\/recipes?\/(.+)\.json$/.exec(path);
  return m ? `${m[1]}:${m[2]}` : null;
}

export const recipePathOf = (id: string) => {
  const [ns, p] = id.split(':');
  return `data/${ns}/recipe/${p}.json`;
};

/** Рецепт из JSON → то, что проверяют фильтры KubeJS */
export function targetFromJson(id: string, json: Record<string, unknown>): FilterTarget {
  return {
    id,
    type: typeof json.type === 'string' ? json.type : '',
    group: typeof json.group === 'string' ? json.group : undefined,
    ...recipeRefs(json),
  };
}

/** Объект-фильтр с ключами id / type / output…, а не регулярка или заглушка */
const asObject = (f: KjsFilter): Record<string, KjsFilter> | null =>
  !!f && typeof f === 'object' && !Array.isArray(f) && !('$re' in f) && !('$unknown' in f) && !('$fn' in f)
    ? (f as Record<string, KjsFilter>)
    : null;

/** Тот же фильтр, но без одного рецепта: { …, not: { id } } — ключ not есть в RecipeFilter KubeJS */
export function excludeId(f: KjsFilter, id: string): KjsFilter {
  const except = { id };
  const o = asObject(f);
  if (o) return { ...o, not: o.not ? [o.not, except] : except };
  if (Array.isArray(f)) return { or: f, not: except };
  return { id: f, not: except };
}

export type LiftPatch =
  | { kind: 'delete-line'; file: string; line: number; code: string }
  | { kind: 'replace-call'; file: string; line: number; before: string; after: string; generated: boolean };

/** Как снять ограничение правкой скрипта */
export function liftPatch(rule: KjsRule, recipeId: string): LiftPatch {
  const f = rule.filter;
  const o = asObject(f);
  const exactId = (typeof f === 'string' && f === recipeId) || (o && Object.keys(o).length === 1 && o.id === recipeId);
  if (exactId)
    return rule.idLine
      ? { kind: 'delete-line', file: rule.file, line: rule.idLine, code: rule.idCode ?? '' }
      : { kind: 'delete-line', file: rule.file, line: rule.line, code: rule.code };
  const after = `event.remove(${filterToJs(excludeId(f, recipeId))})`;
  // Фильтр собран в коде (переменные, шаблонные строки, цикл) — строку вызова целиком не заменить
  const generated = !/event\.remove\(/.test(rule.code) || /\$\{|forEach|=>/.test(rule.code);
  return { kind: 'replace-call', file: rule.file, line: rule.line, before: rule.code, after, generated };
}

function indentJson(v: unknown, pad: string): string {
  return JSON.stringify(v, null, 2).replaceAll('\n', `\n${pad}`);
}

/** server_scripts/*.js с рецептами через event.custom — их удаления KubeJS не трогают */
export function kubejsScript(recipes: { id: string; json: unknown }[], title: string): string {
  const body = recipes.map((r) => `  event.custom(${indentJson(r.json, '  ')}).id('${r.id}')`).join('\n\n');
  return `// ${title}
// Сгенерировано «TFC Планы». Положить в kubejs/server_scripts/ на сервере, затем /reload.
// Рецепты, добавленные скриптом, не попадают под event.remove — в отличие от рецептов из датапаков.

ServerEvents.recipes(event => {
${body}
})
`;
}

/** Имя файла скрипта — латиницей (KubeJS грузит любые, но так проще на сервере) */
export const scriptFileName = (base: string) =>
  `${
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'tfc_plans_recipes'
  }.js`;
