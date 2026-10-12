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
  /** Свой счётчик роста (виноград): прирост за обновление от min до max, обновление раз в interval тиков; стадия — при 1 */
  grow?: { min: number; max: number; interval: number };
  /** Проверяется только температура, влажность на рост не влияет */
  tempOnly?: boolean;
  /** Качество урожая: что считается вокруг лозы (радиус) и при каких условиях плод получает черту еды */
  quality?: {
    radius: number | null;
    traits: { trait: string; when: { l: string; op: string; r: string | number }[] }[];
  };
  /** Что падает со спелой культуры (loot-таблица): byYield — количество зависит от ухода */
  drops?: { item: string; min: number; max: number; byYield?: boolean }[];
  /** Где используется плод: число рецептов и предметы на выходе (сначала того же мода) */
  uses?: { recipes: number; items: string[]; generic?: number };
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
  /** Предел счётчика порчи спелой культуры (в долях полного роста) */
  EXPIRY_LIMIT?: number;
  /** Сколько плодов даёт один сбор, по классу блока растения: { SeasonalPlantBlock: [1, 1], BananaPlantBlock: [3, 6] } */
  pick?: Record<string, [number, number]>;
  /** Минимальная яркость для роста культуры (CropHelpers.lightValid) */
  minLight?: number;
  /** Почвы: тег пашни и множитель из кода (применяется к возврату элементов в почву) */
  soil?: { tag: string; mul: number; blocks: string[] }[];
  /** Уровни теплицы Firmalife по возрастанию: материал стен → уровень */
  /** Константы роста в теплице (Firmalife Mechanics) — та же формула, что у культур */
  greenhouseGrowth?: { GROWTH_FACTOR: number; NUTRIENT_GROWTH_FACTOR: number };
  /** Черты еды и множитель порчи по умолчанию (меньше 1 — хранится дольше) */
  foodTraits?: Record<string, number>;
  greenhouseTiers?: { i: string; tier: number; e: string; r?: string; walls?: string }[];
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

/** Растение теплицы Firmalife (data/<ns>/firmalife/plantable) */
export interface GreenhousePlant {
  i: string;
  n: string;
  src: string;
  crop?: string;
  cropCount?: number;
  seed?: string;
  /** Тип грядки: large, quad, trellis, bonsai, hanging, hydroponic */
  planter?: string;
  /** Минимальный уровень теплицы */
  tier?: number;
  stages?: number;
  /** Шанс лишнего семени при сборе, 0–1 */
  extraSeed?: number;
  npk?: [number, number, number];
}

export const PLANTER_LABEL: Record<string, string> = {
  large: 'большая грядка',
  quad: 'грядка на четыре',
  trellis: 'шпалера',
  bonsai: 'горшок для дерева',
  hanging: 'подвесная грядка',
  hydroponic: 'гидропоника',
};

export type BotanySub = PlantKind | 'greenhouse';

export interface Botany {
  meta: BotanyMeta;
  entries: Plant[];
  greenhouse: GreenhousePlant[];
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
  // Рост за тик (CropHelpers.growthTickStep): GROWTH_FACTOR / множитель конфига — всегда, плюс
  // NUTRIENT_CONSUMPTION × NUTRIENT_GROWTH_FACTOR, если почва даёт всё, что культура просит.
  // Множитель из конфига замедляет только первую часть: 2 — вдвое дольше без удобрений.
  const rate = meta.GROWTH_FACTOR / modifier;
  const bonus = (meta.NUTRIENT_CONSUMPTION ?? 0) * (meta.NUTRIENT_GROWTH_FACTOR ?? 0);
  return { base: 1 / rate / 24000, best: 1 / (rate + bonus) / 24000 };
}

/**
 * Сколько суток спелая культура простоит до гибели без удобрений: после созревания прирост копится в счётчик
 * порчи до предела EXPIRY_LIMIT × множитель порчи / множитель роста, а копится он со скоростью роста.
 * Вне диапазона климата в этот же счётчик уходит весь прирост — культура не растёт и стареет.
 */
export function expiryDays(meta: BotanyMeta, expiryModifier = 1): number | null {
  if (!meta.GROWTH_FACTOR || !meta.EXPIRY_LIMIT) return null;
  return (meta.EXPIRY_LIMIT * expiryModifier) / meta.GROWTH_FACTOR / 24000;
}

export const PLANT_KIND_LABEL: Record<PlantKind, string> = {
  crop: 'Культуры',
  bush: 'Ягодные кусты',
  tree: 'Фруктовые деревья',
  plant: 'Виноград и прочее',
};

let promise: Promise<Botany | null> | null = null;
let loaded: Botany | null | undefined;

export function loadBotany(): Promise<Botany | null> {
  promise ??= fetch(`${import.meta.env.BASE_URL}botany.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Partial<Botany>>) : null))
    .then(
      (d) => (loaded = d?.entries ? { meta: d.meta ?? {}, entries: d.entries, greenhouse: d.greenhouse ?? [] } : null),
    )
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

/** Что считает обход вокруг лозы: теги блоков и служебные счётчики → слово в родительном падеже */
export const QUALITY_COUNT_LABEL: Record<string, string> = {
  'minecraft:dirt': 'земли',
  'tfc:grass': 'травы',
  'c:gravels': 'гравия',
  air_below: 'пустых блоков уровнем ниже лозы',
  air_level: 'пустых блоков на уровне лозы',
};

export const FOOD_TRAIT_LABEL: Record<string, string> = {
  BEE_POLLINATED: 'Опылено пчёлами',
  DIRT_GROWN: 'Выращено на земле',
  GRAVEL_GROWN: 'Выращено на гравии',
  SLOPE_GROWN: 'Выращено на склоне',
};

/** Условие черты словами: «земли больше, чем гравия», «пустых блоков … меньше 33», «рядом улей с маткой» */
export function qualityCondition(c: { l: string; op: string; r: string | number }): string {
  if (c.l === 'bees') return 'рядом улей с маткой';
  const left = QUALITY_COUNT_LABEL[c.l] ?? c.l;
  const word = c.op === '>' ? 'больше' : c.op === '<' ? 'меньше' : c.op === '>=' ? 'не меньше' : 'не больше';
  return typeof c.r === 'number' ? `${left} ${word} ${c.r}` : `${left} ${word}, чем ${QUALITY_COUNT_LABEL[c.r] ?? c.r}`;
}
