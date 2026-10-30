/**
 * Палитры — подобранные по цвету наборы блоков на все роли постройки. Стиль задаёт геометрию и отделку (русты,
 * каркас, свес), палитра — материалы; их можно сочетать как угодно, у палитры есть подходящие стили.
 *
 * Правила подбора (цвета — средний цвет текстуры грани в Lab, scripts/mods/block-colors.mjs; замеры 2026-10-30):
 * - стена — 3–4 варианта одного материала (для степени текстурирования): основной первым, потрескавшийся и
 *   замшелый — в хвосте, их доля мала;
 * - отделка (углы, пояса, перемычки, подоконники) — на 8–20 светлее или темнее стены по L*, без спорящего
 *   оттенка (разница по a и b небольшая), чтобы читалась, но не пестрила;
 * - цоколь и фундамент — темнее и грубее стены (булыжник);
 * - скат — контраст со стенами по светлоте, тёплый или холодный тёмный; у блока обязательно есть ступени и плита;
 * - каркас фахверка — тёмная древесина, заполнение — светлое (ΔL > 35).
 * Проверка сочетаемости — скрипт в отчёте задачи #166; новая палитра — запись здесь.
 */
import type { Role } from './grid.ts';
import type { RoleSpec } from './spec.ts';

export interface Palette {
  name: string;
  /** Для каких стилей подобрана (в интерфейсе — первыми) */
  styles: string[];
  roles: Partial<Record<Role, string[]>>;
}

export const PALETTES: Record<string, Palette> = {
  // ---------------------------------------------------------------- индустриальные: кирпич и бетон (приоритет)
  // Кирпич Create Deco: основной, длинный, короткий — почти одного цвета (ΔE ≤ 3), трещины и мох — в хвосте;
  // «угловой» вариант того же кирпича — для углов и простенков. Бетон IE (L 47, нейтральный) — пояса и цоколь.
  factoryRed: {
    name: 'Заводской красный кирпич',
    styles: ['industrial'],
    roles: {
      wall: [
        'minecraft:bricks',
        'createdeco:long_red_bricks',
        'createdeco:short_red_bricks',
        'createdeco:cracked_red_bricks',
        'createdeco:mossy_red_bricks',
      ],
      frame: ['createdeco:corner_red_bricks'],
      corner: ['createdeco:corner_red_bricks'],
      belt: ['immersiveengineering:concrete'],
      lintel: ['immersiveengineering:concrete'],
      sill: ['immersiveengineering:concrete'],
      parapet: ['immersiveengineering:concrete'],
      plinth: ['immersiveengineering:concrete_brick', 'immersiveengineering:concrete_brick_cracked'],
      foundation: ['immersiveengineering:concrete'],
      roof: ['create:cut_deepslate_bricks'],
      floor: ['immersiveengineering:concrete'],
      glass: ['create:industrial_iron_window_pane'],
      door: ['createdeco:industrial_iron_door'],
      chimney: ['minecraft:bricks'],
    },
  },
  concreteSteel: {
    name: 'Бетон и сталь',
    styles: ['industrial'],
    roles: {
      wall: [
        'immersiveengineering:concrete',
        'immersiveengineering:concrete_tile',
        'immersiveengineering:concrete_sprayed',
        'immersiveengineering:concrete_brick_cracked',
      ],
      frame: ['immersiveengineering:concrete_pillar'],
      corner: ['immersiveengineering:concrete_pillar'],
      belt: ['immersiveengineering:concrete_reinforced_tile'],
      lintel: ['immersiveengineering:storage_steel'],
      sill: ['immersiveengineering:storage_steel'],
      parapet: ['immersiveengineering:concrete_reinforced'],
      plinth: ['immersiveengineering:concrete_leaded'],
      foundation: ['immersiveengineering:concrete_reinforced'],
      roof: ['create:cut_deepslate_bricks'],
      floor: ['immersiveengineering:concrete'],
      glass: ['create:framed_glass_pane'],
      door: ['immersiveengineering:steel_door'],
      chimney: ['immersiveengineering:concrete_brick'],
    },
  },
  scarletClinker: {
    name: 'Клинкер и бетон',
    styles: ['industrial'],
    roles: {
      wall: [
        'immersiveengineering:clinker_brick',
        'createdeco:scarlet_bricks',
        'createdeco:long_scarlet_bricks',
        'createdeco:cracked_scarlet_bricks',
      ],
      frame: ['createdeco:corner_scarlet_bricks'],
      corner: ['createdeco:corner_scarlet_bricks'],
      belt: ['immersiveengineering:concrete'],
      lintel: ['immersiveengineering:concrete'],
      sill: ['immersiveengineering:concrete'],
      parapet: ['immersiveengineering:concrete'],
      plinth: ['create:cut_scorchia_bricks'],
      foundation: ['immersiveengineering:concrete'],
      roof: ['create:cut_scorchia_bricks'],
      floor: ['immersiveengineering:concrete'],
      glass: ['create:industrial_iron_window_pane'],
      door: ['immersiveengineering:steel_door'],
      chimney: ['immersiveengineering:clinker_brick'],
    },
  },
  duskBrick: {
    name: 'Тёмный кирпич и андезит',
    styles: ['industrial'],
    roles: {
      wall: [
        'createdeco:dusk_bricks',
        'createdeco:long_dusk_bricks',
        'createdeco:short_dusk_bricks',
        'createdeco:cracked_dusk_bricks',
      ],
      frame: ['createdeco:corner_dusk_bricks'],
      corner: ['createdeco:corner_dusk_bricks'],
      belt: ['create:cut_andesite'],
      lintel: ['create:cut_andesite'],
      sill: ['create:cut_andesite'],
      parapet: ['create:cut_andesite'],
      plinth: ['create:cut_scorchia_bricks'],
      foundation: ['immersiveengineering:concrete'],
      roof: ['create:cut_andesite_bricks'],
      floor: ['immersiveengineering:concrete'],
      glass: ['create:industrial_iron_window_pane'],
      door: ['createdeco:industrial_iron_door'],
      chimney: ['createdeco:dusk_bricks'],
    },
  },
  ochreBrick: {
    name: 'Жёлтый кирпич',
    styles: ['industrial'],
    roles: {
      wall: [
        'createdeco:dean_bricks',
        'createdeco:long_dean_bricks',
        'createdeco:short_dean_bricks',
        'createdeco:cracked_dean_bricks',
        'createdeco:mossy_dean_bricks',
      ],
      frame: ['createdeco:corner_dean_bricks'],
      corner: ['createdeco:corner_dean_bricks'],
      belt: ['createdeco:pearl_bricks'],
      lintel: ['createdeco:pearl_bricks'],
      sill: ['createdeco:pearl_bricks'],
      parapet: ['createdeco:pearl_bricks'],
      plinth: ['immersiveengineering:concrete_brick'],
      foundation: ['immersiveengineering:concrete'],
      roof: ['create:cut_deepslate_bricks'],
      floor: ['immersiveengineering:concrete'],
      glass: ['create:weathered_iron_window_pane'],
      door: ['createdeco:andesite_door'],
      chimney: ['createdeco:dean_bricks'],
    },
  },
  pearlBrick: {
    name: 'Светлый кирпич и сталь',
    styles: ['industrial'],
    roles: {
      wall: [
        'createdeco:pearl_bricks',
        'createdeco:long_pearl_bricks',
        'createdeco:short_pearl_bricks',
        'createdeco:cracked_pearl_bricks',
      ],
      frame: ['createdeco:corner_pearl_bricks'],
      corner: ['createdeco:corner_pearl_bricks'],
      belt: ['immersiveengineering:storage_steel'],
      lintel: ['immersiveengineering:storage_steel'],
      sill: ['immersiveengineering:storage_steel'],
      parapet: ['immersiveengineering:concrete'],
      plinth: ['immersiveengineering:concrete_brick'],
      foundation: ['immersiveengineering:concrete'],
      roof: ['create:cut_deepslate_bricks'],
      floor: ['immersiveengineering:concrete'],
      glass: ['create:industrial_iron_window_pane'],
      door: ['immersiveengineering:steel_door'],
      chimney: ['createdeco:pearl_bricks'],
    },
  },
  andesiteWorks: {
    name: 'Андезит Create',
    styles: ['industrial', 'stone'],
    roles: {
      wall: [
        'create:cut_andesite_bricks',
        'create:small_andesite_bricks',
        'create:cut_andesite',
        'create:layered_andesite',
      ],
      frame: ['create:polished_cut_andesite'],
      corner: ['create:polished_cut_andesite'],
      belt: ['immersiveengineering:storage_steel'],
      lintel: ['immersiveengineering:storage_steel'],
      sill: ['immersiveengineering:storage_steel'],
      parapet: ['create:polished_cut_andesite'],
      plinth: ['create:cut_deepslate_bricks'],
      foundation: ['immersiveengineering:concrete'],
      roof: ['create:cut_scorchia_bricks'],
      floor: ['immersiveengineering:concrete'],
      glass: ['create:framed_glass_pane'],
      door: ['create:andesite_door'],
      chimney: ['create:cut_deepslate_bricks'],
    },
  },
  // ---------------------------------------------------------------- камень, штукатурка, дерево TFC
  granite: {
    name: 'Серый гранит',
    styles: ['stone'],
    roles: {
      wall: [
        'tfc:rock/bricks/granite',
        'tfc:rock/smooth/granite',
        'tfc:rock/cracked_bricks/granite',
        'tfc:rock/mossy_bricks/granite',
      ],
      corner: ['tfc:rock/smooth/diorite'],
      belt: ['tfc:rock/smooth/diorite'],
      lintel: ['tfc:rock/smooth/diorite'],
      sill: ['tfc:rock/smooth/diorite'],
      plinth: ['tfc:rock/cobble/gabbro', 'tfc:rock/mossy_cobble/gabbro'],
      foundation: ['tfc:rock/cobble/gabbro'],
      roof: ['tfc:rock/bricks/dolomite'],
      floor: ['tfc:wood/planks/oak'],
      glass: ['minecraft:glass_pane'],
      door: ['tfc:wood/door/oak'],
      chimney: ['tfc:rock/bricks/gabbro'],
    },
  },
  limestone: {
    name: 'Светлый известняк',
    styles: ['stone'],
    roles: {
      wall: [
        'tfc:rock/bricks/limestone',
        'tfc:rock/smooth/limestone',
        'tfc:rock/cracked_bricks/limestone',
        'tfc:rock/mossy_bricks/limestone',
      ],
      corner: ['tfc:rock/smooth/chalk'],
      belt: ['tfc:rock/smooth/chalk'],
      lintel: ['tfc:rock/smooth/chalk'],
      sill: ['tfc:rock/smooth/chalk'],
      plinth: ['tfc:rock/cobble/conglomerate', 'tfc:rock/mossy_cobble/conglomerate'],
      foundation: ['tfc:rock/cobble/conglomerate'],
      roof: ['tfc:wood/planks/chestnut'],
      floor: ['tfc:wood/planks/oak'],
      glass: ['minecraft:glass_pane'],
      door: ['tfc:wood/door/chestnut'],
      chimney: ['minecraft:bricks'],
    },
  },
  redbrick: {
    name: 'Красный кирпич',
    styles: ['stone'],
    roles: {
      wall: ['minecraft:bricks', 'tfc:rock/bricks/chert', 'tfc:rock/cracked_bricks/chert'],
      corner: ['tfc:rock/smooth/limestone'],
      belt: ['tfc:rock/smooth/limestone'],
      lintel: ['tfc:rock/smooth/limestone'],
      sill: ['tfc:rock/smooth/limestone'],
      plinth: ['tfc:rock/cobble/andesite', 'tfc:rock/mossy_cobble/andesite'],
      foundation: ['tfc:rock/cobble/andesite'],
      roof: ['minecraft:deepslate_tiles'],
      floor: ['tfc:wood/planks/oak'],
      glass: ['minecraft:glass_pane'],
      door: ['tfc:wood/door/spruce'],
      chimney: ['minecraft:bricks'],
    },
  },
  basalt: {
    name: 'Тёмный базальт',
    styles: ['stone'],
    roles: {
      wall: [
        'tfc:rock/bricks/basalt',
        'tfc:rock/smooth/basalt',
        'tfc:rock/cracked_bricks/basalt',
        'tfc:rock/mossy_bricks/basalt',
      ],
      corner: ['tfc:rock/smooth/dacite'],
      belt: ['tfc:rock/smooth/dacite'],
      lintel: ['tfc:rock/smooth/dacite'],
      sill: ['tfc:rock/smooth/dacite'],
      plinth: ['tfc:rock/cobble/basalt', 'tfc:rock/mossy_cobble/basalt'],
      foundation: ['tfc:rock/cobble/basalt'],
      roof: ['tfc:wood/planks/sequoia'],
      floor: ['tfc:wood/planks/spruce'],
      glass: ['minecraft:glass_pane'],
      door: ['tfc:wood/door/sequoia'],
      chimney: ['tfc:rock/bricks/dacite'],
    },
  },
  plaster: {
    name: 'Белая штукатурка',
    styles: ['stone', 'timber'],
    roles: {
      wall: ['tfc:alabaster/polished/white', 'tfc:alabaster/bricks/white'],
      corner: ['tfc:alabaster/polished/light_gray'],
      belt: ['tfc:alabaster/polished/light_gray'],
      lintel: ['tfc:alabaster/polished/light_gray'],
      sill: ['tfc:alabaster/polished/light_gray'],
      plinth: ['tfc:rock/cobble/gabbro'],
      foundation: ['tfc:rock/cobble/gabbro'],
      roof: ['tfc:alabaster/bricks/red'],
      frame: ['tfc:wood/stripped_log/chestnut'],
      infill: ['tfc:alabaster/polished/white'],
      gable: ['tfc:alabaster/polished/white'],
      floor: ['tfc:wood/planks/oak'],
      glass: ['minecraft:glass_pane'],
      door: ['tfc:wood/door/chestnut'],
      chimney: ['minecraft:bricks'],
    },
  },
  timberWhite: {
    name: 'Фахверк: белое и орех',
    styles: ['timber'],
    roles: {
      wall: ['tfc:wattle/white'],
      infill: ['tfc:wattle/white'],
      frame: ['tfc:wood/stripped_log/chestnut'],
      lintel: ['tfc:wood/stripped_log/chestnut'],
      sill: ['tfc:wood/stripped_log/chestnut'],
      gable: ['tfc:wood/planks/chestnut'],
      plinth: ['tfc:rock/cobble/rhyolite', 'tfc:rock/mossy_cobble/rhyolite'],
      foundation: ['tfc:rock/cobble/rhyolite'],
      roof: ['tfc:wood/planks/acacia'],
      floor: ['tfc:wood/planks/oak'],
      glass: ['minecraft:glass_pane'],
      door: ['tfc:wood/door/chestnut'],
      chimney: ['minecraft:bricks'],
    },
  },
  timberOchre: {
    name: 'Фахверк: охра и гикори',
    styles: ['timber'],
    roles: {
      wall: ['tfc:wattle/yellow'],
      infill: ['tfc:wattle/yellow'],
      frame: ['tfc:wood/stripped_log/hickory'],
      lintel: ['tfc:wood/stripped_log/hickory'],
      sill: ['tfc:wood/stripped_log/hickory'],
      gable: ['tfc:wood/planks/hickory'],
      plinth: ['tfc:rock/cobble/limestone', 'tfc:rock/mossy_cobble/limestone'],
      foundation: ['tfc:rock/cobble/limestone'],
      roof: ['tfc:rock/bricks/dolomite'],
      floor: ['tfc:wood/planks/pine'],
      glass: ['minecraft:glass_pane'],
      door: ['tfc:wood/door/hickory'],
      chimney: ['tfc:rock/bricks/limestone'],
    },
  },
  pineLog: {
    name: 'Сосновый сруб',
    styles: ['log'],
    roles: {
      wall: ['tfc:wood/log/pine'],
      gable: ['tfc:wood/planks/pine'],
      plinth: ['tfc:rock/cobble/granite', 'tfc:rock/mossy_cobble/granite'],
      foundation: ['tfc:rock/cobble/granite'],
      roof: ['tfc:wood/planks/spruce'],
      floor: ['tfc:wood/planks/pine'],
      glass: ['minecraft:glass_pane'],
      door: ['tfc:wood/door/pine'],
      chimney: ['tfc:rock/cobble/granite'],
    },
  },
  darkLog: {
    name: 'Тёмный сруб',
    styles: ['log'],
    roles: {
      wall: ['tfc:wood/log/spruce'],
      gable: ['tfc:wood/planks/spruce'],
      plinth: ['tfc:rock/cobble/basalt', 'tfc:rock/mossy_cobble/basalt'],
      foundation: ['tfc:rock/cobble/basalt'],
      roof: ['tfc:wood/planks/hickory'],
      floor: ['tfc:wood/planks/spruce'],
      glass: ['minecraft:glass_pane'],
      door: ['tfc:wood/door/spruce'],
      chimney: ['tfc:rock/cobble/basalt'],
    },
  },
  sandstone: {
    name: 'Песчаник',
    styles: ['stone'],
    roles: {
      wall: ['tfc:cut_sandstone/yellow', 'tfc:smooth_sandstone/yellow', 'tfc:raw_sandstone/yellow'],
      corner: ['tfc:cut_sandstone/brown'],
      belt: ['tfc:cut_sandstone/brown'],
      lintel: ['tfc:cut_sandstone/brown'],
      sill: ['tfc:cut_sandstone/brown'],
      plinth: ['tfc:rock/cobble/conglomerate'],
      foundation: ['tfc:rock/cobble/conglomerate'],
      roof: ['tfc:wood/planks/palm'],
      floor: ['tfc:wood/planks/acacia'],
      glass: ['minecraft:glass_pane'],
      door: ['tfc:wood/door/acacia'],
      chimney: ['tfc:cut_sandstone/brown'],
    },
  },
};

/** Роли постройки с блоками палитры; включённость ролей (стиль) не трогает */
export function applyPalette(
  roles: Partial<Record<Role, RoleSpec>>,
  palette: Palette,
): Partial<Record<Role, RoleSpec>> {
  const out = { ...roles };
  for (const [role, ids] of Object.entries(palette.roles) as [Role, string[]][])
    out[role] = { ...out[role], fill: { ...out[role]?.fill, blocks: ids.map((id) => ({ id })) } };
  return out;
}
