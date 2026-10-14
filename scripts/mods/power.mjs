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
        out.push({ key: prefix ? `${prefix}.${key}` : key, default: bool ? nums[0] === 1 : nums[0] });
      }
      consts = [];
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
  const ok = values.every((v) => nums.some((n) => Math.abs(n - v) < 1e-9));
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

  return {
    file: 'electroenergetics-server.toml',
    keys,
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

export function buildPower(jarPaths) {
  const warnings = [];
  const find = (re) => jarPaths.find((j) => re.test(path.basename(j)));
  const eeJar = find(/^electroenergetics-/i);
  const ieJar = find(/^ImmersiveEngineering-/i);
  if (!eeJar) warnings.push('нет jar Create Electro Energetics');
  if (!ieJar) warnings.push('нет jar Immersive Engineering');
  const data = {
    ee: eeJar ? { jar: path.basename(eeJar), ...buildEE(eeJar, warnings) } : null,
    ie: ieJar ? { jar: path.basename(ieJar), ...buildIE(ieJar, warnings) } : null,
  };
  return { data, warnings };
}

export function writePower(jarPaths, outFile) {
  const { data, warnings } = buildPower(jarPaths);
  fs.writeFileSync(outFile, JSON.stringify(data));
  return { ee: data.ee?.keys.length ?? 0, ieWires: data.ie?.wires.length ?? 0, warnings };
}
