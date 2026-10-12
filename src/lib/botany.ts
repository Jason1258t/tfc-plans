import { useEffect, useState } from 'react';

/** Ботаника (public/botany.json, собирает scripts/botany.mjs): климатические диапазоны растений TFC и аддонов */
export type PlantKind = 'crop' | 'bush' | 'tree' | 'plant';

export interface PlantRange {
  /** °C */
  minT?: number;
  maxT?: number;
  /** Влажность, % */
  minH?: number;
  maxH?: number;
}

export interface Plant {
  /** Id файла диапазона: tfc:wheat, tfc:red_apple_tree */
  i: string;
  k: PlantKind;
  /** Имя без суффикса _bush/_tree */
  n: string;
  /** jar-источник */
  src: string;
  r: PlantRange;
  /** Плод/урожай (предмет) */
  product?: string;
  seed?: string;
  plant?: string;
}

export const PLANT_KIND_LABEL: Record<PlantKind, string> = {
  crop: 'Культуры',
  bush: 'Ягодные кусты',
  tree: 'Фруктовые деревья',
  plant: 'Прочее',
};

let promise: Promise<Plant[] | null> | null = null;
let loaded: Plant[] | null | undefined;

export function loadBotany(): Promise<Plant[] | null> {
  promise ??= fetch(`${import.meta.env.BASE_URL}botany.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ entries: Plant[] }>) : null))
    .then((d) => (loaded = d?.entries ?? null))
    .catch(() => (loaded = null));
  return promise;
}

/** undefined — грузится, null — данных нет (не собраны) */
export function useBotany(): Plant[] | null | undefined {
  const [list, setList] = useState(loaded);
  useEffect(() => {
    if (list === undefined) loadBotany().then(setList);
  }, [list]);
  return list;
}

/** Попадает ли значение в диапазон (границы, которых нет в данных, не ограничивают) */
export const inRange = (v: number, min?: number, max?: number) =>
  (min === undefined || v >= min) && (max === undefined || v <= max);

const num = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');

/** «−7…22 °C», «от 25 %», «до 13,4 °C»; null — границ в данных нет */
export function rangeLabel(min: number | undefined, max: number | undefined, unit: string): string | null {
  if (min !== undefined && max !== undefined) return `${num(min)}…${num(max)} ${unit}`;
  if (min !== undefined) return `от ${num(min)} ${unit}`;
  if (max !== undefined) return `до ${num(max)} ${unit}`;
  return null;
}
