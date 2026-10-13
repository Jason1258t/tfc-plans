// Сковорода Cuisine Delight → раздел «skillet» в public/meals.json (вызывается из meals.mjs).
//
// У блюда со сковороды нет рецепта с питательностью: продукты жарят, помешивают и снимают тарелкой, а еду считает код.
//  - какие продукты годятся и как их готовить — данные «cuisinedelight_config/ingredient» (читает сам Cuisine Delight);
//  - оценка готовки (доля недожаренного и пережаренного) — CookedFoodData.of в Cuisine Delight;
//  - питательность TFC — аддон совместимости (cuisinetfc): подменяет выдачу блюда тарелкой и считает FoodData
//    из продуктов, оценки и настроек; для части продуктов питательность «в жареном виде» задана данными
//    «cuisinetfc/cooked_food»;
//  - название блюда — рецепты «cuisinedelight:plate_cuisine» (подбор по долям продуктов), на питательность влияет
//    только одно «штрафное» блюдо.
import fs from 'node:fs';
import path from 'node:path';
import { configDefaults } from './config-defaults.mjs';
import { decoded, foodDataArgs, helperCode, tagOf } from './meals.mjs';

const DYNAMIC_FOOD = 'setFoodForDynamicItemOnCreate';
const RECIPE_TYPE = 'cuisinedelight:plate_cuisine';
const round = (x) => Math.round(x * 1000) / 1000;
const invoke = (x) => x.ref && x.op >= 0xb6 && x.op <= 0xb9;

/** Jar с данными сковороды: его классы нужны сборщику (вызывается из mods.mjs при распаковке) */
export const isCuisineData = (entryName) => /^data\/[a-z0-9_.-]+\/(cuisinedelight_config|cuisinetfc)\//.test(entryName);

/** Какие классы такого jar сохранять: расчёт блюда (CookedFoodData), готовка (CookingData), настройки */
export function isCuisineClass(entryName, data) {
  return (
    data.includes('CookedFoodData') ||
    data.includes('CookingData') ||
    data.includes('defineInRange') ||
    data.includes('net/minecraft/tags/TagKey')
  );
}

function readJsonDir(dir, parse, out, prefix = '') {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) readJsonDir(path.join(dir, e.name), parse, out, rel);
    else if (e.name.endsWith('.json')) {
      try {
        out.set(rel, parse(fs.readFileSync(path.join(dir, e.name), 'utf8')));
      } catch {
        /* битый файл — пропускаем */
      }
    }
  }
}

/** Файлы «data/<ns>/<sub>/**.json» всех источников; поздний источник перекрывает ранний, как датапаки */
function dataFiles(dataDirs, parse, sub) {
  const out = new Map();
  for (const { dir } of dataDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const ns of fs.readdirSync(dir)) {
      const files = new Map();
      readJsonDir(path.join(dir, ns, sub), parse, files);
      for (const [rel, json] of files) out.set(`${ns}:${rel}`, json);
    }
  }
  return out;
}

/** Ингредиент рецепта/данных → предметы и теги; «food_type» — свой тип Cuisine Delight (по виду продукта) */
export function ingredientOf(raw) {
  const items = [];
  const tags = [];
  let foodType;
  const walk = (x) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      if (typeof x.item === 'string') items.push(x.item);
      if (typeof x.tag === 'string') tags.push(x.tag);
      if (typeof x.foodType === 'string') foodType = x.foodType.toLowerCase();
    }
  };
  walk(raw);
  return { items, tags, ...(foodType ? { foodType } : {}) };
}

/** Поле конфига за своим методом-геттером; «1 / значение» помечается inverse */
function configField(cls, ref, depth = 0) {
  const m = cls.methods.find((x) => x.name === ref.name && x.desc === ref.desc);
  const body = decoded(cls, m);
  const direct = body.find((x) => x.op === 0xb2)?.ref;
  if (direct) return { ref: direct, inverse: false };
  const inner = body.find((x) => invoke(x) && x.ref.owner === cls.name)?.ref;
  if (!inner || depth > 2) return null;
  const got = configField(cls, inner, depth + 1);
  // «1 / геттер»: единица в начале и деление после вызова
  return got ? { ...got, inverse: body.some((x) => x.num === 1) && body.some((x) => x.op === 0x6e) } : null;
}

/** Настройка мода по полю конфига: ключ, значение по умолчанию из кода, файл */
function configKey(ref, classes, ns) {
  const owner = ref && classes.get(ref.owner);
  // Поле со значением (foodSize) заполняется из поля описания (FOOD_SIZE) — сопоставляем по имени без регистра
  const flat = (x) => x.replace(/_/g, '').toLowerCase();
  const key = owner && configDefaults(owner).find((k) => flat(k.key.split('.').pop()) === flat(ref.name));
  if (!key) return null;
  let type = null;
  for (const c of classes.values()) {
    if (c.name.split('/')[2] !== ns) continue;
    for (const m of c.methods)
      for (const x of decoded(c, m))
        if (x.op === 0xb2 && /ModConfig\$Type$/.test(x.ref.owner)) type ??= x.ref.name.toLowerCase();
  }
  // Тип не назван явно (обёртка L2Core) — он в имени вложенного класса настроек: CDConfig$Server
  type ??= /\$(Server|Common|Client)$/.exec(ref.owner)?.[1].toLowerCase() ?? null;
  return { key: key.key, default: key.default, file: type ? `${ns}-${type}.toml` : null };
}

/** Аддон совместимости: класс, который кладёт на тарелку еду TFC (new FoodData + CookedFoodData в параметрах) */
function plateCode(classes, warnings) {
  for (const cls of classes.values()) {
    for (const m of cls.methods) {
      if (!/CookedFoodData;/.test(m.desc)) continue;
      const list = decoded(cls, m);
      const at = list.findIndex((x) => x.ref?.name === '<init>' && /\/FoodData$/.test(x.ref.owner));
      if (at < 6 || !list.some((x) => x.ref?.name === DYNAMIC_FOOD)) continue;
      const fd = foodDataArgs(cls, list, at, classes);
      if (!fd?.decay || fd.saturationPerItem === undefined) continue;
      const ns = cls.name.split('/')[2];
      const { start, ...values } = fd;
      const out = { ns, ...values };
      // Питательные группы: помощник(сумма, оценка, множитель, предел) → массив
      const before = list.slice(0, start);
      const nutAt = before.findLastIndex((x) => invoke(x) && /\)\[F$/.test(x.ref.desc));
      if (nutAt < 0) continue;
      const h = helperCode(before[nutAt].ref, classes);
      const clone = h.findIndex((x) => x.ref?.name === 'clone');
      const percent = h.find((x, i) => x.num !== undefined && h[i + 1]?.op === 0x6e)?.num;
      const capParam = h.find((x, i) => x.fload !== undefined && h[i + 1]?.op === 0x95 && x.fload <= 3)?.fload;
      out.nutrients = {
        // После копии массива одна ячейка обнуляется — это найденная перед тем самая малая группа
        dropMin: clone > 0 && h.slice(clone).some((x, i, a) => x.op === 0x0b && a[i + 1]?.op === 0x51),
        scoreDivisor: percent ?? null,
      };
      // Аргументы помощника по порядку: оценка блюда, множитель (1 / число порций), предел — два последних из настроек
      const prevArr = before.slice(0, nutAt).findLastIndex((x) => invoke(x) && /\)\[F$/.test(x.ref.desc));
      const args = before.slice(prevArr + 1, nutAt).filter(invoke);
      const own = args.filter((x) => x.ref.owner === cls.name).map((x) => configField(cls, x.ref));
      const divisor = own.find((c) => c?.inverse);
      const cap = capParam !== undefined ? own.find((c) => c && !c.inverse) : null;
      out.nutrients.servingsConfig = divisor ? configKey(divisor.ref, classes, ns) : null;
      out.nutrients.capConfig = cap ? configKey(cap.ref, classes, ns) : null;
      if (!out.nutrients.servingsConfig) warnings.push('сковорода: настройка числа порций не найдена');
      if (!out.nutrients.capConfig) warnings.push('сковорода: настройка предела питательности не найдена');
      // Питательность продукта: его еда TFC, а если есть запись «жареного» продукта — она (вызов …get(ItemStack) своего мода)
      out.cookedOverride = helperCode(before[prevArr]?.ref ?? { owner: '' }, classes).some(
        (x) => invoke(x) && x.ref.name === 'getNutrients',
      );
      // Штрафное блюдо: «если блюдо — ПОЛЕ, группы × настройка»
      const rest = list.slice(nutAt + 1, start);
      const field = rest.find((x) => x.op === 0xb2 && !/Config$/.test(x.ref.owner) && /^[A-Z_]+$/.test(x.ref.name));
      const factor = rest.find((x, i) => invoke(x) && x.ref.owner === cls.name && rest[i + 1]?.op === 0x6a);
      if (field && factor) {
        const f = configField(cls, factor.ref);
        out.penalty = { field: field.ref.name.toLowerCase(), config: f ? configKey(f.ref, classes, ns) : null };
      }
      // Число порций в блюде — та же настройка: new CookedFoodData(…, число порций, …)
      const made = list.findIndex(
        (x, i) => i > nutAt && x.ref?.name === '<init>' && /CookedFoodData$/.test(x.ref.owner),
      );
      out.servingsInDish =
        made > 0 &&
        list
          .slice(nutAt, made)
          .filter((x) => invoke(x) && x.ref.owner === cls.name)
          .some((x) => {
            const f = configField(cls, x.ref);
            return f && !f.inverse && f.ref.name === divisor?.ref.name;
          });
      // Где действует подмена: строка цели «Lвладелец;метод(…» в аннотации, а подменены только те вызывающие
      // методы владельца, чьи имена названы в классе аддона (useOn — тарелкой по блоку, use — со сковороды в руке)
      const strings = cls.cp.filter((c) => c && typeof c.v === 'string').map((c) => c.v);
      const target = strings.map((v) => /^L([^;]+);(\w+)\(/.exec(v)).find(Boolean);
      const owner = target && classes.get(target[1]);
      if (owner) {
        const callers = owner.methods
          .filter((mm) => decoded(owner, mm).some((x) => invoke(x) && x.ref.name === target[2]))
          .map((mm) => mm.name);
        out.hook = {
          hooked: callers.filter((n) => strings.includes(n)),
          missed: callers.filter((n) => !strings.includes(n)),
        };
      }
      return out;
    }
  }
  return null;
}

/** Cuisine Delight: порог съедобности, замедление на слабом огне, вместимость сковороды */
function skilletCode(classes) {
  const out = {};
  for (const cls of classes.values()) {
    for (const m of cls.methods) {
      const list = decoded(cls, m);
      // «оценка < N → несъедобно»: сравнение поля score с константой в классе готового блюда
      if (/CookedFoodData$/.test(cls.name) && out.minScore === undefined) {
        const i = list.findIndex((x, k) => x.op === 0xb4 && x.ref.name === 'score' && list[k + 2]?.op === 0xa1);
        if (i >= 0 && list[i + 1].num !== undefined) out.minScore = list[i + 1].num;
      }
      // «на слабом огне скорость = число»: константа перед setSpeed, рядом — тег блоков слабого огня
      const speed = list.findIndex((x) => invoke(x) && x.ref.name === 'setSpeed');
      if (speed > 0 && list[speed - 1].num !== undefined && out.slowSpeed === undefined)
        out.slowSpeed = round(list[speed - 1].num);
      for (const x of list) {
        if (x.op !== 0xb2 || !/TagKey;$/.test(x.ref.desc)) continue;
        if (/low_?heat/i.test(x.ref.name)) out.slowTag ??= tagOf(x.ref, classes);
        if (/heat_?source/i.test(x.ref.name)) out.heatTag ??= tagOf(x.ref, classes);
      }
      // Вместимость: «contents.size() >= настройка» — поле настройки перед сравнением
      const size = list.findIndex(
        (x, k) => x.op === 0xb4 && x.ref.name === 'contents' && list[k + 1]?.ref?.name === 'size',
      );
      if (size >= 0 && !out.capacityRef) {
        const cfg = list.slice(size, size + 8).find((x) => x.op === 0xb4 && /ConfigSpec\$/.test(x.ref.desc));
        if (cfg) out.capacityRef = cfg.ref;
      }
    }
  }
  return out;
}

/** Запись продукта сковороды из данных «cuisinedelight_config/ingredient» (её же читает scripts/kubejs.mjs) */
export const skilletEntryValues = (e) => ({
  type: String(e.type ?? 'NONE').toLowerCase(),
  min: e.min_time ?? 0,
  max: e.max_time ?? 0,
  stir: e.stir_time ?? 0,
  raw: round(e.raw_penalty ?? 0),
  over: round(e.overcook_penalty ?? 0),
  size: e.size ?? 1,
});

export function buildSkillet({ classes, recipes, have, dataDirs, parse, nutrients, warnings }) {
  const list = recipes.filter((r) => r.t === RECIPE_TYPE);
  if (!list.length) return null;
  const ns = RECIPE_TYPE.split(':')[0];
  const plate = plateCode(classes, warnings);
  if (!plate) {
    warnings.push('сковорода: расчёт еды TFC на тарелке (аддон совместимости) не найден');
    return null;
  }
  const code = skilletCode(classes);
  if (code.minScore === undefined) warnings.push('сковорода: порог съедобности блюда не найден');

  // Продукты: все записи «ingredient» всех модов; оставляем те, чьи предметы есть в сборке
  const entries = [];
  const seen = new Map();
  for (const [file, json] of dataFiles(dataDirs, parse, 'cuisinedelight_config/ingredient')) {
    for (const e of json?.entries ?? []) {
      const ing = ingredientOf(e.ingredient);
      const items = ing.items.filter((i) => have.has(i));
      if (!items.length && !ing.tags.length) continue;
      const values = skilletEntryValues(e);
      // Продукт описан дважды — действует первая запись; предупреждаем, только если записи расходятся
      const fresh = items.filter((i) => {
        const prev = seen.get(i);
        if (!prev) return true;
        if (JSON.stringify(prev.values) !== JSON.stringify(values))
          warnings.push(
            `сковорода: продукт ${i} описан дважды по-разному (${prev.file} и ${file}), взята первая запись`,
          );
        return false;
      });
      for (const i of fresh) seen.set(i, { file, values });
      if (!fresh.length && !ing.tags.length) continue;
      // file — «ns:имя.json»: датапак сборки (kubejs/data) с тем же файлом заменяет запись целиком, это делает сайт
      entries.push({ file, items: fresh, tags: ing.tags, ...values });
    }
  }
  // Питательность «в жареном виде»: запись заменяет еду TFC самого продукта
  const cooked = [];
  if (plate.cookedOverride)
    for (const [file, json] of dataFiles(dataDirs, parse, `${plate.ns}/cooked_food`)) {
      const ing = ingredientOf(json?.ingredient);
      const items = ing.items.filter((i) => have.has(i));
      if (!items.length && !ing.tags.length) continue;
      cooked.push({ file, items, tags: ing.tags, nutrients: nutrients.map((n) => round(json[n] ?? 0)) });
    }
  const { cookedOverride: _cookedOverride, water, penalty, ...rest } = plate;

  // Блюда: название по долям продуктов. Доля = размер подходящих продуктов / размер всех; вне [min, max] — не подходит
  const dishes = list
    .map((r) => ({
      recipe: r.i,
      item: r.j.holderItem,
      list: (r.j.list ?? []).map((m) => ({
        ...ingredientOf(m.ingredient),
        min: round(m.min ?? 0),
        max: round(m.max ?? 0),
        score: round(m.score ?? 0),
        bonus: round(m.bonus ?? 0),
      })),
    }))
    .filter((d) => typeof d.item === 'string' && have.has(d.item))
    .sort((a, b) => a.recipe.localeCompare(b.recipe));

  const out = {
    id: RECIPE_TYPE,
    ...rest,
    // Папка данных «жареной» питательности: data/<ns>/<cookedDir>/…
    cookedDir: `${plate.ns}/cooked_food`,
    water: { ...water, from: water.from.map((i) => nutrients[i]) },
    entries,
    cooked,
    dishes,
  };
  if (penalty) {
    const item = [...have].find((id) => id === `${ns}:${penalty.field}`);
    if (item) out.penalty = { item, config: penalty.config };
    else warnings.push(`сковорода: предмет штрафного блюда (${penalty.field}) не найден`);
  }
  if (code.minScore !== undefined) out.minScore = code.minScore;
  if (code.slowSpeed !== undefined && code.slowTag) out.slow = { speed: code.slowSpeed, tag: code.slowTag };
  if (code.heatTag) out.heatTag = code.heatTag;
  if (code.capacityRef) {
    out.capacityConfig = configKey(code.capacityRef, classes, ns);
    if (!out.capacityConfig) warnings.push('сковорода: настройка вместимости не найдена');
  }
  // Предметы: сковорода и тарелка — в моде рецепта, по имени
  const mine = [...have].filter((id) => id.startsWith(`${ns}:`));
  const skillet = mine.filter((id) => /skillet$/.test(id));
  if (skillet.length === 1) out.block = skillet[0];
  const plateItem = mine.find((id) => id === `${ns}:plate`);
  if (plateItem) out.plate = plateItem;
  return out;
}
