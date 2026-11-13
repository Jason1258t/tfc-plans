/**
 * SNBT в формате FTB Library (файлы FTB Quests: config/ftbquests/quests/**.snbt): разбор и запись.
 * Записи разделяются переводом строки или запятой, ключи без кавычек, числа с суффиксами (0.0d, 16L).
 * Число с суффиксом разбирается в SnbtNumber и записывается обратно тем же типом — правка главы
 * не меняет остальной файл. В JSON (JSON.stringify) SnbtNumber превращается в обычное число.
 */

export type SnbtValue = string | number | boolean | SnbtNumber | SnbtTypedArray | SnbtValue[] | SnbtCompound;
export interface SnbtCompound {
  [key: string]: SnbtValue;
}

/** Число с явным типом: d — double, f — float, L — long, b/B — byte, s — short */
export class SnbtNumber {
  value: number;
  type: string;
  /** исходные цифры long вне точности double (table_id: 6123558642180893114L) — записываются как были */
  digits?: string;
  constructor(value: number, type: string, digits?: string) {
    this.value = value;
    this.type = type;
    if (digits && !Number.isSafeInteger(value) && /^-?\d+$/.test(digits)) this.digits = digits;
  }
  toJSON() {
    return this.value;
  }
  valueOf() {
    return this.value;
  }
}

/** Типизированный массив [I; 1, 2] / [B; …] / [L; …] */
export class SnbtTypedArray {
  type: 'B' | 'I' | 'L';
  values: number[];
  constructor(type: 'B' | 'I' | 'L', values: number[]) {
    this.type = type;
    this.values = values;
  }
  toJSON() {
    return this.values;
  }
}

/** double для координат и размеров квестов */
export const snbtDouble = (v: number) => new SnbtNumber(v, 'd');
export const snbtLong = (v: number) => new SnbtNumber(v, 'L');

/** Число из значения SNBT (обычного или с суффиксом) */
export function snbtNum(v: unknown, def = 0): number {
  if (v instanceof SnbtNumber) return v.value;
  return typeof v === 'number' ? v : def;
}

/**
 * Как узел был записан, запись повторяет это: inline — в одну строку (стек предмета { count: 1, id: "…" }),
 * stuck — список «[{» вплотную, block — каждый элемент с новой строки.
 * Новым узлам — по умолчанию FTB: список из одного элемента вплотную, из нескольких — столбиком.
 */
type Layout = 'inline' | 'stuck' | 'block';
const LAYOUT = new WeakMap<object, Layout>();
/** Записывать объект или массив в одну строку */
export function snbtInline<T extends object>(node: T): T {
  LAYOUT.set(node, 'inline');
  return node;
}
const isInline = (v: object) => LAYOUT.get(v) === 'inline';

const NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?([dDfFlLbBsS]?)$/;
const BARE_RE = /^[A-Za-z0-9_\-.+]+$/;

export class SnbtError extends Error {}

export function parseSnbt(text: string): SnbtValue {
  let i = 0;
  const n = text.length;

  const fail = (msg: string): never => {
    const line = text.slice(0, i).split('\n').length;
    throw new SnbtError(`SNBT, строка ${line}: ${msg}`);
  };
  /** Пропускает пробелы, переводы строк и запятые-разделители */
  const skip = (commas: boolean) => {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || (commas && c === ',')) i++;
      else if (c === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
      } else break;
    }
  };
  const readQuoted = (): string => {
    const q = text[i++];
    let out = '';
    while (i < n) {
      const c = text[i++];
      if (c === q) return out;
      if (c === '\\') {
        const e = text[i++];
        if (e === 'n') out += '\n';
        else if (e === 't') out += '\t';
        else if (e === 'r') out += '\r';
        else if (e === 'u') {
          out += String.fromCharCode(parseInt(text.slice(i, i + 4), 16));
          i += 4;
        } else out += e;
      } else out += c;
    }
    return fail('незакрытая строка');
  };
  const readBare = (re = /[A-Za-z0-9_\-.+:]/): string => {
    const start = i;
    while (i < n && re.test(text[i])) i++;
    if (i === start) fail(`неожиданный символ «${text[i] ?? 'конец'}»`);
    return text.slice(start, i);
  };
  const readKey = (): string => (text[i] === '"' || text[i] === "'" ? readQuoted() : readBare(/[A-Za-z0-9_\-.+]/));

  const readValue = (): SnbtValue => {
    skip(false);
    const c = text[i];
    if (c === '{') {
      const open = i++;
      const obj: SnbtCompound = {};
      for (;;) {
        skip(true);
        if (text[i] === '}') {
          if (!text.slice(open, i).includes('\n')) LAYOUT.set(obj, 'inline');
          i++;
          return obj;
        }
        if (i >= n) fail('незакрытый {');
        const key = readKey();
        skip(false);
        if (text[i] !== ':') fail(`ждали «:» после ключа ${key}`);
        i++;
        obj[key] = readValue();
      }
    }
    if (c === '[') {
      i++;
      const typed = /^([BIL]);/.exec(text.slice(i, i + 2));
      if (typed) {
        i += 2;
        const values: number[] = [];
        for (;;) {
          skip(true);
          if (text[i] === ']') {
            i++;
            return new SnbtTypedArray(typed[1] as 'B' | 'I' | 'L', values);
          }
          const tok = readBare();
          values.push(Number(tok.replace(/[bBlL]$/, '')));
        }
      }
      const open = i - 1;
      const arr: SnbtValue[] = [];
      for (;;) {
        skip(true);
        if (text[i] === ']') {
          const multi = text.slice(open, i).includes('\n');
          LAYOUT.set(arr, !multi ? 'inline' : /\s/.test(text[open + 1]) ? 'block' : 'stuck');
          i++;
          return arr;
        }
        if (i >= n) fail('незакрытый [');
        arr.push(readValue());
      }
    }
    if (c === '"' || c === "'") return readQuoted();
    const tok = readBare();
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    const m = NUM_RE.exec(tok);
    if (m) {
      const num = Number(m[1] ? tok.slice(0, -1) : tok);
      return m[1] ? new SnbtNumber(num, m[1], tok.slice(0, -1)) : num;
    }
    return tok;
  };

  skip(true);
  const v = readValue();
  skip(true);
  if (i < n) fail('лишний текст после значения');
  return v;
}

const quote = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
const key = (k: string) => (BARE_RE.test(k) && !NUM_RE.test(k) ? k : quote(k));

function numText(v: number, type: string) {
  const s = String(v);
  if ((type === 'd' || type === 'f') && Number.isInteger(v)) return `${s}.0${type}`;
  return s + type;
}

function scalar(v: SnbtValue): string | null {
  if (typeof v === 'string') return quote(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : numText(v, 'd');
  if (v instanceof SnbtNumber)
    return v.digits && Number(v.digits) === v.value ? v.digits + v.type : numText(v.value, v.type);
  if (v instanceof SnbtTypedArray)
    return `[${v.type}; ${v.values.map((x) => x + (v.type === 'I' ? '' : v.type)).join(', ')}]`;
  return null;
}

/** Значение в одну строку: скаляр, пустой список или объект, список одного скаляра, явно отмеченный узел */
function inline(v: SnbtValue, force = false): string | null {
  const s = scalar(v);
  if (s !== null) return s;
  if (Array.isArray(v)) {
    if (!v.length) return '[ ]';
    const layout = LAYOUT.get(v);
    if (force || layout === 'inline' || (!layout && v.length === 1 && scalar(v[0]) !== null)) {
      const parts = v.map((x) => inline(x, true));
      return parts.every((x) => x !== null) ? `[${parts.join(', ')}]` : null;
    }
    return null;
  }
  const o = v as SnbtCompound;
  const entries = Object.entries(o);
  if (!entries.length) return '{ }';
  if (force || isInline(o)) return `{ ${entries.map(([k, x]) => `${key(k)}: ${inline(x, true)}`).join(', ')} }`;
  return null;
}

/** Запись в стиле FTB Library: табы, без запятых, список объектов — «[{ … }]» */
export function stringifySnbt(value: SnbtValue, indent = 0): string {
  const s = inline(value);
  if (s !== null) return s;
  const pad = '\t'.repeat(indent + 1);
  const end = '\t'.repeat(indent);
  if (Array.isArray(value)) {
    const layout = LAYOUT.get(value) ?? (value.length === 1 ? 'stuck' : 'block');
    if (layout === 'stuck') {
      // [{\n …\n}] или ["строка"\n…]
      return `[${value.map((x) => stringifySnbt(x, indent)).join(`\n${end}`)}]`;
    }
    return `[\n${value.map((x) => pad + stringifySnbt(x, indent + 1)).join('\n')}\n${end}]`;
  }
  const lines = Object.entries(value as SnbtCompound).map(
    ([k, v]) => `${pad}${key(k)}: ${stringifySnbt(v, indent + 1)}`,
  );
  return `{\n${lines.join('\n')}\n${end}}`;
}
