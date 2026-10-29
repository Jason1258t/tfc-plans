/**
 * Фильтры рецептов KubeJS (`event.remove({...})`, `replaceInput({...}, …)`) и их проверка на рецепте.
 * Семантика — как в KubeJS 2101 (dev.latvian.mods.kubejs.recipe.filter.RecipeFilter):
 *   строка — id рецепта ('*' — все, '-' — ни одного), RegExp — id по регулярке,
 *   массив — ИЛИ, объект — И по ключам id / type / group / mod / input / output, плюс or: [...] и not: {...}.
 *
 * Без импортов: модуль используется и сайтом, и scripts/kubejs.mjs (Node запускает .ts напрямую).
 */

/** Фильтр в JSON: RegExp сериализуется как { $re, $flags }, неразобранное значение — { $unknown } */
export type KjsFilter =
  | string
  | { $re: string; $flags: string }
  | { $unknown: string }
  | { $fn: true }
  | KjsFilter[]
  | { [key: string]: KjsFilter };

export interface FilterTarget {
  /** id рецепта «ns:path» */
  id: string;
  type: string;
  group?: string;
  /** id предметов/жидкостей на входе и выходе, теги — с «#» */
  inputs: string[];
  outputs: string[];
}

/** true — подходит, false — нет, null — по фильтру не понять (функция, неизвестное значение) */
export type Match = boolean | null;

const withNs = (id: string) => (id.includes(':') ? id : `minecraft:${id}`);

const isRe = (f: unknown): f is { $re: string; $flags: string } => !!f && typeof f === 'object' && '$re' in f;
const isUnknown = (f: unknown) => !!f && typeof f === 'object' && ('$unknown' in f || '$fn' in f);

const reCache = new Map<string, RegExp | null>();
function toRe(f: { $re: string; $flags: string }): RegExp | null {
  const key = `${f.$flags}/${f.$re}`;
  if (!reCache.has(key)) {
    try {
      reCache.set(key, new RegExp(f.$re, f.$flags.replace('g', '')));
    } catch {
      reCache.set(key, null);
    }
  }
  return reCache.get(key)!;
}

const and = (a: Match, b: Match): Match =>
  a === false || b === false ? false : a === null || b === null ? null : true;
const or = (a: Match, b: Match): Match => (a === true || b === true ? true : a === null || b === null ? null : false);
const not = (a: Match): Match => (a === null ? null : !a);

/** Значение id-фильтра: строка или регулярка */
function matchId(f: KjsFilter, id: string): Match {
  if (typeof f === 'string') return f === '*' ? true : f === '-' ? false : withNs(f) === id;
  if (isRe(f)) {
    const re = toRe(f);
    return re ? re.test(id) : null;
  }
  if (Array.isArray(f)) return f.reduce<Match>((acc, x) => or(acc, matchId(x, id)), false);
  return null;
}

/**
 * input/output: предмет, тег «#…» или регулярка по id предмета.
 * Тег, который содержит предмет, мы не раскрываем (составов тегов в каталоге нет) — совпадение только точное.
 */
function matchStack(f: KjsFilter, refs: string[]): Match {
  if (typeof f === 'string') {
    const s = f.replace(/^\d+x\s+/, '');
    const ref = s.startsWith('#') ? s : withNs(s);
    return refs.includes(ref);
  }
  if (isRe(f)) {
    const re = toRe(f);
    return re ? refs.some((r) => !r.startsWith('#') && re.test(r)) : null;
  }
  if (Array.isArray(f)) return f.reduce<Match>((acc, x) => or(acc, matchStack(x, refs)), false);
  return null;
}

export function matchFilter(f: KjsFilter, r: FilterTarget): Match {
  if (typeof f === 'string' || isRe(f)) return matchId(f, r.id);
  if (Array.isArray(f)) return f.reduce<Match>((acc, x) => or(acc, matchFilter(x, r)), false);
  if (isUnknown(f)) return null;
  let res: Match = true;
  for (const [k, v] of Object.entries(f)) {
    let m: Match;
    switch (k) {
      case 'or':
        m = Array.isArray(v) ? v.reduce<Match>((acc, x) => or(acc, matchFilter(x, r)), false) : matchFilter(v, r);
        break;
      case 'not':
        m = not(matchFilter(v, r));
        break;
      case 'id':
        m = matchId(v, r.id);
        break;
      case 'type':
        m = typeof v === 'string' ? withNs(v) === r.type : isRe(v) ? (toRe(v)?.test(r.type) ?? null) : null;
        break;
      case 'mod':
        m = typeof v === 'string' ? r.id.split(':')[0] === v : null;
        break;
      case 'group':
        m = typeof v === 'string' ? (r.group ?? '') === v : null;
        break;
      case 'input':
        m = matchStack(v, r.inputs);
        break;
      case 'output':
        m = matchStack(v, r.outputs);
        break;
      default:
        // Ключ, которого KubeJS не знает, фильтр не сужает
        m = true;
    }
    res = and(res, m);
    if (res === false) return false;
  }
  return res;
}

/** Ключи фильтра верхнего уровня — для объяснения «чем задело» */
export function filterKeys(f: KjsFilter): string[] {
  if (typeof f === 'string' || isRe(f)) return ['id'];
  if (Array.isArray(f)) return [...new Set(f.flatMap(filterKeys))];
  if (isUnknown(f)) return ['?'];
  return Object.keys(f);
}

/** Фильтр обратно в JS — для показа и для готовых правок скрипта */
export function filterToJs(f: KjsFilter): string {
  if (typeof f === 'string') return `'${f.replaceAll("'", "\\'")}'`;
  if (isRe(f)) return `/${f.$re}/${f.$flags}`;
  if (Array.isArray(f)) return `[${f.map(filterToJs).join(', ')}]`;
  if ('$unknown' in f) return `/* ${String(f.$unknown)} */`;
  if ('$fn' in f) return '/* функция */';
  return `{ ${Object.entries(f)
    .map(([k, v]) => `${k}: ${filterToJs(v)}`)
    .join(', ')} }`;
}
