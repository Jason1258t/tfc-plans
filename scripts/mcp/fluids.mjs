/**
 * Как выглядит жидкость (текстура still и окраска) — это задаёт код клиента (IClientFluidTypeExtensions), а не
 * ресурсы. Нужно иконкам вёдер neoforge:fluid_container: в ведре — маска, залитая текстурой жидкости с окраской.
 *
 * Моды TFC и аддоны регистрируют жидкости циклом по перечислению: FluidRendererExtension(цвет, MOLTEN_STILL | WATER_STILL…)
 * (проверено по коду TFC 4.2.9, Firmalife, TFC Aged Alcohol, TFC-IE Crossover, TFC Alloy Ext). Поэтому:
 *   цвет — первое «цветовое» int (отрицательное или больше 0xFFFF) у константы перечисления / new Record(…) с тем же
 *   именем, что у жидкости (beer → BEER, aged_beer → BEER, red_wine → RED, metal/inferior_copper → «copper»);
 *   или static final int <ИМЯ>_COLOR; <цвет>_dye — DyeColor.textureDiffuseColor Minecraft;
 *   текстура — tfc:block/molten_still у металлов (класс *Metal*, путь metal/…), иначе minecraft:block/water_still;
 *   особняк — анонимный IClientFluidTypeExtensions в jar мода (getStillTexture + getTintColor(FluidStack)), если он
 *   в jar один (More Propulsion: керосин);
 *   иначе — своя текстура мода block/fluid/<имя>_still без окраски (IE регистрирует так: IEFluids.FluidEntry).
 * Не вышло — null: ведро рисуется как есть, без жидкости.
 */
import { jarList, jarToc, platform, readEntry, zipEntries, zipRead } from './jars.mjs';
import { clinitValues, instructions, parseClass } from '../mods/classfile.mjs';

const WATER_STILL = 'minecraft:block/water_still';
const MOLTEN_STILL = 'tfc:block/molten_still';
const EXT = 'net/neoforged/neoforge/client/extensions/common/IClientFluidTypeExtensions';

const colorLike = (v) => typeof v === 'number' && Number.isInteger(v) && (v < 0 || v > 0xffff);

/** Сведения из классов jar с assets/<ns>: [{ name (верхний регистр), color, metal }], особняки-расширения */
const nsCache = new Map();
function nsInfo(ns) {
  if (nsCache.has(ns)) return nsCache.get(ns);
  const records = [];
  const exts = [];
  for (const jar of jarList()) {
    const toc = jarToc(jar);
    if (!toc.some((e) => e.name.startsWith(`assets/${ns}/`))) continue;
    for (const e of toc) {
      if (!e.name.endsWith('.class')) continue;
      const data = readEntry(jar, e.name)?.data;
      if (!data) continue;
      let cls;
      try {
        cls = parseClass(data);
      } catch {
        continue;
      }
      const metal = /metal/i.test(cls.name);
      let v;
      try {
        v = clinitValues(cls);
      } catch {
        continue;
      }
      for (const c of v.constants) {
        const color = c.args.find(colorLike);
        if (color != null) records.push({ name: c.name, color, metal, from: cls.name });
      }
      // new Record("имя", …, цвет) в статических полях (списки металлов)
      const walk = (x, depth = 0) => {
        if (!x || typeof x !== 'object' || depth > 6) return;
        if (Array.isArray(x)) return x.forEach((y) => walk(y, depth + 1));
        if (x.new && Array.isArray(x.args)) {
          const name = x.args.find((a) => typeof a === 'string');
          const color = x.args.find(colorLike);
          if (name && color != null)
            records.push({ name: name.toUpperCase(), color, metal: metal || /metal/i.test(x.new), from: cls.name });
        }
        for (const k of ['args', 'array']) if (x[k]) walk(x[k], depth + 1);
      };
      for (const val of v.statics.values()) walk(val);
      for (const f of cls.fields) {
        const m = f.name.match(/^([A-Z0-9_]+)_COLOR$/);
        if (m && colorLike(f.constant)) records.push({ name: m[1], color: f.constant, metal, from: cls.name });
      }
      // Прямая регистрация: new FluidRendererExtension(цвет, …), TFCFluids.SALT_WATER.getType() — цвет перед полем
      for (const m of cls.methods) {
        if (!m.code) continue;
        let last = null;
        for (const i of instructions(m.code)) {
          if (i.op === 0x12 || i.op === 0x13) {
            const c = cls.constant(i.index);
            if (colorLike(c)) last = c;
          } else if (i.op === 0xb2 && last != null) {
            const r = cls.ref(i.index);
            if (/^[A-Z][A-Z0-9_]+$/.test(r.name) && /Fluid/.test(r.owner)) {
              records.push({ name: r.name, color: last, metal, from: cls.name });
              last = null;
            }
          }
        }
      }
      // Анонимный IClientFluidTypeExtensions: текстура still и окраска для предмета — константами
      if (cls.interfaces?.includes(EXT)) {
        const still = stillOf(cls, jar);
        const tint = cls.methods.find(
          (m) => m.name === 'getTintColor' && m.desc === '(Lnet/neoforged/neoforge/fluids/FluidStack;)I',
        );
        const ins = tint?.code ? instructions(tint.code) : [];
        const ldc = ins.find((i) => i.op === 0x12 || i.op === 0x13);
        const color = ldc ? cls.constant(ldc.index) : null;
        if (still && colorLike(color)) exts.push({ still, color, from: cls.name });
      }
    }
  }
  const info = { records, exts };
  nsCache.set(ns, info);
  return info;
}

/** getStillTexture(): return <статическое поле> → значение поля из <clinit> класса-владельца (fromNamespaceAndPath) */
function stillOf(cls, jar) {
  const m = cls.methods.find((x) => x.name === 'getStillTexture' && x.desc.startsWith('()'));
  const get = m?.code && instructions(m.code).find((i) => i.op === 0xb2);
  if (!get) return null;
  const r = cls.ref(get.index);
  const data = readEntry(jar, `${r.owner}.class`)?.data;
  if (!data) return null;
  const v = clinitValues(parseClass(data)).statics.get(r.name);
  const args = v?.call ? v.args : null;
  return args?.length === 2 && args.every((a) => typeof a === 'string') ? `${args[0]}:${args[1]}` : null;
}

let dyes = null;
/** DyeColor Minecraft: имя → textureDiffuseColor (первое «цветовое» int) */
export function dyeColors() {
  if (dyes) return dyes;
  dyes = new Map();
  const jar = platform()?.classes;
  const e = jar && zipEntries(jar).find((x) => x.name === 'net/minecraft/world/item/DyeColor.class');
  if (e)
    for (const c of clinitValues(parseClass(zipRead(jar, e))).constants) {
      const color = c.args.find(colorLike);
      if (color != null) dyes.set(c.name, color);
    }
  return dyes;
}

const cache = new Map();
/** Жидкость «ns:path» → { still, tint (0xAARRGGBB), from } или null */
export function fluidLook(id) {
  if (cache.has(id)) return cache.get(id);
  const [ns, p] = id.includes(':') ? id.split(':', 2) : ['minecraft', id];
  let out = null;
  try {
    out = lookup(ns, p);
  } catch {
    out = null;
  }
  cache.set(id, out);
  return out;
}

function lookup(ns, p) {
  const base = p.split('/').at(-1);
  const isMetal = p.includes('metal/');
  const dye = base.match(/^([a-z_]+)_dye$/);
  if (dye && dyeColors().has(dye[1].toUpperCase()))
    return { still: WATER_STILL, tint: (0xff000000 | dyeColors().get(dye[1].toUpperCase())) >>> 0, from: 'DyeColor' };
  const names = new Set([base]);
  for (const pre of ['aged_', 'inferior_', 'molten_']) if (base.startsWith(pre)) names.add(base.slice(pre.length));
  for (const suf of ['_wine', '_fluid']) if (base.endsWith(suf)) names.add(base.slice(0, -suf.length));
  const { records, exts } = nsInfo(ns);
  for (const n of names) {
    const hits = records.filter((r) => r.name === n.toUpperCase());
    // Металл ищем среди металлов, остальное — среди не-металлов (у TFC и BEER, и COPPER есть в разных списках)
    const hit = hits.find((r) => r.metal === isMetal) ?? hits[0];
    if (hit)
      return {
        still: isMetal || hit.metal ? MOLTEN_STILL : WATER_STILL,
        // Без альфы в константе — непрозрачный (TFC сам ставит 0xFF000000 | цвет металлам)
        tint: hit.color >>> 0 > 0xffffff ? hit.color >>> 0 : (0xff000000 | hit.color) >>> 0,
        from: hit.from,
      };
  }
  if (exts.length === 1) return { still: exts[0].still, tint: exts[0].color >>> 0, from: exts[0].from };
  // Своя текстура жидкости без окраски (IE: FluidEntry с block/fluid/<имя>_still; Sophisticated Core: block/xp_still)
  for (const t of [`block/fluid/${base}_still`, `block/${base}_still`, `block/${base}`]) {
    const file = `assets/${ns}/textures/${t}.png`;
    if (jarList().some((j) => jarToc(j).some((e) => e.name === file)))
      return { still: `${ns}:${t}`, tint: 0xffffffff, from: `текстура ${ns}:${t}` };
  }
  return null;
}
