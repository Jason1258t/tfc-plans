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
  /** Множитель силы нагрева бурнера CDG */
  burner: number | null;
  /** Дизельный генератор IE */
  ieGenerator: { burnTime: number | null } | null;
  /** Горелка Create Liquid Fuel */
  blazeBurner: { burnTime: number | null; superHeat: boolean; perTick: number } | null;
  /** Топливо обычной горелки: только конкретные жидкости, без переноса по тегу */
  blazeFuels?: BlazeFuel[];
  produce: FuelRecipe[];
  /** Где используется: жидкость на входе */
  use?: FuelRecipe[];
}

interface GeoLikeName {
  en: string | null;
  ru: string | null;
}

export interface BlazeFuel {
  id: string;
  source: string;
  fluid: string;
  burnTime: number;
  superHeat: boolean;
  /** Размер порции, а не постоянный расход за тик */
  perTick: number;
}

export interface LiquidFuels {
  families: LiquidFamily[];
  /** Исходные записи сохраняются для замены по ID ресурса */
  blazeFuels?: BlazeFuel[];
  namespaces?: string[];
}

/** Дефолты LiquidBurnerFuelJsonLoader.apply, проверено в CLF 2.1.1. */
export function readBlazeFuel(id: string, source: string, json: Record<string, unknown>): BlazeFuel | null {
  if (typeof json.fluid !== 'string') return null;
  const superHeat = json.superHeat === true;
  return {
    id,
    source,
    fluid: json.fluid,
    superHeat,
    burnTime: typeof json.burnTime === 'number' ? json.burnTime : superHeat ? 32 : 20,
    perTick: typeof json.amountConsumedPerTick === 'number' ? json.amountConsumedPerTick : superHeat ? 10 : 1,
  };
}

/** Одинаковое слияние для сайта и MCP; поздний слой заменяет ресурс целиком по ID. */
export function mergeLiquidFuels(liquid: LiquidFuels, overrides: BlazeFuel[] = []): LiquidFuels {
  const records = new Map((liquid.blazeFuels ?? []).map((f) => [f.id, f]));
  for (const f of overrides) records.set(f.id, f);
  const families = liquid.families.map((f) => ({ ...f, blazeFuels: [] as BlazeFuel[] }));
  for (const fuel of records.values()) {
    if (liquid.namespaces && !liquid.namespaces.includes(fuel.fluid.split(':')[0])) continue;
    if (!Number.isInteger(fuel.burnTime) || fuel.burnTime <= 0 || !Number.isInteger(fuel.perTick) || fuel.perTick <= 0)
      continue;
    let family = families.find((f) => f.fluids.some((fluid) => fluid.id === fuel.fluid));
    if (!family) {
      family = {
        tag: fuel.fluid,
        fluids: [{ id: fuel.fluid, name: null, bucket: `${fuel.fluid}_bucket` }],
        engines: null,
        burner: null,
        ieGenerator: null,
        blazeBurner: null,
        produce: [],
        use: [],
        blazeFuels: [],
      };
      families.push(family);
    }
    // Два разных ресурса с одним fluid в игре также перезаписывают друг друга.
    family.blazeFuels = [...family.blazeFuels.filter((f) => f.fluid !== fuel.fluid), fuel];
  }
  return { ...liquid, families, blazeFuels: [...records.values()] };
}

/** Float-арифметика и double-пороги BurnerBlockEntity.calculateHeatLevel (CDG 1.3.8). */
export function burnerHeat(multiplier: number, valve: number): number {
  return Math.fround(Math.fround(1 + Math.fround(valve)) * Math.fround(multiplier));
}

export function burnerMode(heat: number): string {
  return heat >= 1.8 ? 'перегрев' : heat >= 1.2 ? 'нагрев' : heat >= 1 ? 'тление' : 'нет нагрева';
}

/** Один полный цикл счётчика CDG; Java float remainder и приведение к int. */
export function burnerRate(valve: number): number {
  if (valve <= 0) return 0;
  const interval = Math.fround(10 / Math.fround(valve));
  let consumed = 0;
  for (let tick = 0; tick < 40000; tick++) if (Math.trunc(Math.fround(tick % interval)) === 0) consumed++;
  return consumed / 2000;
}
