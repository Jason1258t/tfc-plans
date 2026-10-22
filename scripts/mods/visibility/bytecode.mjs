/**
 * Помощники правил видимости (visibility/*.mjs): чтение классов из jar, вычисление логических условий модов
 * по байткоду и имена, под которыми регистрируется предмет. Всё работает «по образцу»: незнакомый байткод — ответ
 * «не знаю» (null), а не исключение, чтобы обновление мода не роняло сборку сайта.
 */
import AdmZip from 'adm-zip';
import { argTypes, clinitValues, instructions, parseClass } from '../classfile.mjs';

// ---------------------------------------------------------------- jar и классы

/** Все modId из neoforge.mods.toml jar и вложенных jar (jar-in-jar) */
function modIdsOf(zip, depth = 0) {
  const ids = new Set();
  const toml = zip.getEntry('META-INF/neoforge.mods.toml');
  // modId — только из секций [[mods]] (в [[dependencies.…]] — чужие моды)
  for (const block of toml
    ? toml
        .getData()
        .toString('utf8')
        .split(/^\s*(?=\[\[)/m)
    : [])
    if (/^\[\[mods\]\]/.test(block))
      for (const m of block.matchAll(/^\s*modId\s*=\s*["']([^"']+)["']/gm)) ids.add(m[1]);
  if (depth < 2)
    for (const e of zip.getEntries())
      if (/^META-INF\/jarjar\/[^/]+\.jar$/.test(e.entryName))
        try {
          for (const id of modIdsOf(new AdmZip(e.getData()), depth + 1)) ids.add(id);
        } catch {
          /* битый вложенный jar — пропускаем */
        }
  return ids;
}

/** Набор jar сборки: какие моды установлены и доступ к классам */
export function jarSet(jarPaths) {
  const jars = [];
  for (const file of jarPaths) {
    try {
      const zip = new AdmZip(file);
      jars.push({ file, zip, mods: modIdsOf(zip), cache: new Map() });
    } catch {
      /* не zip */
    }
  }
  const loaded = new Set(['minecraft', 'neoforge']);
  for (const j of jars) for (const id of j.mods) loaded.add(id);
  return {
    loaded,
    /** jar, где объявлен мод */
    jarOf: (modId) => jars.find((j) => j.mods.has(modId)) ?? null,
    /** Имена классов jar (a/b/C) */
    classNames: (jar) =>
      jar.zip
        .getEntries()
        .map((e) => e.entryName)
        .filter((n) => n.endsWith('.class') && !n.startsWith('META-INF/'))
        .map((n) => n.slice(0, -6)),
    /** Разобранный класс или null */
    cls(jar, name) {
      if (jar.cache.has(name)) return jar.cache.get(name);
      let c = null;
      try {
        const e = jar.zip.getEntry(`${name}.class`);
        c = e ? parseClass(e.getData()) : null;
      } catch {
        c = null;
      }
      jar.cache.set(name, c);
      return c;
    },
  };
}

// ---------------------------------------------------------------- имена регистрации

const isStringLdc = (cls, i) => (i.op === 0x12 || i.op === 0x13) && typeof cls.constant(i.index) === 'string';

/** Рецепт склейки строк у invokedynamic (StringConcatFactory.makeConcatWithConstants) или null */
export function concatRecipe(cls, i) {
  if (i.op !== 0xba) return null;
  const bs = cls.bootstrap[cls.cp[i.index].a];
  if (!bs?.method || !/StringConcatFactory$/.test(bs.method.owner)) return null;
  return bs.find((a) => a?.string != null)?.string ?? null;
}

/** Рецепт «\u0001_poured_glass» → регулярка по пути предмета (переменная часть — [a-z0-9_/]*) */
export function recipePattern(recipe) {
  const esc = recipe
    .split('\u0001')
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[a-z0-9_/]*');
  return new RegExp(`^${esc}$`);
}

/**
 * Имя, переданное строкой в ближайший раньше вызов регистрации (name(String, …) — block, item, register…)
 * перед инструкцией at: { exact } или { pattern } (имя склеено из частей) или null.
 */
export function registrationNameBefore(cls, ins, at, isRegister) {
  for (let k = at - 1; k >= 0 && k > at - 400; k--) {
    const i = ins[k];
    if (i.op === 0xb3) return null; // putstatic — граница предыдущей регистрации
    if (i.op !== 0xb6 && i.op !== 0xb9 && i.op !== 0xb8) continue;
    const r = cls.ref(i.index);
    if (!isRegister(r) || argTypes(r.desc)[0] !== 'Ljava/lang/String;') continue;
    for (let q = k - 1; q >= 0 && q > k - 40; q--) {
      if (isStringLdc(cls, ins[q])) return { exact: cls.constant(ins[q].index) };
      const rec = concatRecipe(cls, ins[q]);
      if (rec != null) return { pattern: recipePattern(rec), recipe: rec };
    }
    return null;
  }
  return null;
}

/** Тело лямбды того же класса, созданной инструкцией indy, или null */
export function lambdaBody(cls, i) {
  if (i.op !== 0xba) return null;
  const h = cls.bootstrap[cls.cp[i.index].a]?.find((a) => a?.handle)?.handle;
  if (!h || h.owner !== cls.name) return null;
  return cls.methods.find((m) => m.name === h.name && m.desc === h.desc) ?? null;
}

/**
 * Имена, под которыми зарегистрировано статическое поле класса: строки и рецепты склейки между предыдущим putstatic
 * и putstatic этого поля в <clinit>, вкл. тела лямбд оттуда (на два уровня). { exact: [], patterns: [] } или null.
 */
export function fieldRegistrationNames(cls, field) {
  const clinit = cls?.methods.find((m) => m.name === '<clinit>');
  if (!clinit?.code) return null;
  const ins = instructions(clinit.code);
  const at = ins.findIndex(
    (i) => i.op === 0xb3 && cls.ref(i.index).name === field && cls.ref(i.index).owner === cls.name,
  );
  if (at < 0) return null;
  let from = at - 1;
  while (from >= 0 && ins[from].op !== 0xb3) from--;
  const out = { exact: [], patterns: [] };
  const scan = (list, depth) => {
    for (const i of list) {
      if (isStringLdc(cls, i)) out.exact.push(cls.constant(i.index));
      const rec = concatRecipe(cls, i);
      if (rec != null) out.patterns.push(recipePattern(rec));
      const body = depth < 2 ? lambdaBody(cls, i) : null;
      if (body?.code) scan(instructions(body.code), depth + 1);
    }
  };
  scan(ins.slice(from + 1, at), 0);
  return out;
}

// ---------------------------------------------------------------- логические условия

/** Перечисление «модов» (Mods.DYE_DEPOT …) → modId: первая строка аргументов константы, иначе имя в нижнем регистре */
function enumModId(set, jar, owner, name) {
  const c = set.cls(jar, owner);
  const k = c && clinitValues(c).constants.find((x) => x.name === name);
  return k?.args.find((a) => typeof a === 'string') ?? name.toLowerCase();
}

/**
 * Значение метода, возвращающего boolean, при заданных параметрах: понимает константы, параметры, переходы и
 * <Mods-константа>.isLoaded(). Возвращает true / false или null — «не знаю» (другие вызовы, циклы, незнакомое).
 */
export function evalBoolean(set, jar, cls, method, params) {
  if (!method?.code) return null;
  const ins = instructions(method.code);
  const byPc = new Map(ins.map((x, k) => [x.pc, k]));
  const stack = [];
  const loaded = (v) => (v?.field ? set.loaded.has(enumModId(set, jar, v.field.owner, v.field.name)) : null);
  for (let k = 0, steps = 0; k < ins.length && steps < 500; steps++) {
    const i = ins[k];
    const jump = () => byPc.get(i.pc + ((i.index << 16) >> 16));
    const op = i.op;
    if (op === 0x03 || op === 0x04) stack.push(op === 0x04);
    else if (op >= 0x1a && op <= 0x1d) stack.push(params[op - 0x1a]);
    else if (op === 0x15) stack.push(params[i.index]);
    else if (op === 0xb2) {
      const r = cls.ref(i.index);
      stack.push({ field: { owner: r.owner, name: r.name } });
    } else if (op === 0xb6) {
      const r = cls.ref(i.index);
      if (r.name !== 'isLoaded' || r.desc !== '()Z') return null;
      const v = loaded(stack.pop());
      if (v == null) return null;
      stack.push(v);
    } else if (op === 0x99 || op === 0x9a) {
      const v = stack.pop();
      if (typeof v !== 'boolean') return null;
      if ((op === 0x99) === !v) {
        k = jump();
        if (k == null) return null;
        continue;
      }
    } else if (op === 0xa7) {
      k = jump();
      if (k == null) return null;
      continue;
    } else if (op === 0xb8) {
      // Boolean.valueOf(boolean) — упаковка для Supplier<Boolean>
      const r = cls.ref(i.index);
      if (r.owner !== 'java/lang/Boolean' || r.name !== 'valueOf') return null;
    } else if (op === 0xac || op === 0xb0) {
      const v = stack.pop();
      return typeof v === 'boolean' ? v : null;
    } else if (op === 0x59) stack.push(stack.at(-1));
    else if (op === 0x57) stack.pop();
    else if (op !== 0xc0) return null; // checkcast — без изменений; прочее — не знаем
    k++;
  }
  return null;
}

/**
 * Условие-поставщик (Supplier<Boolean>), созданное инструкцией indy ins[at]: лямбда того же класса (захваченные
 * boolean перебираются — «скрыт», только если ложно при всех) или ссылка на метод Mods.X::isLoaded.
 * Возвращает true / false (при всех вариантах) или null.
 */
export function evalSupplier(set, jar, cls, ins, at) {
  const i = ins[at];
  if (i?.op !== 0xba) return null;
  const nat = cls.nat(cls.cp[i.index].b);
  const captured = argTypes(nat.desc);
  const h = cls.bootstrap[cls.cp[i.index].a]?.find((a) => a?.handle)?.handle;
  if (!h) return null;
  if (h.name === 'isLoaded' && h.desc === '()Z' && captured.length === 1) {
    // Mods.X::isLoaded — X взят getstatic чуть раньше (javac добавляет dup + requireNonNull)
    for (let k = at - 1; k >= 0 && k > at - 6; k--)
      if (ins[k].op === 0xb2) {
        const r = cls.ref(ins[k].index);
        return set.loaded.has(enumModId(set, jar, r.owner, r.name));
      }
    return null;
  }
  const body = lambdaBody(cls, i);
  if (!body || captured.some((t) => t !== 'Z')) return null;
  const results = new Set();
  for (let mask = 0; mask < 1 << captured.length; mask++) {
    const params = captured.map((_, b) => Boolean(mask & (1 << b)));
    results.add(evalBoolean(set, jar, cls, body, params));
  }
  if (results.has(null)) return null;
  return results.has(true);
}
