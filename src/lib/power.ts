import { useEffect, useState } from 'react';
import { useModConfig, type ConfigOrigin, type ModConfig } from './config';

/**
 * Электричество: Create Electro Energetics (В, А, Вт), Immersive Engineering (FE/t) и стык с кинетикой Create (SU).
 * public/power.json собирает scripts/mods/power.mjs: значения настроек по умолчанию и коэффициенты формул — из
 * байткода модов. Настройки сервера берутся поверх них из Firestore (config/*__<файл>), как в остальном справочнике.
 */

/** Подразделы вкладки «Электричество» */
export type PowerSub = 'link' | 'ee' | 'ie';
export const POWER_SUBS: { id: PowerSub; label: string }[] = [
  { id: 'link', label: 'Как связаны' },
  { id: 'ee', label: 'Нагрузки EE' },
  { id: 'ie', label: 'Сеть IE' },
];

/** Провода IE: короткое имя, катушка и коннектор */
export const IE_WIRE: Record<string, { short: string; coil: string; connector: string }> = {
  copper: { short: 'LV', coil: 'immersiveengineering:wirecoil_copper', connector: 'immersiveengineering:connector_lv' },
  electrum: {
    short: 'MV',
    coil: 'immersiveengineering:wirecoil_electrum',
    connector: 'immersiveengineering:connector_mv',
  },
  hv: { short: 'HV', coil: 'immersiveengineering:wirecoil_steel', connector: 'immersiveengineering:connector_hv' },
};

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
    /**
     * Ротор: каждый статор вокруг даёт magnetsPerStator «магнитов». Выработка = Σ магниты × об/мин ×
     * rotorPowerMultiplier; нагрузка ротора на вал = (магниты + baseMagnets) × rotorPowerMultiplier ×
     * rotorStressMultiplier на 1 об/мин. Щёточный узел собирает до maxRotors роторов подряд.
     */
    rotor: { magnetsPerStator: number; baseMagnets: number; sides: number; maxRotors: number | null } | null;
    /** Сопротивление двигателя: loadedFactor × min(idleFactor × R, R / нагрузка), нагрузка не меньше minLoad */
    motor: {
      minLoad: number;
      loadedFactor: number;
      idleFactor: number;
      /** Напряжение — среднеквадратичное за rmsWindow × microTicks расчётов; SU меняет не чаще раза в updateTicks */
      rmsWindow?: number;
      updateTicks?: number;
      maxSpeed?: number;
      defaultSpeed?: number;
    } | null;
    /**
     * Нагреватель: в сети — резистор circuitOhms (константа); нагрев за расчёт: heat += min(1, U² / R / wattsFull) × gain,
     * heat × keep (R — настройка resistiveHeaterResistance); уровни Create: smouldering / fading / kindled
     */
    heater?: {
      circuitOhms: number;
      wattsFull: number;
      gain: number;
      keep: number;
      smouldering: number;
      fading: number;
      kindled: number;
    } | null;
    /** Ячейка аккумулятора: ЭДС = cellVoltage × (lg(1000 × заряд) / 4 + 0,25), внутреннее сопротивление; ячеек в блоке */
    accumulator?: { cellVoltage: number; internalResistance: number; cellsPerBlock: number } | null;
    /** Предохранитель/автомат: срабатывает выше perAmp × (номинал − offset) °; автомат — мгновенно выше instantFactor × номинал */
    fuse?: { perAmp: number; offset: number; coolBelow: number; instantFactor: number; defaultAmps: number } | null;
    converter: { minResistance: number; voltageStep: number; voltageMax: number; voltageDefault: number } | null;
    /** Запас энергии генератора — столько тиков его мощности */
    generator: { bufferTicks: number } | null;
    /** Трёхфазный щёточный узел: частота = hzPerRpm × об/мин, фазы через phaseShift градусов */
    ac?: { hzPerRpm: number; phaseShift: number } | null;
    /** Электропомпа: скорость = U² / pumpResistance / нагрузка механической помпы, не больше maxSpeed */
    pump?: { maxSpeed: number } | null;
    /** Диод (модель Шокли): ток насыщения, А, тепловое напряжение, В, и предел точки линеаризации, В */
    diode?: { saturation: number; thermal: number; clamp?: number } | null;
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
  /** Advanced TFC Tech: множители энергии и времени машин */
  att?: { jar: string; file: string; keys: PowerKey[] } | null;
  ie: {
    jar: string;
    file: string;
    wires: { name: string; maxLength: number; transferRate: number; distanceLoss: number }[];
    /** Потребители: мультиблоки и машины с рецептами (расход — из рецептов сборки) и приборы (из конфига) */
    consumers?: { machines: IeMachine[]; devices: IeDevice[] };
    /** Конденсаторы IE: настройки machines.capacitors.<name>.storage / input / output */
    capacitors?: { name: string; block: string }[];
    /** Ввод коннектора = пропускная способность провода / connectorDivisor */
    connectorDivisor: number | null;
    keys: PowerKey[];
  } | null;
}

/**
 * Машина с рецептами: расход одной операции = энергия рецепта / время (по рецептам модов сборки, без KubeJS), до
 * parallel операций одновременно (null — не разобрано). energyKey / timeKey — множители из конфига.
 */
export interface IeMachine {
  id: string;
  mod: 'ie' | 'att';
  block: string;
  name: string;
  single: boolean;
  parallel: number | null;
  recipes: number;
  min: number | null;
  median: number | null;
  max: number | null;
  energyKey: string | null;
  timeKey: string | null;
}

/** Прибор: потребление — ключи конфига IE; kind: tick — FE/t в работе, action — FE за действие, max — до FE/t */
export interface IeDevice {
  id: string;
  block: string;
  name: string;
  multiblock: boolean;
  draws: { key: string; kind: 'tick' | 'action' | 'max'; note: string | null }[];
}

/** Расход машины на одну операцию, FE/t, с множителями сервера */
export function machineRates(m: IeMachine, get: (key: string) => Setting | null) {
  const k = (m.energyKey ? (get(m.energyKey)?.value ?? 1) : 1) / (m.timeKey ? (get(m.timeKey)?.value ?? 1) : 1);
  const f = (v: number | null) => (v === null ? null : v * k);
  return { min: f(m.min), median: f(m.median), max: f(m.max) };
}

/** Постоянный расход прибора в работе (все «tick» и «max» вместе), FE/t */
export const deviceTick = (d: IeDevice, get: (key: string) => Setting | null) =>
  d.draws.filter((x) => x.kind !== 'action').reduce((a, x) => a + (get(x.key)?.value ?? 0), 0);

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

export interface AlternatorParams {
  powerMult: number;
  stressMult: number;
  fullLoadCurrent: number;
  magnetsPerStator: number;
  baseMagnets: number;
}

/**
 * Генератор EE (щёточный узел + роторы со статорами). Выработка = статоры × magnetsPerStator × об/мин ×
 * rotorPowerMultiplier, ЭДС = выработка / rotorFullLoadCurrent. Вал нагружается одинаково при любом потреблении:
 * (статоры × magnetsPerStator + роторы × baseMagnets) × rotorPowerMultiplier × rotorStressMultiplier × об/мин.
 * Роторов по умолчанию — наименьшее число, на которое помещаются статоры (по 4 на ротор).
 */
export function alternator(
  stators: number,
  rpm: number,
  p: AlternatorParams,
  rotors = Math.ceil(stators / 4),
): Alternator {
  const magnets = stators * p.magnetsPerStator;
  const power = magnets * Math.abs(rpm) * p.powerMult;
  const emf = power / p.fullLoadCurrent;
  return {
    power,
    emf,
    stress: (magnets + Math.max(rotors, 1) * p.baseMagnets) * p.powerMult * p.stressMult * Math.abs(rpm),
    minLoad: power > 0 ? (emf * emf) / power : Infinity,
  };
}

/** Сколько статоров нужно, чтобы на rpm оборотах получить напряжение без нагрузки volts */
export const statorsFor = (volts: number, rpm: number, p: AlternatorParams) =>
  Math.max(1, Math.ceil((volts * p.fullLoadCurrent) / (p.magnetsPerStator * Math.abs(rpm) * p.powerMult)));

export type LoadRegime = 'idle' | 'normal' | 'overload' | 'unstable';

export interface AlternatorLoad {
  regime: LoadRegime;
  /** Напряжение на контактах, В */
  volts: number;
  /** Отдаёт в нагрузку, Вт */
  delivered: number;
  current: number;
  /** Запас энергии в установившемся режиме, Вт·тик */
  stored: number;
}

/**
 * Генератор под нагрузкой R (Ом). По коду EE это источник ЭДС с внутренним сопротивлением ЭДС² / (4 × запас)
 * (BridgeCollector.energyLimitedSource), запас пополняется выработкой каждый тик, не больше bufferTicks × выработка.
 * Пока нагрузка берёт меньше выработки, запас полный и напряжение почти равно ЭДС. Больше — запас садится, пока
 * генератор не отдаёт ровно выработку: U = √(P × R). Если R меньше четверти «согласованного» ЭДС² / P (ток больше
 * 2 × ток полной нагрузки), модель не сходится с замером: на сервере разработки 2212 В / 221 кВт на 5 Ом дали 1193 В
 * и ~285 кВт — запас обнуляется и пополняется, учёт мода уходит в плюс. Это помечается как 'unstable'.
 */
export function alternatorLoad(emf: number, power: number, r: number, bufferTicks: number): AlternatorLoad {
  if (power <= 0 || emf <= 0) return { regime: 'idle', volts: 0, delivered: 0, current: 0, stored: 0 };
  if (!(r > 0) || !Number.isFinite(r))
    return { regime: 'idle', volts: emf, delivered: 0, current: 0, stored: bufferTicks * power };
  const full = bufferTicks * power;
  const ri0 = (emf * emf) / (4 * full);
  const v0 = (emf * r) / (r + ri0);
  if ((v0 * v0) / r <= power)
    return { regime: 'normal', volts: v0, delivered: (v0 * v0) / r, current: v0 / r, stored: full };
  const volts = Math.sqrt(power * r);
  const ri = emf * Math.sqrt(r / power) - r;
  return {
    regime: r >= (emf * emf) / power / 4 ? 'overload' : 'unstable',
    volts,
    delivered: power,
    current: volts / r,
    stored: ri > 0 ? (emf * emf) / (4 * ri) : 0,
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
/**
 * Падение на диоде EE при токе I. До clamp (0,8 В) — Шокли: Vt × ln(I / Is + 1). Выше EE не сдвигает точку
 * линеаризации, и диод ведёт себя как прямая: V = clamp + (I − I(clamp)) / g, g = Is / Vt × e^(clamp / Vt) ≈ 0,18 См.
 */
export function diodeDrop(current: number, d: { saturation: number; thermal: number; clamp?: number }) {
  if (current <= 0) return 0;
  const clamp = d.clamp ?? Infinity;
  const atClamp = d.saturation * (Math.exp(clamp / d.thermal) - 1);
  if (current <= atClamp) return d.thermal * Math.log(current / d.saturation + 1);
  return clamp + (current - atClamp) / ((d.saturation / d.thermal) * Math.exp(clamp / d.thermal));
}

/** Сопротивление открытого диода EE при больших токах, Ом */
export const diodeResistance = (d: { saturation: number; thermal: number; clamp?: number }) =>
  d.clamp ? 1 / ((d.saturation / d.thermal) * Math.exp(d.clamp / d.thermal)) : 0;

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

// ---------------------------------------------------------------- общее для гайдов

/** Параметры генератора из настроек и данных мода; null — чего-то не хватает */
export function alternatorParams(data: PowerData, get: (key: string) => Setting | null): AlternatorParams | null {
  const powerMult = get('rotor.rotorPowerMultiplier');
  const stressMult = get('rotor.rotorStressMultiplier');
  const fullLoad = get('rotor.rotorFullLoadCurrent');
  const rotor = data.ee?.rotor;
  if (!powerMult || !stressMult || !fullLoad || !rotor) return null;
  return {
    powerMult: powerMult.value,
    stressMult: stressMult.value,
    fullLoadCurrent: fullLoad.value,
    magnetsPerStator: rotor.magnetsPerStator,
    baseMagnets: rotor.baseMagnets,
  };
}

export const ALTERNATOR_REGIME: Record<LoadRegime, string> = {
  idle: 'без нагрузки',
  normal: 'нормальный: напряжение почти полное',
  overload: 'перегрузка: отдаёт всю выработку, напряжение просело',
  unstable: 'ток больше двух полных: режим вне модели, считать нельзя',
};

/** Подобрать трансформатор: соотношение «выход / вход», при котором потребители получат нужное напряжение */
export function matchRatio(emf: number, power: number, consumerR: number, want: number, buffer: number) {
  let k = want / emf;
  for (let i = 0; i < 30; i++) {
    const l = alternatorLoad(emf, power, consumerR / (k * k), buffer);
    if (l.volts <= 0) break;
    k = want / l.volts;
  }
  return k;
}

/** Шаг фазы за расчёт, при котором диоды EE успевают (до GOOD), терпимо (до OK); microTicks на сервере — до MAX */
export const PHASE_STEP = { good: 10, ok: 25, maxMicro: 32 };

/** Сколько расчётов за тик нужно, чтобы шаг фазы был не больше PHASE_STEP.good */
export const microTicksFor = (rpm: number, hzPerRpm: number) =>
  Math.min(PHASE_STEP.maxMicro, Math.max(1, Math.ceil(degreesPerStep(rpm, hzPerRpm, 1) / PHASE_STEP.good)));

/** Напряжение на выходе схемы при угле θ с падением на диодах при нагрузке ohms (ток зависит от напряжения) */
export function rectifiedLoaded(
  kind: Rectifier,
  amp: number,
  theta: number,
  ohms: number,
  diode: { saturation: number; thermal: number; clamp?: number } | null | undefined,
) {
  const v = Math.abs(rectified(kind, amp, theta));
  const n = diodesInPath(kind);
  if (!n || !diode) return v;
  let out = v;
  for (let i = 0; i < 4; i++) out = Math.max(0, v - n * diodeDrop(out / ohms, diode));
  return out;
}

export const RECTIFIERS: { id: Rectifier; label: string }[] = [
  { id: 'dc', label: 'Обычный щёточный узел (постоянный ток)' },
  { id: 'raw', label: 'Фаза и нейтраль напрямую, без выпрямителя' },
  { id: 'bridge3', label: 'Трёхфазный мост, 6 диодов' },
  { id: 'bridge1', label: 'Однофазный мост, 4 диода' },
  { id: 'bridge1cap', label: 'Однофазный мост + конденсатор' },
];

/** Названия видов проводов EE; декоративные и творческий в гайды не идут */
const WIRE_LABEL: Record<string, string> = {
  standard: 'Изолированный медный',
  copper: 'Медный голый',
  heavily_insulated: 'Высокоизолированный',
  bundle_conductor: 'Двухпроводной кабель (жила)',
  electrum: 'Электрумовый голый',
  iron: 'Железный кабель',
  iron_bus: 'Железная шина',
  iron_rail: 'Контактный рельс',
};

export interface WireRow {
  name: string;
  label: string;
  /** Предмет для значка: катушка или сам провод */
  item: string | null;
  ohmPerM: number | null;
  insulation: number;
  maxTemp: number;
  span: number | null;
  /** Длительный ток: дольше — сгорит; с warnI — начнёт искрить */
  maxI: number;
  warnI: number;
}

export function wireRows(data: PowerData, get: (key: string) => Setting | null, h: HeatModel): WireRow[] {
  const d = data.ee?.wireDefault ?? {};
  return (data.ee?.wires ?? [])
    .filter((w) => WIRE_LABEL[w.name] && !w.decorative)
    .map((w) => {
      const maxTemp = wireValue(w.maxTemperature, get, d.maxTemperature) ?? 0;
      const infinite = !Number.isFinite(maxTemp) || maxTemp > 1e12;
      return {
        name: w.name,
        label: WIRE_LABEL[w.name],
        item: w.spool || w.item || null,
        ohmPerM: wireValue(w.resistance, get),
        insulation: wireValue(w.maxInsulationVoltage, get, d.maxInsulationVoltage) ?? 0,
        maxTemp: infinite ? Infinity : maxTemp,
        // У жилы кабеля длину пролёта задаёт оболочка (кабель двухпроводной) — у жилы её нет
        span: w.name === 'bundle_conductor' ? (get('bundledWireLength')?.value ?? null) : wireValue(w.maxLength, get),
        maxI: infinite ? Infinity : Math.min(h.maxCurrent, maxSteadyHeat(maxTemp, h)),
        warnI: infinite ? Infinity : Math.min(h.maxCurrent, maxSteadyHeat(maxTemp * h.warn, h)),
      };
    });
}

/** Нагрузка механической помпы Create в конфиге Create */
export const PUMP_IMPACT_KEY = 'kinetics.stressValues.v2.impact.mechanical_pump';
