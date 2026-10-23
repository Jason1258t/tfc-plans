/**
 * Инструмент MCP bytecode: сжатый разбор байткода без JDK — вместо «javap -c | grep» в терминале.
 *
 * Обзор класса — строка на метод (что вызывает, какие поля читает и пишет, строки и числа); один метод — поток
 * операций по строкам исходника без шума стека (aload/dup/pop/приведения чисел); сравнение двух версий класса или
 * целого jar. Источник — jar сборки (индекс классов, как у class_info), кандидат или путь на диске: jar, папка
 * классов (build/classes/java/main, run/.mixin.out/class) или .class.
 */
import fs from 'node:fs';
import path from 'node:path';
import { WORK } from '../data.mjs';
import { ACC, javaName, lineAt, methodSig, parseClassFull } from '../bytecode.mjs';
import { classRecord, findClasses, jarOwner, oneClass } from '../code-index.mjs';
import { clip, page, paging, str, userRegex } from '../fmt.mjs';
import { PLATFORM, jarToc, readEntry, resolveJar, zipEntries, zipRead } from '../jars.mjs';

const dotted = (n) => n.replaceAll('/', '.');
const ROOT = WORK;

// ---------------------------------------------------------------- источники классов

const where = (jar) => (jar === PLATFORM ? jarOwner(jar) : `${jar} (${jarOwner(jar)})`);

/** Путь на диске из параметра jar: абсолютный, от текущей папки или от корня репозитория */
function diskPath(q) {
  const s = String(q ?? '').trim();
  if (!s || s.startsWith('candidate:')) return null;
  const home = s.startsWith('~/') ? path.join(process.env.HOME ?? '', s.slice(2)) : s;
  for (const p of path.isAbsolute(home) ? [home] : [path.resolve(home), path.join(ROOT, home)])
    if (fs.existsSync(p)) return p;
  return null;
}

/** Классы на диске: папка или .class → { name → файл } (имя из самого класса для .class) */
function walkClasses(dir, out = new Map(), base = dir, limit = { n: 60000 }) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (--limit.n < 0) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkClasses(p, out, base, limit);
    else if (e.name.endsWith('.class')) out.set(path.relative(base, p).replaceAll(path.sep, '/').slice(0, -6), p);
  }
  return out;
}

const tocCache = new Map(); // файл jar на диске → { sig, byName }

/**
 * Источник: { label, names() → [internal], find(q) → [internal], read(internal) → Buffer | null }.
 * Без jar — весь индекс сборки (класс берётся из jar мода, иначе из вложенного или Minecraft).
 */
function openSource(q) {
  const disk = diskPath(q);
  if (disk) {
    const st = fs.statSync(disk);
    let byName;
    if (st.isDirectory()) byName = new Map([...walkClasses(disk)].map(([n, f]) => [n, () => fs.readFileSync(f)]));
    else if (disk.endsWith('.class')) {
      const buf = fs.readFileSync(disk);
      byName = new Map([[parseClassFull(buf).name, () => buf]]);
    } else {
      const c = tocCache.get(disk);
      if (c && c.sig === st.mtimeMs) byName = c.byName;
      else {
        byName = new Map(
          zipEntries(disk)
            .filter((e) => e.name.endsWith('.class') && !e.name.startsWith('META-INF/versions/'))
            .map((e) => [e.name.slice(0, -6), () => zipRead(disk, e)]),
        );
        tocCache.set(disk, { sig: st.mtimeMs, byName });
      }
    }
    return {
      label: path.relative(ROOT, disk).startsWith('..') ? disk : path.relative(ROOT, disk),
      names: () => [...byName.keys()],
      find: (cq) => findIn([...byName.keys()], cq),
      read: (n) => byName.get(n)?.() ?? null,
    };
  }
  if (q && /[/\\]/.test(q) && /\.(jar|class)$|^[~.]?\//.test(q) && !String(q).startsWith('candidate:'))
    throw new Error(`путь «${q}» не найден (абсолютный, от текущей папки или от корня репозитория)`);
  const jar = q ? resolveJar(q, true) : null;
  return {
    label: jar ? where(jar) : 'сборка',
    jar,
    names: () => {
      if (!jar) throw new Error('сравнение всего jar: укажите jar (старая версия) и diff (новая)');
      return jarToc(jar)
        .filter((e) => e.name.endsWith('.class') && !e.name.startsWith('META-INF/versions/'))
        .map((e) => e.name.slice(0, -6));
    },
    find: (cq) => findClasses(cq, jar),
    one: (cq) => oneClass(cq, jar),
    read: (n) => {
      const rec = classRecord(n, jar);
      return rec ? readEntry(rec.jar, rec.path)?.data : null;
    },
    where: (n) => {
      const rec = classRecord(n, jar);
      return rec ? where(rec.jar) : '';
    },
  };
}

/** Класс по запросу среди имён: полное (точки/слэши, вложенный через точку), хвост пути, простое имя */
function findIn(names, q) {
  const s = String(q ?? '')
    .trim()
    .replace(/\.class$/, '');
  if (!s) return [];
  const set = new Set(names);
  const internal = s.replaceAll('.', '/');
  if (set.has(internal)) return [internal];
  const parts = internal.split('/');
  for (let k = parts.length - 1; k > 0; k--) {
    const n = `${parts.slice(0, k).join('/')}/${parts.slice(k).join('$')}`;
    if (set.has(n)) return [n];
  }
  const exact = names.filter((n) => n === internal || n.endsWith(`/${internal}`));
  if (exact.length) return exact.sort();
  const low = internal.toLowerCase();
  return names
    .filter((n) =>
      n
        .slice(n.lastIndexOf('/') + 1)
        .toLowerCase()
        .includes(low),
    )
    .sort();
}

function pickClass(src, q) {
  if (src.one) return src.one(q);
  const hits = src.find(q);
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`класс «${q}» не найден в ${src.label}`);
  throw new Error(
    `«${q}» — несколько классов в ${src.label}, укажите полное имя:\n${hits.slice(0, 25).map(dotted).join('\n')}${hits.length > 25 ? `\n… ещё ${hits.length - 25}` : ''}`,
  );
}

function loadClass(src, name) {
  const buf = src.read(name);
  if (!buf) return null;
  return parseClassFull(buf);
}

// ---------------------------------------------------------------- декодер инструкций

const ARITH = ['+', '-', '*', '/', '%', 'neg'];
const BITS = { 0x78: '<<', 0x79: '<<', 0x7a: '>>', 0x7b: '>>', 0x7c: '>>>', 0x7d: '>>>', 0x7e: '&', 0x7f: '&' };
Object.assign(BITS, { 0x80: '|', 0x81: '|', 0x82: '^', 0x83: '^' });
const COND = ['==', '!=', '<', '>=', '>', '<='];
/** Упаковка чисел (Integer.valueOf, intValue…) — шум, в поток не идёт */
const BOXING = /^java\/lang\/(Integer|Long|Float|Double|Boolean|Short|Byte|Character)$/;
const NEWARRAY = { 4: 'boolean', 5: 'char', 6: 'float', 7: 'double', 8: 'byte', 9: 'short', 10: 'int', 11: 'long' };

/** Все инструкции метода с операндами: { pc, op, len, local?, value?, index?, target?, cases? } */
export function decode(code) {
  const out = [];
  let pc = 0;
  while (pc < code.length) {
    const op = code[pc];
    const ins = { pc, op, len: 1 };
    const u1 = (o) => code[pc + o];
    const u2 = (o) => code.readUInt16BE(pc + o);
    const s2 = (o) => code.readInt16BE(pc + o);
    if (op === 0x10) Object.assign(ins, { len: 2, value: code.readInt8(pc + 1) });
    else if (op === 0x11) Object.assign(ins, { len: 3, value: s2(1) });
    else if (op === 0x12) Object.assign(ins, { len: 2, index: u1(1) });
    else if (op === 0x13 || op === 0x14) Object.assign(ins, { len: 3, index: u2(1) });
    else if ((op >= 0x15 && op <= 0x19) || (op >= 0x36 && op <= 0x3a) || op === 0xa9)
      Object.assign(ins, { len: 2, local: u1(1) });
    else if (op === 0x84) Object.assign(ins, { len: 3, local: u1(1), value: code.readInt8(pc + 2) });
    else if ((op >= 0x99 && op <= 0xa8) || op === 0xc6 || op === 0xc7)
      Object.assign(ins, { len: 3, target: pc + s2(1) });
    else if (op === 0xc8 || op === 0xc9) Object.assign(ins, { len: 5, target: pc + code.readInt32BE(pc + 1) });
    else if (op === 0xaa || op === 0xab) {
      const base = (pc + 4) & ~3;
      const def = pc + code.readInt32BE(base);
      const cases = [];
      if (op === 0xaa) {
        const low = code.readInt32BE(base + 4);
        const high = code.readInt32BE(base + 8);
        for (let k = 0; k <= high - low; k++) cases.push([low + k, pc + code.readInt32BE(base + 12 + k * 4)]);
        ins.len = base + 12 + (high - low + 1) * 4 - pc;
      } else {
        const n = code.readInt32BE(base + 4);
        for (let k = 0; k < n; k++)
          cases.push([code.readInt32BE(base + 8 + k * 8), pc + code.readInt32BE(base + 12 + k * 8)]);
        ins.len = base + 8 + n * 8 - pc;
      }
      Object.assign(ins, { cases, target: def });
    } else if ((op >= 0xb2 && op <= 0xb8) || op === 0xbb || op === 0xbd || op === 0xc0 || op === 0xc1)
      Object.assign(ins, { len: 3, index: u2(1) });
    else if (op === 0xb9 || op === 0xba) Object.assign(ins, { len: 5, index: u2(1) });
    else if (op === 0xbc) Object.assign(ins, { len: 2, value: u1(1) });
    else if (op === 0xc5) Object.assign(ins, { len: 4, index: u2(1), value: u1(3) });
    else if (op === 0xc4) {
      // wide: та же инструкция с 16-битным номером локальной (и константой у iinc)
      const wop = u1(1);
      Object.assign(ins, { op: wop, local: u2(2), len: wop === 0x84 ? 6 : 4 });
      if (wop === 0x84) ins.value = s2(4);
    }
    out.push(ins);
    pc += ins.len;
  }
  return out;
}

// ---------------------------------------------------------------- поток операций метода

const simple = (internal) => {
  const n = internal.replace(/^\[+L?|;$/g, '');
  return n.slice(n.lastIndexOf('/') + 1);
};
const quote = (s) => JSON.stringify(s.length > 80 ? `${s.slice(0, 80)}…` : s);
const numText = (v) => (Number.isInteger(v) ? String(v) : String(+v.toPrecision(7)));

/** Имя локальной по слоту и pc (LocalVariableTable), иначе this / p1 (параметр) / v5 */
function localName(m, slot, pc, len) {
  const e = m.locals?.find((x) => x.slot === slot && x.start <= pc + len && pc <= x.start + x.len);
  if (e) return e.name;
  if (slot === 0 && !(m.access & ACC.STATIC)) return 'this';
  return `v${slot}`;
}

/**
 * Поток метода: [{ line, toks: [{ t, kind?, target?, cases? }] }]. kind — для обзора и сравнения:
 * call, get, put, str, num, cls, new. target — pc перехода (в текст подставляется строка исходника).
 */
export function flow(cls, m) {
  if (!m.code) return [];
  const { cp, utf, className, ref } = cls.pool;
  const own = cls.name;
  const ins = decode(m.code);
  const rows = [];
  let row = null;
  const handlers = new Map();
  for (const h of m.handlers ?? []) handlers.set(h.pc, h.type);
  const push = (tok, pc) => {
    const line = lineAt(m, pc);
    if (!row || (line !== null && line !== row.line)) {
      row = { line, toks: [] };
      rows.push(row);
    }
    row.toks.push(typeof tok === 'string' ? { t: tok, pc } : { ...tok, pc });
  };
  let prevCmp = false;
  for (let k = 0; k < ins.length; k++) {
    const i = ins[k];
    const op = i.op;
    const next = ins[k + 1];
    if (handlers.has(i.pc)) push(`catch(${handlers.get(i.pc) ? simple(handlers.get(i.pc)) : '*'})`, i.pc);
    const cmp = prevCmp;
    prevCmp = false;
    if (op === 0x01) push('null', i.pc);
    else if (op >= 0x02 && op <= 0x08) push({ t: String(op - 3), kind: 'small' }, i.pc);
    else if (op >= 0x09 && op <= 0x0f) push({ t: String([0, 1, 0, 1, 2, 0, 1][op - 9]), kind: 'small' }, i.pc);
    else if (op === 0x10 || op === 0x11) push({ t: String(i.value), kind: 'num' }, i.pc);
    else if (op >= 0x12 && op <= 0x14) {
      const c = cp[i.index];
      if (c?.tag === 8) push({ t: quote(utf(c.a)), kind: 'str' }, i.pc);
      else if (c?.tag === 7) push({ t: `${simple(utf(c.a))}.class`, kind: 'cls' }, i.pc);
      else if (c && 'v' in c) push({ t: numText(c.v), kind: 'num' }, i.pc);
      else push('ldc', i.pc);
    } else if ((op >= 0x15 && op <= 0x19) || (op >= 0x1a && op <= 0x2d)) {
      const slot = op <= 0x19 ? i.local : (op - 0x1a) % 4;
      const name = localName(m, slot, i.pc, i.len);
      // this перед своим полем — шум: «.heat» и так про this
      if (name === 'this' && next && (next.op === 0xb4 || next.op === 0xb6) && ref(next.index).owner === own) continue;
      push(name, i.pc);
    } else if ((op >= 0x2e && op <= 0x35) || op === 0xbe) push(op === 0xbe ? '.length' : '[]', i.pc);
    else if ((op >= 0x36 && op <= 0x3a) || (op >= 0x3b && op <= 0x4e)) {
      const slot = op <= 0x3a ? i.local : (op - 0x3b) % 4;
      push(`→${localName(m, slot, i.pc, i.len)}`, i.pc);
    } else if (op >= 0x4f && op <= 0x56) push('[]=', i.pc);
    else if (op >= 0x60 && op <= 0x77) push(ARITH[Math.floor((op - 0x60) / 4)], i.pc);
    else if (BITS[op]) push(BITS[op], i.pc);
    else if (op === 0x84) push(`${localName(m, i.local, i.pc, i.len)}+=${i.value}`, i.pc);
    else if (op >= 0x94 && op <= 0x98) prevCmp = true;
    else if (op >= 0x99 && op <= 0x9e)
      push({ t: cmp ? `if${COND[op - 0x99]}` : `if${COND[op - 0x99]}0`, target: i.target }, i.pc);
    else if (op >= 0x9f && op <= 0xa4) push({ t: `if${COND[op - 0x9f]}`, target: i.target }, i.pc);
    else if (op === 0xa5 || op === 0xa6) push({ t: op === 0xa5 ? 'if==' : 'if!=', target: i.target }, i.pc);
    else if (op === 0xc6 || op === 0xc7) push({ t: op === 0xc6 ? 'if null' : 'if !null', target: i.target }, i.pc);
    else if (op === 0xa7 || op === 0xc8) {
      // goto в конец метода после return не нужен; переходы назад — циклы
      push({ t: 'goto', target: i.target }, i.pc);
    } else if (op === 0xaa || op === 0xab) push({ t: 'switch', cases: i.cases, target: i.target }, i.pc);
    else if (op >= 0xac && op <= 0xb0) push('return', i.pc);
    else if (op === 0xb1) {
      if (next) push('return', i.pc);
    } else if (op >= 0xb2 && op <= 0xb5) {
      const r = ref(i.index);
      const isOwn = r.owner === own;
      const stat = op === 0xb2 || op === 0xb3;
      const name = isOwn ? (stat ? r.name : `.${r.name}`) : `${simple(r.owner)}.${r.name}`;
      const write = op === 0xb3 || op === 0xb5;
      push({ t: write ? `→${name}` : name, kind: write ? 'put' : 'get' }, i.pc);
    } else if (op >= 0xb6 && op <= 0xb9) {
      const r = ref(i.index);
      if (r.name === '<init>') {
        const t = r.owner === own ? 'this()' : r.owner === cls.superName && m.name === '<init>' ? 'super()' : null;
        push({ t: t ?? `new ${simple(r.owner)}()`, kind: t ? undefined : 'new', key: `new ${simple(r.owner)}` }, i.pc);
      } else if (BOXING.test(r.owner) && /^valueOf$|Value$/.test(r.name)) continue;
      else {
        const sup = op === 0xb7 && r.owner !== own;
        const t = sup ? `super.${r.name}()` : r.owner === own ? `${r.name}()` : `${simple(r.owner)}.${r.name}()`;
        push({ t, kind: 'call', key: `${simple(r.owner)}.${r.name}` }, i.pc);
      }
    } else if (op === 0xba) {
      const c = cp[i.index];
      const nat = cp[c.b];
      const args = cls.bootstrap[c.a] ?? [];
      const handle = args.find((x) => x?.handle)?.handle;
      const recipe = args.find((x) => typeof x === 'string');
      if (recipe !== undefined && utf(nat.a) === 'makeConcatWithConstants')
        push({ t: `concat${quote(recipe.replaceAll('\u0001', '·'))}`, kind: 'str', key: quote(recipe) }, i.pc);
      else if (handle && handle.owner === own && handle.name.startsWith('lambda$'))
        push({ t: `λ${handle.name}`, kind: 'call', key: handle.name }, i.pc);
      else if (handle)
        push(
          { t: `${simple(handle.owner)}::${handle.name}`, kind: 'call', key: `${simple(handle.owner)}.${handle.name}` },
          i.pc,
        );
      else push(`indy ${utf(nat.a)}`, i.pc);
    } else if (op === 0xbb)
      continue; // new — вместе с конструктором
    else if (op === 0xbc) push(`new ${NEWARRAY[i.value] ?? '?'}[]`, i.pc);
    else if (op === 0xbd || op === 0xc5)
      push({ t: `new ${simple(className(i.index))}[]`, kind: 'new', key: `new ${simple(className(i.index))}[]` }, i.pc);
    else if (op === 0xbf) push('throw', i.pc);
    else if (op === 0xc0) push({ t: `(${simple(className(i.index))})`, kind: 'cls' }, i.pc);
    else if (op === 0xc1) push({ t: `instanceof ${simple(className(i.index))}`, kind: 'cls' }, i.pc);
    else if (op === 0xc2) push('synchronized', i.pc);
  }
  return rows;
}

/** Текст строки потока; at(цель, откуда) → «:47» */
function rowText(row, at) {
  return row.toks
    .map((x) => {
      if (x.cases)
        return `switch{${x.cases.map(([v, p]) => `${v}→${at(p, x.pc)}`).join(' ')} иначе→${at(x.target, x.pc)}}`;
      return x.target !== undefined ? `${x.t} →${at(x.target, x.pc)}` : x.t;
    })
    .join(' ');
}

/** Строки метода для показа: «:42  .heat 1200 if< →:47»; переход внутри той же строки — на метку [a] */
function methodRows(cls, m) {
  const rows = flow(cls, m);
  const out = [];
  for (const r of rows) {
    if (!r.toks.length) continue;
    // Цели внутри строки: первая операция с pc ≥ цели получает метку
    const labels = new Map();
    const inRow = (pc) => {
      if (lineAt(m, pc) !== r.line || pc <= r.toks[0].pc) return null;
      const tok = r.toks.find((x) => x.pc >= pc);
      if (!tok) return null;
      if (!labels.has(tok.pc)) labels.set(tok.pc, `[${String.fromCharCode(97 + labels.size)}]`);
      return labels.get(tok.pc);
    };
    for (const x of r.toks)
      for (const pc of [x.target, ...(x.cases ?? []).map((c) => c[1])]) if (pc !== undefined) inRow(pc);
    // Строка цели перехода; переход назад по байткоду — «↑:N» (цикл)
    const at = (pc, from) => {
      const label = pc > from ? inRow(pc) : null;
      if (label) return label;
      const tl = lineAt(m, pc);
      return `${pc <= from ? '↑' : ''}${tl === null ? `@${pc}` : `:${tl}`}`;
    };
    const marked = {
      ...r,
      toks: r.toks.flatMap((x) =>
        labels.has(x.pc) && x === r.toks.find((y) => y.pc === x.pc) ? [{ t: labels.get(x.pc), pc: x.pc }, x] : [x],
      ),
    };
    out.push({ line: r.line, text: rowText(marked, at) });
  }
  return out;
}

/** Нормализованный поток для сравнения версий: без номеров строк, переходы — по порядковому номеру инструкции */
function methodKey(cls, m) {
  if (!m.code) return '';
  const order = new Map(decode(m.code).map((x, k) => [x.pc, k]));
  const at = (pc) => `#${order.get(pc) ?? pc}`;
  return flow(cls, m)
    .map((r) => rowText(r, at))
    .join('\n');
}

/** Строки потока без номеров строк исходника — для построчного сравнения метода */
function methodLinesForDiff(cls, m) {
  return methodRows(cls, m).map((r) => r.text.replace(/→↑?:\d+/g, '→…'));
}

// ---------------------------------------------------------------- обзор класса

/** Сводка метода: вызовы, поля (чтение/ЗАПИСЬ), строки, числа, классы — уникально, по порядку */
function summary(cls, m) {
  const s = { call: new Set(), get: new Set(), put: new Set(), str: new Set(), num: new Set(), new: new Set() };
  for (const r of flow(cls, m))
    for (const x of r.toks) {
      if (x.kind === 'call') s.call.add(x.t.replace(/^λ/, 'λ'));
      else if (x.kind === 'get') s.get.add(x.t);
      else if (x.kind === 'put') s.put.add(x.t);
      else if (x.kind === 'str') s.str.add(x.t);
      else if (x.kind === 'num') s.num.add(x.t);
      else if (x.kind === 'new') s.new.add(x.t.replace(/\(\)$/, ''));
    }
  return s;
}

const MAX_LIST = 8;
const list = (set, n = MAX_LIST) => {
  const a = [...set];
  return a.length > n ? `${a.slice(0, n).join(', ')} … +${a.length - n}` : a.join(', ');
};

function lineRange(m) {
  if (!m.lines?.length) return '';
  const ls = m.lines.map((x) => x[1]);
  const lo = Math.min(...ls);
  const hi = Math.max(...ls);
  return lo === hi ? ` :${lo}` : ` :${lo}–${hi}`;
}

/** Сводка метода одной-двумя строками */
function summaryLines(cls, m) {
  const s = summary(cls, m);
  const n = MAX_LIST;
  const parts = [];
  if (s.call.size) parts.push(`вызывает ${list(s.call, n)}`);
  if (s.new.size) parts.push(`создаёт ${list(s.new, n)}`);
  if (s.put.size) parts.push(`ЗАПИСЬ ${list(new Set([...s.put].map((x) => x.slice(1))), n)}`);
  if (s.get.size) parts.push(`читает ${list(s.get, n)}`);
  if (s.str.size) parts.push(`строки ${list(s.str, n)}`);
  if (s.num.size) parts.push(`числа ${list(s.num, n)}`);
  const head = `${methodSig(m, cls.name)}${lineRange(m)}${m.code ? ` · ${m.code.length} Б` : ' · без кода'}`;
  return parts.length ? [head, `    ${parts.join('; ')}`] : [head];
}

const NOTE =
  '.поле — своё, →x — запись, «if< →:47» — переход при условии (обратном if исходника), ↑ — назад (цикл), λ — лямбда (method=lambda\\$…).';

function classOutline(src, name, a) {
  const cls = loadClass(src, name);
  const re = a.query ? userRegex(a.query) : null;
  const ms = cls.methods.filter((m) => {
    if (m.access & ACC.BRIDGE) return false;
    if (!re) return true;
    if (re.test(m.name)) return true;
    const s = summary(cls, m);
    return [...s.call, ...s.get, ...s.put, ...s.str, ...s.num, ...s.new].some((x) => re.test(x));
  });
  const head = [
    `${dotted(name)} — ${src.where?.(name) || src.label}; методов ${ms.length}${re ? ` по «${a.query}»` : ''} из ${cls.methods.length}`,
  ];
  if (cls.superName && cls.superName !== 'java/lang/Object') head.push(`extends ${javaName(cls.superName)}`);
  if (cls.interfaces.length) head.push(`implements ${cls.interfaces.map((x) => javaName(x)).join(', ')}`);
  const consts = cls.fields.filter((f) => f.constant !== undefined);
  if (consts.length)
    head.push(
      `константы: ${consts.map((f) => `${f.name}=${typeof f.constant === 'number' ? numText(f.constant) : JSON.stringify(f.constant)}`).join(', ')}`,
    );
  const body = page(ms, a, (m) => summaryLines(cls, m).map((l) => `  ${l}`), 60);
  return clip([...head, body, 'Метод подробно — method=<имя>.'].join('\n'));
}

function methodView(src, name, a) {
  const cls = loadClass(src, name);
  const re = userRegex(`^(?:${a.method})$`);
  const ms = cls.methods.filter((m) => re.test(m.name));
  if (!ms.length)
    throw new Error(
      `в ${dotted(name)} нет метода «${a.method}»; есть: ${[...new Set(cls.methods.map((m) => m.name))].join(', ')}`,
    );
  const grep = a.query ? userRegex(a.query) : null;
  const out = [`${dotted(name)} — ${src.where?.(name) || src.label}`];
  for (const m of ms) {
    out.push('', `${methodSig(m, cls.name)}${lineRange(m)}${m.code ? ` · ${m.code.length} Б` : ' · без кода'}`);
    if (!m.code) continue;
    let rows = methodRows(cls, m);
    if (grep) rows = rows.filter((r) => grep.test(r.text));
    const offset = Math.max(0, Number(a.offset ?? 0) | 0);
    const limit = Math.min(1000, Math.max(1, Number(a.limit ?? 300) | 0));
    const part = rows.slice(offset, offset + limit);
    for (const r of part) out.push(`  ${r.line === null ? '   ' : `:${r.line}`}  ${r.text}`);
    if (offset + part.length < rows.length)
      out.push(`  … ещё ${rows.length - offset - part.length} строк: offset=${offset + part.length}`);
    if (!m.lines) out.push('  (в классе нет номеров строк — строки исходника не показаны)');
  }
  out.push('', NOTE);
  return clip(out.join('\n'));
}

// ---------------------------------------------------------------- сравнение версий

const sig = (x) => `${x.name}${x.desc}`;
const mshort = (cls, m) =>
  methodSig(m, cls.name).replace(/^(public|protected|private|static|final|abstract|synchronized|native|\s)+/, '');

/** LCS по строкам: [['=', i, j] | ['-', i] | ['+', null, j]] — индексы строк старой и новой версии */
function lineDiff(a, b) {
  const n = a.length;
  const k = b.length;
  if (n * k > 4e6) return null;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(k + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = k - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < k)
    if (a[i] === b[j]) out.push(['=', i++, j++]);
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(['-', i++]);
    else out.push(['+', null, j++]);
  while (i < n) out.push(['-', i++]);
  while (j < k) out.push(['+', null, j++]);
  return out;
}

function setDiff(a, b) {
  const plus = [...b].filter((x) => !a.has(x));
  const minus = [...a].filter((x) => !b.has(x));
  return { plus, minus };
}

/** Что поменялось в классе: заголовок, поля, методы (добавлены, удалены, изменены — с разницей ссылок) */
function classDiff(oldCls, newCls) {
  const out = [];
  if (oldCls.superName !== newCls.superName)
    out.push(`extends: ${javaName(oldCls.superName ?? '-')} → ${javaName(newCls.superName ?? '-')}`);
  const ifs = setDiff(new Set(oldCls.interfaces), new Set(newCls.interfaces));
  if (ifs.plus.length || ifs.minus.length)
    out.push(
      `implements: ${[...ifs.plus.map((x) => `+${javaName(x)}`), ...ifs.minus.map((x) => `−${javaName(x)}`)].join(', ')}`,
    );
  const of = new Map(oldCls.fields.map((f) => [sig(f), f]));
  const nf = new Map(newCls.fields.map((f) => [sig(f), f]));
  for (const [s, f] of nf)
    if (!of.has(s)) out.push(`+ поле ${f.name}${f.constant !== undefined ? ` = ${JSON.stringify(f.constant)}` : ''}`);
    else if (of.get(s).constant !== f.constant)
      out.push(`~ поле ${f.name}: ${JSON.stringify(of.get(s).constant)} → ${JSON.stringify(f.constant)}`);
    else if (of.get(s).access !== f.access) out.push(`~ поле ${f.name}: модификаторы`);
  for (const [s, f] of of) if (!nf.has(s)) out.push(`− поле ${f.name}`);
  const om = new Map(oldCls.methods.map((m) => [sig(m), m]));
  const nm = new Map(newCls.methods.map((m) => [sig(m), m]));
  const changed = [];
  for (const [s, m] of nm) {
    if (!om.has(s)) {
      out.push(`+ ${mshort(newCls, m)}${lineRange(m)}`);
      continue;
    }
    const o = om.get(s);
    if (o.access !== m.access) out.push(`~ ${mshort(newCls, m)}: модификаторы`);
    if (methodKey(oldCls, o) === methodKey(newCls, m)) continue;
    changed.push([o, m]);
  }
  for (const [s, m] of om) if (!nm.has(s)) out.push(`− ${mshort(oldCls, m)}`);
  for (const [o, m] of changed) {
    const a = summary(oldCls, o);
    const b = summary(newCls, m);
    const parts = [];
    for (const [k, label] of [
      ['call', 'вызовы'],
      ['new', 'создаёт'],
      ['put', 'запись'],
      ['get', 'чтение'],
      ['str', 'строки'],
      ['num', 'числа'],
    ]) {
      const d = setDiff(a[k], b[k]);
      if (d.plus.length || d.minus.length)
        parts.push(
          `${label} ${[...d.plus.map((x) => `+${x}`), ...d.minus.map((x) => `−${x}`)].slice(0, 20).join(' ')}`,
        );
    }
    out.push(
      `~ ${mshort(newCls, m)}${lineRange(m)} · ${o.code?.length ?? 0}→${m.code?.length ?? 0} Б${parts.length ? `: ${parts.join('; ')}` : ': та же сводка, поменялась логика (ветвления, арифметика, порядок)'}`,
    );
  }
  return out;
}

function methodDiff(oldCls, newCls, a) {
  const re = userRegex(`^(?:${a.method})$`);
  const pairs = [];
  const om = oldCls.methods.filter((m) => re.test(m.name));
  const nm = newCls.methods.filter((m) => re.test(m.name));
  for (const m of nm) pairs.push([om.find((o) => sig(o) === sig(m)) ?? null, m]);
  for (const o of om) if (!nm.some((m) => sig(m) === sig(o))) pairs.push([o, null]);
  if (!pairs.length) throw new Error(`метода «${a.method}» нет ни в одной версии ${dotted(newCls.name)}`);
  const out = [];
  for (const [o, m] of pairs) {
    if (!o) {
      out.push(`+ ${mshort(newCls, m)} — только в новой`);
      continue;
    }
    if (!m) {
      out.push(`− ${mshort(oldCls, o)} — только в старой`);
      continue;
    }
    if (methodKey(oldCls, o) === methodKey(newCls, m)) {
      out.push(
        `= ${mshort(newCls, m)}: код тот же${lineRange(o) !== lineRange(m) ? ` (строки ${lineRange(o).trim()} → ${lineRange(m).trim()})` : ''}`,
      );
      continue;
    }
    const oldRows = methodRows(oldCls, o);
    const newRows = methodRows(newCls, m);
    const d = lineDiff(methodLinesForDiff(oldCls, o), methodLinesForDiff(newCls, m));
    out.push(`~ ${mshort(newCls, m)} · старая${lineRange(o)}, новая${lineRange(m)}`);
    if (!d) {
      out.push('  метод слишком большой для построчного сравнения — сравните method=… без diff');
      continue;
    }
    // Показ: изменённые строки и по одной строке контекста; у «−» номер строки старой версии, у остальных — новой
    const near = (k) => d[k] && d[k][0] !== '=';
    let gap = false;
    for (let k = 0; k < d.length; k++) {
      const [kind, i, j] = d[k];
      if (kind === '=' && !near(k - 1) && !near(k + 1)) {
        gap = true;
        continue;
      }
      if (gap) out.push('  …');
      gap = false;
      const r = kind === '-' ? oldRows[i] : newRows[j];
      out.push(`  ${kind === '=' ? ' ' : kind === '-' ? '−' : '+'} :${r.line ?? '?'}  ${r.text}`);
    }
    if (gap) out.push('  …');
  }
  return out;
}

function jarDiff(oldSrc, newSrc, a) {
  const on = new Set(oldSrc.names());
  const nn = new Set(newSrc.names());
  const re = a.query ? userRegex(a.query) : null;
  const pass = (n) => !re || re.test(dotted(n));
  const added = [...nn].filter((n) => !on.has(n) && pass(n)).sort();
  const removed = [...on].filter((n) => !nn.has(n) && pass(n)).sort();
  const changed = [];
  let linesOnly = 0;
  for (const n of [...nn].filter((x) => on.has(x) && pass(x)).sort()) {
    const ob = oldSrc.read(n);
    const nb = newSrc.read(n);
    if (ob.equals(nb)) continue;
    const d = classDiff(parseClassFull(ob), parseClassFull(nb));
    if (d.length) changed.push([n, d]);
    else linesOnly++;
  }
  const out = [
    `${oldSrc.label} → ${newSrc.label}${re ? ` (классы по «${a.query}»)` : ''}: изменено ${changed.length}, добавлено ${added.length}, удалено ${removed.length}${linesOnly ? `; ещё ${linesOnly} отличаются только номерами строк / пулом констант` : ''}`,
  ];
  const items = [
    ...changed.map(([n, d]) => [
      `~ ${dotted(n)}: ${d.length} изм. — ${d
        .slice(0, 3)
        .map((x) => x.replace(/\s+/g, ' ').slice(0, 140))
        .join(' | ')}${d.length > 3 ? ' …' : ''}`,
    ]),
    ...added.map((n) => [`+ ${dotted(n)}`]),
    ...removed.map((n) => [`− ${dotted(n)}`]),
  ];
  out.push(page(items, a, (x) => x, 80));
  out.push('Класс подробно — class=<имя> с тем же jar и diff; метод построчно — ещё method=<имя>.');
  return clip(out.join('\n'));
}

// ---------------------------------------------------------------- инструмент

async function bytecodeTool(a) {
  const src = openSource(a.jar);
  if (a.diff) {
    const other = openSource(a.diff);
    if (!a.class) return jarDiff(src, other, a);
    const name = pickClass(src, a.class);
    const oldCls = loadClass(src, name);
    const newCls = loadClass(other, name);
    if (!newCls) throw new Error(`в ${other.label} нет класса ${dotted(name)} (переименован или удалён)`);
    const head = `${dotted(name)}: ${src.where?.(name) || src.label} → ${other.label}`;
    const body = a.method ? methodDiff(oldCls, newCls, a) : classDiff(oldCls, newCls);
    return clip(
      [head, ...(body.length ? body : ['код и поля не изменились (могли сдвинуться номера строк)'])].join('\n'),
    );
  }
  if (!a.class) {
    const disk = diskPath(a.jar);
    if (disk?.endsWith('.class')) a = { ...a, class: src.names()[0] };
    else throw new Error('укажите class (или diff — сравнить два jar)');
  }
  const name = pickClass(src, a.class);
  return a.method ? methodView(src, name, a) : classOutline(src, name, a);
}

export const TOOLS = [
  {
    name: 'bytecode',
    description:
      'Compact bytecode reader (own parser, no JDK) — instead of javap in a shell. Without method: one line per method — calls, fields read/WRITTEN, strings, numbers, created classes (query — only methods mentioning it). method (regex) — the method as a per-source-line op stream without stack noise (locals by name, constants, fields, calls, branches with target lines, switch, lambdas, string concat). jar — pack jar/mod id/«minecraft»/«candidate:<file>» OR a path on disk: a .jar, a classes folder (tools/<addon>/build/classes/java/main, run/.mixin.out/class — class after mixins), a .class. diff — another version (jar or path): with class — fields/methods added/removed/changed with call/field/constant differences; with method — line diff; without class — which classes changed between two jars. Readable source — decompile.',
    inputSchema: {
      type: 'object',
      properties: {
        class: str('class (full name, simple name if unique, nested via $ or dot); optional with diff (whole jar)'),
        jar: str('pack jar, mod id, «minecraft», «candidate:<file>» or a path to .jar / classes folder / .class'),
        method: str('method name or regex (lambda\\$tick\\$0); shows the op stream'),
        query: str(
          'regex: without method — methods mentioning it; with method — only matching lines; with jar diff — class names',
        ),
        diff: str('the other version to compare with (jar or path); jar is the old one, diff the new one'),
        ...paging,
      },
    },
    handler: bytecodeTool,
  },
];
