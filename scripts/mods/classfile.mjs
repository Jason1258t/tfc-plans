/**
 * Минимальный разбор .class (JVM) на Node — чтобы доставать из jar то, что моды задают кодом, а не данными:
 * константы перечислений (аргументы конструкторов), значения static final полей, цели лямбд.
 * JDK и javap не нужны: сборка должна работать у любого, кто положил моды в mods/.
 *
 *   const cls = parseClass(buffer)
 *   cls.name, cls.interfaces, cls.fields[{ name, desc, constant }], cls.methods[{ name, desc, code }]
 *   enumConstants(cls)  → [{ name, field, desc, args: [значения после (String имя, int номер)] }]
 *   clinitValues(cls)   → { constants (то же), statics: Map(имя статического поля → значение) }
 *   lambdaTargets(cls, method) → [{ owner, name, desc }] — что вызывают лямбды, созданные в методе
 *
 * Значения аргументов: числа, строки, null, { field: { owner, name } }, { array: [...] , type },
 * { new: класс, args }, { call: { owner, name, desc }, args }, { indy: номер bootstrap-метода, args }.
 */

// Константы пула
const UTF8 = 1;
const INT = 3;
const FLOAT = 4;
const LONG = 5;
const DOUBLE = 6;
const CLASS = 7;
const STRING = 8;
const FIELD = 9;
const METHOD = 10;
const IMETHOD = 11;
const NAT = 12;
const MHANDLE = 15;
const MTYPE = 16;
const DYNAMIC = 17;
const INDY = 18;
const MODULE = 19;
const PACKAGE = 20;

export function parseClass(buf) {
  let p = 0;
  const u1 = () => buf[p++];
  const u2 = () => ((p += 2), buf.readUInt16BE(p - 2));
  const u4 = () => ((p += 4), buf.readUInt32BE(p - 4));
  if (u4() !== 0xcafebabe) throw new Error('не class-файл');
  p += 4; // версии
  const n = u2();
  const cp = new Array(n);
  for (let i = 1; i < n; i++) {
    const tag = u1();
    switch (tag) {
      case UTF8: {
        const len = u2();
        // Модифицированный UTF-8: для имён и строк модов достаточно обычного декодирования
        cp[i] = { tag, v: buf.toString('utf8', p, p + len) };
        p += len;
        break;
      }
      case INT:
        cp[i] = { tag, v: buf.readInt32BE(p) };
        p += 4;
        break;
      case FLOAT:
        cp[i] = { tag, v: buf.readFloatBE(p) };
        p += 4;
        break;
      case LONG:
        cp[i] = { tag, v: Number(buf.readBigInt64BE(p)) };
        p += 8;
        i++;
        break;
      case DOUBLE:
        cp[i] = { tag, v: buf.readDoubleBE(p) };
        p += 8;
        i++;
        break;
      case CLASS:
      case STRING:
      case MTYPE:
      case MODULE:
      case PACKAGE:
        cp[i] = { tag, a: u2() };
        break;
      case FIELD:
      case METHOD:
      case IMETHOD:
      case NAT:
      case DYNAMIC:
      case INDY:
        cp[i] = { tag, a: u2(), b: u2() };
        break;
      case MHANDLE:
        cp[i] = { tag, kind: u1(), a: u2() };
        break;
      default:
        throw new Error(`неизвестный тег пула ${tag}`);
    }
  }
  const utf = (i) => cp[i]?.v;
  const className = (i) => utf(cp[i].a);
  const nat = (i) => ({ name: utf(cp[i].a), desc: utf(cp[i].b) });
  const ref = (i) => ({ owner: className(cp[i].a), ...nat(cp[i].b) });
  /** Значение константы пула для ldc: число, строка или { class } */
  const constant = (i) => {
    const c = cp[i];
    if (!c) return undefined;
    if (c.tag === INT || c.tag === FLOAT || c.tag === LONG || c.tag === DOUBLE) return c.v;
    if (c.tag === STRING) return utf(c.a);
    if (c.tag === CLASS) return { class: utf(c.a) };
    return undefined;
  };

  p += 2; // access
  const name = className(u2());
  const superIdx = u2();
  const superName = superIdx ? className(superIdx) : null;
  const interfaces = [];
  for (let n = u2(); n > 0; n--) interfaces.push(className(u2()));

  const attributes = () => {
    const out = [];
    for (let k = u2(); k > 0; k--) {
      const an = utf(u2());
      const len = u4();
      out.push({ name: an, start: p, len });
      p += len;
    }
    return out;
  };

  const fields = [];
  for (let k = u2(); k > 0; k--) {
    const access = u2();
    const f = { access, name: utf(u2()), desc: utf(u2()), constant: undefined };
    for (const a of attributes()) if (a.name === 'ConstantValue') f.constant = constant(buf.readUInt16BE(a.start));
    fields.push(f);
  }

  const methods = [];
  for (let k = u2(); k > 0; k--) {
    const access = u2();
    const m = { access, name: utf(u2()), desc: utf(u2()), code: null };
    for (const a of attributes())
      if (a.name === 'Code') {
        const len = buf.readUInt32BE(a.start + 4);
        m.code = buf.subarray(a.start + 8, a.start + 8 + len);
      }
    methods.push(m);
  }

  /**
   * BootstrapMethods: у лямбд второй аргумент — MethodHandle на тело лямбды; у склейки строк (StringConcatFactory)
   * аргумент — рецепт: «\u0001» — место переменной части. args.method — сам bootstrap-метод.
   */
  const bootstrap = [];
  for (const a of attributes()) {
    if (a.name !== 'BootstrapMethods') continue;
    let q = a.start;
    const count = buf.readUInt16BE(q);
    q += 2;
    for (let i = 0; i < count; i++) {
      const bsm = cp[buf.readUInt16BE(q)];
      q += 2;
      const argc = buf.readUInt16BE(q);
      q += 2;
      const args = [];
      for (let j = 0; j < argc; j++, q += 2) {
        const c = cp[buf.readUInt16BE(q)];
        args.push(c?.tag === MHANDLE ? { handle: ref(c.a) } : c?.tag === STRING ? { string: utf(c.a) } : null);
      }
      args.method = bsm?.tag === MHANDLE ? ref(bsm.a) : null;
      bootstrap.push(args);
    }
  }

  return { name, superName, interfaces, fields, methods, bootstrap, cp, constant, ref, nat, className, utf };
}

// ---------------------------------------------------------------- инструкции

/** Длина инструкции по опкоду (без переменной длины: tableswitch, lookupswitch, wide — отдельно) */
const LEN = new Uint8Array(256).fill(1);
for (const [ops, len] of [
  [[0x10, 0x12, 0x15, 0x16, 0x17, 0x18, 0x19, 0x36, 0x37, 0x38, 0x39, 0x3a, 0xa9, 0xbc], 2],
  [[0x11, 0x13, 0x14, 0x84, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xbb, 0xbd, 0xc0, 0xc1], 3],
  [[0xc5], 4],
  [[0xb9, 0xba, 0xc8, 0xc9], 5],
])
  for (const o of ops) LEN[o] = len;
for (let o = 0x99; o <= 0xa8; o++) LEN[o] = 3; // условные переходы, goto, jsr
LEN[0xc6] = 3; // ifnull
LEN[0xc7] = 3; // ifnonnull

/** Линейный проход по байткоду: [{ pc, op, index? (u1/u2 операнд), value? }] */
export function instructions(code) {
  const out = [];
  let pc = 0;
  while (pc < code.length) {
    const op = code[pc];
    let len = LEN[op];
    const ins = { pc, op };
    if (op === 0xaa) {
      // tableswitch
      const base = (pc + 4) & ~3;
      const low = code.readInt32BE(base + 4);
      const high = code.readInt32BE(base + 8);
      len = base + 12 + (high - low + 1) * 4 - pc;
    } else if (op === 0xab) {
      // lookupswitch
      const base = (pc + 4) & ~3;
      len = base + 8 + code.readInt32BE(base + 4) * 8 - pc;
    } else if (op === 0xc4) {
      len = code[pc + 1] === 0x84 ? 6 : 4; // wide
    } else if (len === 2) ins.index = op === 0x10 ? code.readInt8(pc + 1) : code[pc + 1];
    else if (len >= 3) ins.index = op === 0x11 ? code.readInt16BE(pc + 1) : code.readUInt16BE(pc + 1);
    out.push(ins);
    pc += len;
  }
  return out;
}

/** Типы аргументов из дескриптора метода: «(Ljava/lang/String;IF[I)V» → ['L…;', 'I', 'F', '[I'] */
export function argTypes(desc) {
  const out = [];
  const body = desc.slice(1, desc.indexOf(')'));
  for (let i = 0; i < body.length;) {
    const start = i;
    while (body[i] === '[') i++;
    if (body[i] === 'L') i = body.indexOf(';', i);
    i++;
    out.push(body.slice(start, i));
  }
  return out;
}
const returnsVoid = (desc) => desc.endsWith(')V');

/**
 * Константы перечисления из <clinit>: упрощённая стековая машина только по тем инструкциям, из которых
 * javac собирает «new Enum("ИМЯ", номер, аргументы…)». Встретив незнакомую инструкцию, стек сбрасывается —
 * конструкции перечислений идут подряд и от этого не страдают.
 */
export function enumConstants(cls) {
  return clinitValues(cls).constants;
}

/**
 * Всё, что видно в <clinit>: константы перечисления и значения статических полей (массивы, числа, строки),
 * например «static final Lifecycle[] BANANA_STAGES = {…}» в обычном классе.
 */
export function clinitValues(cls) {
  const clinit = cls.methods.find((m) => m.name === '<clinit>');
  const statics = new Map();
  if (!clinit?.code) return { constants: [], statics };
  const out = [];
  let stack = [];
  const pop = (n) => (n ? stack.splice(Math.max(0, stack.length - n), n) : []);
  for (const ins of instructions(clinit.code)) {
    const { op } = ins;
    if (op === 0x01) stack.push(null);
    else if (op >= 0x02 && op <= 0x08)
      stack.push(op - 0x03); // iconst_m1..5
    else if (op === 0x09 || op === 0x0a)
      stack.push(op - 0x09); // lconst
    else if (op >= 0x0b && op <= 0x0d)
      stack.push(op - 0x0b); // fconst
    else if (op === 0x0e || op === 0x0f)
      stack.push(op - 0x0e); // dconst
    else if (op === 0x10 || op === 0x11) stack.push(ins.index);
    else if (op === 0x12 || op === 0x13 || op === 0x14) stack.push(cls.constant(ins.index));
    else if (op === 0xb2) {
      const r = cls.ref(ins.index);
      stack.push({ field: { owner: r.owner, name: r.name } });
    } else if (op === 0xbb) stack.push({ new: cls.className(ins.index), args: null });
    else if (op === 0x59) stack.push(stack.at(-1));
    else if (op === 0xbd) {
      const [len] = pop(1);
      stack.push({ array: new Array(typeof len === 'number' ? len : 0).fill(null), type: cls.className(ins.index) });
    } else if (op === 0xbc) {
      const [len] = pop(1);
      stack.push({ array: new Array(typeof len === 'number' ? len : 0).fill(null), type: 'primitive' });
    } else if (op === 0x53 || (op >= 0x4f && op <= 0x56)) {
      const [arr, idx, value] = pop(3);
      if (arr?.array && typeof idx === 'number') arr.array[idx] = value;
    } else if (op === 0xc0) {
      /* checkcast — значение то же */
    } else if (op === 0xb7 || op === 0xb6 || op === 0xb8 || op === 0xb9) {
      const r = cls.ref(ins.index);
      const args = pop(argTypes(r.desc).length);
      const self = op === 0xb8 ? null : pop(1)[0];
      if (op === 0xb7 && r.name === '<init>') {
        if (self && typeof self === 'object' && 'new' in self) self.args = args;
        if (r.owner === cls.name && typeof args[0] === 'string')
          out.push({ name: args[0], field: null, desc: r.desc, args: args.slice(2), obj: self });
      } else if (!returnsVoid(r.desc)) stack.push({ call: r, args, self });
    } else if (op === 0xba) {
      const c = cls.cp[ins.index];
      const d = cls.nat(c.b);
      stack.push({ indy: c.a, args: pop(argTypes(d.desc).length) });
    } else if (op === 0xb3) {
      const [v] = pop(1);
      const hit = out.find((e) => e.obj === v);
      const r = cls.ref(ins.index);
      if (hit && !hit.field) hit.field = r.name;
      else if (r.owner === cls.name && v !== undefined) statics.set(r.name, v);
    } else stack = [];
  }
  return { constants: out.map(({ obj: _obj, ...e }) => e), statics };
}

/** Что вызывают лямбды, созданные в методе: тела лямбд (invokestatic/new) по порядку появления */
export function lambdaTargets(cls, method) {
  const out = [];
  if (!method?.code) return out;
  for (const ins of instructions(method.code)) {
    if (ins.op !== 0xba) continue;
    const impl = cls.bootstrap[cls.cp[ins.index].a]?.find((a) => a?.handle)?.handle;
    if (!impl) continue;
    if (impl.owner !== cls.name) {
      out.push(impl);
      continue;
    }
    const body = cls.methods.find((m) => m.name === impl.name && m.desc === impl.desc);
    for (const i of body?.code ? instructions(body.code) : []) {
      if (i.op === 0xb8 || i.op === 0xb7 || i.op === 0xb6) out.push(cls.ref(i.index));
      else if (i.op === 0xbb) out.push({ owner: cls.className(i.index), name: '<new>', desc: '' });
    }
  }
  return out;
}
