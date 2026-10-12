import { useEffect, useState } from 'react';

/** Ботаника (public/botany.json, собирает scripts/mods/botany.mjs): климатические диапазоны растений TFC и аддонов */
export type PlantKind = 'crop' | 'bush' | 'tree' | 'plant';

export interface PlantRange {
  /** °C */
  minT?: number;
  maxT?: number;
  /** Влажность, % */
  minH?: number;
  maxH?: number;
  /** Допуск за границей (°C и %): там растение уже не растёт, но ещё не гибнет */
  wigT?: number;
  wigH?: number;
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
  /** Из кода мода: расход азота, фосфора, калия (плюс — берёт из почвы, минус — возвращает) */
  npk?: [number, number, number];
  /** Число стадий роста (у двойных культур — нижняя и верхняя часть) */
  stages?: number[];
  /** Класс блока культуры: DefaultCropBlock, ClimbingCropBlock, FloodedCropBlock… */
  block?: string | null;
  /** Состояние по месяцам года (12 значений), порядок — meta.months */
  life?: (Lifecycle | null)[];
  /** Дней роста саженца дерева */
  growDays?: number;
  /** Высота раскидистого куста, блоков */
  maxHeight?: number;
  spreading?: boolean;
  /** Что падает со спелой культуры (loot-таблица): byYield — количество зависит от ухода */
  drops?: { item: string; min: number; max: number; byYield?: boolean }[];
  /** Где используется плод: число рецептов и предметы на выходе (сначала того же мода) */
  uses?: { recipes: number; items: string[] };
  /** Где растёт в природе: температура, грунтовая влага, лесистость (0–4), редкость «1 из N» */
  wild?: { minT?: number; maxT?: number; minW?: number; maxW?: number; minF?: number; maxF?: number; rarity?: number };
}

export type Lifecycle = 'DORMANT' | 'HEALTHY' | 'FLOWERING' | 'FRUITING';

export const LIFE_LABEL: Record<Lifecycle, string> = {
  DORMANT: 'покой',
  HEALTHY: 'растёт',
  FLOWERING: 'цветёт',
  FRUITING: 'плодоносит',
};

/** Что удалось узнать о культуре по классу её блока; неизвестный класс показывается как есть */
export const CROP_BLOCK_LABEL: Record<string, string> = {
  DefaultCropBlock: 'обычная',
  DoubleCropBlock: 'высокая, два блока',
  ClimbingCropBlock: 'вьющаяся, нужна жердь',
  PickableCropBlock: 'плоды срываются, куст остаётся',
  PickableClimbingCropBlock: 'вьющаяся, нужна жердь; плоды срываются',
  FloodedCropBlock: 'растёт в воде',
  SpreadingCropBlock: 'стелющаяся: плод вырастает рядом',
};

export interface BotanyMeta {
  /** Порядок месяцев из кода TFC: JANUARY… */
  months?: string[];
  /** Прирост роста за тик при множителе 1 (рост идёт от 0 до 1) */
  GROWTH_FACTOR?: number;
  /** Расход удобрения за тик на единицу расхода культуры */
  NUTRIENT_CONSUMPTION?: number;
  /** Насколько удобрения ускоряют рост (доля сверху) */
  NUTRIENT_GROWTH_FACTOR?: number;
  UPDATE_INTERVAL?: number;
  /** Сколько плодов даёт один сбор, по классу блока растения: { SeasonalPlantBlock: [1, 1], BananaPlantBlock: [3, 6] } */
  pick?: Record<string, [number, number]>;
  /** Минимальная яркость для роста культуры (CropHelpers.lightValid) */
  minLight?: number;
  /** Почвы: тег пашни и множитель из кода (применяется к возврату элементов в почву) */
  soil?: { tag: string; mul: number; blocks: string[] }[];
  /** Настройки модов, от которых зависят сроки: ключ в TOML и значение по умолчанию из кода */
  config?: Record<string, ConfigKey | undefined>;
}

export interface ConfigKey {
  /** Путь в TOML: blocks.crops.cropGrowthModifier */
  key: string;
  default: number | string | boolean | null;
  /** Имя файла конфига, как его называет NeoForge: tfc-server.toml */
  file: string | null;
  type: string;
  /** Где значение лежит в сохранении мира, если мир его хранит сам (npm run world) */
  world?: { file: string; key: string };
}

export interface Botany {
  meta: BotanyMeta;
  entries: Plant[];
}

const MONTH_RU: Record<string, string> = {
  JANUARY: 'янв',
  FEBRUARY: 'фев',
  MARCH: 'мар',
  APRIL: 'апр',
  MAY: 'май',
  JUNE: 'июн',
  JULY: 'июл',
  AUGUST: 'авг',
  SEPTEMBER: 'сен',
  OCTOBER: 'окт',
  NOVEMBER: 'ноя',
  DECEMBER: 'дек',
};
export const monthLabel = (m: string | undefined, i: number) => (m && MONTH_RU[m]) ?? String(i + 1);

/** Дней до созревания культуры без удобрений и с полными (24000 тиков в сутках) */
export function growthDays(meta: BotanyMeta, modifier = 1): { base: number; best: number } | null {
  if (!meta.GROWTH_FACTOR) return null;
  // Множитель из конфига умножает время роста: 2 — вдвое дольше
  const base = (1 / meta.GROWTH_FACTOR / 24000) * modifier;
  return { base, best: base / (1 + (meta.NUTRIENT_GROWTH_FACTOR ?? 0)) };
}

export const PLANT_KIND_LABEL: Record<PlantKind, string> = {
  crop: 'Культуры',
  bush: 'Ягодные кусты',
  tree: 'Фруктовые деревья',
  plant: 'Прочее',
};

let promise: Promise<Botany | null> | null = null;
let loaded: Botany | null | undefined;

export function loadBotany(): Promise<Botany | null> {
  promise ??= fetch(`${import.meta.env.BASE_URL}botany.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Partial<Botany>>) : null))
    .then((d) => (loaded = d?.entries ? { meta: d.meta ?? {}, entries: d.entries } : null))
    .catch(() => (loaded = null));
  return promise;
}

/** undefined — грузится, null — данных нет (не собраны) */
export function useBotany(): Botany | null | undefined {
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
