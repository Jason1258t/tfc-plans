import { useEffect, useState } from 'react';
import { useModConfig, type ConfigOrigin, type ModConfig } from './config';

/**
 * Электричество: Create Electro Energetics (В, А, Вт), Immersive Engineering (FE/t) и стык с кинетикой Create (SU).
 * public/power.json собирает scripts/mods/power.mjs: значения настроек по умолчанию и коэффициенты формул — из
 * байткода модов. Настройки сервера берутся поверх них из Firestore (config/*__<файл>), как в остальном справочнике.
 */

/** Подразделы вкладки «Электричество» */
export type PowerSub = 'link' | 'ee' | 'ie' | 'guides';
export const POWER_SUBS: { id: PowerSub; label: string }[] = [
  { id: 'link', label: 'Как связаны' },
  { id: 'ee', label: 'Нагрузки EE' },
  { id: 'ie', label: 'Сеть IE' },
  { id: 'guides', label: 'Гайды' },
];

export type WireValue = { key: string } | { value: number } | null | undefined;

export interface EeWire {
  name: string;
  resistance?: WireValue;
  maxInsulationVoltage?: WireValue;
  maxTemperature?: WireValue;
  maxLength?: WireValue;
  insulationResistance?: number;
  item?: string | null;
  spool?: string | null;
  overheated?: string | null;
  decorative?: boolean;
  invulnerable?: boolean;
}

export interface HeatModel {
  cool: number;
  base: number;
  scale: number;
  warn: number;
  maxCurrent: number;
}

export interface PowerKey {
  key: string;
  default: number | boolean | string | null;
}

export interface PowerData {
  ee: {
    jar: string;
    file: string;
    keys: PowerKey[];
    /** Нагрузка ротора на вал = статоры × stressFactor × rotorPowerMultiplier × rotorStressMultiplier на 1 об/мин */
    rotor: { stressFactor: number; sides: number } | null;
    /** Сопротивление двигателя: loadedFactor × min(idleFactor × R, R / нагрузка), нагрузка не меньше minLoad */
    motor: { minLoad: number; loadedFactor: number; idleFactor: number } | null;
    converter: { minResistance: number; voltageStep: number; voltageMax: number; voltageDefault: number } | null;
    /** Запас энергии генератора — столько тиков его мощности */
    generator: { bufferTicks: number } | null;
    /** Трёхфазный щёточный узел: частота = hzPerRpm × об/мин, фазы через phaseShift градусов */
    ac?: { hzPerRpm: number; phaseShift: number } | null;
    /** Электропомпа: скорость = U² / pumpResistance / нагрузка механической помпы, не больше maxSpeed */
    pump?: { maxSpeed: number } | null;
    /** Диод (модель Шокли): ток насыщения, А, и тепловое напряжение, В */
    diode?: { saturation: number; thermal: number } | null;
    /** Виды проводов: значение — ключ настройки или число из кода; нет поля — значение строителя по умолчанию */
    wires?: EeWire[];
    wireDefault?: { maxInsulationVoltage?: number; maxTemperature?: number };
    /** Нагрев: T' = max(0, T − cool + (тепло + base) × min(1, 1 / (1 + T / scale))); провод — тепло = ток */
    wireHeat?: HeatModel | null;
    /** Одноблочный трансформатор: шкала соотношений (вход, выход), тепло = min(heatCap, |P|) / heatDivisor */
    transformer?: { ratios: [number, number][]; heatDivisor: number; heatCap: number; breakTemp: number } | null;
    /** Магнитопровод: теплоотвод = base × (1 + Σ 1/√d) × noOil за каждую сторону без масла */
    core?: {
      base: number;
      noOil: number;
      radius: number;
      maxLoad: number;
      heatPerLoad: number;
      breakTemp: number;
      explosion: number;
      turnsMin: number;
      turnsMax: number;
      turnsDefault: number;
    } | null;
    /** Блоки и теги, охлаждающие магнитопровод */
    dissipators?: string[];
    /** Заземляющий стержень: сопротивление до общей земли, Ом */
    groundRod?: { resistance: number } | null;
  } | null;
  create?: { jar: string; file: string; pumpImpact: number | null } | null;
  ie: {
    jar: string;
    file: string;
    wires: { name: string; maxLength: number; transferRate: number; distanceLoss: number }[];
    /** Ввод коннектора = пропускная способность провода / connectorDivisor */
    connectorDivisor: number | null;
    keys: PowerKey[];
  } | null;
}

let loaded: PowerData | null | undefined;
let promise: Promise<PowerData | null> | null = null;

function loadPower() {
  promise ??= fetch('/power.json')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((d: PowerData | null) => (loaded = d?.ee || d?.ie ? d : null));
  return promise;
}

/** undefined — грузится, null — файла нет (библиотека собрана старой версией) */
export function usePower(): PowerData | null | undefined {
  const [data, setData] = useState(loaded);
  useEffect(() => {
    if (data === undefined) loadPower().then(setData);
  }, [data]);
  return data;
}

export interface Setting {
  value: number;
  origin: ConfigOrigin;
  default: number | null;
}

const valueAt = (doc: ModConfig | null | undefined, key: string) => {
  let v: unknown = doc?.values;
  for (const part of key.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined;
  return v;
};

/** Настройки файла: переопределение сервера → конфиг сборки → значение мода по умолчанию */
export function useSettings(file: string | undefined, keys: PowerKey[] | undefined) {
  const server = useModConfig(file ?? '', 'server');
  const config = useModConfig(file ?? '', 'config');
  const get = (key: string): Setting | null => {
    const def = keys?.find((k) => k.key === key)?.default;
    const d = typeof def === 'number' ? def : null;
    for (const [doc, origin] of [
      [server, 'server'],
      [config, 'config'],
    ] as const) {
      const v = valueAt(doc, key);
      if (typeof v === 'number') return { value: v, origin, default: d };
    }
    return d === null ? null : { value: d, origin: 'default', default: d };
  };
  return { get, loading: server === undefined || config === undefined };
}

// ---------------------------------------------------------------- формулы (по коду модов)

export interface Alternator {
  /** Выработка, Вт */
  power: number;
  /** Напряжение без нагрузки (ЭДС), В */
  emf: number;
  /** Нагрузка на вал Create, SU */
  stress: number;
  /** Наименьшее сопротивление нагрузки, которое генератор ещё тянет на полном напряжении, Ом */
  minLoad: number;
}

/**
 * Генератор EE (щёточный узел + роторы со статорами). Выработка = статоры × об/мин × rotorPowerMultiplier,
 * ЭДС = выработка / rotorFullLoadCurrent. Вал нагружается одинаково при любом потреблении.
 */
export function alternator(
  stators: number,
  rpm: number,
  p: { powerMult: number; stressMult: number; fullLoadCurrent: number; stressFactor: number },
): Alternator {
  const power = stators * Math.abs(rpm) * p.powerMult;
  const emf = power / p.fullLoadCurrent;
  return {
    power,
    emf,
    stress: stators * p.stressFactor * p.powerMult * p.stressMult * Math.abs(rpm),
    minLoad: power > 0 ? (emf * emf) / power : Infinity,
  };
}

export interface Motor {
  running: boolean;
  /** Сколько SU выдаёт в сеть Create */
  capacity: number;
  /** Сопротивление при этой нагрузке, Ом */
  resistance: number;
  /** Потребление, Вт */
  power: number;
  current: number;
}

/**
 * Двигатель EE: ёмкость по нагрузке = V² / R (SU), сопротивление = loadedFactor × min(idleFactor × R, R / нагрузка),
 * нагрузка (доля использованных SU) не меньше minLoad. Ниже motorMinVoltage вал не крутится.
 */
export function motor(
  volts: number,
  load: number,
  p: { resistance: number; minVoltage: number; minLoad: number; loadedFactor: number; idleFactor: number },
): Motor {
  const l = Math.min(1, Math.max(p.minLoad, load));
  const resistance = p.loadedFactor * Math.min(p.idleFactor * p.resistance, p.resistance / l);
  const power = (volts * volts) / resistance;
  return {
    running: volts > p.minVoltage,
    capacity: (volts * volts) / p.resistance,
    resistance,
    power,
    current: volts / resistance,
  };
}

/** Резистивная нагрузка: мощность и ток при напряжении */
export const resistive = (volts: number, ohms: number) => ({ power: (volts * volts) / ohms, current: volts / ohms });

// ---------------------------------------------------------------- переменный ток и выпрямители

const RAD = Math.PI / 180;

/** Схема питания помпы: от обычного узла, напрямую от фазы, мостом на 6 диодов, мостом на 4 диода с конденсатором */
export type Rectifier = 'dc' | 'raw' | 'bridge3' | 'bridge1' | 'bridge1cap';

/**
 * Напряжение на выходе схемы при угле ротора θ (градусы), без падения на диодах. amp — амплитуда фазы.
 * Мост на 6 диодах отдаёт разность самой высокой и самой низкой фазы: от 1,5 до √3 амплитуды.
 */
export function rectified(kind: Rectifier, amp: number, theta: number, shift = 120): number {
  const ph = [0, shift, 2 * shift].map((o) => amp * Math.sin((theta + o) * RAD));
  if (kind === 'dc') return amp;
  if (kind === 'raw') return ph[0];
  if (kind === 'bridge3') return Math.max(...ph) - Math.min(...ph);
  if (kind === 'bridge1') return Math.abs(ph[0]);
  // С конденсатором — до пика; насколько он проседает между пиками, зависит от ёмкости (не считаем)
  return amp;
}

/** Сколько диодов на пути тока в схеме */
export const diodesInPath = (kind: Rectifier) => (kind === 'bridge3' || kind.startsWith('bridge1') ? 2 : 0);

/** Падение на диоде при токе I по модели Шокли: Vt × ln(I / Is + 1) */
export const diodeDrop = (current: number, d: { saturation: number; thermal: number }) =>
  current > 0 ? d.thermal * Math.log(current / d.saturation + 1) : 0;

/** Скорость электропомпы: U² / R / нагрузка механической помпы Create, в пределах maxSpeed; |U| ≤ 1 В — стоит */
export function pumpSpeed(volts: number, p: { resistance: number; impact: number; maxSpeed: number }) {
  if (Math.abs(volts) <= 1) return 0;
  return Math.min(p.maxSpeed, (volts * volts) / p.resistance / p.impact);
}

/** Напряжение для нужной скорости помпы */
export const pumpVolts = (speed: number, p: { resistance: number; impact: number }) =>
  Math.sqrt(speed * p.resistance * p.impact);

/** На сколько градусов поворачивается фаза между расчётами цепи (расчёт — microTicks раз за тик, 20 тиков в секунду) */
export const degreesPerStep = (rpm: number, hzPerRpm: number, microTicks: number) =>
  (360 * hzPerRpm * Math.abs(rpm)) / 20 / Math.max(1, microTicks);

// ---------------------------------------------------------------- нагрев, провода, трансформаторы

/** Один шаг нагрева (общая формула устройств EE) */
export const heatStep = (t: number, heat: number, h: HeatModel) =>
  Math.max(0, t - h.cool + (heat + h.base) * Math.min(1, 1 / (1 + t / h.scale)));

/** Установившаяся температура при постоянном тепле */
export const steadyTemp = (heat: number, h: HeatModel) => Math.max(0, h.scale * ((heat + h.base) / h.cool - 1));

/** Наибольшее постоянное тепло, при котором температура не дойдёт до предела */
export const maxSteadyHeat = (limit: number, h: HeatModel) => h.cool * (limit / h.scale + 1) - h.base;

/** Через сколько расчётов температура дойдёт до предела (null — не дойдёт за maxSteps) */
export function stepsToTemp(heat: number, limit: number, h: HeatModel, maxSteps = 72000) {
  if (steadyTemp(heat, h) <= limit) return null;
  let t = 0;
  for (let i = 1; i <= maxSteps; i++) {
    t = heatStep(t, heat, h);
    if (t > limit) return i;
  }
  return null;
}

/** Значение свойства провода: настройка сервера / число из кода / значение строителя по умолчанию */
export function wireValue(v: WireValue, get: (key: string) => Setting | null, fallback?: number): number | null {
  if (v && 'key' in v) return get(v.key)?.value ?? null;
  if (v && 'value' in v) return v.value;
  return fallback ?? null;
}

/** Соотношения одноблочного трансформатора «выход / вход» по возрастанию: понижающие, 1:1, повышающие */
export function transformerRatios(ratios: [number, number][]) {
  const down = ratios.map(([a, b]) => ({ label: `${a}:${b}`, k: a / b }));
  const up = ratios.map(([a, b]) => ({ label: `${b}:${a}`, k: b / a }));
  return [...down, { label: '1:1', k: 1 }, ...up].sort((x, y) => x.k - y.k);
}
