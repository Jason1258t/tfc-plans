/**
 * Значения конфига мода по умолчанию — из кода: «builder.push("раздел") … comment(…).define("ключ", значение, мин, макс)».
 * Так сайт знает настройку, даже если конфиг сервера не импортирован, а импортированный (npm run serverconfig)
 * только переопределяет её. Понимает ModConfigSpec.Builder NeoForge и обёртки с теми же именами методов
 * (push / pop / swap / comment / define*), как ConfigBuilder у TFC.
 *
 *   configDefaults(cls) → [{ key: 'раздел.подраздел.ключ', field, default, min?, max?, comment }]
 */
import { argTypes, instructions } from './classfile.mjs';

const isBuilder = (owner) => /ConfigBuilder$|ModConfigSpec\$Builder$/.test(owner);

export function configDefaults(cls) {
  const out = [];
  for (const m of cls.methods) {
    if (!m.code) continue;
    const sections = [];
    let consts = [];
    let comment = '';
    let last = null;
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
      } else if (op === 0xb6 || op === 0xb9) {
        const r = cls.ref(ins.index);
        if (!isBuilder(r.owner)) continue;
        const strings = consts.filter((c) => typeof c === 'string');
        if (r.name === 'push') sections.push(strings.at(-1) ?? '?');
        else if (r.name === 'swap') sections.splice(-1, 1, strings.at(-1) ?? '?');
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
  }
  return out;
}
