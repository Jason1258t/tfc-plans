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
  } | null;
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
