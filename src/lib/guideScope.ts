import { CalcError, type Scope } from './calcExpr';
import { formatValue, parseSpec, plural, watts } from './guideFormat';

/**
 * Общие функции формул гайдов (для любого раздела). Раздел добавляет свои имена — см. powerGuideScope.ts.
 * Описания идут в справку редактора.
 */

export interface ScopeDoc {
  /** Как писать: «alternator(статоры, обороты)» */
  sig: string;
  doc: string;
}

export interface GuideScope {
  values: Scope;
  docs: Record<string, ScopeDoc>;
  /** Значение настройки по пути (ee.Voltages.x) — для значка «сервер» у живых значений */
  setting?: (path: string[]) => { origin: string; changed: boolean; default: number | null } | null;
}

const list = (v: unknown, what = 'список'): unknown[] => {
  if (!Array.isArray(v)) throw new CalcError(`ожидался ${what}`);
  return v;
};
const fn = (v: unknown) => {
  if (typeof v !== 'function') throw new CalcError('нужна функция, например x => x * 2');
  return v as (...a: unknown[]) => unknown;
};
const nums = (args: unknown[]) => (args.length === 1 && Array.isArray(args[0]) ? args[0] : args).map(Number);

const DEG = Math.PI / 180;

export const BASE: { [name: string]: ScopeDoc & { v: unknown } } = {
  min: { sig: 'min(a, b, …) или min(список)', doc: 'наименьшее', v: (...a: unknown[]) => Math.min(...nums(a)) },
  max: { sig: 'max(a, b, …) или max(список)', doc: 'наибольшее', v: (...a: unknown[]) => Math.max(...nums(a)) },
  abs: { sig: 'abs(x)', doc: 'модуль', v: Math.abs },
  sqrt: { sig: 'sqrt(x)', doc: 'квадратный корень', v: Math.sqrt },
  ceil: { sig: 'ceil(x)', doc: 'округлить вверх', v: Math.ceil },
  floor: { sig: 'floor(x)', doc: 'округлить вниз', v: Math.floor },
  round: {
    sig: 'round(x, знаков)',
    doc: 'округлить',
    v: (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
  },
  clamp: {
    sig: 'clamp(x, от, до)',
    doc: 'ограничить',
    v: (x: number, a: number, b: number) => Math.min(b, Math.max(a, x)),
  },
  ln: { sig: 'ln(x)', doc: 'натуральный логарифм', v: Math.log },
  log10: { sig: 'log10(x)', doc: 'десятичный логарифм', v: Math.log10 },
  exp: { sig: 'exp(x)', doc: 'eˣ', v: Math.exp },
  sin: { sig: 'sin(градусы)', doc: 'синус угла в градусах', v: (x: number) => Math.sin(x * DEG) },
  cos: { sig: 'cos(градусы)', doc: 'косинус угла в градусах', v: (x: number) => Math.cos(x * DEG) },
  pi: { sig: 'pi', doc: 'число π', v: Math.PI },
  inf: { sig: 'inf', doc: 'бесконечность', v: Infinity },
  range: {
    sig: 'range(от, до, шаг)',
    doc: 'список чисел от и до включительно: range(0, 19) — 20 чисел',
    v: (a: number, b: number, s = 1) => {
      if (!(s > 0) || (b - a) / s > 10000) throw new CalcError('range: слишком много чисел или шаг ≤ 0');
      const out: number[] = [];
      for (let x = a; x <= b + 1e-9; x += s) out.push(Math.round(x * 1e9) / 1e9);
      return out;
    },
  },
  map: {
    sig: 'map(список, x => …)',
    doc: 'посчитать для каждого',
    v: (a: unknown, f: unknown) => list(a).map((x, i) => fn(f)(x, i)),
  },
  filter: {
    sig: 'filter(список, x => условие)',
    doc: 'оставить подходящие',
    v: (a: unknown, f: unknown) => list(a).filter((x, i) => fn(f)(x, i)),
  },
  find: {
    sig: 'find(список, x => условие)',
    doc: 'первый подходящий или null: find(range(1, 100), k => …) — наименьшее k',
    v: (a: unknown, f: unknown) => list(a).find((x, i) => fn(f)(x, i)) ?? null,
  },
  any: {
    sig: 'any(список, x => условие)',
    doc: 'хоть один подходит',
    v: (a: unknown, f: unknown) => list(a).some((x, i) => fn(f)(x, i)),
  },
  all: {
    sig: 'all(список, x => условие)',
    doc: 'все подходят',
    v: (a: unknown, f: unknown) => list(a).every((x, i) => fn(f)(x, i)),
  },
  sum: { sig: 'sum(список)', doc: 'сумма', v: (a: unknown) => list(a).reduce((s: number, x) => s + Number(x), 0) },
  avg: {
    sig: 'avg(список)',
    doc: 'среднее',
    v: (a: unknown) => list(a).reduce((s: number, x) => s + Number(x), 0) / list(a).length,
  },
  len: { sig: 'len(список)', doc: 'сколько элементов', v: (a: unknown) => list(a).length },
  first: { sig: 'first(список)', doc: 'первый', v: (a: unknown) => list(a)[0] ?? null },
  last: { sig: 'last(список)', doc: 'последний', v: (a: unknown) => list(a).at(-1) ?? null },
  join: {
    sig: "join(список, ', ')",
    doc: 'склеить в строку',
    v: (a: unknown, sep = ', ') =>
      list(a)
        .map((x) => formatValue(x))
        .join(String(sep)),
  },
  fmt: {
    sig: "fmt(x, '1 В')",
    doc: 'число в текст по формату, как в {{x | 1 В}}',
    v: (x: unknown, spec = '') => formatValue(x, parseSpec(String(spec))),
  },
  watts: { sig: 'watts(x)', doc: 'ватты с приставкой: 98 304 → «98,3 кВт»', v: (x: number) => watts(x) },
  plural: {
    sig: "plural(n, 'ротор', 'ротора', 'роторов')",
    doc: 'слово в нужной форме для числа',
    v: (n: number, a: string, b: string, c: string) => plural(n, a, b, c),
  },
  isnum: { sig: 'isnum(x)', doc: 'x — конечное число', v: (x: unknown) => typeof x === 'number' && Number.isFinite(x) },
};

export const BASE_DOCS: Record<string, ScopeDoc> = {
  if: { sig: 'if(условие, то, иначе)', doc: 'выбор; считает только нужную ветку' },
  ...Object.fromEntries(Object.entries(BASE).map(([k, { sig, doc }]) => [k, { sig, doc }])),
};

export const BASE_VALUES: Scope = Object.fromEntries(Object.entries(BASE).map(([k, { v }]) => [k, v]));
