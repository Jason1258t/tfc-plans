/**
 * Электричество: Create Electro Energetics (вольты, амперы, ватты), Immersive Engineering (FE/t) и их стык с
 * кинетикой Create (SU). Всё, что мод задаёт кодом, читается из байткода: значения настроек по умолчанию
 * (конфиг EE — на ConfigBase из catnip, а не на ModConfigSpec) и коэффициенты в формулах генератора, двигателя
 * и преобразователя. Сайт поверх них берёт настройки сервера из Firestore (config/*__electroenergetics-server.toml).
 *
 *   buildPower(jarPaths) → { data, warnings }  — data идёт в public/power.json
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { argTypes, instructions, parseClass } from './classfile.mjs';
import { configDefaults } from './config-defaults.mjs';

const EE = 'com/george_vi/electroenergetics';
const IE = 'blusunrize/immersiveengineering';

function classFrom(jar, name) {
  const r = spawnSync('unzip', ['-p', jar, `${name}.class`], { maxBuffer: 16 << 20 });
  if (r.status !== 0 || !r.stdout?.length) return null;
  try {
    return parseClass(r.stdout);
  } catch {
    return null;
  }
}

/** Числовые и строковые константы метода по порядку (ldc, *const, bipush/sipush) */
function constants(cls, method) {
  const m = cls?.methods.find((x) => x.name === method && x.code);
  if (!m) return null;
  const out = [];
  for (const ins of instructions(m.code)) {
    const { op } = ins;
    if (op >= 0x02 && op <= 0x08) out.push(op - 0x03);
    else if (op === 0x0b || op === 0x0c || op === 0x0d) out.push(op - 0x0b);
    else if (op === 0x0e || op === 0x0f) out.push(op - 0x0e);
    else if (op === 0x10 || op === 0x11) out.push(ins.index);
    else if (op === 0x12 || op === 0x13 || op === 0x14) out.push(cls.constant(ins.index));
  }
  return out;
}

/** Имя раздела конфига catnip: getName() { return "rotor"; } */
const sectionName = (cls) => constants(cls, 'getName')?.find((c) => typeof c === 'string') ?? null;

/**
 * Настройки ConfigBase (catnip, как у Create): в конструкторе «поле = f(по умолчанию, мин, [макс], "ключ", комментарии…)».
 * Между двумя putfield берём числа до первой строки (по умолчанию — первое) и саму строку как ключ.
 */
function catnipDefaults(cls, prefix) {
  const init = cls.methods.find((m) => m.name === '<init>' && m.code);
  const out = [];
  let consts = [];
  for (const ins of instructions(init?.code ?? Buffer.alloc(0))) {
    const { op } = ins;
    if (op >= 0x02 && op <= 0x08) consts.push(op - 0x03);
    else if (op >= 0x0b && op <= 0x0d) consts.push(op - 0x0b);
    else if (op === 0x0e || op === 0x0f) consts.push(op - 0x0e);
    else if (op === 0x10 || op === 0x11) consts.push(ins.index);
    else if (op === 0x12 || op === 0x13 || op === 0x14) consts.push(cls.constant(ins.index));
    else if (op === 0xb5) {
      const r = cls.ref(ins.index);
      const at = consts.findIndex((c) => typeof c === 'string');
      const key = at >= 0 ? consts[at] : null;
      // Вложенные разделы («Alternator Values») — с пробелами, это не ключи
      if (key && /^\w+$/.test(key) && at > 0) {
        const nums = consts.slice(0, at);
        const bool = /ConfigBool;$/.test(r.desc);
        out.push({ key: prefix ? `${prefix}.${key}` : key, field: r.name, default: bool ? nums[0] === 1 : nums[0] });
      }
      consts = [];
    }
  }
  return out;
}

/**
 * Виды проводов EE: в CEEWireTypes.<clinit> «register("copper", () -> new WireType.Builder(…).resistance(cfg::get)
 * .maxInsulationVoltage(…).maxTemperature(() -> 3540).maxLength(cfg::get)…build())». Из лямбды-строителя берём
 * поле конфига или константу для каждого вызова Builder. fieldKey: поле класса конфига → ключ TOML.
 */
function wireTypes(cls, fieldKey, warnings) {
  const method = (name, desc) => cls.methods.find((m) => m.name === name && (!desc || m.desc === desc) && m.code);
  /** Константа, которую возвращает лямбда «() -> 3540.0» этого же класса */
  const lambdaConst = (handle) => {
    if (!handle || handle.owner !== cls.name) return null;
    return constants(cls, handle.name)?.find((c) => typeof c === 'number') ?? null;
  };
  const indyHandle = (ins) => cls.bootstrap[cls.cp[ins.index].a]?.find((a) => a?.handle)?.handle;
  const out = [];
  let name = null;
  let builder = null;
  for (const ins of instructions(method('<clinit>')?.code ?? Buffer.alloc(0))) {
    if (ins.op === 0x12 || ins.op === 0x13) {
      const c = cls.constant(ins.index);
      if (typeof c === 'string') name = c;
    } else if (ins.op === 0xba) builder = indyHandle(ins);
    else if (ins.op === 0xb6 && cls.ref(ins.index).name === 'register' && name && builder) {
      const body = method(builder.name, builder.desc);
      if (body) out.push({ name, ...builderProps(body) });
      name = builder = null;
    }
  }
  function builderProps(body) {
    const props = {};
    let field = null;
    let value = null;
    let item = null;
    let own = null;
    for (const ins of instructions(body.code)) {
      const { op } = ins;
      if (op === 0xb4) {
        const r = cls.ref(ins.index);
        if (/\/config\/C\w+$/.test(r.owner) && fieldKey.has(r.name)) field = fieldKey.get(r.name);
      } else if (op === 0xb2) {
        const r = cls.ref(ins.index);
        if (/\/CEEItems$/.test(r.owner)) item = `electroenergetics:${r.name.toLowerCase()}`;
        else if (r.owner === cls.name) own = r.name.toLowerCase();
      } else if (op === 0x14 || op === 0x13 || op === 0x12) {
        const c = cls.constant(ins.index);
        if (typeof c === 'number') value = c;
      } else if (op === 0xba) {
        const v = lambdaConst(indyHandle(ins));
        if (v !== null) value = v;
      } else if (op === 0xb6) {
        const r = cls.ref(ins.index);
        if (!/\$Builder$/.test(r.owner)) continue;
        const m = r.name;
        if (m === 'resistance' || m === 'maxInsulationVoltage' || m === 'maxLength' || m === 'maxTemperature')
          props[m] = field ? { key: field } : value !== null ? { value } : null;
        else if (m === 'insulationResistance') props[m] = value;
        else if (m === 'droppedItem') props.item = item;
        else if (m === 'spoolItem') props.spool = item;
        else if (m === 'replaceOnOverheated') props.overheated = own;
        else if (m === 'decorative' || m === 'invulnerable') props[m] = true;
        field = value = item = own = null;
      }
    }
    return props;
  }
  if (!out.length) warnings.push('EE: виды проводов не найдены');
  return out;
}

/** Значения строителя провода по умолчанию: в конструкторе «this.maxTemperature = () -> 1000» (лямбда без числа — 0) */
function wireDefaults(cls) {
  const out = {};
  const init = cls?.methods.find((m) => m.name === '<init>' && m.code);
  let handle = null;
  for (const ins of instructions(init?.code ?? Buffer.alloc(0))) {
    if (ins.op === 0xba) handle = cls.bootstrap[cls.cp[ins.index].a]?.find((a) => a?.handle)?.handle;
    else if (ins.op === 0xb5) {
      const r = cls.ref(ins.index);
      if (handle && handle.owner === cls.name && /DoubleSupplier;$/.test(r.desc)) {
        const body = cls.methods.find((m) => m.name === handle.name && m.desc === handle.desc);
        const nums = body ? constants(cls, handle.name).filter((c) => typeof c === 'number') : [];
        out[r.name] = nums[0] ?? 0;
      }
      handle = null;
    }
  }
  return out;
}

/** Ожидаемые константы: проверяем, что код не поменялся (иначе формула на сайте будет неверной) */
function expect(list, values, what, warnings) {
  if (!list) {
    warnings.push(`${what}: метод не найден`);
    return false;
  }
  const nums = list.filter((c) => typeof c === 'number');
  const ok = values.every((v) => nums.some((n) => Math.abs(n - v) <= Math.abs(v) * 1e-6 + 1e-12));
  if (!ok) warnings.push(`${what}: в коде нет ожидаемых чисел ${values.join(', ')} (есть ${nums.join(', ')})`);
  return ok;
}

function buildEE(jar, warnings) {
  const cfg = (n) => classFrom(jar, `${EE}/config/${n}`);
  const keys = [];
  for (const n of ['CServer', 'CRotor', 'CResistances', 'CRatings', 'CVoltages']) {
    const cls = cfg(n);
    if (!cls) {
      warnings.push(`EE: нет класса конфига ${n}`);
      continue;
    }
    keys.push(...catnipDefaults(cls, n === 'CServer' ? '' : sectionName(cls)));
  }

  // Провода: нагрев за расчёт = ток (А, не больше 1000) по общей формуле updateTemp; искрят с 85 % предела, на пределе
  // заменяются «перегретым» видом (WireLifetimeModule.finishSimulation)
  const fieldKey = new Map(keys.map((k) => [k.field, k.key]));
  const wires = wireTypes(classFrom(jar, `${EE}/CEEWireTypes`) ?? { methods: [] }, fieldKey, warnings);
  const wireDefault = wireDefaults(classFrom(jar, `${EE}/simulation/WireType$Builder`));
  if (wireDefault.maxTemperature === undefined) warnings.push('EE: предел температуры провода по умолчанию не найден');
  const life = classFrom(jar, `${EE}/simulation/infrastructure/WireLifetimeModule`);
  const lifeOk = expect(constants(life, 'finishSimulation'), [1000, 33.3, 0.85], 'EE: нагрев проводов', warnings);
  // Общая формула нагрева устройств: T' = max(0, T − cool + (тепло + base) × min(1, 1 / (1 + T / scale)))
  const dev = classFrom(jar, `${EE}/foundation/device/ElectricalDevice`);
  const heatOk = expect(constants(dev, 'updateTemp'), [30, 1000, 33.3], 'EE: формула нагрева', warnings);

  // Трансформатор (один блок): шкала соотношений — массив Couple(вход, выход) в <clinit>, середина шкалы — 1:1;
  // нагрев = min(70000, |P|) / 10, разрушается выше 76000 (если componentDamage)
  const tr = classFrom(jar, `${EE}/content/transmission_distribution/transformer/TransformerBlockEntity`);
  const ratios = [];
  {
    const nums = [];
    for (const ins of instructions(tr?.methods.find((m) => m.name === '<clinit>')?.code ?? Buffer.alloc(0))) {
      if (ins.op >= 0x02 && ins.op <= 0x08) nums.push(ins.op - 0x03);
      else if (ins.op === 0x10 || ins.op === 0x11) nums.push(ins.index);
      else if (ins.op === 0xb8 && /Couple$/.test(tr.ref(ins.index).owner)) {
        const [a, b] = nums.slice(-2);
        ratios.push([a, b]);
      }
    }
  }
  const trDev = classFrom(jar, `${EE}/content/transmission_distribution/transformer/TransformerDevice`);
  const trOk = expect(constants(trDev, 'postTick'), [70000, 10, 76000], 'EE: нагрев трансформатора', warnings);
  if (!ratios.length) warnings.push('EE: соотношения трансформатора не найдены');
  // Магнитопровод: витки 1…100 (по умолчанию 10); теплоотвод = 60000 × (1 + Σ 1/√расстояния по охладителям в радиусе
  // √16) × 0,7 за каждую сторону без трансформаторного масла; нагрузка = |P| / теплоотвод (≤ 2,5), нагрев = × 1000,
  // взрыв (сила 4) выше 31000
  const core = classFrom(jar, `${EE}/content/transmission_distribution/transformer/TransformerCoreBlockEntity`);
  const coreLazy = constants(core, 'lazyTick');
  const coreOk =
    expect(coreLazy, [0.7, 60000], 'EE: охлаждение магнитопровода', warnings) &&
    expect(constants(core, 'heatDissipatorsDFS'), [16], 'EE: радиус охлаждения', warnings) &&
    expect(
      constants(
        classFrom(jar, `${EE}/content/transmission_distribution/transformer/TransformerCoreDevice`),
        'postTick',
      ),
      [2.5, 1000, 31000, 4],
      'EE: перегрев магнитопровода',
      warnings,
    );
  const turns = constants(core, 'addBehaviours')?.filter((c) => typeof c === 'number') ?? [];

  // Охладители магнитопровода — тег блоков из jar (датапак сборки его не трогает — проверить при смене сборки)
  const tagRaw = spawnSync('unzip', ['-p', jar, 'data/electroenergetics/tags/block/transformer_heat_dissipators.json']);
  let dissipators = [];
  try {
    dissipators = JSON.parse(tagRaw.stdout.toString()).values.map((v) => (typeof v === 'string' ? v : v.id));
  } catch {
    warnings.push('EE: тег охладителей магнитопровода не прочитан');
  }
  // Заземляющий стержень: контакт 0 → общая земля с проводимостью 1 См (1 Ом)
  const rod = classFrom(jar, `${EE}/content/ground_rod/GroundRodDevice`);
  const rodOk = constants(rod, 'preTick')?.includes(1);

  // Ротор: нагрузка на вал = статоры × 0,125 × rotorPowerMultiplier × rotorStressMultiplier (SU на 1 об/мин)
  const rotor = classFrom(jar, `${EE}/content/rotor/AlternatorRotorBlockEntity`);
  const rotorK = constants(rotor, 'calculateStressApplied')?.find((c) => typeof c === 'number' && c > 0 && c < 1);
  if (rotorK === undefined) warnings.push('EE: множитель нагрузки ротора не найден');
  // Статоры — соседние блоки по четырём сторонам поперёк оси ротора
  const rotorTick = constants(rotor, 'lazyTick');
  if (!rotorTick) warnings.push('EE: подсчёт статоров ротора не найден');

  // Двигатель: сопротивление 0,8 × min(6R, R / нагрузка), нагрузка не меньше 0,05; отдаёт V² / R (SU)
  const motorDev = classFrom(jar, `${EE}/content/electric_motor/ElectricMotorDevice`);
  const motorOk = expect(constants(motorDev, 'preTick'), [0.05, 0.8, 6], 'EE: сопротивление двигателя', warnings);
  const motorBe = classFrom(jar, `${EE}/content/electric_motor/ElectricMotorBlockEntity`);
  const capOk = motorBe?.methods.some((m) => m.name === 'calculateMotorCapacity' && m.desc === '(D)F');
  if (!capOk) warnings.push('EE: формула мощности двигателя (calculateMotorCapacity) не найдена');

  // Преобразователь: буфер converterMaxPower × 1000, сопротивление потребителя не меньше 20 Ом,
  // напряжение источника — шкала 0…432 × 10 В, по умолчанию 10 × 10
  const conv = classFrom(jar, `${EE}/content/converter/ConverterDevice`);
  const convOk =
    expect(constants(conv, 'getMaxEnergy'), [1000], 'EE: буфер преобразователя', warnings) &&
    expect(constants(conv, 'postTick'), [20], 'EE: сопротивление преобразователя', warnings);
  const convBe = classFrom(jar, `${EE}/content/converter/ConverterBlockEntity`);
  const scroll = constants(convBe, 'addBehaviours')?.filter((c) => typeof c === 'number') ?? [];
  const [, scrollMax, scrollDefault] = scroll;
  const step = constants(convBe, 'updateVoltage')?.find((c) => typeof c === 'number' && c > 1);
  if (!scrollMax || !step) warnings.push('EE: шкала напряжения преобразователя не найдена');

  // Генератор: ЭДС = мощность / rotorFullLoadCurrent, запас энергии не больше 10 тиков мощности
  const gen = classFrom(jar, `${EE}/foundation/base/GeneratingDevice`);
  const genOk = expect(constants(gen, 'postTick'), [10], 'EE: запас генератора', warnings);

  // Переменный ток (трёхфазный щёточный узел): фаза = амплитуда × sin(угол + 0/120/240°), угол растёт на
  // 360 × об/мин × 0,15625 / 20 / расчётов за тик градусов за расчёт → частота 0,15625 × об/мин Гц
  const virtual = classFrom(jar, `${EE}/content/rotor/VirtualRotor`);
  const acOk = expect(constants(virtual, 'swing'), [360, 0.15625, 20], 'EE: частота переменного тока', warnings);
  const phases = classFrom(jar, `${EE}/content/rotor/ThreePhaseAlternatorBrushesDevice`);
  const phaseOk = expect(constants(phases, '<init>'), [120, 240], 'EE: сдвиг фаз', warnings);
  const simCfg = classFrom(jar, `${EE}/config/CSimulation`);
  if (simCfg) keys.push(...catnipDefaults(simCfg, sectionName(simCfg)));

  // Помпа: скорость = U² / pumpResistance / нагрузка механической помпы Create, в пределах ±300; напряжение —
  // мгновенное, в каждом расчёте (без усреднения, в отличие от двигателя)
  const pumpBe = classFrom(jar, `${EE}/content/electric_pump/ElectricPumpBlockEntity`);
  const pumpMax = constants(pumpBe, 'getSpeed')?.find((c) => typeof c === 'number' && c > 1);
  if (!pumpMax) warnings.push('EE: предел скорости помпы не найден');

  // Диод — модель Шокли: I = Is × (e^(U/Vt) − 1), напряжение линеаризации в пределах ±0,8 В
  const diode = classFrom(jar, `${EE}/foundation/electrical_properties/DiodeProperties`);
  const diodeOk = expect(constants(diode, 'tickDiode'), [1e-9, 0.05, 0.8], 'EE: модель диода', warnings);

  // Конденсатор: предел напряжения — capacitorVoltage / highVoltageCapacitorVoltage из настроек

  return {
    file: 'electroenergetics-server.toml',
    keys,
    wires,
    wireDefault,
    dissipators,
    groundRod: rodOk ? { resistance: 1 } : null,
    wireHeat: lifeOk && heatOk ? { cool: 33.3, base: 30, scale: 1000, warn: 0.85, maxCurrent: 1000 } : null,
    transformer: trOk && ratios.length ? { ratios, heatDivisor: 10, heatCap: 70000, breakTemp: 76000 } : null,
    core: coreOk
      ? {
          base: 60000,
          noOil: 0.7,
          radius: 4,
          maxLoad: 2.5,
          heatPerLoad: 1000,
          breakTemp: 31000,
          explosion: 4,
          turnsMin: turns[1] ?? 1,
          turnsMax: turns[2] ?? 100,
          turnsDefault: turns[3] ?? 10,
        }
      : null,
    ac: acOk && phaseOk ? { hzPerRpm: 0.15625, phaseShift: 120 } : null,
    pump: pumpMax ? { maxSpeed: pumpMax } : null,
    diode: diodeOk ? { saturation: 1e-9, thermal: 0.05 } : null,
    rotor: rotorK !== undefined ? { stressFactor: rotorK, sides: 4 } : null,
    motor: motorOk && capOk ? { minLoad: 0.05, loadedFactor: 0.8, idleFactor: 6 } : null,
    converter: convOk
      ? {
          minResistance: 20,
          voltageStep: step ?? 10,
          voltageMax: (scrollMax ?? 0) * (step ?? 10),
          voltageDefault: (scrollDefault ?? 0) * (step ?? 10),
        }
      : null,
    generator: genOk ? { bufferTicks: 10 } : null,
  };
}

function buildIE(jar, warnings) {
  // Провода: new EnergyWireConfig(builder, "copper", длина, FE/t, потери); ввод коннектора = FE/t / 8
  const wiresCls = classFrom(jar, `${IE}/common/config/IEServerConfig$Wires`);
  const wires = [];
  const init = wiresCls?.methods.find((m) => m.name === '<init>' && m.code);
  let stack = [];
  for (const ins of instructions(init?.code ?? Buffer.alloc(0))) {
    const { op } = ins;
    if (op >= 0x02 && op <= 0x08) stack.push(op - 0x03);
    else if (op === 0x10 || op === 0x11) stack.push(ins.index);
    else if (op === 0x12 || op === 0x13 || op === 0x14) stack.push(wiresCls.constant(ins.index));
    else if (op === 0xb7) {
      const r = wiresCls.ref(ins.index);
      if (r.name === '<init>' && /\$EnergyWireConfig$/.test(r.owner)) {
        const n = argTypes(r.desc).length - 1;
        const [name, maxLength, transferRate, distanceLoss] = stack.slice(-n);
        if (typeof name === 'string') wires.push({ name, maxLength, transferRate, distanceLoss });
      }
      stack = [];
    }
  }
  const wireCfg = classFrom(jar, `${IE}/common/config/IEServerConfig$Wires$EnergyWireConfig`);
  const divOk = expect(constants(wireCfg, '<init>'), [8], 'IE: ввод коннектора', warnings);
  if (!wires.length) warnings.push('IE: провода не найдены');
  // Потери на пролёте: distanceLoss × длина / максимальная длина провода
  const wireType = classFrom(jar, `${IE}/common/wires/IEWireTypes$EnergyWire`);
  if (!wireType?.methods.some((m) => m.name === 'getBasicLossRate')) warnings.push('IE: формула потерь не найдена');

  const machines = classFrom(jar, `${IE}/common/config/IEServerConfig$Machines`);
  const keys = machines ? configDefaults(machines).filter((k) => !k.key.startsWith('?')) : [];
  return {
    file: 'immersiveengineering-server.toml',
    wires,
    connectorDivisor: divOk ? 8 : null,
    keys: keys.map(({ key, default: d }) => ({ key, default: d })),
  };
}

/**
 * Нагрузка механической помпы Create по умолчанию (входит в формулу скорости электропомпы EE): в AllBlocks.<clinit>
 * «.transform(CStress.setImpact(4.0))» идёт после имени блока. Сервер переопределяет её в create-server.toml →
 * kinetics.stressValues.v2.impact.mechanical_pump. Остальные блоки так не разобрать: имя не всегда стоит рядом
 * со значением (у подшипника ветряка оно приписалось бы коробке передач) — для них нужен разбор вызовов block(…).
 */
function buildCreate(jar, warnings) {
  const cls = classFrom(jar, 'com/simibubi/create/AllBlocks');
  const clinit = cls?.methods.find((m) => m.name === '<clinit>' && m.code);
  let name = null;
  let value = null;
  let pumpImpact = null;
  for (const ins of instructions(clinit?.code ?? Buffer.alloc(0))) {
    const { op } = ins;
    if (op === 0x12 || op === 0x13 || op === 0x14) {
      const c = cls.constant(ins.index);
      if (typeof c === 'string' && /^[a-z0-9_]+$/.test(c)) name = c;
      else if (typeof c === 'number') value = c;
    } else if (op === 0x0e || op === 0x0f) value = op - 0x0e;
    else if (op === 0xb8) {
      const r = cls.ref(ins.index);
      if (/\/CStress$/.test(r.owner) && r.name === 'setImpact' && name === 'mechanical_pump') pumpImpact = value;
      if (/\/CStress$/.test(r.owner)) name = null;
      value = null;
    }
  }
  if (pumpImpact === null) warnings.push('Create: нагрузка механической помпы не найдена');
  return { file: 'create-server.toml', pumpImpact };
}

export function buildPower(jarPaths) {
  const warnings = [];
  const find = (re) => jarPaths.find((j) => re.test(path.basename(j)));
  const eeJar = find(/^electroenergetics-/i);
  const ieJar = find(/^ImmersiveEngineering-/i);
  const createJar = find(/^create-1\./i);
  if (!createJar) warnings.push('нет jar Create');
  if (!eeJar) warnings.push('нет jar Create Electro Energetics');
  if (!ieJar) warnings.push('нет jar Immersive Engineering');
  const data = {
    ee: eeJar ? { jar: path.basename(eeJar), ...buildEE(eeJar, warnings) } : null,
    ie: ieJar ? { jar: path.basename(ieJar), ...buildIE(ieJar, warnings) } : null,
    create: createJar ? { jar: path.basename(createJar), ...buildCreate(createJar, warnings) } : null,
  };
  return { data, warnings };
}

export function writePower(jarPaths, outFile) {
  const { data, warnings } = buildPower(jarPaths);
  fs.writeFileSync(outFile, JSON.stringify(data));
  return { ee: data.ee?.keys.length ?? 0, ieWires: data.ie?.wires.length ?? 0, warnings };
}
