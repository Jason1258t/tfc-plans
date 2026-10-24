/**
 * Ботаника → public/botany.json: культуры, ягодные кусты и фруктовые деревья TFC и аддонов.
 *
 * Из данных (data/<ns>/tfc/climate_range/{crop,plant}/<имя>.json): диапазоны температуры и влажности.
 * Из кода модов (.class, разбор — scripts/mods/classfile.mjs, без JDK):
 *   - перечисление культур (поля nitrogen/phosphorous/potassium): расход N/P/K, число стадий, класс блока культуры;
 *   - перечисления с массивом Lifecycle по месяцам (кусты, деревья): сезоны, дни роста саженца, высота куста;
 *   - CropHelpers: константы скорости роста и расхода удобрений; calendar/Month: порядок месяцев.
 * Ничего не зашито руками: имена полей, значения и связи берутся из jar текущей сборки. Если мод переименует
 * поле или сменит устройство перечисления, соответствующие данные просто пропадут, а сборка сообщит об этом.
 *
 *   { meta: { months, growthFactor, nutrientConsumption, nutrientGrowthFactor, … },
 *     entries: [{ i, k: crop|bush|tree|plant, n, src, r: { minT, maxT, minH, maxH }, product?, seed?, plant?,
 *                 npk?: [N, P, K], stages?: [int…], block?: 'ClimbingCropBlock',
 *                 life?: ['DORMANT'|'HEALTHY'|'FLOWERING'|'FRUITING' × 12], growDays?, maxHeight?, code?: источник,
 *                 drops?: [{ item, min, max, byYield? }] — с созревшего растения (loot_table/blocks/…),
 *                 wild?: { minT, maxT, minW, maxW, minF, maxF, rarity } — где растёт в природе (placed_feature) }] }
 */
import fs from 'node:fs';
import path from 'node:path';
import { argTypes, clinitValues, enumConstants, instructions, lambdaTargets, parseClass } from './classfile.mjs';
import { configDefaults } from './config-defaults.mjs';
import { itemTags } from './reference.mjs';
import { recipeRefs } from '../../src/shared/pack-data/recipeRefs.ts';

const FIELDS = {
  min_temperature: 'minT',
  max_temperature: 'maxT',
  min_hydration: 'minH',
  max_hydration: 'maxH',
  // Допуск за границей диапазона (по умолчанию 0): растение там уже не растёт, но ещё не гибнет
  temperature_wiggle_range: 'wigT',
  hydration_wiggle_range: 'wigH',
};
const NPK = ['nitrogen', 'phosphorous', 'potassium'];
/** Настройки модов, влияющие на сроки роста (имя поля в классе конфига) */
const CONFIG_KEYS = [
  'cropGrowthModifier',
  'cropExpiryModifier',
  'wildCropMaturityStartMonth',
  'wildCropMaturityEndMonth',
  'saplingGrowthModifier',
  'bananaSaplingGrowthTicks',
  'fruitPickBloomDelayTicks',
  'defaultMonthLength',
  'defaultCalendarDayLength',
  'greenhouseGrowthModifier',
  'greenhouseWaterDays',
  'greenhouseNutrientDays',
  'greenhouseRadius',
  'usePipesForSprinklers',
];

/** Какие классы jar сохранять в кеш для разбора (вызывается из build-items при распаковке) */
export function isBotanyClass(entryName, data) {
  if (
    /\/crop\/CropHelpers\.class$|\/calendar\/(Month|Calendar|CalendarWorldData)\.class$|\/config\/\w*(Server|Common)Config\.class$/.test(
      entryName,
    )
  )
    return true;
  if (/FoodTraits\$Default\.class$/.test(entryName)) return true;
  // Полив теплицы: всё, что вызывает addWater (лейка, разбрызгиватель, грядки), блоки с зоной полива и реестр предметов
  // с прочностью лейки
  if (data.includes('addWater') || data.includes('SprinklerBlock') || data.includes('WateringCan')) return true;
  return data.includes('plant/fruit/Lifecycle') || data.includes('phosphorous') || data.includes('getInvalidReason');
}

// ---------------------------------------------------------------- код модов

const isEnum = (cls) => cls.superName === 'java/lang/Enum';
const isLifecycle = (v) => v?.array && /\/Lifecycle$/.test(v.type ?? '');
const fieldName = (v) => (v && typeof v === 'object' && v.field ? v.field.name : null);
const round = (x) => Math.round(x * 1000) / 1000;

/** Инструкции метода с раскрытыми операндами: число (константа на стеке) или ссылка на поле/метод */
function decoded(cls, method) {
  if (!method?.code) return [];
  return instructions(method.code).map((ins) => {
    const { op } = ins;
    if (op >= 0x02 && op <= 0x08) return { op, num: op - 0x03 };
    if (op >= 0x0b && op <= 0x0d) return { op, num: op - 0x0b };
    if (op === 0x10 || op === 0x11) return { op, num: ins.index };
    if (op === 0x12 || op === 0x13) {
      const v = cls.constant(ins.index);
      return typeof v === 'number' ? { op, num: v } : { op, str: typeof v === 'string' ? v : undefined };
    }
    if (op >= 0xb2 && op <= 0xb9) return { op, ref: cls.ref(ins.index) };
    if (op === 0xbb || op === 0xc1) return { op, cls: cls.className(ins.index) };
    return { op };
  });
}

/** Последнее число, положенное на стек перед инструкцией i (не дальше back шагов) */
function numBefore(list, i, back = 4) {
  for (let j = i - 1; j >= Math.max(0, i - back); j--) if (list[j].num !== undefined) return list[j].num;
  return undefined;
}

/**
 * Полив теплицы из кода аддона. Опорная точка — вызовы addWater(количество): у предмета это лейка, у блока-сущности
 * с serverTick — разбрызгиватель; грядка, переопределившая addWater, принимает воду не со всех сторон или не принимает.
 */
function greenhouseWater(cls, water) {
  const methods = cls.methods.map((m) => ({ m, list: decoded(cls, m) }));
  const calls = (list, name) => list.findIndex((x) => x.ref?.name === name && (x.op === 0xb6 || x.op === 0xb9));
  const short = cls.name.split('/').pop();
  for (const { m, list } of methods) {
    const at = calls(list, 'addWater');
    // Лейка: onUseTick → всем грядкам в кубе вокруг игрока
    if (at >= 0 && m.name === 'onUseTick') {
      const can = (water.can ??= { cls: cls.name });
      can.add = round(numBefore(list, at));
      const box = list.findIndex((x) => x.ref && /positions/i.test(x.ref.name) && x.ref.desc.includes('II)'));
      if (box >= 2 && list[box - 1].num !== undefined && list[box - 2].num !== undefined)
        [can.radius, can.radiusY] = [list[box - 2].num, list[box - 1].num];
      const dur = cls.methods.find((x) => x.name === 'getUseDuration');
      const ticks = decoded(cls, dur).find((x) => x.num !== undefined)?.num;
      if (ticks) can.useTicks = ticks;
      const use = methods.find((x) => x.m.name === 'useOn')?.list ?? [];
      const fluid = use.find((x) => x.op === 0xb2 && /Fluids$/.test(x.ref.owner))?.ref.name;
      if (fluid && use.some((x) => x.ref?.name === 'setDamageValue')) can.refill = fluid.toLowerCase();
    }
    // Разбрызгиватель: раз в N тиков добавляет воду всем грядкам своей зоны, если нашёл источник
    if (at >= 0 && /tick/i.test(m.name) && m.name !== 'onUseTick' && !water.sprinkler?.add) {
      const sp = (water.sprinkler ??= {});
      sp.add = round(numBefore(list, at, 12));
      const rem = list.findIndex((x) => x.op === 0x71 || x.op === 0x70);
      const every = list.slice(0, Math.max(rem, 0)).find((x) => x.op === 0x10)?.num;
      if (every) sp.interval = every;
      const max = cls.fields.find((f) => f.name === 'MAX_COST' && typeof f.constant === 'number');
      if (max) sp.pipeMax = max.constant;
      // Источник: поиск жидкости по трубам или из бака вплотную — выбирается настройкой
      for (const x of methods) {
        const cfg = x.list.find((i) => i.op === 0xb4 && /Config$/.test(i.ref.owner));
        const drain = x.list.findIndex((i) => i.ref?.name === 'drain' && /IFluidHandler$/.test(i.ref.owner));
        if (!cfg || drain < 0) continue;
        sp.pipeConfig = cfg.ref.name;
        sp.tankDrain = numBefore(x.list, drain, 3);
        const tag = x.list.find((i) => i.op === 0xb2 && /Tags\$Fluids$/.test(i.ref.owner))?.ref.name;
        if (tag) sp.fluidTag = tag.toLowerCase();
      }
      const all = methods.flatMap((x) => x.list);
      sp.sources = [
        ...new Set(
          all
            .filter((i) => i.op === 0xb2 && /Blocks$/.test(i.ref.owner) && /TANK|PUMP/.test(i.ref.name))
            .map((i) => i.ref.name.toLowerCase()),
        ),
      ];
    }
    // Зона разбрызгивателя: лямбда «позиция → betweenClosed(pos.offset(a), pos.offset(b))»
    if (m.name.startsWith('lambda$') && list.some((x) => x.ref?.name === 'betweenClosed')) {
      const n = list.filter((x) => x.num !== undefined).map((x) => x.num);
      if (n.length === 6 && cls.methods.every((x) => x.name !== 'onUseTick')) {
        const id = short
          .replace(/Block$/, '')
          .replace(/([a-z])([A-Z])/g, '$1_$2')
          .toLowerCase();
        (water.zones ??= []).push({ id, radius: Math.max(Math.abs(n[0]), Math.abs(n[3])), y: [n[1], n[4]] });
      }
    }
    // Расход воды: вычитается в цикле по ячейкам грядки — каждое растущее растение пьёт отдельно
    if (calls(list, 'drainWater') >= 0 && list.some((x) => x.ref?.name === 'slots')) water.perSlot = true;
    // Грядки с особым правилом приёма воды
    if (m.name === 'addWater' && m.code) {
      const kind = /^(\w+?)PlanterBlockEntity$/.exec(short)?.[1].toLowerCase();
      if (!kind) continue;
      const first = list.filter((x) => x.op !== 0x00);
      if (first.length === 2 && first[0].num === 0) (water.noWatering ??= []).push(kind);
      else if (list.some((x) => x.op === 0xb2 && x.ref.name === 'DOWN')) (water.notFromBelow ??= []).push(kind);
    }
  }
  // Прочность лейки: «new Лейка(new Properties().durability(N))» в реестре предметов
  for (const { list } of methods) {
    const i = list.findIndex((x) => x.op === 0xbb && /WateringCan/.test(x.cls ?? ''));
    if (i < 0) continue;
    const d = list.findIndex((x, j) => j > i && x.ref?.name === 'durability');
    if (d > 0) (water.can ??= {}).durability = numBefore(list, d, 2);
  }
}

/**
 * Какой параметр конструктора в какое поле попадает: «load n … putfield X» (с учётом «× константа»,
 * как defaultTicksToGrow = дни × 24000). Номер локальной переменной → { field, mul }.
 */
function ctorFields(cls, desc) {
  const m = cls.methods.find((x) => x.name === '<init>' && x.desc === desc);
  const out = new Map();
  if (!m?.code) return out;
  let local = null;
  let mul = 1;
  let pending = null;
  for (const ins of instructions(m.code)) {
    const { op } = ins;
    // iload/fload/aload с операндом и короткие формы _0.._3
    if (op === 0x15 || op === 0x17 || op === 0x19) [local, mul] = [ins.index, 1];
    else if (op >= 0x1a && op <= 0x1d) [local, mul] = [op - 0x1a, 1];
    else if (op >= 0x22 && op <= 0x25) [local, mul] = [op - 0x22, 1];
    else if (op >= 0x2a && op <= 0x2d) {
      if (op !== 0x2a) [local, mul] = [op - 0x2a, 1];
    } else if (op === 0x10 || op === 0x11) pending = ins.index;
    else if (op === 0x12 || op === 0x13) pending = cls.constant(ins.index);
    else if (op === 0x68 && typeof pending === 'number') mul = pending;
    else if (op === 0xb5) {
      if (local !== null && local > 0) out.set(local, { field: cls.ref(ins.index).name, mul });
      local = null;
      mul = 1;
    } else if (op !== 0x59) local = op === 0xb6 || op === 0xb8 ? null : local;
  }
  return out;
}

/** Аргументы константы перечисления по именам полей (локальные 1 и 2 — имя и номер, long/double тут не встречаются) */
function namedArgs(cls, constant) {
  const map = ctorFields(cls, constant.desc);
  const out = {};
  constant.args.forEach((value, i) => {
    const f = map.get(i + 3);
    if (!f) return;
    out[f.field] = typeof value === 'number' ? value * f.mul : value;
    if (f.mul !== 1 && typeof value === 'number') out[`${f.field}__raw`] = value;
  });
  return out;
}

/** Класс блока культуры: что создаёт фабрика из конструктора (XCropBlock.create), без мёртвых и диких форм */
function cropBlock(cls, constant) {
  const ctor = cls.methods.find((m) => m.name === '<init>' && m.desc === constant.desc);
  const isBlock = (t) => /CropBlock(\$\w+)?$/.test(t.owner) && ['create', '<new>', '<init>'].includes(t.name);
  const alive = (t) => !/Dead|Wild/.test(t.owner.split('/').pop());
  const simple = (t) => t.owner.split('/').pop().replace(/\$.*$/, '');
  let targets = lambdaTargets(cls, ctor);
  // Фабрика блока — первая лямбда конструктора; create(...) надёжнее, чем new (так создаются и мёртвые формы)
  let blocks = [...new Set(targets.filter((t) => t.name === 'create' && isBlock(t) && alive(t)).map(simple))];
  if (!blocks.length) {
    // Аддоны заворачивают создание блока в свой статический метод (IECrop.createDoubleCrop) — заглядываем в него
    const own = targets.filter((t) => t.owner === cls.name && !['dead', 'getClimateRange'].includes(t.name));
    for (const t of own) {
      const m = cls.methods.find((x) => x.name === t.name && x.desc === t.desc);
      if (!m?.code) continue;
      const inner = [];
      for (const ins of instructions(m.code)) {
        if (ins.op === 0xb8 || ins.op === 0xb7) inner.push(cls.ref(ins.index));
        else if (ins.op === 0xbb) inner.push({ owner: cls.className(ins.index), name: '<new>', desc: '' });
        else if (ins.op === 0xba) inner.push(...lambdaTargetsOf(cls, ins));
      }
      blocks = [...new Set(inner.filter((x) => isBlock(x) && alive(x)).map(simple))];
      // Анонимный наследник (IECrop$1 extends DoubleCropBlock) — тип берём по имени метода-фабрики
      if (!blocks.length) {
        const hint = /(Double|Climbing|Flooded|Spreading|Pickable|Default)/.exec(t.name)?.[1];
        if (hint) blocks = [`${hint === 'Default' ? 'Default' : hint}CropBlock`];
      }
      if (blocks.length) break;
    }
  }
  if (blocks.length <= 1) return blocks[0] ?? null;
  // Две фабрики на выбор по булеву аргументу конструктора (нужна ли опора): истина — первая
  const types = argTypes(constant.desc).slice(2);
  const flag = constant.args[types.indexOf('Z')];
  return flag === 0 ? blocks[1] : blocks[0];
}

/** Цели одной лямбды (invokedynamic) — тело её метода */
function lambdaTargetsOf(cls, ins) {
  const impl = cls.bootstrap[cls.cp[ins.index].a]?.find((a) => a?.handle)?.handle;
  if (!impl || impl.owner !== cls.name) return impl ? [impl] : [];
  const body = cls.methods.find((m) => m.name === impl.name && m.desc === impl.desc);
  const out = [];
  for (const i of body?.code ? instructions(body.code) : []) {
    if (i.op === 0xb8 || i.op === 0xb7 || i.op === 0xb6) out.push(cls.ref(i.index));
    else if (i.op === 0xbb) out.push({ owner: cls.className(i.index), name: '<new>', desc: '' });
  }
  return out;
}

/** Поле TagKey из кода → id тега: BlockTags.DIRT → minecraft:dirt, TFCTags.Blocks.GRASS → tfc:grass, Tags.Blocks.GRAVELS → c:gravels */
function tagIdOf(ref) {
  const ns = /^net\/minecraft\//.test(ref.owner)
    ? 'minecraft'
    : /^net\/neoforged\//.test(ref.owner)
      ? 'c'
      : ref.owner.split('/')[2];
  return `${ns}:${ref.name.toLowerCase()}`;
}

const localOf = (ins) => (ins.op === 0x15 ? ins.index : ins.op >= 0x1a && ins.op <= 0x1d ? ins.op - 0x1a : null);
const storeOf = (ins) => (ins.op === 0x36 ? ins.index : ins.op >= 0x3b && ins.op <= 0x3e ? ins.op - 0x3b : null);
const intOf = (ins) =>
  ins.op >= 0x02 && ins.op <= 0x08 ? ins.op - 0x03 : ins.op === 0x10 || ins.op === 0x11 ? ins.index : null;

/**
 * Качество урожая (виноград Firmalife): один метод считает, что вокруг лозы (блоки по тегам, пустоты, улей),
 * другой по этим счётчикам выдаёт черты еды. Достаём: радиус, что считается, и условия каждой черты
 * в виде сравнений «счётчик А больше счётчика Б» / «счётчик меньше числа».
 */
function qualityRules(cls) {
  const isTag = (r) => /TagKey;$/.test(r.desc);
  const scan = cls.methods.find(
    (m) =>
      m.code &&
      instructions(m.code).some((i) => i.op === 0x84) &&
      instructions(m.code).some((i) => i.op === 0xb2 && isTag(cls.ref(i.index))),
  );
  const traits = cls.methods.find(
    (m) => m.code && instructions(m.code).some((i) => i.op === 0xb2 && /FoodTraits$/.test(cls.ref(i.index).owner)),
  );
  if (!scan || !traits) return null;

  // 1. Что считает обход: локальная переменная → подпись, индекс массива → локальная переменная
  const label = new Map();
  const untagged = [];
  const slot = new Map();
  let tag = null;
  let lastInt = null;
  let lastLocal = null;
  let radius = null;
  let bees = false;
  let prevIndex = null;
  // «isAir(); ifne» — счётчик пропускает воздух, то есть считает занятые блоки; «ifeq» — наоборот, пустые
  let counts = 'air';
  let prevOp = null;
  for (const ins of instructions(scan.code)) {
    if (prevOp === 0xb6 && cls.ref(prevIndex).name === 'isAir' && ins.op === 0x9a) counts = 'solid';
    prevOp = ins.op;
    prevIndex = ins.index;
    if (ins.op === 0xb2 && isTag(cls.ref(ins.index))) tag = tagIdOf(cls.ref(ins.index));
    else if (ins.op === 0x84) {
      const local = ins.index >> 8;
      if (tag) label.set(local, tag);
      else if (!untagged.includes(local)) untagged.push(local);
      tag = null;
    } else if (ins.op === 0xc1 && /Beehive/.test(cls.className(ins.index))) bees = true;
    else if (ins.op === 0x4f && lastInt !== null && lastLocal !== null) slot.set(lastInt, lastLocal);
    if (intOf(ins) !== null) {
      lastInt = intOf(ins);
      if (lastInt < 0 && radius === null) radius = -lastInt;
    }
    if (localOf(ins) !== null) lastLocal = localOf(ins);
  }
  // Счётчики без тега — пустые или занятые блоки (см. counts): сначала уровнем ниже лозы, потом на её уровне
  const counted = [...slot.values()];
  const air = untagged.filter((l) => counted.includes(l));
  const slotLabel = new Map();
  for (const [idx, local] of slot)
    slotLabel.set(
      idx,
      label.get(local) ??
        (air.indexOf(local) === 0 ? `${counts}_below` : air.indexOf(local) === 1 ? `${counts}_level` : null),
    );

  // 2. Условия черт: переменная суммирует слот массива («x += data[k]»), затем сравнения перед каждой чертой
  const sums = new Map();
  let idx = null;
  let stack = [];
  let pending = [];
  const out = [];
  const operand = (o) => ('num' in o ? o.num : (sums.get(o.local) ?? null));
  for (const ins of instructions(traits.code)) {
    const { op } = ins;
    if (localOf(ins) !== null) stack.push({ local: localOf(ins) });
    else if (intOf(ins) !== null) {
      idx = intOf(ins);
      stack.push({ num: idx });
    } else if (op === 0x2e) {
      // iaload: индекс слота — последнее целое
    } else if (op === 0x60) {
      // iadd
    } else if (storeOf(ins) !== null) {
      if (idx !== null && slotLabel.get(idx)) sums.set(storeOf(ins), slotLabel.get(idx));
      idx = null;
      stack = [];
    } else if (op >= 0xa1 && op <= 0xa4) {
      const [a, b] = stack.splice(-2);
      // Переход — это «пропустить черту»: условие черты обратное
      const cmp = { 0xa4: '>', 0xa2: '<', 0xa1: '>=', 0xa3: '<=' }[op];
      const l = a && operand(a);
      const r = b && operand(b);
      if (l !== null && r !== null && l !== undefined && r !== undefined && typeof l === 'string')
        pending.push({ l, op: cmp, r });
      stack = [];
    } else if (op === 0x99) {
      const [a] = stack.splice(-1);
      if (a && 'local' in a && !sums.has(a.local) && bees) pending.push({ l: 'bees', op: 'is', r: 1 });
      stack = [];
    } else if (op === 0xb2 && /FoodTraits$/.test(cls.ref(ins.index).owner)) {
      if (pending.length) out.push({ trait: cls.ref(ins.index).name, when: pending });
      pending = [];
      stack = [];
    } else stack = [];
  }
  // 3. Ряд: метод выдачи черт идёт от крайнего растения с шагом «move(направление, N)» и складывает счётчики
  // соседей; если в цикле нет своего счётчика (iinc), длина ряда не ограничена
  const tr = instructions(traits.code);
  let step = null;
  tr.forEach((ins, i) => {
    if (ins.op === 0xb6 && cls.ref(ins.index).name === 'move' && i > 0 && intOf(tr[i - 1]) > 0) step = intOf(tr[i - 1]);
  });
  const row =
    step && tr.some((i) => i.op === 0xa7 && i.index > 0x7fff)
      ? { step, unbounded: !tr.some((i) => i.op === 0x84) }
      : undefined;
  return out.length ? { radius, layers: air.length || undefined, row, traits: out } : null;
}

function readCode(classDirs, warnings) {
  const crops = new Map();
  const life = new Map();
  const meta = {};
  /** Настройки модов по умолчанию: { src, type: server|common, keys: [...] } */
  const configs = [];
  for (const { dir, source } of classDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const rel of fs.readdirSync(dir, { recursive: true })) {
      if (!String(rel).endsWith('.class')) continue;
      let cls;
      try {
        cls = parseClass(fs.readFileSync(path.join(dir, rel)));
      } catch (e) {
        warnings.push(`${rel}: ${e.message}`);
        continue;
      }
      if (/\/crop\/CropHelpers$/.test(cls.name)) {
        for (const f of cls.fields) if (typeof f.constant === 'number') meta[f.name] = f.constant;
        // lightValid: «яркость >= N»; getSoilModifier: пары «тег почвы → множитель»
        const light = cls.methods.find((m) => m.name === 'lightValid' && m.code);
        const lv = light && instructions(light.code).find((i) => i.op === 0x10 || i.op === 0x11);
        if (lv) meta.minLight = lv.index;
        const soil = cls.methods.find((m) => m.name === 'getSoilModifier' && m.code);
        if (soil) {
          meta.soilCode = [];
          let tag = null;
          for (const ins of instructions(soil.code)) {
            if (ins.op === 0xb2) tag = cls.ref(ins.index).name;
            else if ((ins.op === 0x12 || ins.op === 0x13) && tag && typeof cls.constant(ins.index) === 'number') {
              meta.soilCode.push({ field: tag, mul: round(cls.constant(ins.index)) });
              tag = null;
            }
          }
        }
        continue;
      }
      const cfg = /\/config\/\w*(Server|Common)Config$/.exec(cls.name);
      if (cfg) {
        // Множители черт еды задаются ключами «trait<Имя>Modifier» в разделе foodTraits (ключ собирается из имени)
        const strings = cls.cp.filter((c) => c?.tag === 8).map((c) => cls.utf(c.a));
        if (strings.includes('foodTraits') && cfg[1] === 'Server') meta.traitConfigSource ??= source;
        const keys = configDefaults(cls);
        if (keys.length) configs.push({ src: source, type: cfg[1].toLowerCase(), keys });
        continue;
      }
      // Где календарь лежит в сохранении мира: имя файла и ключ длины месяца (её меняют командой, не конфигом)
      if (/\/calendar\/CalendarWorldData$/.test(cls.name)) {
        const name = cls.fields.find((f) => f.name === 'NAME')?.constant;
        if (typeof name === 'string') meta.calendarFile = `${name}.dat`;
        continue;
      }
      if (/\/calendar\/Calendar$/.test(cls.name)) {
        const strings = cls.cp.filter((c) => c?.tag === 8).map((c) => cls.utf(c.a));
        if (strings.includes('daysInMonth')) meta.calendarKey = 'daysInMonth';
        if (strings.includes('calendarTickRate')) meta.calendarRateKey = 'calendarTickRate';
        continue;
      }
      // Сколько плодов даёт один сбор: getProductItem() — «new ItemStack(плод)» или «…, Mth.nextInt(rand, a, b)»
      const product = cls.methods.find((m) => m.name === 'getProductItem' && m.code);
      if (product) {
        const nums = [];
        let ranged = false;
        for (const ins of instructions(product.code)) {
          if (ins.op >= 0x02 && ins.op <= 0x08) nums.push(ins.op - 0x03);
          else if (ins.op === 0x10 || ins.op === 0x11) nums.push(ins.index);
          else if (ins.op === 0xb8 && cls.ref(ins.index).name === 'nextInt') ranged = true;
        }
        (meta.pick ??= {})[cls.name.split('/').pop()] =
          ranged && nums.length >= 2 ? [nums.at(-2), nums.at(-1)] : [nums.at(-1) ?? 1, nums.at(-1) ?? 1];
      }
      // Растение со своим счётчиком роста (виноград Firmalife): сезоны заданы кодом «если месяц X — состояние Y»,
      // прирост за обновление — константами, климат — ссылкой на диапазон (FLClimateRanges.GRAPES)
      const tick = cls.methods.find((m) => m.name === 'updateTick' && m.code);
      if (tick) {
        const g = { byMonth: {}, base: null, floats: [], range: null, tempOnly: false };
        let month = null;
        for (const ins of instructions(tick.code)) {
          if (ins.op === 0xb2) {
            const r = cls.ref(ins.index);
            if (/\/calendar\/Month$/.test(r.owner)) month = r.name;
            else if (/\/Lifecycle$/.test(r.owner)) {
              if (month) g.byMonth[month] = r.name;
              else if (r.name !== 'DORMANT') g.base = r.name;
              month = null;
            } else if (/ClimateRanges$/.test(r.owner)) g.range = r.name.toLowerCase();
          } else if (ins.op === 0x12 || ins.op === 0x13) {
            const v = cls.constant(ins.index);
            if (typeof v === 'number') g.floats.push(round(v));
          } else if (ins.op === 0xb6 && cls.ref(ins.index).name === 'checkTemperature') g.tempOnly = true;
        }
        if (g.range && Object.keys(g.byMonth).length) {
          const interval = cls.fields.find((f) => f.name === 'UPDATE_INTERVAL')?.constant;
          life.set(g.range, {
            lifeByMonth: g.byMonth,
            lifeBase: g.base ?? 'HEALTHY',
            kind: null,
            // Прирост за одно обновление: постоянная часть + случайная (rand × второй коэффициент)
            grow:
              g.floats.length >= 2 && typeof interval === 'number'
                ? { min: g.floats[0], max: round(g.floats[0] + g.floats[1]), interval }
                : undefined,
            tempOnly: g.tempOnly || undefined,
            quality: qualityRules(cls) ?? undefined,
            code: source,
          });
        }
        continue;
      }
      // Почему грядка теплицы не растёт: getInvalidReason() возвращает ключи сообщений мода
      const reason = cls.methods.find((m) => m.name === 'getInvalidReason' && m.code);
      if (reason && !meta.greenhouseReasons) {
        const keys = [];
        for (const ins of instructions(reason.code)) {
          if (ins.op !== 0x12 && ins.op !== 0x13) continue;
          const v = cls.constant(ins.index);
          if (typeof v === 'string' && /^[a-z_]+$/.test(v) && !keys.includes(v)) keys.push(v);
        }
        if (keys.length) meta.greenhouseReasons = { ns: cls.name.split('/')[2], keys };
      }
      greenhouseWater(cls, (meta.greenhouseWater ??= {}));
      // Лоза (виноград): блоки, реализующие общий интерфейс роста, — сколько стадий у ростка, куда растёт, сколько
      // ягод за сбор. Признаки берутся из инструкций методов advance() и useWithoutItem()
      if (cls.fields.some((f) => f.name === 'LIFECYCLE') && cls.methods.some((m) => m.name === 'advance' && m.code)) {
        const vine = (meta.vine ??= {});
        const adv = instructions(cls.methods.find((m) => m.name === 'advance').code);
        const refs = adv
          .filter((i) => [0xb2, 0xb4, 0xb6, 0xb7, 0xb8, 0xb9].includes(i.op))
          .map((i) => cls.ref(i.index));
        const stageInit = instructions(cls.methods.find((m) => m.name === '<clinit>')?.code ?? Buffer.alloc(0))
          .filter((i) => i.op === 0xb2)
          .map((i) => /^STAGE_(\d+)$/.exec(cls.ref(i.index).name)?.[1])
          .find(Boolean);
        if (stageInit) vine.stages = Number(stageInit) + 1;
        if (
          refs.some((r) => r.name === 'above') &&
          adv.some((i) => i.op === 0xc1 && /String/.test(cls.className(i.index)))
        )
          vine.up = true;
        if (refs.some((r) => r.name === 'relative') && refs.some((r) => /convert/i.test(r.name))) vine.sideways = true;
        if (refs.some((r) => /fluff/i.test(r.name))) vine.canopy = true;
        const use = cls.methods.find((m) => m.name === 'useWithoutItem' && m.code);
        if (use) {
          const u = instructions(use.code)
            .filter((i) => [0xb2, 0xb6, 0xb8, 0xb9].includes(i.op))
            .map((i) => cls.ref(i.index));
          // «плодоносит → выдать предмет → вернуть в обычное состояние»: один плод с блока за сезон
          if (u.some((r) => r.name === 'FRUITING') && u.some((r) => r.name === 'getDefaultInstance')) vine.pick = 1;
          if (u.some((r) => r.name === 'FRUITING') && u.some((r) => r.name === 'HEALTHY')) vine.oncePerSeason = true;
        }
        continue;
      }
      // Теплица: класс с теми же константами роста, что CropHelpers, но свой (Firmalife Mechanics)
      const gf = cls.fields.find((f) => f.name === 'GROWTH_FACTOR' && typeof f.constant === 'number');
      const ngf = cls.fields.find((f) => f.name === 'NUTRIENT_GROWTH_FACTOR' && typeof f.constant === 'number');
      if (gf && ngf) {
        meta.greenhouseGrowth = { GROWTH_FACTOR: gf.constant, NUTRIENT_GROWTH_FACTOR: ngf.constant };
        continue;
      }
      // Черты еды и их множитель порчи по умолчанию: перечисление FoodTraits.Default(имя, множитель)
      if (/FoodTraits\$Default$/.test(cls.name) && isEnum(cls)) {
        meta.foodTraits = {};
        for (const c of enumConstants(cls)) {
          const mod = c.args.find((a) => typeof a === 'number');
          if (typeof mod === 'number') meta.foodTraits[c.name] = round(mod);
        }
        continue;
      }
      if (!isEnum(cls)) {
        // Сезоны вне перечислений: «static final Lifecycle[] BANANA_STAGES» → banana
        for (const [field, value] of clinitValues(cls).statics) {
          const name = field.toLowerCase().replace(/_stages$/, '');
          if (isLifecycle(value) && name !== field.toLowerCase() && !life.has(name))
            life.set(name, { life: value.array.map(fieldName), kind: null, code: source });
        }
        continue;
      }
      const constants = enumConstants(cls);
      if (/\/calendar\/Month$/.test(cls.name)) {
        meta.months = constants.map((c) => c.name);
        continue;
      }
      const floats = cls.fields.filter((f) => f.desc === 'F').map((f) => f.name);
      if (NPK.every((n) => floats.includes(n))) {
        // Порядок полей в классе = порядок чисел в конструкторе; проверяем, что это именно N, P, K
        const order = NPK.map((n) => floats.indexOf(n));
        if (order.join() !== '0,1,2') warnings.push(`${cls.name}: поля удобрений в неожиданном порядке — пропускаю`);
        else
          for (const c of constants) {
            const types = argTypes(c.desc).slice(2);
            const nums = c.args.filter((_, i) => types[i] === 'F');
            if (nums.length !== 3 || nums.some((x) => typeof x !== 'number')) continue;
            crops.set(c.name.toLowerCase(), {
              npk: nums.map(round),
              stages: c.args.filter((v, i) => types[i] === 'I' && typeof v === 'number'),
              block: cropBlock(cls, c),
              code: source,
            });
          }
        continue;
      }
      for (const c of constants) {
        const arr = c.args.find(isLifecycle);
        if (!arr) continue;
        const named = namedArgs(cls, c);
        const ticks = named.defaultTicksToGrow;
        life.set(c.name.toLowerCase(), {
          life: arr.array.map(fieldName),
          kind: /Tree/.test(cls.name) ? 'tree' : /Bush/.test(cls.name) ? 'bush' : null,
          growDays: typeof named.defaultTicksToGrow__raw === 'number' ? named.defaultTicksToGrow__raw : undefined,
          growTicks: typeof ticks === 'number' ? ticks : undefined,
          maxHeight: typeof named.maxHeight === 'number' ? named.maxHeight : undefined,
          spreading: /Spreading/.test(cls.name) || undefined,
          code: source,
        });
      }
    }
  }
  return { crops, life, meta, configs };
}

// ---------------------------------------------------------------- урожай и дикие формы (данные)

/** Диапазон количества из loot-функции set_count: число, uniform или tfc:crop_yield_uniform (зависит от ухода) */
function countRange(c) {
  if (typeof c === 'number') return { min: c, max: c, byYield: false };
  if (!c || typeof c !== 'object') return { min: 1, max: 1, byYield: false };
  const lo = countRange(c.min ?? 1);
  const hi = countRange(c.max ?? c.min ?? 1);
  return { min: lo.min, max: hi.max, byYield: /crop_yield/.test(c.type ?? '') || lo.byYield || hi.byYield };
}

/**
 * Что падает с созревшего растения: по каждому пулу берём предметы (условия считаем выполненными — растение
 * спелое, инструмент подходящий), количества пулов складываются. Условный предмет может не выпасть — минимум 0.
 */
function lootDrops(json) {
  const total = new Map();
  for (const pool of json?.pools ?? []) {
    const inPool = new Map();
    const walk = (entry) => {
      if (!entry || typeof entry !== 'object') return;
      for (const ch of entry.children ?? []) walk(ch);
      if (entry.type !== 'minecraft:item' || typeof entry.name !== 'string') return;
      const set = (entry.functions ?? []).find((f) => /set_count$/.test(f.function ?? ''));
      const r = countRange(set ? set.count : 1);
      const cur = inPool.get(entry.name);
      // Альтернативы одного пула — берём самый щедрый вариант
      if (!cur || r.max > cur.max) inPool.set(entry.name, r);
    };
    for (const e of pool.entries ?? []) walk(e);
    for (const [item, r] of inPool) {
      const t = total.get(item) ?? { min: 0, max: 0, byYield: false };
      total.set(item, { min: t.min + r.min, max: t.max + r.max, byYield: t.byYield || r.byYield });
    }
  }
  return total;
}

/** Размещение в мире: климат (tfc:climate) и редкость из placed_feature; имя файла без папок → данные */
function readPlacements(dataDirs, parse) {
  const out = new Map();
  for (const { dir } of dataDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const ns of fs.readdirSync(dir)) {
      const base = path.join(dir, ns, 'worldgen', 'placed_feature', 'plant');
      if (!fs.existsSync(base)) continue;
      for (const rel of fs.readdirSync(base, { recursive: true })) {
        if (!String(rel).endsWith('.json')) continue;
        const j = parse(fs.readFileSync(path.join(base, String(rel)), 'utf8'));
        const placement = Array.isArray(j?.placement) ? j.placement : [];
        const climate = placement.find((p) => /(^|:)climate$/.test(p?.type ?? ''));
        if (!climate) continue;
        const rarity = placement.find((p) => /rarity_filter$/.test(p?.type ?? ''))?.chance;
        const pick = (k) => (typeof climate[k] === 'number' ? climate[k] : undefined);
        const w = {
          minT: pick('min_temperature'),
          maxT: pick('max_temperature'),
          minW: pick('min_groundwater') ?? pick('min_rainfall'),
          maxW: pick('max_groundwater') ?? pick('max_rainfall'),
          minF: pick('min_forest'),
          maxF: pick('max_forest'),
          rarity: typeof rarity === 'number' ? rarity : undefined,
        };
        const key = String(rel).slice(0, -5).split(path.sep).join('/');
        out.set(`${ns}:${key}`, Object.fromEntries(Object.entries(w).filter(([, v]) => v !== undefined)));
      }
    }
  }
  return out;
}

function readLoot(dataDirs, parse, ns, rel) {
  // Поздние источники перекрывают ранние, как датапаки
  for (const { dir } of [...dataDirs].reverse()) {
    const file = path.join(dir, ns, 'loot_table', 'blocks', `${rel}.json`);
    if (fs.existsSync(file)) return parse(fs.readFileSync(file, 'utf8'));
  }
  return null;
}

/**
 * Растения теплицы Firmalife: data/<ns>/firmalife/plantable/<имя>.json — что сажать, в какую грядку, какой нужен
 * уровень теплицы, расход N/P/K и что вырастет. Это отдельная механика: климат и сезоны на неё не действуют.
 */
function readPlantables(dataDirs, parse, have) {
  const out = new Map();
  const id = (v) => (typeof v === 'string' ? v : (v?.id ?? v?.item ?? null));
  for (const { dir, source } of dataDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const ns of fs.readdirSync(dir)) {
      const base = path.join(dir, ns, 'firmalife', 'plantable');
      if (!fs.existsSync(base)) continue;
      for (const file of fs.readdirSync(base)) {
        if (!file.endsWith('.json')) continue;
        const j = parse(fs.readFileSync(path.join(base, file), 'utf8'));
        if (!j || typeof j !== 'object') continue;
        const n = j.nutrient ?? {};
        const crop = id(j.crop);
        const seed = id(j.seed) ?? id(j.ingredient);
        out.set(`${ns}:${file.slice(0, -5)}`, {
          i: `${ns}:${file.slice(0, -5)}`,
          n: file.slice(0, -5),
          src: source,
          crop: crop && have.has(crop) ? crop : (crop ?? undefined),
          cropCount: typeof j.crop?.count === 'number' ? j.crop.count : undefined,
          seed: seed ?? undefined,
          planter: typeof j.planter === 'string' ? j.planter : undefined,
          tier: typeof j.tier === 'number' ? j.tier : undefined,
          stages: typeof j.stages === 'number' ? j.stages : undefined,
          extraSeed: typeof j.extra_seed_chance === 'number' ? j.extra_seed_chance : undefined,
          npk: NPK.every((k) => typeof n[k] === 'number') ? NPK.map((k) => round(n[k])) : undefined,
        });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.i.localeCompare(b.i));
}

/** Уровни теплицы Firmalife: data/<ns>/firmalife/greenhouse/<материал>.json — { tier, ingredient: тег блоков стен } */
function readGreenhouseTiers(dataDirs, parse, translate) {
  const out = new Map();
  for (const { dir } of dataDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const ns of fs.readdirSync(dir)) {
      const base = path.join(dir, ns, 'firmalife', 'greenhouse');
      if (!fs.existsSync(base)) continue;
      for (const file of fs.readdirSync(base)) {
        if (!file.endsWith('.json')) continue;
        const j = parse(fs.readFileSync(path.join(base, file), 'utf8'));
        if (typeof j?.tier !== 'number') continue;
        const key = typeof j.translation_key === 'string' ? j.translation_key : j.translation_key?.translate;
        const name = key ? translate(key) : {};
        out.set(`${ns}:${file.slice(0, -5)}`, {
          i: `${ns}:${file.slice(0, -5)}`,
          tier: j.tier,
          e: name.en ?? file.slice(0, -5).replaceAll('_', ' '),
          ...(name.ru && name.ru !== name.en ? { r: name.ru } : {}),
          ...(typeof j.ingredient === 'string' ? { walls: j.ingredient } : {}),
        });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.tier - b.tier);
}

// ---------------------------------------------------------------- сборка

export function buildBotany(dataDirs, parse, items, recipes, translate = () => ({})) {
  const have = new Set(items.map((i) => i.i));
  const first = (...ids) => ids.find((id) => have.has(id));
  const warnings = [];
  const out = new Map();
  for (const { dir, source } of dataDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const ns of fs.readdirSync(dir)) {
      for (const group of ['crop', 'plant']) {
        const base = path.join(dir, ns, 'tfc', 'climate_range', group);
        if (!fs.existsSync(base)) continue;
        for (const file of fs.readdirSync(base)) {
          if (!file.endsWith('.json')) continue;
          const j = parse(fs.readFileSync(path.join(base, file), 'utf8'));
          if (!j || typeof j !== 'object') continue;
          const name = file.slice(0, -5);
          const r = {};
          for (const [from, to] of Object.entries(FIELDS)) if (typeof j[from] === 'number') r[to] = j[from];
          const kind =
            group === 'crop' ? 'crop' : name.endsWith('_bush') ? 'bush' : name.endsWith('_tree') ? 'tree' : 'plant';
          const n = name.replace(/_(bush|tree)$/, '');
          out.set(`${ns}:${name}`, {
            i: `${ns}:${name}`,
            k: kind,
            n,
            src: source,
            r,
            product: first(`${ns}:food/${n}`, `${ns}:${n}`),
            seed: group === 'crop' ? first(`${ns}:seeds/${n}`) : undefined,
            plant: kind === 'bush' ? first(`${ns}:plant/${name}`) : undefined,
          });
        }
      }
    }
  }

  // Классы лежат рядом с data/ в кеше jar (см. prepareJar)
  const code = readCode(
    dataDirs.map((d) => ({ dir: path.join(d.dir, '..', 'classes'), source: d.source })),
    warnings,
  );
  for (const l of code.life.values()) {
    if (!l.lifeByMonth) continue;
    if (code.meta.months) l.life = code.meta.months.map((m) => l.lifeByMonth[m] ?? l.lifeBase);
    delete l.lifeByMonth;
    delete l.lifeBase;
  }
  // Признаки лозы относятся к растению со своим счётчиком роста из того же мода
  if (code.meta.vine) for (const l of code.life.values()) if (l.grow) l.vine = code.meta.vine;
  const usedCrops = new Set();
  const usedLife = new Set();
  for (const e of out.values()) {
    const c = e.k === 'crop' ? code.crops.get(e.n) : undefined;
    if (c) {
      Object.assign(e, c);
      usedCrops.add(e.n);
    }
    const l = code.life.get(e.n);
    if (l && (!l.kind || e.k === 'plant' || l.kind === e.k)) {
      const { kind: _kind, ...rest } = l;
      Object.assign(e, rest);
      usedLife.add(e.n);
    }
  }
  // Урожай (loot-таблицы) и дикие формы (размещение в мире) — из данных
  const placements = readPlacements(dataDirs, parse);
  for (const e of out.values()) {
    const [ns, name] = e.i.split(':');
    // Урожай из loot-таблицы есть только у культур: ягоды и фрукты собирают рукой (это код, а не loot)
    if (e.k === 'crop') {
      const drops = lootDrops(readLoot(dataDirs, parse, ns, `crop/${e.n}`));
      const list = [...drops]
        .filter(([item]) => item === e.product || item === e.seed || /:(food|seeds)\//.test(item))
        .map(([item, r]) => ({ item, min: r.min, max: r.max, ...(r.byYield ? { byYield: true } : {}) }));
      if (list.length) e.drops = list;
    }
    const wildAt =
      e.k === 'crop'
        ? [`plant/wild_crop/${e.n}_patch`, `plant/wild_crop/${e.n}`]
        : [`plant/${name}_patch`, `plant/${name}`, `plant/${e.n}_patch`, `plant/${e.n}`];
    for (const rel of wildAt) {
      const w = placements.get(`${ns}:${rel.replace(/^plant\//, '')}`);
      if (w && Object.keys(w).length) {
        e.wild = w;
        break;
      }
    }
  }

  // Теплица Firmalife; заодно плод тем растениям, у которых он не нашёлся по id (какао → какао-бобы)
  const greenhouse = readPlantables(dataDirs, parse, have);
  const greenhouseTiers = readGreenhouseTiers(dataDirs, parse, translate);
  for (const e of out.values()) {
    if (e.product) continue;
    const g = greenhouse.find((x) => (x.n === e.n || x.n.endsWith(`_${e.n}`)) && x.crop && have.has(x.crop));
    if (g) e.product = g.crop;
  }

  // Почва: поле TagKey из кода (VERY_RICH_FARMLAND) → тег блоков с тем же именем в данных и его состав
  const soil = [];
  for (const sc of code.meta.soilCode ?? []) {
    const tagName = sc.field.toLowerCase();
    for (const { dir } of dataDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const ns of fs.readdirSync(dir)) {
        const file = path.join(dir, ns, 'tags', 'block', `${tagName}.json`);
        if (!fs.existsSync(file)) continue;
        const j = parse(fs.readFileSync(file, 'utf8'));
        const blocks = (j?.values ?? []).map((v) => (typeof v === 'string' ? v : v?.id)).filter(Boolean);
        const cur = soil.find((x) => x.tag === `${ns}:${tagName}`);
        if (cur) cur.blocks.push(...blocks.filter((b) => !cur.blocks.includes(b)));
        else soil.push({ tag: `${ns}:${tagName}`, mul: sc.mul, blocks });
      }
    }
  }
  if (code.meta.soilCode?.length && !soil.length) warnings.push('теги почв из getSoilModifier не найдены в данных');

  // Куда идёт урожай: рецепты, где плод стоит на входе — сам или через тег предметов
  const tags = itemTags(dataDirs, parse);
  const byProduct = new Map();
  for (const e of out.values()) if (e.product) byProduct.set(e.product, e);
  const inTags = new Map();
  for (const [tag, members] of tags)
    for (const m of members) if (byProduct.has(m)) inTags.set(`#${tag}`, [...(inTags.get(`#${tag}`) ?? []), m]);
  const uses = new Map();
  for (const [, r] of recipes ?? []) {
    const { inputs, outputs } = recipeRefs(r.json);
    const hit = new Set();
    for (const i of inputs) {
      if (byProduct.has(i)) hit.add(i);
      for (const m of inTags.get(i) ?? []) hit.add(m);
    }
    if (!hit.size) continue;
    const outs = outputs.filter((o) => !o.startsWith('#') && have.has(o));
    for (const product of hit) {
      const u = uses.get(product) ?? { count: 0, outs: new Map() };
      u.count++;
      for (const o of outs) if (o !== product) u.outs.set(o, (u.outs.get(o) ?? 0) + 1);
      uses.set(product, u);
    }
  }
  // Блюда-конструкторы (сэндвичи, супы, салаты) принимают почти любую еду через тег и засоряют список:
  // предмет, который получается из многих разных растений, не считаем «продуктом из этого плода»
  const GENERIC_FROM = 5;
  const madeFrom = new Map();
  for (const u of uses.values()) for (const o of u.outs.keys()) madeFrom.set(o, (madeFrom.get(o) ?? 0) + 1);
  for (const [product, u] of uses) {
    const e = byProduct.get(product);
    // Сначала продукты того же мода, что и растение (мука, масло, волокно), блюда других модов — следом
    const ns = product.split(':')[0];
    const own = (id) => (id.startsWith(`${ns}:`) ? 0 : 1);
    const specific = [...u.outs].filter(([id]) => madeFrom.get(id) < GENERIC_FROM);
    e.uses = {
      recipes: u.count,
      generic: u.outs.size - specific.length,
      items: specific
        .sort((a, b) => own(a[0]) - own(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([id]) => id)
        .slice(0, 24),
    };
  }

  const lostCrops = [...code.crops.keys()].filter((n) => !usedCrops.has(n));
  const lostLife = [...code.life.keys()].filter((n) => !usedLife.has(n));
  if (lostCrops.length) warnings.push(`в коде есть культуры без climate_range: ${lostCrops.join(', ')}`);
  if (lostLife.length) warnings.push(`в коде есть сезоны без climate_range: ${lostLife.join(', ')}`);
  if (!code.crops.size) warnings.push('перечисление культур (nitrogen/phosphorous/potassium) не найдено');
  if (!code.life.size) warnings.push('перечисления с сезонами (Lifecycle[]) не найдены');
  if (!code.meta.months) warnings.push('порядок месяцев (calendar/Month) не найден');

  // Настройки, от которых зависят сроки: ключ и значение по умолчанию из кода; сервер может их переопределить
  const config = {};
  for (const name of CONFIG_KEYS) {
    for (const c of code.configs) {
      const k = c.keys.find((x) => x.field === name || x.key.split('.').pop() === name);
      if (!k || config[name]) continue;
      const ns = [...out.values()].find((e) => e.src === c.src)?.i.split(':')[0];
      config[name] = { key: k.key, default: k.default, file: ns ? `${ns}-${c.type}.toml` : null, type: c.type };
    }
    if (!config[name]) warnings.push(`настройка ${name} в коде модов не найдена`);
  }
  // Срок роста саженца задаётся отдельным ключом на каждое дерево: «<имя>SaplingGrowthTicks» в том же разделе,
  // что и общий множитель (в коде ключ собирается из имени дерева, поэтому здесь — шаблон)
  for (const c of code.configs) {
    const perTree = c.keys.find((k) => /^SaplingGrowthTicks$/.test(k.key.split('.').pop()) && /%s/.test(k.comment));
    const section = config.saplingGrowthModifier?.key.split('.').slice(0, -1).join('.');
    if (perTree && section && !config.saplingGrowthTicks)
      config.saplingGrowthTicks = {
        key: `${section}.{name}SaplingGrowthTicks`,
        default: null,
        file: config.saplingGrowthModifier.file,
        type: c.type,
      };
  }
  // Длина месяца в уже созданном мире хранится в сохранении (npm run world): SavedData → data.calendar.<ключ>
  if (config.defaultMonthLength) {
    if (code.meta.calendarFile && code.meta.calendarKey)
      config.defaultMonthLength.world = { file: code.meta.calendarFile, key: `data.calendar.${code.meta.calendarKey}` };
    else warnings.push('где календарь лежит в сохранении мира (CalendarWorldData / daysInMonth) — не найдено');
  }
  // Множитель порчи черты еды аддона: foodTraits.trait<Имя>Modifier в его серверном конфиге
  if (code.meta.traitConfigSource && config.greenhouseGrowthModifier)
    config.foodTraitModifier = {
      key: 'foodTraits.trait{name}Modifier',
      default: null,
      file: config.greenhouseGrowthModifier.file,
      type: 'server',
    };
  // Скорость календаря в мире: calendarTickRate = 20 / длина календарных суток в минутах (Calendar.resetToDefault)
  if (code.meta.calendarFile && code.meta.calendarRateKey)
    config.calendarTickRate = {
      key: '',
      default: null,
      file: null,
      type: 'world',
      world: { file: code.meta.calendarFile, key: `data.calendar.${code.meta.calendarRateKey}` },
    };

  // Причины простоя грядки — словами самого мода (перевод из его lang), без цветовых кодов
  const reasons = (code.meta.greenhouseReasons?.keys ?? [])
    .map((k) => {
      const t = translate(`${code.meta.greenhouseReasons.ns}.greenhouse.${k}`);
      const clean = (x) => x?.replace(/\u00a7./g, '');
      return t.en || t.ru
        ? { key: k, e: clean(t.en ?? t.ru), ...(t.ru && t.ru !== t.en ? { r: clean(t.ru) } : {}) }
        : null;
    })
    .filter(Boolean);

  // Полив: названия предметов — из библиотеки, причина «нужна труба» — из перевода мода
  let water = null;
  const gw = code.meta.greenhouseWater;
  if (gw && (gw.can?.add || gw.sprinkler?.add)) {
    const ns = code.meta.greenhouseReasons?.ns;
    const itemOf = (id) => (ns && have.has(`${ns}:${id}`) ? `${ns}:${id}` : undefined);
    const { cls: _cls, ...can } = gw.can ?? {};
    water = {
      ...gw,
      ...(gw.can?.add ? { can: { ...can, item: itemOf('watering_can') } } : { can: undefined }),
      zones: (gw.zones ?? []).map((z) => ({ ...z, item: itemOf(z.id) })),
      ...(gw.sprinkler
        ? { sprinkler: { ...gw.sprinkler, sources: gw.sprinkler.sources.map((x) => itemOf(x) ?? x) } }
        : {}),
    };
    if (!gw.can?.add) warnings.push('полив теплицы: лейка (onUseTick → addWater) не найдена');
    if (!gw.sprinkler?.add) warnings.push('полив теплицы: разбрызгиватель (serverTick → addWater) не найден');
  }

  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  return {
    meta: {
      ...(code.meta.months ? { months: code.meta.months } : {}),
      ...pick(code.meta, [
        'GROWTH_FACTOR',
        'NUTRIENT_CONSUMPTION',
        'NUTRIENT_GROWTH_FACTOR',
        'UPDATE_INTERVAL',
        'EXPIRY_LIMIT',
        'pick',
        'minLight',
        'greenhouseGrowth',
        'foodTraits',
      ]),
      ...(water ? { greenhouseWater: water } : {}),
      ...(soil.length ? { soil } : {}),
      ...(greenhouseTiers.length ? { greenhouseTiers } : {}),
      ...(reasons.length ? { greenhouseReasons: reasons } : {}),
      config,
    },
    configs: code.configs,
    entries: [...out.values()].sort((a, b) => a.i.localeCompare(b.i)),
    greenhouse,
    warnings,
  };
}

export function writeBotany(dataDirs, parse, items, recipes, translate, outFile) {
  const { warnings, configs, ...data } = buildBotany(dataDirs, parse, items, recipes, translate);
  fs.writeFileSync(outFile, JSON.stringify(data));
  // Все настройки модов по умолчанию — отдельным файлом (сайту пока нужны только три, они продублированы в meta.config)
  fs.writeFileSync(path.join(path.dirname(outFile), 'config-defaults.json'), JSON.stringify(configs));
  const by = (k) => data.entries.filter((e) => e.k === k).length;
  return {
    crops: by('crop'),
    bushes: by('bush'),
    trees: by('tree'),
    other: by('plant'),
    npk: data.entries.filter((e) => e.npk).length,
    life: data.entries.filter((e) => e.life).length,
    configKeys: configs.reduce((n, c) => n + c.keys.length, 0),
    drops: data.entries.filter((e) => e.drops).length,
    wild: data.entries.filter((e) => e.wild).length,
    uses: data.entries.filter((e) => e.uses).length,
    greenhouse: data.greenhouse.length,
    warnings,
  };
}
