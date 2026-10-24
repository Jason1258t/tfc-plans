import { CONFIG_ORIGIN_LABEL } from './config';
import type { Scope } from '@/shared/lib';
import { BASE_DOCS, BASE_VALUES, type GuideScope, type ScopeDoc } from './guideScope';
import {
  alternator,
  ALTERNATOR_REGIME,
  alternatorLoad,
  alternatorParams,
  degreesPerStep,
  diodeDrop,
  diodeResistance,
  diodesInPath,
  IE_WIRE,
  matchRatio,
  maxSteadyHeat,
  microTicksFor,
  PHASE_STEP,
  PUMP_IMPACT_KEY,
  pumpSpeed,
  pumpVolts,
  RECTIFIERS,
  rectified,
  rectifiedLoaded,
  statorsFor,
  steadyTemp,
  stepsToTemp,
  transformerRatios,
  wireRows,
  type LoadRegime,
  type PowerData,
  type PowerKey,
  type Rectifier,
  type Setting,
} from './power';

/**
 * Имена, которые видят формулы гайдов «Электричества»: настройки модов (сервер поверх кода), данные из jar
 * (public/power.json) и формулы из src/lib/power.ts — те же, что у остальных калькуляторов раздела.
 */

type Get = (key: string) => Setting | null;

const CAPACITOR_LABEL: Record<string, string> = {
  lv: 'Низковольтный',
  mv: 'Средневольтный',
  hv: 'Высоковольтный',
};

export interface PowerSettings {
  ee: Get;
  ie: Get;
  att: Get;
  create: Get;
}

/** Ключи «a.b.c» → вложенный объект { a: { b: { c: число } } } */
function nest(keys: PowerKey[] | undefined, get: Get): Scope {
  const root: Scope = {};
  for (const { key } of keys ?? []) {
    const v = get(key)?.value;
    if (v === undefined) continue;
    const parts = key.split('.');
    let o = root;
    for (const p of parts.slice(0, -1)) {
      if (typeof o[p] !== 'object' || o[p] === null) o[p] = {};
      o = o[p] as Scope;
    }
    o[parts.at(-1)!] = v;
  }
  return root;
}

const kinds = (k: unknown): Rectifier => {
  if (!RECTIFIERS.some((r) => r.id === k)) throw new Error(`схема «${k}»: ${RECTIFIERS.map((r) => r.id).join(', ')}`);
  return k as Rectifier;
};

export function powerScope(data: PowerData, s: PowerSettings): GuideScope {
  const gen = alternatorParams(data, s.ee);
  const needGen = () => {
    if (!gen) throw new Error('параметры генератора не собраны');
    return gen;
  };
  const e = data.ee;
  const h = e?.wireHeat ?? null;
  const needHeat = () => {
    if (!h) throw new Error('данные о нагреве не собраны');
    return h;
  };
  const hz = e?.ac?.hzPerRpm ?? null;
  const needHz = () => {
    if (hz === null) throw new Error('частота трёхфазного узла не собрана');
    return hz;
  };
  const buffer = e?.generator?.bufferTicks ?? 10;
  const createKeys = data.create ? [{ key: PUMP_IMPACT_KEY, default: data.create.pumpImpact }] : [];
  const pumpR = s.ee('Resistances.pumpResistance')?.value;
  const impact = s.create(PUMP_IMPACT_KEY)?.value;
  const pump = pumpR && impact && e?.pump ? { resistance: pumpR, impact, maxSpeed: e.pump.maxSpeed } : null;
  const needPump = () => {
    if (!pump) throw new Error('параметры помпы не собраны');
    return pump;
  };
  const tr = e?.transformer ?? null;
  const core = e?.core ?? null;
  const ratios = tr ? transformerRatios(tr.ratios) : [];
  const wires = h ? wireRows(data, s.ee, h) : [];
  const div = data.ie?.connectorDivisor ?? null;

  const defs: { [name: string]: ScopeDoc & { v: unknown } } = {
    ee: {
      sig: 'ee.Раздел.ключ',
      doc: 'настройка Electro Energetics (сервер поверх мода): ee.Voltages.wireMaxVoltage',
      v: nest(e?.keys, s.ee),
    },
    ie: { sig: 'ie.раздел.ключ', doc: 'настройка Immersive Engineering', v: nest(data.ie?.keys, s.ie) },
    att: { sig: 'att.раздел.ключ', doc: 'настройка Advanced TFC Tech', v: nest(data.att?.keys, s.att) },
    create: {
      sig: 'create.kinetics…',
      doc: 'настройка Create (пока только нагрузка механической помпы)',
      v: nest(createKeys, s.create),
    },
    data: { sig: 'data.ee.diode.clamp', doc: 'данные из кода модов (public/power.json)', v: data },
    gen: {
      sig: 'gen.fullLoadCurrent',
      doc: 'параметры генератора: powerMult, stressMult, fullLoadCurrent, magnetsPerStator, baseMagnets',
      v: gen,
    },
    maxRotors: { sig: 'maxRotors', doc: 'роторов на один щёточный узел', v: e?.rotor?.maxRotors ?? null },
    bufferTicks: { sig: 'bufferTicks', doc: 'запас генератора — столько тиков выработки', v: buffer },
    alternator: {
      sig: 'alternator(статоры, обороты, роторы)',
      doc: 'генератор: .power (Вт), .emf (В без нагрузки), .stress (SU), .minLoad (Ом); роторы — по умолчанию по 4 статора',
      v: (st: number, rpm: number, rotors?: number) => alternator(st, rpm, needGen(), rotors ?? Math.ceil(st / 4)),
    },
    statorsFor: {
      sig: 'statorsFor(вольты, обороты)',
      doc: 'сколько статоров дадут это напряжение без нагрузки',
      v: (v: number, rpm: number) => statorsFor(v, rpm, needGen()),
    },
    alternatorLoad: {
      sig: 'alternatorLoad(эдс, выработка, омы)',
      doc: 'генератор под нагрузкой: .volts, .delivered (Вт), .current, .regime, .regimeLabel',
      v: (emf: number, power: number, r: number) => {
        const l = alternatorLoad(emf, power, r, buffer);
        return { ...l, regimeLabel: ALTERNATOR_REGIME[l.regime as LoadRegime] };
      },
    },
    matchRatio: {
      sig: 'matchRatio(эдс, выработка, омы потребителей, нужные вольты)',
      doc: 'трансформатор «выход / вход», чтобы у потребителей было нужное напряжение',
      v: (emf: number, power: number, r: number, want: number) => matchRatio(emf, power, r, want, buffer),
    },
    hzPerRpm: { sig: 'hzPerRpm', doc: 'частота трёхфазного узла на 1 об/мин, Гц', v: hz },
    phaseShift: { sig: 'phaseShift', doc: 'сдвиг фаз, градусы', v: e?.ac?.phaseShift ?? 120 },
    microTicks: {
      sig: 'microTicks',
      doc: 'расчётов цепи за тик на сервере',
      v: s.ee('simulation.microTicks')?.value ?? 1,
    },
    phaseGood: { sig: 'phaseGood', doc: 'шаг фазы за расчёт, при котором диоды EE успевают, °', v: PHASE_STEP.good },
    phaseOk: { sig: 'phaseOk', doc: 'шаг фазы, при котором ещё терпимо, °', v: PHASE_STEP.ok },
    maxMicro: { sig: 'maxMicro', doc: 'наибольший microTicks в настройке', v: PHASE_STEP.maxMicro },
    degreesPerStep: {
      sig: 'degreesPerStep(обороты, microTicks)',
      doc: 'на сколько градусов фаза поворачивается за расчёт',
      v: (rpm: number, m = 1) => degreesPerStep(rpm, needHz(), m),
    },
    microTicksFor: {
      sig: 'microTicksFor(обороты)',
      doc: 'какой microTicks нужен, чтобы диоды успевали',
      v: (rpm: number) => microTicksFor(rpm, needHz()),
    },
    schemes: {
      sig: 'schemes',
      doc: "схемы выпрямления: список {id, label}; id — 'dc', 'raw', 'bridge3', 'bridge1', 'bridge1cap'",
      v: RECTIFIERS,
    },
    rectified: {
      sig: 'rectified(схема, амплитуда, угол)',
      doc: 'напряжение на выходе идеальной схемы при угле ротора (градусы)',
      v: (k: unknown, amp: number, th: number) => rectified(kinds(k), amp, th),
    },
    rectifiedLoaded: {
      sig: 'rectifiedLoaded(схема, амплитуда, угол, омы)',
      doc: 'то же с падением на диодах EE при нагрузке',
      v: (k: unknown, amp: number, th: number, r: number) => rectifiedLoaded(kinds(k), amp, th, r, e?.diode),
    },
    diodesInPath: { sig: 'diodesInPath(схема)', doc: 'диодов на пути тока', v: (k: unknown) => diodesInPath(kinds(k)) },
    diodeDrop: {
      sig: 'diodeDrop(ток)',
      doc: 'падение на диоде EE при токе, В',
      v: (i: number) => (e?.diode ? diodeDrop(i, e.diode) : null),
    },
    diodeR: {
      sig: 'diodeR',
      doc: 'сопротивление открытого диода EE при больших токах, Ом',
      v: e?.diode ? diodeResistance(e.diode) : null,
    },
    pump: { sig: 'pump.resistance', doc: 'помпа: resistance (Ом), impact (SU механической помпы), maxSpeed', v: pump },
    pumpSpeed: { sig: 'pumpSpeed(вольты)', doc: 'скорость электропомпы', v: (v: number) => pumpSpeed(v, needPump()) },
    pumpVolts: {
      sig: 'pumpVolts(скорость)',
      doc: 'напряжение для скорости помпы',
      v: (sp: number) => pumpVolts(sp, needPump()),
    },
    steadyTemp: {
      sig: 'steadyTemp(ток)',
      doc: 'установившаяся температура провода',
      v: (i: number) => steadyTemp(i, needHeat()),
    },
    maxSteadyHeat: {
      sig: 'maxSteadyHeat(предел)',
      doc: 'наибольший ток (тепло), при котором провод не нагреется до предела',
      v: (t: number) => maxSteadyHeat(t, needHeat()),
    },
    stepsToTemp: {
      sig: 'stepsToTemp(ток, предел)',
      doc: 'через сколько расчётов провод дойдёт до предела (null — не дойдёт)',
      v: (i: number, t: number) => stepsToTemp(i, t, needHeat()),
    },
    heat: { sig: 'heat.maxCurrent', doc: 'модель нагрева EE: cool, base, scale, warn, maxCurrent', v: h },
    wires: {
      sig: 'wires',
      doc: 'провода EE: name, label, item, ohmPerM, insulation (0 — голый), maxTemp, span, maxI (длительно), warnI (искрит)',
      v: wires,
    },
    wire: {
      sig: "wire('heavily_insulated')",
      doc: 'провод по имени',
      v: (n: string) => wires.find((w) => w.name === n) ?? null,
    },
    ratios: { sig: 'ratios', doc: 'соотношения одноблочного трансформатора «выход / вход»: {label, k}', v: ratios },
    nearestRatio: {
      sig: 'nearestRatio(k)',
      doc: 'ближайшее соотношение одноблочного трансформатора',
      v: (k: number) =>
        ratios.length
          ? ratios.reduce((a, b) => (Math.abs(Math.log(b.k / k)) < Math.abs(Math.log(a.k / k)) ? b : a))
          : null,
    },
    trMax: {
      sig: 'trMax',
      doc: 'сколько ватт одноблочный трансформатор держит длительно',
      v: tr && h ? Math.min(tr.heatCap, tr.heatDivisor * maxSteadyHeat(tr.breakTemp, h)) : null,
    },
    coreLoad: {
      sig: 'coreLoad',
      doc: 'запас магнитопровода по нагрузке (1,036 — 3,6 %)',
      v: core && h ? maxSteadyHeat(core.breakTemp, h) / core.heatPerLoad : null,
    },
    motorSu: {
      sig: 'motorSu(вольты)',
      doc: 'сколько SU даёт двигатель EE при напряжении (V² / motorResistance), на любых оборотах',
      v: (v: number) => (v * v) / (s.ee('Resistances.motorResistance')?.value ?? 30),
    },
    motorDraw: {
      sig: 'motorDraw(вольты, доля нагрузки)',
      doc: 'сколько ватт берёт двигатель при нагрузке (доля его SU, 0…1)',
      v: (v: number, load: number) => {
        const m = e?.motor;
        if (!m) return null;
        const r = s.ee('Resistances.motorResistance')?.value ?? 30;
        const l = Math.min(1, Math.max(m.minLoad, load));
        return (v * v) / (m.loadedFactor * Math.min(m.idleFactor * r, r / l));
      },
    },
    motor: {
      sig: 'motor.rmsWindow',
      doc: 'двигатель из кода: rmsWindow, updateTicks, maxSpeed, defaultSpeed, loadedFactor…',
      v: e?.motor ?? null,
    },
    heater: {
      sig: 'heater.circuitOhms',
      doc: 'нагреватель из кода: circuitOhms (в сети), wattsFull, gain, keep, smouldering / fading / kindled (уровни)',
      v: e?.heater ?? null,
    },
    heaterHeat: {
      sig: 'heaterHeat(вольты)',
      doc: 'установившийся нагрев 0…1 при напряжении (считается по настройке resistiveHeaterResistance)',
      v: (v: number) => {
        const hh = e?.heater;
        if (!hh) return null;
        const x = Math.min(1, (v * v) / (s.ee('Resistances.resistiveHeaterResistance')?.value ?? 45) / hh.wattsFull);
        return Math.min(1, (hh.keep * hh.gain * x) / (1 - hh.keep));
      },
    },
    heaterVolts: {
      sig: 'heaterVolts(нагрев)',
      doc: 'какое напряжение нужно для установившегося нагрева 0…1',
      v: (heat: number) => {
        const hh = e?.heater;
        if (!hh) return null;
        const x = (heat * (1 - hh.keep)) / (hh.keep * hh.gain);
        return Math.sqrt(x * hh.wattsFull * (s.ee('Resistances.resistiveHeaterResistance')?.value ?? 45));
      },
    },
    heaterTicks: {
      sig: 'heaterTicks(вольты, нагрев)',
      doc: 'через сколько тиков от холодного нагреватель дойдёт до нагрева (null — не дойдёт)',
      v: (v: number, target: number) => {
        const hh = e?.heater;
        if (!hh) return null;
        const x = Math.min(1, (v * v) / (s.ee('Resistances.resistiveHeaterResistance')?.value ?? 45) / hh.wattsFull);
        let h = 0;
        for (let i = 1; i <= 2000; i++) {
          h = Math.min(1, (h + x * hh.gain) * hh.keep);
          if (h >= target) return i;
        }
        return null;
      },
    },
    accumulator: {
      sig: 'accumulator.cellVoltage',
      doc: 'ячейка аккумулятора: cellVoltage, internalResistance, cellsPerBlock',
      v: e?.accumulator ?? null,
    },
    accVolts: {
      sig: 'accVolts(заряд 0…1)',
      doc: 'ЭДС ячейки аккумулятора при заряде',
      v: (soc: number) => {
        const a = e?.accumulator;
        if (!a) return null;
        const c = Math.min(1, Math.max(0, soc));
        return c < 1e-5 ? 0 : a.cellVoltage * (Math.log10(c * 1000) / 4 + 0.25);
      },
    },
    accEnergy: {
      sig: 'accEnergy(от, до)',
      doc: 'энергия ячейки между зарядами (доли 0…1), Вт·ч; accEnergy(0, 1) — полная',
      v: (from: number, to: number) => {
        const a = e?.accumulator;
        const q = s.ee('Voltages.maxAccumulatorCharge')?.value;
        if (!a || !q) return null;
        const lo = Math.max(1e-5, Math.min(from, to));
        const hi = Math.min(1, Math.max(from, to));
        const n = 400;
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const c = lo + ((i + 0.5) / n) * (hi - lo);
          sum += a.cellVoltage * (Math.log10(c * 1000) / 4 + 0.25);
        }
        return ((sum / n) * (hi - lo) * q) / 3600;
      },
    },
    fuse: {
      sig: 'fuse.instantFactor',
      doc: 'предохранитель из кода: perAmp, offset, coolBelow, instantFactor, defaultAmps',
      v: e?.fuse ?? null,
    },
    fuseTicks: {
      sig: 'fuseTicks(ток, номинал)',
      doc: 'через сколько тиков сработает предохранитель (null — не сработает никогда)',
      v: (i: number, rating: number) => {
        const f = e?.fuse;
        if (!f || i < f.coolBelow) return null;
        return stepsToTemp(i, Math.max(0, f.perAmp * (rating - f.offset)), needHeat(), 72000);
      },
    },
    ieCapacitors: {
      sig: 'ieCapacitors',
      doc: 'конденсаторы IE: name (lv/mv/hv), label, block, storage (FE), input / output (FE/t), wh — запас в Вт·ч EE, kw — отдача в кВт EE (по курсу преобразователя)',
      v: (data.ie?.capacitors ?? []).map((c) => {
        const g = (k: string) => s.ie(`machines.capacitors.${c.name}.${k}`)?.value ?? null;
        const rate = s.ee('wattFeTConversionRate')?.value ?? null;
        const storage = g('storage');
        const input = g('input');
        const output = g('output');
        return {
          ...c,
          label: CAPACITOR_LABEL[c.name] ?? c.name,
          storage,
          input,
          output,
          wh: storage !== null && rate ? (storage * rate) / 20 / 3600 : null,
          kwIn: input !== null && rate ? (input * rate) / 1000 : null,
          kw: output !== null && rate ? (output * rate) / 1000 : null,
        };
      }),
    },
    ieWires: {
      sig: 'ieWires',
      doc: 'провода IE: name, short (LV/MV/HV), connector (FE/t на ввод коннектора), maxLength, transferRate',
      v: (data.ie?.wires ?? []).map((w) => ({
        ...w,
        label: IE_WIRE[w.name]?.short ?? w.name,
        short: IE_WIRE[w.name]?.short ?? w.name,
        connector: s.ie(`wires.${w.name}.wireConnectorInput`)?.value ?? (div ? w.transferRate / div : null),
      })),
    },
  };

  const settingGet: Record<string, Get> = { ee: s.ee, ie: s.ie, att: s.att, create: s.create };
  return {
    values: { ...BASE_VALUES, ...Object.fromEntries(Object.entries(defs).map(([k, { v }]) => [k, v])) },
    docs: { ...BASE_DOCS, ...Object.fromEntries(Object.entries(defs).map(([k, { sig, doc }]) => [k, { sig, doc }])) },
    setting: (path) => {
      const get = Object.hasOwn(settingGet, path[0]) ? settingGet[path[0]] : null;
      const st = get && path.length > 1 ? get(path.slice(1).join('.')) : null;
      if (!st) return null;
      return {
        origin: CONFIG_ORIGIN_LABEL[st.origin],
        changed: st.origin !== 'default' && st.default !== null && st.default !== st.value,
        default: st.default,
      };
    },
  };
}
