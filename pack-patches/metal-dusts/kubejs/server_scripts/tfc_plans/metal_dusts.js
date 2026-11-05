// Единая система пылей чистых металлов (dev-задача #212).
// Основная пыль — destroy_extras:<металл>_dust. Новый металл — одна строка в METAL_DUSTS.
// Дубли (пыли IE и Destroy) перенаправляются на основную пыль, только если их предмет есть в сборке.
// Фильтр {} не покрывает часть рецептов (проверено на стенде), поэтому остальные id перечислены явно.

const METAL_DUSTS = [
  {
    metal: 'copper',
    dust: 'destroy_extras:copper_dust',
    ingot: 'tfc:metal/ingot/copper',
    fluid: 'tfc:metal/copper',
    temperature: 1080,
    aliases: ['immersiveengineering:dust_copper', 'destroy:copper_powder'],
  },
  {
    metal: 'iron',
    dust: 'destroy_extras:iron_dust',
    ingot: 'tfc:metal/ingot/wrought_iron',
    fluid: 'tfc:metal/wrought_iron',
    temperature: 1535,
    aliases: ['immersiveengineering:dust_iron', 'destroy:iron_powder'],
  },
  {
    metal: 'lead',
    dust: 'destroy_extras:lead_dust',
    ingot: 'immersiveengineering:ingot_lead',
    fluid: 'tfc_ie_addon:metal/lead',
    temperature: 330,
    aliases: ['immersiveengineering:dust_lead', 'destroy:lead_powder'],
  },
  {
    metal: 'nickel',
    dust: 'destroy_extras:nickel_dust',
    ingot: 'tfc:metal/ingot/nickel',
    fluid: 'tfc:metal/nickel',
    temperature: 1453,
    aliases: ['immersiveengineering:dust_nickel', 'destroy:nickel_powder'],
  },
  {
    metal: 'silver',
    dust: 'destroy_extras:silver_dust',
    ingot: 'tfc:metal/ingot/silver',
    fluid: 'tfc:metal/silver',
    temperature: 961,
    aliases: ['immersiveengineering:dust_silver'],
  },
  {
    metal: 'gold',
    dust: 'destroy_extras:gold_dust',
    ingot: 'tfc:metal/ingot/gold',
    fluid: 'tfc:metal/gold',
    temperature: 1060,
    aliases: ['immersiveengineering:dust_gold'],
  },
  {
    metal: 'aluminum',
    dust: 'destroy_extras:aluminum_dust',
    ingot: 'immersiveengineering:ingot_aluminum',
    fluid: 'tfc_ie_addon:metal/aluminum',
    temperature: 1550,
    aliases: ['immersiveengineering:dust_aluminum'],
  },
  {
    metal: 'uranium',
    dust: 'destroy_extras:uranium_dust',
    ingot: 'immersiveengineering:ingot_uranium',
    fluid: 'tfc_ie_addon:metal/uranium',
    temperature: 1130,
    aliases: ['immersiveengineering:dust_uranium'],
  },
  {
    metal: 'zinc',
    dust: 'destroy_extras:zinc_dust',
    ingot: 'tfc:metal/ingot/zinc',
    fluid: 'tfc:metal/zinc',
    temperature: 420,
    aliases: ['destroy:zinc_powder'],
  },
  {
    metal: 'chromium',
    dust: 'destroy_extras:chromium_dust',
    ingot: 'firmalife:metal/ingot/chromium',
    fluid: 'firmalife:metal/chromium',
    temperature: 1250,
    aliases: ['destroy:chromium_powder'],
  },
  {
    metal: 'tin',
    dust: 'destroy_extras:tin_dust',
    ingot: 'tfc:metal/ingot/tin',
    fluid: 'tfc:metal/tin',
    temperature: 230,
    aliases: [],
  },
  {
    metal: 'bismuth',
    dust: 'destroy_extras:bismuth_dust',
    ingot: 'tfc:metal/ingot/bismuth',
    fluid: 'tfc:metal/bismuth',
    temperature: 270,
    aliases: [],
  },
  {
    metal: 'constantan',
    dust: 'destroy_extras:constantan_dust',
    ingot: 'immersiveengineering:ingot_constantan',
    fluid: 'tfc_ie_addon:metal/constantan',
    temperature: 1250,
    aliases: ['immersiveengineering:dust_constantan'],
  },
  {
    metal: 'electrum',
    dust: 'destroy_extras:electrum_dust',
    ingot: 'immersiveengineering:ingot_electrum',
    fluid: 'tfc_ie_addon:metal/electrum',
    temperature: 1000,
    aliases: ['immersiveengineering:dust_electrum'],
  },
  {
    metal: 'steel',
    dust: 'destroy_extras:steel_dust',
    ingot: 'tfc:metal/ingot/steel',
    fluid: 'tfc:metal/steel',
    temperature: 1540,
    aliases: ['immersiveengineering:dust_steel'],
  },
  {
    metal: 'platinum',
    dust: 'destroy_extras:platinum_dust',
    ingot: 'destroy:platinum_ingot',
    fluid: 'kubejs:molten_platinum',
    temperature: 1768,
    customFluid: true,
    aliases: ['destroy:platinum_powder'],
  },
  {
    metal: 'palladium',
    dust: 'destroy_extras:palladium_dust',
    ingot: 'destroy:palladium_ingot',
    fluid: 'kubejs:molten_palladium',
    temperature: 1555,
    customFluid: true,
    aliases: ['destroy:palladium_powder'],
  },
  {
    metal: 'rhodium',
    dust: 'destroy_extras:rhodium_dust',
    ingot: 'destroy:rhodium_ingot',
    fluid: 'kubejs:molten_rhodium',
    temperature: 1964,
    customFluid: true,
    aliases: ['destroy:rhodium_powder'],
  },
];

// Эти рецепты расходуют реактив. Остальные потребители сохраняют цену одной пыли как слитка.
const DUST_CHEMISTRY = ['destroy:mixing/slime_ball', 'destroy_extras:metallurgy/cement_copper'];

// Электролиз Destroy выдаёт пыль по id в results, фильтр replaceOutput его не видит: рецепт пересоздаётся
// по JSON из destroy 0.4.6-eligibbs (concentration 0.4, amount 25, 200 тиков).
const ELECTROLYSIS = [
  { metal: 'copper', molecule: 'destroy:copper_ii' },
  { metal: 'iron', molecule: 'destroy:iron_iii' },
  { metal: 'lead', molecule: 'destroy:lead_ii' },
  { metal: 'nickel', molecule: 'destroy:nickel_ion' },
  { metal: 'chromium', molecule: 'destroy:chromium_iii' },
  { metal: 'zinc', molecule: 'destroy:zinc_ion' },
];

// Слитковый брикет сохраняет выбранное соотношение 14:1.
const DUST_BRIQUETTES = [
  { size: 'mini', count: 2 },
  { size: 'small', count: 7 },
  { size: 'ingot', count: 14 },
  { size: 'double', count: 28 },
  { size: 'large', count: 56 },
];
const DustHeatDefinition = Java.loadClass('net.dries007.tfc.common.component.heat.HeatDefinition');

function dustBriquette(metal, size) {
  return 'kubejs:dust_briquette/' + size + '/' + metal;
}

ServerEvents.tags('item', (event) => {
  METAL_DUSTS.forEach((row) => {
    if (!Item.exists(row.dust)) return;
    row.aliases.forEach((alias) => {
      if (Item.exists(alias)) event.add('c:hidden_from_recipe_viewers', alias);
    });
  });
});

TFCEvents.data((event) => {
  METAL_DUSTS.forEach((row) => {
    if (!Item.exists(row.dust)) return;
    const forms = [{ item: row.dust, count: 1 }];
    DUST_BRIQUETTES.forEach((form) =>
      forms.push({
        item: dustBriquette(row.metal, form.size),
        count: form.count,
      }),
    );
    forms.forEach((form) => {
      if (!Item.exists(form.item)) return;
      const heat = new DustHeatDefinition(
        Ingredient.of(form.item),
        (form.count * 7) / 70,
        row.temperature * 0.6,
        row.temperature * 0.8,
      );
      event.heat(heat, 'tfc_plans:metal_dusts/' + form.item.split(':')[1]);
    });
  });
});

ServerEvents.recipes((event) => {
  const byMetal = Object.fromEntries(METAL_DUSTS.map((row) => [row.metal, row]));

  METAL_DUSTS.forEach((row) => {
    if (!Item.exists(row.dust)) {
      console.warn(`[metal_dusts] основная пыль ${row.dust} не найдена, металл ${row.metal} пропущен`);
      return;
    }
    const id = 'tfc_plans:metal_dusts/' + row.metal;
    const pure = pureIngot(1, row.ingot, row.metal === 'iron' ? 'wrought_iron' : row.metal).basePredicate;
    const dust = { item: row.dust };
    const crushed = { id: row.dust, count: 14 };

    for (const oldId of [
      'immersiveengineering:crusher/ingot_' + row.metal,
      'immersiveengineering:arcfurnace/dust_' + row.metal,
      'destroy:crushing/' + row.metal + '_powder',
      'destroy:crushing/' + row.metal + '_powder_from_sheet',
      'destroy:smelting/' + row.metal + '_from_powder',
      'destroy:blasting/' + row.metal + '_from_powder',
    ])
      event.remove({ id: oldId });

    event
      .custom({
        type: 'immersiveengineering:crusher',
        input: pure,
        result: crushed,
        energy: 3000,
      })
      .id(id + '/crusher');
    event
      .custom({
        type: 'create:crushing',
        ingredients: [pure],
        results: [crushed],
        processing_time: 100,
      })
      .id(id + '/crushing');
    event
      .custom({
        type: 'immersiveengineering:arc_furnace',
        input: { basePredicate: dust, count: 14 },
        additives: [],
        results: [{ id: row.ingot }],
        time: 100,
        energy: 51200,
      })
      .id(id + '/arc_furnace');
    event
      .custom({
        type: 'tfc:heating',
        ingredient: dust,
        result_fluid: { id: row.fluid, amount: 7 },
        temperature: row.temperature,
      })
      .id(id + '/heating');

    if (row.customFluid) {
      event
        .custom({
          type: 'tfc:casting',
          break_chance: 0.1,
          fluid: { fluid: row.fluid, amount: 100 },
          mold: { item: 'tfc:ceramic/ingot_mold' },
          result: { id: row.ingot },
        })
        .id(id + '/casting');
    }

    DUST_BRIQUETTES.forEach((form, index) => {
      const item = dustBriquette(row.metal, form.size);
      if (!Item.exists(item)) return;
      const formId = id + '/briquette/' + form.size;
      const ingredient = { item: item };
      const source = index < 2 ? row.dust : dustBriquette(row.metal, DUST_BRIQUETTES[index - 1].size);
      const count = index < 2 ? form.count : 2;
      const inputs = [];
      for (let i = 0; i < count; i++) inputs.push(source);
      event.shapeless(item, inputs).id(formId + '/pack');
      event.recipes.create.compacting(item, inputs).id(formId + '/compact');
      event.shapeless(Item.of(source, count), [item]).id(formId + '/unpack');
      event
        .custom({
          type: 'tfc:heating',
          ingredient: ingredient,
          result_fluid: { id: row.fluid, amount: form.count * 7 },
          temperature: row.temperature,
        })
        .id(formId + '/heating');
      if (form.size === 'ingot') {
        event
          .custom({
            type: 'immersiveengineering:crusher',
            input: ingredient,
            result: crushed,
            energy: 3000,
          })
          .id(formId + '/crusher');
        event
          .custom({
            type: 'create:crushing',
            ingredients: [ingredient],
            results: [crushed],
            processing_time: 100,
          })
          .id(formId + '/crushing');
      }
      if (index === 0) return;
      const outputCount = Math.max(1, form.count / 14);
      event
        .custom({
          type: 'immersiveengineering:arc_furnace',
          input: index === 1 ? { basePredicate: ingredient, count: 2 } : ingredient,
          additives: [],
          results: [{ id: row.ingot, count: outputCount }],
          time: 100 * outputCount,
          energy: 51200 * outputCount,
        })
        .id(formId + '/arc_furnace');
    });

    const filter = {
      not: { id: /^(tfc_plans:metal_dusts\/|destroy:mixing\/slime_ball$|destroy_extras:metallurgy\/cement_copper$)/ },
    };
    const ingotBriquette = dustBriquette(row.metal, 'ingot');
    event.replaceInput(filter, '#c:dusts/' + row.metal, ingotBriquette);
    row.aliases.forEach((alias) => {
      if (!Item.exists(alias)) return;
      event.remove({ type: 'minecraft:smelting', input: alias });
      event.remove({ type: 'minecraft:blasting', input: alias });
      event.replaceOutput({}, alias, row.dust);
      event.replaceInput(filter, alias, ingotBriquette);
      DUST_CHEMISTRY.forEach((recipeId) => event.replaceInput({ id: recipeId }, alias, row.dust));
      event.shapeless(row.dust, [alias]).id(id + '/convert/' + alias.replace(':', '/'));
    });
  });

  ELECTROLYSIS.forEach((el) => {
    const row = byMetal[el.metal];
    const recipeId = 'destroy:electrolysis/' + el.metal + '_electrolysis';
    if (!Item.exists(row.dust) || !Item.exists('destroy:' + el.metal + '_powder')) return;
    event.remove({ id: recipeId });
    event
      .custom({
        type: 'destroy:electrolysis',
        ingredients: [{ type: 'destroy:mixture_with_ion', molecule: el.molecule, concentration: 0.4, amount: 25 }],
        results: [{ id: row.dust }],
        processing_time: 200,
      })
      .id(recipeId);
  });
});
