/**
 * Формулы гайдов: маленький язык выражений для калькуляторов и живых значений в статьях.
 * Статьи правит кто угодно, поэтому никакого eval: свой разборщик, доступ только к именам из переданной области
 * и к собственным полям объектов (прототипы закрыты). Без импортов — файл проверяется и из Node.
 *
 *   числа 1.5 1e3, строки 'a' "b", true false null, списки [1, 2]
 *   + − × /  % ^ (степень), сравнения == != < <= > >=, and or not (или && || !), a ? b : c
 *   поля obj.x, obj['x'], arr[0], вызовы f(x), лямбды x => x * 2, (a, b) => a + b
 *   if(условие, то, иначе) — считает только нужную ветку
 */

export class CalcError extends Error {
  pos: number;
  constructor(message: string, pos = -1) {
    super(message);
    this.pos = pos;
  }
}

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'lit'; v: boolean | null }
  | { t: 'id'; name: string; pos: number }
  | { t: 'list'; items: Node[] }
  | { t: 'member'; obj: Node; key: Node; pos: number }
  | { t: 'call'; fn: Node; args: Node[]; pos: number }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node; pos: number }
  | { t: 'cond'; c: Node; a: Node; b: Node }
  | { t: 'lambda'; params: string[]; body: Node };

export type Expr = Node;

interface Tok {
  k: 'num' | 'str' | 'id' | 'op' | 'end';
  v: string;
  pos: number;
}

const OPS = [
  '=>',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '<',
  '>',
  '(',
  ')',
  '[',
  ']',
  ',',
  '.',
  '?',
  ':',
  '!',
];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const start = i;
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ k: 'num', v: m[0], pos: start });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let s = '';
      i++;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\' && i + 1 < src.length) i++;
        s += src[i++];
      }
      if (i >= src.length) throw new CalcError('незакрытая строка', start);
      i++;
      out.push({ k: 'str', v: s, pos: start });
      continue;
    }
    if (/[\p{L}_]/u.test(ch)) {
      const m = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i))!;
      out.push({ k: 'id', v: m[0], pos: start });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new CalcError(`непонятный символ «${ch}»`, start);
    out.push({ k: 'op', v: op === '×' ? '*' : op, pos: start });
    i += op.length;
  }
  out.push({ k: 'end', v: '', pos: src.length });
  return out;
}

const WORD_OPS: Record<string, string> = { and: '&&', or: '||', not: '!' };

/** Разобрать выражение; ошибка — CalcError с позицией */
export function parseExpr(src: string): Expr {
  const toks = tokenize(src);
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const isOp = (v: string, o = 0) => {
    const t = peek(o);
    return (t.k === 'op' && t.v === v) || (t.k === 'id' && WORD_OPS[t.v] === v);
  };
  const eat = (v: string) => {
    if (!isOp(v)) throw new CalcError(`ожидалось «${v}»`, peek().pos);
    p++;
  };

  function expr(): Node {
    // Лямбда: x => …  или  (a, b) => …
    if (peek().k === 'id' && isOp('=>', 1)) {
      const name = peek().v;
      p += 2;
      return { t: 'lambda', params: [name], body: expr() };
    }
    if (isOp('(')) {
      const params: string[] = [];
      let j = 1;
      let ok = isOp(')', j);
      while (!ok && peek(j).k === 'id') {
        params.push(peek(j).v);
        if (isOp(')', j + 1)) {
          j++;
          ok = true;
        } else if (isOp(',', j + 1)) j += 2;
        else break;
      }
      if (ok && isOp('=>', j + 1)) {
        p += j + 2;
        return { t: 'lambda', params, body: expr() };
      }
    }
    return cond();
  }
  function cond(): Node {
    const c = or();
    if (!isOp('?')) return c;
    p++;
    const a = expr();
    eat(':');
    return { t: 'cond', c, a, b: expr() };
  }
  const binary = (ops: string[], next: () => Node) => (): Node => {
    let a = next();
    for (;;) {
      const op = ops.find((o) => isOp(o));
      if (!op) return a;
      const pos = peek().pos;
      p++;
      a = { t: 'bin', op, a, b: next(), pos };
    }
  };
  const not = (): Node => {
    if (isOp('!')) {
      p++;
      return { t: 'un', op: '!', a: not() };
    }
    return cmp();
  };
  const cmp = (): Node => {
    const a = add();
    const op = ['==', '!=', '<=', '>=', '<', '>'].find((o) => isOp(o));
    if (!op) return a;
    const pos = peek().pos;
    p++;
    return { t: 'bin', op, a, b: add(), pos };
  };
  const unary = (): Node => {
    if (isOp('-') || isOp('+')) {
      const op = peek().v;
      p++;
      const a = unary();
      return op === '-' ? { t: 'un', op: '-', a } : a;
    }
    return pow();
  };
  const pow = (): Node => {
    const a = postfix();
    if (!isOp('^')) return a;
    const pos = peek().pos;
    p++;
    return { t: 'bin', op: '^', a, b: unary(), pos };
  };
  const mul = binary(['*', '/', '%'], unary);
  const add = binary(['+', '-'], mul);
  const and = binary(['&&'], not);
  const or = binary(['||'], and);

  function postfix(): Node {
    let n = primary();
    for (;;) {
      const pos = peek().pos;
      if (isOp('.')) {
        p++;
        const t = peek();
        if (t.k !== 'id') throw new CalcError('после точки нужно имя поля', t.pos);
        p++;
        n = { t: 'member', obj: n, key: { t: 'str', v: t.v }, pos };
      } else if (isOp('[')) {
        p++;
        const key = expr();
        eat(']');
        n = { t: 'member', obj: n, key, pos };
      } else if (isOp('(')) {
        p++;
        const args: Node[] = [];
        while (!isOp(')')) {
          args.push(expr());
          if (!isOp(')')) eat(',');
        }
        p++;
        n = { t: 'call', fn: n, args, pos };
      } else return n;
    }
  }
  function primary(): Node {
    const t = peek();
    if (t.k === 'num') {
      p++;
      return { t: 'num', v: Number(t.v) };
    }
    if (t.k === 'str') {
      p++;
      return { t: 'str', v: t.v };
    }
    if (t.k === 'id' && !WORD_OPS[t.v]) {
      p++;
      if (t.v === 'true' || t.v === 'false') return { t: 'lit', v: t.v === 'true' };
      if (t.v === 'null') return { t: 'lit', v: null };
      return { t: 'id', name: t.v, pos: t.pos };
    }
    if (isOp('(')) {
      p++;
      const n = expr();
      eat(')');
      return n;
    }
    if (isOp('[')) {
      p++;
      const items: Node[] = [];
      while (!isOp(']')) {
        items.push(expr());
        if (!isOp(']')) eat(',');
      }
      p++;
      return { t: 'list', items };
    }
    throw new CalcError(t.k === 'end' ? 'выражение оборвалось' : `неожиданное «${t.v}»`, t.pos);
  }

  if (peek().k === 'end') throw new CalcError('пустое выражение', 0);
  const n = expr();
  if (peek().k !== 'end') throw new CalcError(`лишнее «${peek().v}»`, peek().pos);
  return n;
}

/** Область видимости: имя → значение. Функции в ней — только те, что положил сайт */
export type Scope = Record<string, unknown>;

const BLOCKED = new Set(['__proto__', 'prototype', 'constructor']);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function lookup(name: string, envs: Scope[], pos: number): unknown {
  for (const e of envs) if (own(e, name)) return e[name];
  throw new CalcError(`неизвестное имя «${name}»`, pos);
}

const truthy = (v: unknown) => Boolean(v) && !(typeof v === 'number' && Number.isNaN(v));

function num(v: unknown, pos: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined) return NaN;
  throw new CalcError(`ожидалось число, а здесь ${typeName(v)}`, pos);
}

const typeName = (v: unknown) =>
  Array.isArray(v) ? 'список' : typeof v === 'string' ? 'строка' : typeof v === 'function' ? 'функция' : 'объект';

function evalNode(n: Node, envs: Scope[]): unknown {
  switch (n.t) {
    case 'num':
    case 'str':
    case 'lit':
      return n.v;
    case 'id':
      if (n.name === 'if') throw new CalcError('if — это if(условие, то, иначе)', n.pos);
      return lookup(n.name, envs, n.pos);
    case 'list':
      return n.items.map((x) => evalNode(x, envs));
    case 'member': {
      const o = evalNode(n.obj, envs);
      const k = evalNode(n.key, envs);
      if (o === null || o === undefined) return null;
      if (Array.isArray(o)) {
        if (k === 'length') return o.length;
        if (typeof k !== 'number') throw new CalcError('у списка поле — номер, с нуля', n.pos);
        return o[k < 0 ? o.length + k : k] ?? null;
      }
      if (typeof o === 'string' && k === 'length') return o.length;
      if (typeof o !== 'object')
        throw new CalcError(`у ${typeName(o) === 'объект' ? 'числа' : typeName(o)} нет полей`, n.pos);
      const key = String(k);
      if (BLOCKED.has(key) || !own(o, key)) return null;
      return (o as Record<string, unknown>)[key] ?? null;
    }
    case 'call': {
      if (n.fn.t === 'id' && n.fn.name === 'if') {
        if (n.args.length !== 3) throw new CalcError('if(условие, то, иначе) — три части', n.pos);
        return truthy(evalNode(n.args[0], envs)) ? evalNode(n.args[1], envs) : evalNode(n.args[2], envs);
      }
      const f = evalNode(n.fn, envs);
      if (typeof f !== 'function') throw new CalcError('это не функция', n.pos);
      const args = n.args.map((a) => evalNode(a, envs));
      try {
        return f(...args);
      } catch (e) {
        if (e instanceof CalcError) throw e.pos < 0 ? new CalcError(e.message, n.pos) : e;
        throw new CalcError(e instanceof Error ? e.message : String(e), n.pos);
      }
    }
    case 'un': {
      const a = evalNode(n.a, envs);
      return n.op === '!' ? !truthy(a) : -num(a, -1);
    }
    case 'cond':
      return truthy(evalNode(n.c, envs)) ? evalNode(n.a, envs) : evalNode(n.b, envs);
    case 'lambda':
      return (...args: unknown[]) => {
        const local: Scope = {};
        n.params.forEach((name, i) => (local[name] = args[i] ?? null));
        return evalNode(n.body, [local, ...envs]);
      };
    case 'bin': {
      if (n.op === '&&') {
        const a = evalNode(n.a, envs);
        return truthy(a) ? evalNode(n.b, envs) : a;
      }
      if (n.op === '||') {
        const a = evalNode(n.a, envs);
        return truthy(a) ? a : evalNode(n.b, envs);
      }
      const a = evalNode(n.a, envs);
      const b = evalNode(n.b, envs);
      if (n.op === '==') return a === b;
      if (n.op === '!=') return a !== b;
      if (n.op === '+' && (typeof a === 'string' || typeof b === 'string')) return `${a ?? ''}${b ?? ''}`;
      if (
        (n.op === '<' || n.op === '>' || n.op === '<=' || n.op === '>=') &&
        typeof a === 'string' &&
        typeof b === 'string'
      )
        return n.op === '<' ? a < b : n.op === '>' ? a > b : n.op === '<=' ? a <= b : a >= b;
      const x = num(a, n.pos);
      const y = num(b, n.pos);
      switch (n.op) {
        case '+':
          return x + y;
        case '-':
          return x - y;
        case '*':
          return x * y;
        case '/':
          return x / y;
        case '%':
          return x % y;
        case '^':
          return x ** y;
        case '<':
          return x < y;
        case '>':
          return x > y;
        case '<=':
          return x <= y;
        case '>=':
          return x >= y;
      }
    }
  }
  throw new CalcError('не умею считать это выражение');
}

/** Посчитать разобранное выражение в области (первой ищется первая) */
export const evalExpr = (e: Expr, ...scopes: Scope[]): unknown => evalNode(e, scopes);

/** Разобрать и посчитать */
export const calc = (src: string, ...scopes: Scope[]): unknown => evalNode(parseExpr(src), scopes);

/** Путь «ee.Voltages.wireMaxVoltage», если выражение — просто ссылка на поле; иначе null */
export function exprPath(e: Expr): string[] | null {
  if (e.t === 'id') return [e.name];
  if (e.t === 'member' && (e.key.t === 'str' || e.key.t === 'num')) {
    const head = exprPath(e.obj);
    return head ? [...head, String(e.key.v)] : null;
  }
  return null;
}

/** Ошибку с позицией — в текст «ошибка (символ N): …» */
export function errorText(e: unknown, src?: string): string {
  if (!(e instanceof CalcError)) return e instanceof Error ? e.message : String(e);
  if (e.pos < 0 || src === undefined) return e.message;
  const near = src.slice(Math.max(0, e.pos - 12), e.pos + 12);
  return `${e.message} — около «${near}»`;
}
