// Сборные блюда → public/meals.json: блюда, у которых питательность зависит от того, что положили.
//
// Три источника, все из jar текущей сборки:
//  1. рецепты с модификатором результата «tfc:meal» (сэндвичи, пицца, буррито, блюда аддонов) — основа блюда
//     и доли от ингредиентов записаны прямо в рецепте;
//  2. суп — рецепты «…pot_soup», а формулу задаёт код рецепта;
//  3. салат — рецепта нет вовсе: это окно сборки, всё в коде контейнера.
// Код читается через classfile.mjs: класс, который создаёт еду с вычисленной питательностью
// (FoodCapability.setFoodForDynamicItemOnCreate + new FoodData), и запись доли (MealPortion) со значениями по умолчанию.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { clinitValues, enumConstants, instructions, parseClass } from './classfile.mjs';
import { configDefaults } from './config-defaults.mjs';

const DYNAMIC_FOOD = 'setFoodForDynamicItemOnCreate';
const round = (x) => Math.round(x * 1000) / 1000;

/** Какие классы jar сохранять в кеш для разбора (вызывается из mods.mjs при распаковке) */
export function isMealClass(entryName, data) {
  // Порядок питательных групп — перечисление Nutrient; формулы аддонов лежат в помощниках (FoodData) и зависят
  // от настроек мода (ModConfigSpec, тип конфига — ModConfig$Type)
  // …а настоящий id тега — в инициализации поля класса тегов (tag("x") — тег мода, commonTag("x") — c:x)
  if (/\/food\/Nutrient\.class$|Tags\$Items\.class$/.test(entryName)) return true;
  return (
    data.includes(DYNAMIC_FOOD) ||
    data.includes('nutrient_modifier') ||
    data.includes('component/food/FoodData') ||
    data.includes('ModConfigSpec$Builder') ||
    data.includes('ModConfig$Type')
  );
}

// ---------------------------------------------------------------- код

/** Инструкции с раскрытыми операндами: число, строка, ссылка, номер локальной переменной (load/store) */
function decoded(cls, method) {
  if (!method?.code) return [];
  return instructions(method.code).map((ins) => {
    const { op } = ins;
    if (op >= 0x02 && op <= 0x08) return { op, num: op - 0x03, int: true };
    if (op >= 0x0b && op <= 0x0d) return { op, num: op - 0x0b };
    if (op === 0x10 || op === 0x11) return { op, num: ins.index, int: true };
    if (op === 0x12 || op === 0x13) {
      const v = cls.constant(ins.index);
      return typeof v === 'number' ? { op, num: v } : { op, str: typeof v === 'string' ? v : undefined };
    }
    if (op === 0x17) return { op, fload: ins.index };
    if (op >= 0x22 && op <= 0x25) return { op, fload: op - 0x22 };
    if (op === 0x38) return { op, fstore: ins.index };
    if (op >= 0x43 && op <= 0x46) return { op, fstore: op - 0x43 };
    if (op >= 0xb2 && op <= 0xb9) return { op, ref: cls.ref(ins.index) };
    return { op };
  });
}

/**
 * Блюдо с вычисляемой питательностью: метод складывает воду, насыщение и питательные группы ингредиентов,
 * умножает на коэффициент и создаёт FoodData(сытость, вода, насыщение, 0, группы, порча).
 */
function computedDish(cls, classes) {
  for (const m of cls.methods) {
    const list = decoded(cls, m);
    const at = list.findIndex((x) => x.ref?.name === '<init>' && /FoodData$/.test(x.ref.owner));
    if (at < 6 || !list.some((x) => x.ref?.name === DYNAMIC_FOOD)) continue;
    // Блюда по главной питательной группе лежат в статической карте предметов (SOUPS, SALADS)
    const map = list.find((x) => x.op === 0xb2 && /Map;$/.test(x.ref.desc) && /Items$/.test(x.ref.owner));
    if (!map) continue;
    // Аргументы конструктора — шесть инструкций перед вызовом
    const [hunger, water, saturation, , , decay] = list.slice(at - 6, at);
    // Аргументы — выражения, а не готовые переменные: блюдо аддона со своей формулой
    if (water.fload === undefined || decay.num === undefined) {
      const dish = addonDish(cls, list, at, map, classes);
      if (dish) return dish;
      return { kind: map.ref.name.toLowerCase(), ns: cls.name.split('/')[2] };
    }
    const initial = (local) => {
      const i = list.findIndex((x) => x.fstore === local);
      return i > 0 && list[i - 1].num !== undefined ? list[i - 1].num : undefined;
    };
    // Коэффициент: «константа × сумма» (салат) или «константа / число порций» (суп)
    let scale;
    let perServing = false;
    list.forEach((x, i) => {
      if (x.num === undefined || x.int || scale !== undefined) return;
      const next = list.slice(i + 1, i + 4).map((y) => y.op);
      if (next[0] === 0x6a) scale = x.num;
      else if (next.includes(0x6e) && next.includes(0x86)) [scale, perServing] = [x.num, true];
    });
    const out = {
      kind: map.ref.name.toLowerCase(),
      ns: cls.name.split('/')[2],
      itemNs: map.ref.owner.split('/')[2],
      hunger: hunger.num,
      decay: round(decay.num),
      baseWater: water.fload !== undefined ? initial(water.fload) : undefined,
      baseSaturation: saturation.fload !== undefined ? initial(saturation.fload) : undefined,
      scale: scale !== undefined ? round(scale) : undefined,
    };
    // Число порций из числа ингредиентов: «n / делитель + добавка»
    const servings = cls.methods.find((x) => /servings/i.test(x.name) && x.desc === '(I)I');
    if (perServing && servings) {
      const s = decoded(cls, servings);
      const div = s.findIndex((x) => x.op === 0x6e);
      const add = s.findIndex((x) => x.op === 0x60);
      if (div > 0 && add > 0) out.servings = { div: s[div - 1].num, add: s[add - 1].num };
    }
    // Окно сборки: слоты ингредиентов и теги (что можно класть, какая посуда)
    const start = cls.fields.find((f) => f.name === 'SLOT_INPUT_START')?.constant;
    const end = cls.fields.find((f) => f.name === 'SLOT_INPUT_END')?.constant;
    if (typeof start === 'number' && typeof end === 'number') out.slots = end - start + 1;
    const tags = new Set();
    for (const x of cls.methods.flatMap((mm) => decoded(cls, mm)))
      if (x.op === 0xb2 && /Tags\$Items$/.test(x.ref.owner)) tags.add(tagOf(x.ref, classes));
    if (tags.size) out.tagFields = [...tags];
    return out;
  }
  return null;
}

/**
 * Поле тега в коде (TFCTags$Items.BOWLS) → id тега. Берём из инициализации поля: «create(ns, path)» — готовый id;
 * «помощник("path")» — пространство имён из строки внутри помощника (commonTag → "c"), иначе это тег самого мода.
 * Если класс тегов не прочитан — по имени поля.
 */
function tagOf(ref, classes) {
  const ns = ref.owner.split('/')[2];
  const owner = classes?.get(ref.owner);
  let v = null;
  try {
    v = owner ? clinitValues(owner).statics.get(ref.name) : null;
  } catch {
    v = null;
  }
  const strings = [];
  const walk = (x) => {
    if (typeof x === 'string') strings.push(x);
    else if (x?.args) x.args.forEach(walk);
  };
  walk(v);
  if (strings.length >= 2) return `${strings[0]}:${strings[1]}`;
  if (strings.length === 1 && v?.call?.owner === ref.owner) {
    const helper = owner.methods.find((m) => m.name === v.call.name && m.desc === v.call.desc);
    const literal = decoded(owner, helper).find((x) => x.str)?.str;
    return `${literal ?? ns}:${strings[0]}`;
  }
  return `${ns}:${ref.name.toLowerCase()}`;
}

/**
 * Блюдо аддона: когда ни один рецепт посуды не подошёл, а все продукты входят в тег, еда считается формулой.
 * FoodData(сытость, вода, насыщение, 0, группы, порча), где
 *   группы     = помощник(продукты, множитель, предел) — сумма по продуктам, обнуление самой малой группы и т. д.;
 *   вода       = сумма выбранных групп [× число] [+ число];
 *   насыщение  = число × количество продуктов;
 *   порча      = помощник(продукты) — наибольшая порча среди продуктов × число.
 * Всё читается из инструкций между «new FoodData» и вызовом конструктора.
 */
function addonDish(cls, list, at, map, classes) {
  let start = at;
  while (start > 0 && list[start].op !== 0xbb) start--;
  const invoke = (x) => x.ref && x.op >= 0xb6;
  const args = list
    .slice(start + 1, at)
    .filter((x) => x.num !== undefined || invoke(x) || [0x30, 0x62, 0x6a, 0x86].includes(x.op));
  if (args[0]?.num === undefined) return null;
  const out = { kind: map.ref.name.toLowerCase(), ns: cls.name.split('/')[2], itemNs: map.ref.owner.split('/')[2] };
  out.hunger = args[0].num;
  let j = 1;
  // Вода: «группы[a] + группы[b]», затем необязательные «× число» и «+ число»
  const waterFrom = [];
  while (args[j]?.int && args[j + 1]?.op === 0x30) {
    waterFrom.push(args[j].num);
    j += 2;
    if (args[j]?.op === 0x62) j++;
  }
  out.water = { from: waterFrom, mul: 1, add: 0 };
  if (args[j]?.num !== undefined && args[j + 1]?.op === 0x6a) [out.water.mul, j] = [round(args[j].num), j + 2];
  if (args[j]?.num !== undefined && args[j + 1]?.op === 0x62) [out.water.add, j] = [round(args[j].num), j + 2];
  // Насыщение: «число × количество продуктов»
  if (args[j]?.num !== undefined && invoke(args[j + 1] ?? {}) && /\)I$/.test(args[j + 1].ref.desc))
    out.saturationPerItem = round(args[j].num);
  // Порча: помощник (список) → число: «наибольшая порча × число»
  const decayRef = args.findLast((x) => invoke(x) && /\)F$/.test(x.ref.desc) && x.ref.owner !== cls.name)?.ref;
  const helper = (ref) => {
    const owner = classes.get(ref.owner);
    return owner
      ? decoded(
          owner,
          owner.methods.find((x) => x.name === ref.name && x.desc === ref.desc),
        )
      : [];
  };
  if (decayRef) {
    const h = helper(decayRef);
    const mul = h.findLast((x, i) => x.num !== undefined && h[i + 1]?.op === 0x6a);
    if (h.some((x) => x.ref?.name === 'max')) out.decay = { of: 'max', mul: mul ? round(mul.num) : 1 };
  }
  // Питательные группы: помощник (список, множитель, предел) → массив
  const before = list.slice(0, start);
  const nutRef = before.findLast((x) => invoke(x) && /\)\[F$/.test(x.ref.desc))?.ref;
  if (!nutRef || !out.decay || out.saturationPerItem === undefined) return null;
  const h = helper(nutRef);
  const clone = h.findIndex((x) => x.ref?.name === 'clone');
  out.nutrients = {
    // После копии массива одна ячейка обнуляется — это найденная перед тем самая малая группа
    dropMin: clone > 0 && h.slice(clone).some((x, i, a) => x.op === 0x0b && a[i + 1]?.op === 0x51),
    mult: h.some((x, i) => x.fload === 1 && h[i + 1]?.op === 0x6a),
    cap: h.some((x, i) => x.fload === 2 && h[i + 1]?.op === 0x95),
  };
  // Множитель и предел приходят из настроек мода: свои методы-геттеры, читающие статические поля конфига
  const getters = before
    .filter((x) => invoke(x) && x.ref.owner === cls.name && x.ref.desc === '()F')
    .map(
      (x) =>
        decoded(
          cls,
          cls.methods.find((mm) => mm.name === x.ref.name && mm.desc === '()F'),
        ).find((y) => y.op === 0xb2)?.ref,
    )
    .filter(Boolean);
  const [multRef, capRef] = getters;
  const configOf = (ref) => {
    const owner = ref && classes.get(ref.owner);
    const key = owner && configDefaults(owner).find((k) => k.key.split('.').pop() === ref.name);
    if (!key) return null;
    // Тип конфига — из регистрации: registerConfig(ModConfig.Type.COMMON, …) в том же моде
    let type = null;
    for (const c of classes.values()) {
      if (c.name.split('/')[2] !== out.ns) continue;
      for (const mm of c.methods)
        for (const x of decoded(c, mm))
          if (x.op === 0xb2 && /ModConfig\$Type$/.test(x.ref.owner)) type ??= x.ref.name.toLowerCase();
    }
    return { key: key.key, default: key.default, file: type ? `${out.ns}-${type}.toml` : null };
  };
  if (out.nutrients.mult) out.nutrients.multConfig = configOf(multRef);
  if (out.nutrients.cap) out.nutrients.capConfig = configOf(capRef);
  // Что можно класть (тег в проверке продуктов), посуда (Ingredient.of(тег)), время, блок-цель подмешивания
  const all = cls.methods.flatMap((mm) => decoded(cls, mm));
  const tagBefore = (name) => {
    const i = all.findIndex(
      (x) => x.ref?.name === name && x.op === 0xb8 && (name !== 'of' || /Ingredient$/.test(x.ref.owner)),
    );
    const t =
      i > 0 ? all.slice(Math.max(0, i - 3), i).findLast((x) => x.op === 0xb2 && /TagKey;$/.test(x.ref.desc)) : null;
    return t ? tagOf(t.ref, classes) : undefined;
  };
  const valid = all.find(
    (x) => x.op === 0xb8 && /\(Ljava\/util\/List;Lnet\/minecraft\/tags\/TagKey;\)Z$/.test(x.ref.desc),
  );
  if (valid) out.ingredientTag = tagBefore(valid.ref.name);
  out.carrierTag = tagBefore('of');
  const tick = list.findIndex((x, i) => i > at && x.op === 0xb5 && /tick/i.test(x.ref.name));
  if (tick > 0 && list[tick - 1].num !== undefined) out.ticks = list[tick - 1].num;
  // Посуда — первый параметр подменённого вызова: addDishRecipe(PotBlockEntity)
  const target = cls.methods.map((mm) => /^\(L([^;]+BlockEntity);\)V$/.exec(mm.desc)?.[1]).find(Boolean);
  if (target) out.target = target;
  return out;
}

/** Значения по умолчанию у доли: «"имя_modifier"; константа; optionalFieldOf» в кодеке записи */
function portionDefaults(cls) {
  const out = {};
  for (const m of cls.methods) {
    const list = decoded(cls, m);
    list.forEach((x, i) => {
      const name = /^(\w+)_modifier$/.exec(x.str ?? '')?.[1];
      if (name && list[i + 1]?.num !== undefined) out[name] = list[i + 1].num;
    });
  }
  return Object.keys(out).length ? out : null;
}

function readCode(classDirs) {
  const computed = [];
  let defaults = null;
  let nutrients = null;
  const classes = new Map();
  for (const dir of classDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const rel of fs.readdirSync(dir, { recursive: true })) {
      if (!String(rel).endsWith('.class')) continue;
      let cls;
      try {
        cls = parseClass(fs.readFileSync(path.join(dir, rel)));
      } catch {
        continue;
      }
      classes.set(cls.name, cls);
    }
  }
  for (const cls of classes.values()) {
    defaults ??= portionDefaults(cls);
    // Порядок питательных групп в массивах — порядок перечисления Nutrient
    if (/\/food\/Nutrient$/.test(cls.name) && cls.superName === 'java/lang/Enum')
      nutrients = enumConstants(cls).map((c) => c.name.toLowerCase());
    const dish = computedDish(cls, classes);
    if (dish) computed.push(dish);
  }
  return { computed, defaults, nutrients };
}

// ---------------------------------------------------------------- рецепты

/** Ингредиент рецепта → { key, items, tags, food }: обёртка «и не испорчено» значит, что это еда */
function ingredient(raw) {
  let food = false;
  const items = [];
  const tags = [];
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    if (x.type === 'tfc:not_rotten') food = true;
    else if (x.children) x.children.forEach(walk);
    else if (x.item) items.push(x.item);
    else if (x.tag) tags.push(x.tag);
    else if (x.ingredient) walk(x.ingredient);
  };
  walk(raw);
  items.sort();
  tags.sort();
  return { key: [...tags.map((t) => `#${t}`), ...items].join('|'), items, tags, food };
}

/** Входы рецепта верстака с количеством: в фигурном считаем буквы узора */
function craftingInputs(j) {
  const out = new Map();
  const add = (raw, n) => {
    const ing = ingredient(raw);
    if (!ing.key) return;
    const prev = out.get(ing.key);
    out.set(ing.key, { ...ing, count: (prev?.count ?? 0) + n });
  };
  if (j.pattern && j.key) {
    const text = j.pattern.join('');
    for (const [ch, raw] of Object.entries(j.key)) add(raw, [...text].filter((c) => c === ch).length);
  } else for (const raw of j.ingredients ?? []) add(raw, 1);
  return [...out.values()];
}

const mealOf = (j) => (j.result?.modifiers ?? []).find((m) => m?.type === 'tfc:meal');

function foodData(f = {}) {
  const { hunger = 0, saturation = 0, water = 0, decay_modifier: decay = 0, ...nutrients } = f;
  return { hunger, saturation, water, decay, nutrients };
}

/** «barley_bread_sandwich» и «barley_flatbread» делят первое слово — это вид основы (ячмень) */
const head = (id) => id.split(':')[1].split('/').pop().split('_')[0];

/** Класс из jar, который не попал в кеш (посуда чужого мода): ищем по всем jar, первый найденный */
function classFromJars(jarPaths, name) {
  for (const jar of jarPaths) {
    const r = spawnSync('unzip', ['-p', jar, `${name}.class`], { maxBuffer: 16 << 20 });
    if (r.status === 0 && r.stdout?.length) {
      try {
        return parseClass(r.stdout);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function buildMeals(classDirs, recipeMap, items, jarPaths = []) {
  let recipes = recipeMap;
  const warnings = [];
  const have = new Set(items.map((i) => i.i));
  // Каталог рецептов сборщика: Map id → { source, json }
  recipes = [...recipes].map(([i, r]) => ({
    i,
    s: r.source,
    j: r.json,
    t: typeof r.json.type === 'string' ? r.json.type : '',
  }));
  const { computed, defaults, nutrients: order } = readCode(classDirs);
  if (!order) warnings.push('порядок питательных групп (перечисление Nutrient) не найден');
  const NUTRIENTS = order ?? [];
  if (!defaults) warnings.push('значения по умолчанию у долей блюда (кодек MealPortion) не найдены');
  const def = (v, name) => round(v ?? defaults?.[name] ?? 1);

  // 1. Блюда по рецептам tfc:meal: один предмет на выходе — одно блюдо, варианты рецепта сливаются в слоты
  const dishes = new Map();
  for (const r of recipes) {
    const meal = mealOf(r.j);
    const id = r.j.result?.stack?.id ?? r.j.result?.id;
    if (!meal || !id) continue;
    const d = dishes.get(id) ?? { id, recipes: [], sources: new Set(), types: new Set(), variants: [] };
    d.recipes.push(r.i);
    d.sources.add(r.s);
    d.types.add(r.t);
    d.base = foodData(meal.food);
    d.portions = (meal.portions ?? []).map((p) => {
      const ing = p.ingredient ? ingredient(p.ingredient) : null;
      return {
        ...(ing ? { items: ing.items, tags: ing.tags } : {}),
        nutrient: def(p.nutrient_modifier, 'nutrient'),
        water: def(p.water_modifier, 'water'),
        saturation: def(p.saturation_modifier, 'saturation'),
      };
    });
    d.variants.push(craftingInputs(r.j));
    dishes.set(id, d);
  }
  // Что из блюда получается дальше без пересчёта питательности (сырая пицца → пицца из печи)
  const next = new Map();
  for (const r of recipes) {
    const mods = (r.j.result?.modifiers ?? []).map((m) => (typeof m === 'string' ? m : m?.type));
    if (!mods.some((m) => /copy_dynamic_food$/.test(m ?? ''))) continue;
    const out = r.j.result?.stack?.id;
    for (const it of ingredient(r.j.ingredient ?? r.j.ingredients).items)
      if (dishes.has(it) && out) next.set(it, { item: out, type: r.t, recipe: r.i });
  }

  // 2. Семейства: блюда, отличающиеся только видом основы (шесть хлебов — один сэндвич)
  const families = new Map();
  for (const d of dishes.values()) {
    const h = head(d.id);
    // Слоты блюда: по всем вариантам рецепта — от скольки до скольки штук
    const slots = new Map();
    for (const v of d.variants)
      for (const s of v) {
        const prev = slots.get(s.key);
        slots.set(s.key, { ...s, min: 0, max: Math.max(prev?.max ?? 0, s.count) });
      }
    for (const s of slots.values())
      s.min = Math.min(...d.variants.map((v) => v.find((x) => x.key === s.key)?.count ?? 0));
    // Основа — предметы того же вида, что и блюдо (ячменный хлеб/лепёшка/ломтик для сэндвича на ячменном хлебе)
    const isBase = (s) =>
      d.id.includes(`${h}_`) && s.items.length > 0 && !s.tags.length && s.items.every((i) => head(i) === h);
    const list = [...slots.values()].map((s) => ({ ...s, base: isBase(s) }));
    const hasBase = list.some((s) => s.base);
    const sig = (s) => (s.base ? '<основа>' : s.key);
    const baseSlots = list.filter((s) => s.base);
    const rest = list.filter((s) => !s.base);
    const key = [
      hasBase ? d.id.replace(`${h}_`, '') : d.id,
      ...rest.map((s) => `${sig(s)}:${s.min}-${s.max}`).sort(),
      baseSlots.length ? `<основа>:${Math.max(...baseSlots.map((s) => s.max))}` : '',
    ].join(' ');
    const f = families.get(key) ?? {
      id: hasBase ? d.id.replace(`${h}_`, '') : d.id,
      dishes: [],
      slots: rest.map(({ key: k, items: it, tags, food, min, max }) => ({ key: k, items: it, tags, food, min, max })),
      baseCount: baseSlots.length ? Math.max(...baseSlots.map((s) => s.max)) : 0,
      base: d.base,
      portions: d.portions.map((p) => {
        // Доля основы у каждого блюда семейства своя (свой хлеб) — в семействе оставляем только признак
        const base = hasBase && Boolean(p.items?.length && p.items.every((i) => head(i) === h));
        const { items: _items, tags: _tags, ...mods } = p;
        return base ? { ...mods, base } : { ...p, base };
      }),
      types: new Set(),
      sources: new Set(),
      recipes: 0,
    };
    f.dishes.push({
      item: d.id,
      bases: [...new Set(baseSlots.flatMap((s) => s.items))].sort(),
      recipes: d.recipes,
      ...(next.has(d.id) ? { next: next.get(d.id) } : {}),
    });
    for (const t of d.types) f.types.add(t);
    for (const s of d.sources) f.sources.add(s);
    f.recipes += d.recipes.length;
    families.set(key, f);
  }

  // 3. Суп и салат: формула из кода, рецепты супа — из каталога (сколько ингредиентов, жидкость, время, жар)
  // Предмет блюда для каждой группы: в пространстве имён мода, в id есть и группа, и вид блюда
  // (tfc:food/grain_soup, ktfcc:dish/grain)
  const nutrientsOf = (kind, ns) => {
    const one = kind.replace(/(es|s)$/, (m0) => (kind.endsWith('shes') ? '' : m0 === 's' ? '' : m0));
    const mine = [...have].filter((id) => id.startsWith(`${ns}:`));
    return NUTRIENTS.map((n) => ({
      nutrient: n,
      item: mine.find((id) => {
        const parts = id.split(':')[1].split(/[/_]/);
        return parts.includes(n) && parts.includes(one);
      }),
    })).filter((x) => x.item);
  };
  // Класс считает еду по-своему, не по образцу TFC (нет сытости в конструкторе) — пока не разобран
  for (const c of computed.filter((x) => x.hunger === undefined))
    warnings.push(`${c.ns}: блюда «${c.kind}» считаются своим кодом, формула не разобрана`);
  // Блюда аддонов со своей формулой: посуда чужого мода, в которую аддон подмешал расчёт
  const snake = (x) => x.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  const dynamic = computed
    .filter((c) => c.nutrients)
    .map((c) => {
      const { itemNs, target, water, ...rest } = c;
      const results = nutrientsOf(c.kind, itemNs);
      if (!results.length) warnings.push(`${c.ns}/${c.kind}: предметы блюда по питательным группам не найдены`);
      const out = {
        id: `${c.ns}:${c.kind}`,
        ...rest,
        water: { ...water, from: water.from.map((i) => NUTRIENTS[i]) },
        results,
      };
      if (target) {
        // Вместимость посуды — размер списка продуктов в её классе; сам предмет посуды — по имени класса
        const cls = classFromJars(jarPaths, target);
        const list = cls ? cls.methods.flatMap((m) => decoded(cls, m)) : [];
        const size = list.findIndex((x) => x.ref?.name === 'withSize');
        const n = size > 0 ? list.slice(Math.max(0, size - 3), size).findLast((x) => x.int)?.num : undefined;
        if (n) out.slots = n;
        else warnings.push(`${c.ns}/${c.kind}: вместимость посуды (${target}) не найдена`);
        const short = snake(
          target
            .split('/')
            .pop()
            .replace(/BlockEntity$/, ''),
        );
        // Предмет посуды — в том же моде, что и её класс (пространство имён совпадает с корнем id предметов мода)
        const block = [...have].filter(
          (id) => id.split(':')[1] === short && target.includes(id.split(':')[0].replace(/_/g, '')),
        );
        if (block.length === 1) out.block = block[0];
      }
      return out;
    });
  const computedOut = computed
    .filter((c) => c.hunger !== undefined && !c.nutrients)
    .map((c) => {
      const results = nutrientsOf(c.kind, c.itemNs);
      if (!results.length) warnings.push(`${c.kind}: предметы блюда по питательным группам не найдены`);
      const type = `${c.ns}:pot_${c.kind.replace(/s$/, '')}`;
      const pots = recipes
        .filter((r) => r.t === type)
        .map((r) => {
          const ings = (r.j.ingredients ?? []).map(ingredient);
          return {
            recipe: r.i,
            count: ings.length,
            tags: [...new Set(ings.flatMap((i) => i.tags))],
            fluid: r.j.fluid_ingredient?.fluid ?? r.j.fluid_ingredient?.tag ?? null,
            amount: r.j.fluid_ingredient?.amount ?? null,
            duration: r.j.duration ?? null,
            temperature: r.j.temperature ?? null,
          };
        })
        .sort((a, b) => a.count - b.count);
      const { tagFields, ns: _ns, itemNs: _itemNs, ...rest } = c;
      const tags = tagFields ?? [];
      return { ...rest, results, ...(pots.length ? { pots } : {}), ...(tags.length ? { tags } : {}) };
    });
  if (!computedOut.some((c) => c.kind === 'soups')) warnings.push('формула супа (класс рецепта с SOUPS) не найдена');
  if (!computedOut.some((c) => c.kind === 'salads')) warnings.push('формула салата (контейнер с SALADS) не найдена');

  return {
    data: {
      families: [...families.values()]
        .map((f) => ({ ...f, types: [...f.types], sources: [...f.sources] }))
        .sort((a, b) => b.dishes.length - a.dishes.length || a.id.localeCompare(b.id)),
      computed: computedOut,
      dynamic,
      nutrients: NUTRIENTS,
    },
    warnings,
  };
}

export function writeMeals(classDirs, recipes, items, outFile, jarPaths) {
  const { data, warnings } = buildMeals(classDirs, recipes, items, jarPaths);
  fs.writeFileSync(outFile, JSON.stringify(data));
  return {
    families: data.families.length,
    dishes: data.families.reduce((n, f) => n + f.dishes.length, 0),
    computed: [...data.computed.map((c) => c.kind), ...data.dynamic.map((c) => c.id)],
    warnings,
  };
}
