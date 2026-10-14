/**
 * Значения конфига мода по умолчанию — из кода: «builder.push("раздел") … comment(…).define("ключ", значение, мин, макс)».
 * Так сайт знает настройку, даже если конфиг сервера не импортирован, а импортированный (npm run serverconfig)
 * только переопределяет её. Понимает ModConfigSpec.Builder NeoForge и обёртки с теми же именами методов
 * (push / pop / swap / comment / define*), как ConfigBuilder у TFC.
 *
 *   configDefaults(cls) → [{ key: 'раздел.подраздел.ключ', field, default, min?, max?, comment }]
 */
import { argTypes, instructions } from './classfile.mjs';

// ConfigInit$Builder — обёртка L2Core (Cuisine Delight): text(описание) вместо comment, те же define*
const isBuilder = (owner) => /ConfigBuilder$|ModConfigSpec\$Builder$|ConfigInit\$Builder$/.test(owner);

export function configDefaults(cls) {
  const out = [];
  // Помощники класса вида «addX(builder, "имя", …)» разбираются при вызове, с известным именем — сами по себе
  // (с неизвестным разделом «?») они не нужны
  const called = new Set();
  for (const m of cls.methods)
    for (const ins of m.code ? instructions(m.code) : [])
      if (ins.op >= 0xb6 && ins.op <= 0xb8) {
        const r = cls.ref(ins.index);
        if (r.owner === cls.name && r.name !== '<init>') called.add(r.name + r.desc);
      }
  const helpers = new Set(
    cls.methods.filter((m) => called.has(m.name + m.desc) && isHelper(cls, m.desc)).map((m) => m.name + m.desc),
  );
  for (const m of cls.methods) {
    if (!m.code || helpers.has(m.name + m.desc)) continue;
    walk(cls, m, [], out, 0, {});
  }
  return out;
}

const BUILDER_ARG = /ModConfigSpec\$Builder;$|ConfigBuilder;$|ConfigInit\$Builder;$/;
const isHelper = (cls, desc) => {
  const t = argTypes(desc);
  return t.length >= 2 && BUILDER_ARG.test(t[0]) && t[1] === 'Ljava/lang/String;' && !/Value;$/.test(desc);
};

/**
 * Проход по методу: разделы — стек push/pop, ключи — define*; возвращает стек разделов на выходе.
 * ctx — для помощника: name — его строковый аргумент (раздел, который он открывает), flag — булев аргумент: при 0
 * пропускается pop сразу за условным переходом (IE: «if (pop) builder.pop()»).
 */
function walk(cls, m, start, out, depth, ctx) {
  {
    const sections = [...start];
    let consts = [];
    let comment = '';
    let last = null;
    let skipPop = false;
    for (const ins of instructions(m.code)) {
      const { op } = ins;
      if (op >= 0x02 && op <= 0x08) consts.push(op - 0x03);
      else if (op === 0x0e || op === 0x0f) consts.push(op - 0x0e);
      else if (op >= 0x0b && op <= 0x0d) consts.push(op - 0x0b);
      else if (op === 0x09 || op === 0x0a) consts.push(op - 0x09);
      else if (op === 0x10 || op === 0x11) consts.push(ins.index);
      else if (op === 0x12 || op === 0x13 || op === 0x14) consts.push(cls.constant(ins.index));
      else if (op === 0xb2) {
        const r = cls.ref(ins.index);
        consts.push({ enum: r.name });
      } else if (op === 0xb5) {
        if (last) last.field ??= cls.ref(ins.index).name;
        last = null;
      } else if ((op === 0xb6 || op === 0xb7 || op === 0xb8) && depth < 3 && cls.ref(ins.index).owner === cls.name) {
        // Помощник этого же класса: раздел, который он открывает своим строковым аргументом, — имя из вызова
        // (IE: addMachineEnergyTimeModifiers(builder, "metal press") → [machines.metal_press])
        const r = cls.ref(ins.index);
        const callee =
          r.name !== '<init>' &&
          isHelper(cls, r.desc) &&
          cls.methods.find((x) => x.name === r.name && x.desc === r.desc && x.code);
        const name = consts.filter((c) => typeof c === 'string').at(-1) ?? ctx.name;
        if (callee && name) {
          const types = argTypes(r.desc);
          const flag = types.at(-1) === 'Z' ? consts.filter((c) => typeof c === 'number').at(-1) : undefined;
          const after = walk(cls, callee, sections, out, depth + 1, { name, flag });
          sections.splice(0, sections.length, ...after);
          consts = [];
        }
      } else if ((op === 0x99 || op === 0x9a) && ctx.flag === 0) {
        skipPop = true;
      } else if (op === 0xb8) {
        // Статический помощник «addPositive(builder, "ключ", значение, комментарий…)» (IE): первый аргумент —
        // строитель, второй — имя, третий — число; возвращает *Value
        const r = cls.ref(ins.index);
        const types = argTypes(r.desc);
        if (
          /ModConfigSpec\$Builder;$/.test(types[0] ?? '') &&
          types[1] === 'Ljava/lang/String;' &&
          /Value;$/.test(r.desc)
        ) {
          const at = consts.findIndex((c) => typeof c === 'string');
          if (at >= 0 && typeof consts[at + 1] === 'number') {
            last = {
              key: [...sections, consts[at]].join('.'),
              field: null,
              default: consts[at + 1],
              comment: consts
                .slice(at + 2)
                .filter((c) => typeof c === 'string')
                .join(' '),
            };
            out.push(last);
          }
          consts = [];
        }
      } else if (op === 0xb6 || op === 0xb9) {
        const r = cls.ref(ins.index);
        if (!isBuilder(r.owner)) continue;
        const strings = consts.filter((c) => typeof c === 'string');
        if (r.name === 'push') sections.push(strings.at(-1) ?? ctx.name?.replace(/ /g, '_') ?? '?');
        else if (r.name === 'swap') sections.splice(-1, 1, strings.at(-1) ?? '?');
        else if (r.name === 'pop' && skipPop) skipPop = false;
        else if (r.name === 'pop') {
          const n = argTypes(r.desc).length ? consts.findLast((c) => typeof c === 'number') : 1;
          sections.splice(-(n ?? 1));
        } else if (r.name === 'comment') comment = strings.join(' ');
        else if (r.name.startsWith('define')) {
          const types = argTypes(r.desc);
          const at = consts.findIndex((c) => typeof c === 'string');
          const rest = at >= 0 ? consts.slice(at + 1) : [];
          let def = rest[0];
          if (types[1] === 'Z') def = def === 1;
          else if (def && typeof def === 'object') def = def.enum ?? null;
          const numeric = types[1] === 'D' || types[1] === 'I';
          last = {
            key: [...sections, consts[at]].join('.'),
            field: null,
            default: def ?? null,
            ...(numeric && typeof rest[1] === 'number' && typeof rest[2] === 'number'
              ? { min: rest[1], max: rest[2] }
              : {}),
            comment,
          };
          if (at >= 0) out.push(last);
          comment = '';
        }
        consts = [];
      }
    }
    return sections;
  }
}
