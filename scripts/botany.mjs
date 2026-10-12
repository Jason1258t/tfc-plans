/**
 * Ботаника → public/botany.json: культуры, ягодные кусты и фруктовые деревья TFC и аддонов.
 *
 * Из данных (data/<ns>/tfc/climate_range/{crop,plant}/<имя>.json): диапазоны температуры и влажности.
 * Из кода модов (.class, разбор — scripts/classfile.mjs, без JDK):
 *   - перечисление культур (поля nitrogen/phosphorous/potassium): расход N/P/K, число стадий, класс блока культуры;
 *   - перечисления с массивом Lifecycle по месяцам (кусты, деревья): сезоны, дни роста саженца, высота куста;
 *   - CropHelpers: константы скорости роста и расхода удобрений; calendar/Month: порядок месяцев.
 * Ничего не зашито руками: имена полей, значения и связи берутся из jar текущей сборки. Если мод переименует
 * поле или сменит устройство перечисления, соответствующие данные просто пропадут, а сборка сообщит об этом.
 *
 *   { meta: { months, growthFactor, nutrientConsumption, nutrientGrowthFactor, … },
 *     entries: [{ i, k: crop|bush|tree|plant, n, src, r: { minT, maxT, minH, maxH }, product?, seed?, plant?,
 *                 npk?: [N, P, K], stages?: [int…], block?: 'ClimbingCropBlock',
 *                 life?: ['DORMANT'|'HEALTHY'|'FLOWERING'|'FRUITING' × 12], growDays?, maxHeight?, code?: источник }] }
 */
import fs from 'node:fs';
import path from 'node:path';
import { argTypes, clinitValues, enumConstants, instructions, lambdaTargets, parseClass } from './classfile.mjs';

const FIELDS = { min_temperature: 'minT', max_temperature: 'maxT', min_hydration: 'minH', max_hydration: 'maxH' };
const NPK = ['nitrogen', 'phosphorous', 'potassium'];

/** Какие классы jar сохранять в кеш для разбора (вызывается из build-items при распаковке) */
export function isBotanyClass(entryName, data) {
  if (/\/crop\/CropHelpers\.class$|\/calendar\/Month\.class$/.test(entryName)) return true;
  return data.includes('plant/fruit/Lifecycle') || data.includes('phosphorous');
}

// ---------------------------------------------------------------- код модов

const isEnum = (cls) => cls.superName === 'java/lang/Enum';
const isLifecycle = (v) => v?.array && /\/Lifecycle$/.test(v.type ?? '');
const fieldName = (v) => (v && typeof v === 'object' && v.field ? v.field.name : null);
const round = (x) => Math.round(x * 1000) / 1000;

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
  const blocks = [
    ...new Set(
      lambdaTargets(cls, ctor)
        .filter((t) => t.name === 'create' && /CropBlock$/.test(t.owner))
        .map((t) => t.owner.split('/').pop())
        .filter((n) => !/^(Dead|Wild)|Dead|Wild/.test(n)),
    ),
  ];
  if (blocks.length <= 1) return blocks[0] ?? null;
  // Две фабрики на выбор по булеву аргументу конструктора (нужна ли опора): истина — первая
  const types = argTypes(constant.desc).slice(2);
  const flag = constant.args[types.indexOf('Z')];
  return flag === 0 ? blocks[1] : blocks[0];
}

function readCode(classDirs, warnings) {
  const crops = new Map();
  const life = new Map();
  const meta = {};
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
  return { crops, life, meta };
}

// ---------------------------------------------------------------- сборка

export function buildBotany(dataDirs, parse, items) {
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
  const lostCrops = [...code.crops.keys()].filter((n) => !usedCrops.has(n));
  const lostLife = [...code.life.keys()].filter((n) => !usedLife.has(n));
  if (lostCrops.length) warnings.push(`в коде есть культуры без climate_range: ${lostCrops.join(', ')}`);
  if (lostLife.length) warnings.push(`в коде есть сезоны без climate_range: ${lostLife.join(', ')}`);
  if (!code.crops.size) warnings.push('перечисление культур (nitrogen/phosphorous/potassium) не найдено');
  if (!code.life.size) warnings.push('перечисления с сезонами (Lifecycle[]) не найдены');
  if (!code.meta.months) warnings.push('порядок месяцев (calendar/Month) не найден');

  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  return {
    meta: {
      ...(code.meta.months ? { months: code.meta.months } : {}),
      ...pick(code.meta, ['GROWTH_FACTOR', 'NUTRIENT_CONSUMPTION', 'NUTRIENT_GROWTH_FACTOR', 'UPDATE_INTERVAL']),
    },
    entries: [...out.values()].sort((a, b) => a.i.localeCompare(b.i)),
    warnings,
  };
}

export function writeBotany(dataDirs, parse, items, outFile) {
  const { warnings, ...data } = buildBotany(dataDirs, parse, items);
  fs.writeFileSync(outFile, JSON.stringify(data));
  const by = (k) => data.entries.filter((e) => e.k === k).length;
  return {
    crops: by('crop'),
    bushes: by('bush'),
    trees: by('tree'),
    other: by('plant'),
    npk: data.entries.filter((e) => e.npk).length,
    life: data.entries.filter((e) => e.life).length,
    warnings,
  };
}
