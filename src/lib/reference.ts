import { useEffect, useState } from 'react';
import type { ItemIndex } from './items';

/** Справочник сборки: public/reference.json, собирается scripts/reference.mjs вместе с библиотекой предметов */
export type Grade = 'poor' | 'normal' | 'rich' | 'single' | 'deposit';

export interface VeinItem {
  item: string;
  grade: Grade;
  /** Доля среди блоков жилы, % */
  share: number;
}

export interface Vein {
  id: string;
  source: string;
  type: string;
  kind: 'ore' | 'rock' | 'other';
  /** 1 жила на N чанков */
  rarity: number | null;
  density: number | null;
  size: number | null;
  height: number | null;
  radius: number | null;
  minY: number | null;
  maxY: number | null;
  rocks: string[];
  minerals: { mineral: string; items: VeinItem[] }[];
  indicator: { blocks: string[]; depth: number | null; rarity: number | null } | null;
}

export interface Smelt {
  fluid: string;
  mb: number;
  temp: number;
}

export interface ChainStep {
  item: string;
  /** Типы рецептов, которыми делается переход */
  methods: string[];
}

export interface Fuel {
  id: string;
  source: string;
  ingredient: string | null;
  items: string[];
  temp: number | null;
  /** В тиках */
  duration: number | null;
  purity: number | null;
}

export const NUTRIENTS = ['grain', 'fruit', 'vegetables', 'protein', 'dairy'] as const;
export type Nutrient = (typeof NUTRIENTS)[number];

export interface Food {
  id: string;
  source: string;
  ingredient: string | null;
  items: string[];
  hunger: number;
  saturation: number;
  water: number;
  decay: number;
  nutrients: Partial<Record<Nutrient, number>>;
}

export interface Metal {
  id: string;
  source: string;
  fluid: string | null;
  melt: number | null;
  specificHeat: number | null;
}

/** Вход/выход рецепта: жидкость (amount в mB), тег жидкости, предмет или тег предметов */
export interface LiquidStack {
  kind: 'fluid' | 'fluidTag' | 'item' | 'tag';
  id: string;
  amount?: number;
  count?: number;
  chance?: number;
  /** Для тегов предметов — первые предметы (иконка) */
  items?: string[];
}

export interface FuelRecipe {
  id: string;
  type: string;
  inputs: LiquidStack[];
  outputs: LiquidStack[];
  meta: { heat?: string; time?: number; energy?: number; catalyst?: LiquidStack | null };
}

export interface EngineStats {
  /** об/мин */
  speed: number;
  /** SU */
  strength: number;
  /** mB за тик */
  burnRate: number;
}

/** Семейство жидкого топлива (по общему тегу c:*) */
export interface LiquidFamily {
  tag: string;
  fluids: { id: string; name: GeoLikeName | null; bucket: string }[];
  /** Двигатели Create: Diesel Generators */
  engines: { normal: EngineStats | null; modular: EngineStats | null; huge: EngineStats | null } | null;
  /** Множитель времени горения в горелке Create (CDG) */
  burner: number | null;
  /** Дизельный генератор IE */
  ieGenerator: { burnTime: number | null } | null;
  /** Горелка Create Liquid Fuel */
  blazeBurner: { burnTime: number | null; superHeat: boolean; perTick: number } | null;
  produce: FuelRecipe[];
  /** Где используется: жидкость на входе */
  use?: FuelRecipe[];
}

interface GeoLikeName {
  en: string | null;
  ru: string | null;
}

export interface Reference {
  liquid?: { families: LiquidFamily[] };
  veins: Vein[];
  smelt: Record<string, Smelt>;
  chains: Record<string, ChainStep[]>;
  metals: Metal[];
  fuels: Fuel[];
  foods: Food[];
}

let promise: Promise<Reference | null> | null = null;
let loaded: Reference | null = null;

export function loadReference(): Promise<Reference | null> {
  promise ??= fetch(`${import.meta.env.BASE_URL}reference.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Reference>) : null))
    .catch(() => null)
    .then((ref) => (loaded = ref));
  return promise;
}

/** undefined — грузится, null — справочника нет (не собран) */
export function useReference(): Reference | null | undefined {
  const [ref, setRef] = useState<Reference | null | undefined>(loaded ?? undefined);
  useEffect(() => {
    if (ref === undefined) loadReference().then(setRef);
  }, [ref]);
  return ref;
}

// ---------------------------------------------------------------- подписи

export const GRADE_LABEL: Record<Grade, string> = {
  poor: 'бедная',
  normal: 'обычная',
  rich: 'богатая',
  single: 'руда',
  deposit: 'россыпь',
};

const VEIN_TYPE: Record<string, string> = {
  cluster_vein: 'скопление',
  pipe_vein: 'трубка',
  disc_vein: 'пласт',
  kaolin_disc_vein: 'пласт каолина',
};
export const veinTypeLabel = (t: string) => VEIN_TYPE[t] ?? t;

const VARIANT: Record<string, string> = {
  surface: 'Поверхностная',
  normal: 'Обычная',
  montane: 'Горная',
  deep: 'Глубинная',
  rich: 'Богатая',
  gabbro: 'В габбро',
  tuff: 'В туфе',
  fake: 'Ложная',
};
/** «tfc:vein/montane_native_copper» → «Горная»; единственная жила минерала — просто «Жила» */
export function veinVariant(v: Vein): string {
  const name = v.id.split('/').pop() ?? v.id;
  const first = name.split('_')[0];
  return VARIANT[first] ?? 'Жила';
}

/** Короткие названия способов обработки */
const METHOD: Record<string, string> = {
  'tfc:quern': 'жернов',
  'tfc:advanced_shapeless_crafting': 'молот',
  'minecraft:crafting_shapeless': 'верстак',
  'minecraft:crafting_shaped': 'верстак',
  'create:milling': 'жернова Create',
  'create:crushing': 'дробильные колёса',
  'create:splashing': 'промывка вентилятором',
  'create:pressing': 'пресс',
  'create:sequenced_assembly': 'сборочная линия',
  'create:mixing': 'механический смеситель',
  'immersiveengineering:crusher': 'дробилка IE',
  'immersiveengineering:metal_press': 'пресс IE',
  'tfc:barrel_sealed': 'бочка',
  'createdieselgenerators:distillation': 'дистилляционная колонна',
  'createdieselgenerators:basin_fermenting': 'брожение в чаше',
  'createdieselgenerators:bulk_fermenting': 'бродильный чан',
  'create:compacting': 'механический пресс + чаша',
  'immersiveengineering:fermenter': 'ферментер IE',
  'immersiveengineering:squeezer': 'выжималка IE',
  'immersiveengineering:refinery': 'очистительная установка IE',
  'immersiveengineering:coke_oven': 'коксовая печь IE',
  'immersiveengineering:mixer': 'смеситель IE',
  'tfc:barrel_instant': 'бочка',
};
export const methodLabel = (t: string) => METHOD[t] ?? t.split(':')[1]?.replaceAll('_', ' ') ?? t;

/**
 * Жидкий металл → слиток (для иконки и названия): tfc:metal/copper → tfc:metal/ingot/copper.
 * Модовые металлы ищутся по нескольким схемам имён (IE: ingot_lead), «molten_x» и «inferior_x» — по основе.
 */
export function ingotOf(fluid: string, items: ItemIndex | null): string | null {
  const [ns, p] = fluid.split(':');
  const name = p
    ?.split('/')
    .pop()
    ?.replace(/^molten_/, '');
  if (!name || !items) return null;
  const base = name.replace(/^inferior_/, '');
  const candidates = [name, base].flatMap((n) => [
    `${ns}:metal/ingot/${n}`,
    `tfc:metal/ingot/${n}`,
    `immersiveengineering:ingot_${n}`,
    `${ns}:metal/double_ingot/${n}`,
  ]);
  return candidates.find((id) => items.byId.has(id)) ?? null;
}

/** Название металла: по слитку; низкосортные (tfc_alloy_ext) помечаются */
export function metalName(fluid: string, items: ItemIndex | null): string {
  const ingot = ingotOf(fluid, items);
  const it = ingot ? items?.byId.get(ingot) : undefined;
  const label = it ? (it.r ?? it.e) : (fluid.split('/').pop() ?? fluid).replaceAll('_', ' ');
  return /inferior_/.test(fluid) ? `${label} (низкосортный)` : label;
}

/** Длительность горения: тики → «12 мин» / «45 с» */
export function formatTicks(ticks: number | null): string {
  if (ticks == null) return '—';
  const s = ticks / 20;
  if (s < 90) return `${Math.round(s)} с`;
  const m = s / 60;
  return m < 90 ? `${Math.round(m)} мин` : `${(m / 60).toFixed(1)} ч`;
}
