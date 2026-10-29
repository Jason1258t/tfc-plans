/* Геология для вкладки справочника. Источник — TerraFirmaCraft-NeoForge-1.21.1-4.2.9.jar:
   категории — enum Rock / RockCategory, прочность инструментов — TFCTiers, слои — пресет мира
   data/tfc/worldgen/world_preset/overworld.json (rock_layer_settings; другого пресета в сборке нет),
   флюс — тег #tfc:fluxstone. Жилы руд по породам — из reference.json (собирается из jar). */

import type { Vein } from '@/lib/reference';

export type RockCategory = 'sedimentary' | 'metamorphic' | 'igneous_extrusive' | 'igneous_intrusive';
export type Acidity = 'felsic' | 'intermediate' | 'mafic';

export const CATEGORY: Record<RockCategory, { label: string; about: string; durability: number }> = {
  sedimentary: {
    label: 'Осадочные',
    about: 'образуются из накопленных частиц. Обычно верхний слой континентов; под ними — метаморфические породы.',
    durability: 50,
  },
  metamorphic: {
    label: 'Метаморфические',
    about: 'лежат под осадочными или магматическими породами, а в горах (районах поднятия) выходят на поверхность.',
    durability: 55,
  },
  igneous_extrusive: {
    label: 'Эффузивные магматические',
    about: 'застывшая на поверхности магма: верхний слой части континентов и всё дно океанов.',
    durability: 70,
  },
  igneous_intrusive: {
    label: 'Интрузивные магматические',
    about: 'застывшая под корой магма: глубоко под землёй, реже — в дайках и горах.',
    durability: 60,
  },
};

export const ACIDITY: Record<Acidity, string> = { felsic: 'кислая', intermediate: 'средняя', mafic: 'основная' };

interface RockDef {
  category: RockCategory;
  acidity?: Acidity;
}

/** enum Rock (порядок — как в моде). Туф в мире не появляется: в слоях пресета его нет */
export const ROCKS: Record<string, RockDef> = {
  granite: { category: 'igneous_intrusive', acidity: 'felsic' },
  diorite: { category: 'igneous_intrusive', acidity: 'intermediate' },
  gabbro: { category: 'igneous_intrusive', acidity: 'mafic' },
  shale: { category: 'sedimentary' },
  claystone: { category: 'sedimentary' },
  limestone: { category: 'sedimentary' },
  conglomerate: { category: 'sedimentary' },
  dolomite: { category: 'sedimentary' },
  chert: { category: 'sedimentary' },
  chalk: { category: 'sedimentary' },
  tuff: { category: 'sedimentary' },
  rhyolite: { category: 'igneous_extrusive', acidity: 'felsic' },
  basalt: { category: 'igneous_extrusive', acidity: 'mafic' },
  andesite: { category: 'igneous_extrusive', acidity: 'intermediate' },
  dacite: { category: 'igneous_extrusive', acidity: 'intermediate' },
  quartzite: { category: 'metamorphic' },
  slate: { category: 'metamorphic' },
  phyllite: { category: 'metamorphic' },
  schist: { category: 'metamorphic' },
  gneiss: { category: 'metamorphic' },
  marble: { category: 'metamorphic' },
};

/** #tfc:fluxstone — камешки этих пород годятся как флюс */
export const FLUX = new Set(['limestone', 'dolomite', 'chalk', 'marble']);

// rock_layer_settings пресета: слой → порода → слой под ней
const LAYERS: Record<string, Record<string, string>> = {
  felsic: { granite: 'bottom' },
  intermediate: { diorite: 'bottom' },
  mafic: { gabbro: 'bottom' },
  igneous_extrusive: { andesite: 'intermediate', basalt: 'mafic', dacite: 'intermediate', rhyolite: 'felsic' },
  igneous_extrusive_x2: {
    andesite: 'igneous_extrusive',
    basalt: 'igneous_extrusive',
    dacite: 'igneous_extrusive',
    rhyolite: 'igneous_extrusive',
  },
  igneous_intrusive: { diorite: 'intermediate', gabbro: 'mafic', granite: 'felsic' },
  high_grade: { gneiss: 'bottom', schist: 'bottom' },
  low_grade: { phyllite: 'high_grade', slate: 'high_grade' },
  marble: { marble: 'bottom' },
  quartzite: { quartzite: 'bottom' },
  sedimentary: {
    chalk: 'marble',
    chert: 'quartzite',
    claystone: 'low_grade',
    conglomerate: 'low_grade',
    dolomite: 'marble',
    limestone: 'marble',
    shale: 'low_grade',
  },
  uplift: {
    diorite: 'low_grade',
    gabbro: 'low_grade',
    gneiss: 'high_grade',
    granite: 'low_grade',
    marble: 'bottom',
    phyllite: 'high_grade',
    quartzite: 'bottom',
    schist: 'high_grade',
    slate: 'high_grade',
  },
};
const BOTTOM = ['gneiss', 'schist', 'diorite', 'granite', 'gabbro'];
/** Верхний слой по типу области */
const SURFACE: { id: string; label: string; layers: string[] }[] = [
  { id: 'land', label: 'суша', layers: ['sedimentary', 'igneous_extrusive'] },
  { id: 'ocean', label: 'дно океана', layers: ['igneous_extrusive'] },
  { id: 'uplift', label: 'горы (поднятие)', layers: ['uplift', 'sedimentary'] },
  {
    id: 'volcanic',
    label: 'вулканические области',
    layers: ['igneous_extrusive', 'igneous_extrusive_x2', 'igneous_intrusive'],
  },
];

const layerRocks = (layer: string): string[] => (layer === 'bottom' ? BOTTOM : Object.keys(LAYERS[layer] ?? {}));

export interface RockInfo {
  /** granite */
  key: string;
  /** tfc:rock/raw/granite */
  block: string;
  category: RockCategory;
  acidity?: Acidity;
  flux: boolean;
  /** Камень можно расколоть молотом в наковальню */
  anvil: boolean;
  /** Верхний слой в областях (подписи SURFACE) */
  surface: string[];
  /** Глубинный слой (bottom) — бывает под всем остальным */
  bottom: boolean;
  /** Генерируется ли вообще (туф — нет) */
  generates: boolean;
  below: string[];
  above: string[];
  veins: Vein[];
}

const sortUniq = (a: string[]) => [...new Set(a)];

/** Сведения о всех породах: что сверху/снизу по пресету, где верхний слой, какие жилы */
export function buildRocks(veins: Vein[]): RockInfo[] {
  const below = new Map<string, string[]>();
  const above = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, k: string, v: string[]) => m.set(k, [...(m.get(k) ?? []), ...v]);
  for (const layer of Object.values(LAYERS))
    for (const [rock, next] of Object.entries(layer)) {
      const under = layerRocks(next);
      add(below, rock, under);
      for (const u of under) add(above, u, [rock]);
    }
  const generated = new Set([...BOTTOM, ...Object.values(LAYERS).flatMap((l) => Object.keys(l))]);

  return Object.entries(ROCKS).map(([key, def]) => {
    const block = `tfc:rock/raw/${key}`;
    return {
      key,
      block,
      ...def,
      flux: FLUX.has(key),
      anvil: def.category.startsWith('igneous'),
      surface: SURFACE.filter((s) => s.layers.some((l) => key in (LAYERS[l] ?? {}))).map((s) => s.label),
      bottom: BOTTOM.includes(key),
      generates: generated.has(key),
      below: sortUniq((below.get(key) ?? []).filter((r) => r !== key)),
      above: sortUniq((above.get(key) ?? []).filter((r) => r !== key)),
      veins: veins.filter((v) => v.kind === 'ore' && v.rocks.includes(block)),
    };
  });
}
