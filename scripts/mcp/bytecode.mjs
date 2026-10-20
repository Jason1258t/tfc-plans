/**
 * Разбор .class для инструментов кода MCP: заголовок, поля и методы с аннотациями (видимыми и CLASS — как у
 * @Mixin), номера строк, ссылки из байткода (вызовы, поля, классы, строки, лямбды). Без JDK и зависимостей.
 * Длины инструкций — из scripts/mods/classfile.mjs (он же разбирает константы для сборки данных сайта).
 *
 *   const c = parseClassFull(buf)
 *   c.name, c.superName, c.interfaces, c.access, c.annotations, c.fields[], c.methods[]
 *   codeRefs(c, m) → [{ pc, line, op, kind: 'method'|'field'|'class'|'string'|'const'|'lambda', owner, name, desc, value }]
 */
import { instructions } from '../mods/classfile.mjs';

const UTF8 = 1;
const INT = 3;
const FLOAT = 4;
const LONG = 5;
const DOUBLE = 6;
const CLASS = 7;
const STRING = 8;
const NAT = 12;
const MHANDLE = 15;
const MTYPE = 16;
const DYNAMIC = 17;
const INDY = 18;

// ---------------------------------------------------------------- флаги доступа

export const ACC = {
  PUBLIC: 0x1,
  PRIVATE: 0x2,
  PROTECTED: 0x4,
  STATIC: 0x8,
  FINAL: 0x10,
  SYNCHRONIZED: 0x20,
  BRIDGE: 0x40,
  VARARGS: 0x80,
  NATIVE: 0x100,
  INTERFACE: 0x200,
  ABSTRACT: 0x400,
  SYNTHETIC: 0x1000,
  ANNOTATION: 0x2000,
  ENUM: 0x4000,
};

/** «public static final» для поля или метода */
export function modifiers(access, method = false) {
  const out = [];
  if (access & ACC.PUBLIC) out.push('public');
  if (access & ACC.PRIVATE) out.push('private');
  if (access & ACC.PROTECTED) out.push('protected');
  if (access & ACC.STATIC) out.push('static');
  if (access & ACC.FINAL) out.push('final');
  if (access & ACC.ABSTRACT && method) out.push('abstract');
  if (access & ACC.SYNCHRONIZED && method) out.push('synchronized');
  if (access & ACC.NATIVE) out.push('native');
  if (access & ACC.SYNTHETIC) out.push('synthetic');
  if (access & ACC.BRIDGE && method) out.push('bridge');
  return out.join(' ');
}

/** Вид класса: interface, annotation, enum, record, abstract class, class */
export function classKind(c) {
  if (c.access & ACC.ANNOTATION) return '@interface';
  if (c.access & ACC.INTERFACE) return 'interface';
  if (c.access & ACC.ENUM) return 'enum';
  if (c.superName === 'java/lang/Record') return 'record';
  if (c.access & ACC.ABSTRACT) return 'abstract class';
  return 'class';
}

// ---------------------------------------------------------------- дескрипторы

/** Тип из дескриптора начиная с i: [тип по-явовски, следующий индекс]; full — с пакетом */
function readType(d, i, full) {
  let dims = 0;
  while (d[i] === '[') {
    dims++;
    i++;
  }
  let t;
  const prim = {
    B: 'byte',
    C: 'char',
    D: 'double',
    F: 'float',
    I: 'int',
    J: 'long',
    S: 'short',
    Z: 'boolean',
    V: 'void',
  };
  if (d[i] === 'L') {
    const end = d.indexOf(';', i);
    t = javaName(d.slice(i + 1, end), full);
    i = end + 1;
  } else {
    t = prim[d[i]] ?? d[i];
    i++;
  }
  return [t + '[]'.repeat(dims), i];
}

/** «net/minecraft/world/level/Level» → «Level» (full — «net.minecraft.world.level.Level») */
export function javaName(internal, full = false) {
  const dotted = internal.replaceAll('/', '.');
  return full ? dotted : dotted.slice(dotted.lastIndexOf('.') + 1);
}

/** Тип поля: «Lnet/…/Level;» → «Level» */
export const fieldType = (desc, full = false) => readType(desc, 0, full)[0];

/** Метод: { params: [типы], ret } */
export function methodTypes(desc, full = false) {
  const params = [];
  let i = 1;
  while (desc[i] !== ')') {
    const [t, next] = readType(desc, i, full);
    params.push(t);
    i = next;
  }
  return { params, ret: readType(desc, i + 1, full)[0] };
}

/** «name(Level, int)» — для списков ссылок */
export function methodShort(name, desc) {
  return `${name}(${methodTypes(desc).params.join(', ')})`;
}

/** «public static void tick(Level, BlockPos)» — для class_info */
export function methodSig(m, owner) {
  const { params, ret } = methodTypes(m.desc);
  const mods = modifiers(m.access, true);
  const head = m.name === '<init>' ? javaName(owner) : m.name === '<clinit>' ? 'static {}' : `${ret} ${m.name}`;
  if (m.name === '<clinit>') return head;
  return `${mods ? `${mods} ` : ''}${head}(${params.join(', ')})`;
}

/** Классы, упомянутые в дескрипторе (internal names) */
export function descClasses(desc) {
  return [...desc.matchAll(/L([^;<]+);/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------- разбор

export function parseClassFull(buf) {
  let p = 0;
  const u1 = () => buf[p++];
  const u2 = () => ((p += 2), buf.readUInt16BE(p - 2));
  const u4 = () => ((p += 4), buf.readUInt32BE(p - 4));
  if (buf.length < 10 || u4() !== 0xcafebabe) throw new Error('не class-файл');
  p += 2;
  const major = u2();
  const n = u2();
  const cp = new Array(n);
  for (let i = 1; i < n; i++) {
    const tag = u1();
    switch (tag) {
      case UTF8: {
        const len = u2();
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
      case 19:
      case 20:
        cp[i] = { tag, a: u2() };
        break;
      case 9:
      case 10:
      case 11:
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
  const className = (i) => utf(cp[i]?.a);
  const ref = (i) => {
    const c = cp[i];
    const t = cp[c.b];
    return { owner: className(c.a), name: utf(t.a), desc: utf(t.b) };
  };

  // Аннотации: { type, values: { имя: значение } }; значение — число/строка/{ enum }/{ class }/{ ann }/[…]
  const elementValue = () => {
    const tag = String.fromCharCode(u1());
    switch (tag) {
      case 'e': {
        const type = utf(u2());
        return { enum: `${javaName(type.slice(1, -1))}.${utf(u2())}` };
      }
      case 'c':
        return { class: utf(u2()) };
      case '@':
        return { ann: annotation() };
      case '[': {
        const out = [];
        for (let k = u2(); k > 0; k--) out.push(elementValue());
        return out;
      }
      case 's':
        return utf(u2());
      case 'Z':
        return cp[u2()].v !== 0;
      default:
        return cp[u2()].v;
    }
  };
  const annotation = () => {
    const type = utf(u2());
    const values = {};
    for (let k = u2(); k > 0; k--) {
      const name = utf(u2());
      values[name] = elementValue();
    }
    return { type, values };
  };
  const annotationsAt = (start) => {
    p = start;
    const out = [];
    for (let k = u2(); k > 0; k--) out.push(annotation());
    return out;
  };

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
  /** Аннотации и подпись из атрибутов; p после разбора возвращается на конец атрибутов */
  const common = (attrs, target) => {
    const end = p;
    for (const a of attrs) {
      if (a.name === 'RuntimeVisibleAnnotations' || a.name === 'RuntimeInvisibleAnnotations')
        target.annotations.push(...annotationsAt(a.start));
      else if (a.name === 'Signature') target.signature = utf(buf.readUInt16BE(a.start));
    }
    p = end;
  };

  const access = u2();
  const name = className(u2());
  const superIdx = u2();
  const superName = superIdx ? className(superIdx) : null;
  const interfaces = [];
  for (let k = u2(); k > 0; k--) interfaces.push(className(u2()));

  const fields = [];
  for (let k = u2(); k > 0; k--) {
    const f = { access: u2(), name: utf(u2()), desc: utf(u2()), annotations: [], constant: undefined };
    const attrs = attributes();
    common(attrs, f);
    for (const a of attrs)
      if (a.name === 'ConstantValue') {
        const c = cp[buf.readUInt16BE(a.start)];
        f.constant = c.tag === STRING ? utf(c.a) : c.v;
      }
    fields.push(f);
  }

  const methods = [];
  for (let k = u2(); k > 0; k--) {
    const m = { access: u2(), name: utf(u2()), desc: utf(u2()), annotations: [], code: null, lines: null };
    const attrs = attributes();
    common(attrs, m);
    const end = p;
    for (const a of attrs) {
      if (a.name !== 'Code') continue;
      const len = buf.readUInt32BE(a.start + 4);
      m.code = buf.subarray(a.start + 8, a.start + 8 + len);
      // Атрибуты Code: LineNumberTable — номер строки исходника по pc
      p = a.start + 8 + len;
      const exceptions = u2(); // таблица исключений; не «p += 8 * u2()»: p прочитается до сдвига в u2
      p += 8 * exceptions;
      for (const ca of attributes())
        if (ca.name === 'LineNumberTable') {
          const lines = [];
          for (let q = ca.start + 2, cnt = buf.readUInt16BE(ca.start); cnt > 0; cnt--, q += 4)
            lines.push([buf.readUInt16BE(q), buf.readUInt16BE(q + 2)]);
          m.lines = (m.lines ?? []).concat(lines).sort((x, y) => x[0] - y[0]);
        }
    }
    p = end;
    methods.push(m);
  }

  const cls = {
    major,
    access,
    name,
    superName,
    interfaces,
    fields,
    methods,
    annotations: [],
    bootstrap: [],
    source: null,
  };
  const attrs = attributes();
  common(attrs, cls);
  for (const a of attrs) {
    if (a.name === 'SourceFile') cls.source = utf(buf.readUInt16BE(a.start));
    if (a.name !== 'BootstrapMethods') continue;
    let q = a.start + 2;
    for (let i = buf.readUInt16BE(a.start); i > 0; i--) {
      q += 2;
      const args = [];
      for (let j = buf.readUInt16BE(q); j > 0; j--) {
        q += 2;
        const c = cp[buf.readUInt16BE(q)];
        if (c?.tag === MHANDLE) args.push({ handle: ref(c.a) });
        else if (c?.tag === STRING) args.push(utf(c.a));
        else args.push(null);
      }
      q += 2;
      cls.bootstrap.push(args);
    }
  }
  Object.defineProperty(cls, 'pool', { value: { cp, utf, className, ref }, enumerable: false });
  return cls;
}

/** Номер строки исходника для pc (или null без LineNumberTable) */
export function lineAt(m, pc) {
  if (!m.lines) return null;
  let line = null;
  for (const [start, l] of m.lines) {
    if (start > pc) break;
    line = l;
  }
  return line;
}

const OPS = {
  0x12: 'ldc',
  0x13: 'ldc_w',
  0x14: 'ldc2_w',
  0xb2: 'getstatic',
  0xb3: 'putstatic',
  0xb4: 'getfield',
  0xb5: 'putfield',
  0xb6: 'invokevirtual',
  0xb7: 'invokespecial',
  0xb8: 'invokestatic',
  0xb9: 'invokeinterface',
  0xba: 'invokedynamic',
  0xbb: 'new',
  0xbd: 'anewarray',
  0xc0: 'checkcast',
  0xc1: 'instanceof',
  0xc5: 'multianewarray',
};

/** Ссылки из кода метода: что вызывает, читает, создаёт, какие строки и лямбды */
export function codeRefs(cls, m) {
  if (!m.code) return [];
  const { cp, utf, className, ref } = cls.pool;
  const out = [];
  for (const ins of instructions(m.code)) {
    const op = OPS[ins.op];
    if (!op) continue;
    const line = lineAt(m, ins.pc);
    const base = { pc: ins.pc, line, op };
    const c = cp[ins.index];
    if (!c) continue;
    if (ins.op >= 0x12 && ins.op <= 0x14) {
      if (c.tag === STRING) out.push({ ...base, kind: 'string', value: utf(c.a) });
      else if (c.tag === CLASS) out.push({ ...base, kind: 'class', owner: utf(c.a) });
      else if (c.tag !== MHANDLE && c.tag !== MTYPE && c.tag !== DYNAMIC)
        out.push({ ...base, kind: 'const', value: c.v });
    } else if (ins.op >= 0xb2 && ins.op <= 0xb5) out.push({ ...base, kind: 'field', ...ref(ins.index) });
    else if (ins.op >= 0xb6 && ins.op <= 0xb9) out.push({ ...base, kind: 'method', ...ref(ins.index) });
    else if (ins.op === 0xba) {
      // invokedynamic: тело лямбды или ссылка на метод — в аргументах bootstrap
      const bsm = cls.bootstrap[c.a] ?? [];
      const nat = cp[c.b];
      for (const arg of bsm)
        if (arg?.handle) out.push({ ...base, kind: 'lambda', ...arg.handle, via: utf(nat.a) });
        else if (typeof arg === 'string' && arg.length) out.push({ ...base, kind: 'string', value: arg, op: 'concat' });
    } else {
      const owner = className(ins.index);
      if (owner) out.push({ ...base, kind: 'class', owner: owner.replace(/^\[+L?|;$/g, '') });
    }
  }
  return out;
}

// ---------------------------------------------------------------- аннотации текстом

const short = (t) => javaName(t.slice(1, -1));

/** Значение аннотации коротко: Foo.class, "str", ENUM, [a, b] */
export function valueText(v) {
  if (Array.isArray(v)) return v.length === 1 ? valueText(v[0]) : `{${v.map(valueText).join(', ')}}`;
  if (typeof v === 'string') return JSON.stringify(v);
  if (v && typeof v === 'object') {
    if (v.enum) return v.enum.slice(v.enum.indexOf('.') + 1);
    if (v.class) return `${fieldType(v.class)}.class`;
    if (v.ann) return annotationText(v.ann);
  }
  return String(v);
}

/** «@Inject(method="tick", at=@At("HEAD"), cancellable=true)» */
export function annotationText(a) {
  const vals = Object.entries(a.values);
  if (!vals.length) return `@${short(a.type)}`;
  if (vals.length === 1 && vals[0][0] === 'value') return `@${short(a.type)}(${valueText(vals[0][1])})`;
  return `@${short(a.type)}(${vals.map(([k, v]) => `${k}=${valueText(v)}`).join(', ')})`;
}
