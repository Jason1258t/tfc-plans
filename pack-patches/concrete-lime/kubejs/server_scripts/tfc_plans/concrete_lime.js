// Общая основа: 3 песка + 3 гравия + 2 извести → 8 порций сухой смеси.
ServerEvents.recipes((event) => {
  const colors = [
    'white',
    'orange',
    'magenta',
    'light_blue',
    'yellow',
    'lime',
    'pink',
    'gray',
    'light_gray',
    'cyan',
    'purple',
    'blue',
    'brown',
    'green',
    'red',
    'black',
  ];
  const aggregate = { item: 'tfc:aggregate' };
  const dryIngredients = [
    { tag: 'c:sands' },
    { tag: 'c:sands' },
    { tag: 'c:sands' },
    { tag: 'c:gravels' },
    { tag: 'c:gravels' },
    { tag: 'c:gravels' },
    { item: 'tfc:powder/lime' },
    { item: 'tfc:powder/lime' },
  ];
  const add = (name, recipe) => event.custom(recipe).id(`tfc_plans:concrete/${name}`);

  // Удаляем только исходное производство; обработку готовых блоков и бочки TFC сохраняем.
  [
    'tfc:crafting/aggregate',
    'immersiveengineering:crafting/concrete',
    'immersiveengineering:mixer/concrete',
    'rnr:crafting/concrete_powder',
  ].forEach((id) => event.remove({ id }));
  colors.forEach((color) => {
    event.remove({ id: `minecraft:${color}_concrete_powder` });
    event.remove({ id: `createdieselgenerators:mixing/${color}_concrete` });
  });

  add('aggregate', {
    type: 'minecraft:crafting_shapeless',
    ingredients: dryIngredients,
    result: { id: 'tfc:aggregate', count: 8 },
  });

  colors.forEach((color) => {
    const dye = { item: `minecraft:${color}_dye` };
    const powder = `minecraft:${color}_concrete_powder`;
    add(`${color}_powder`, {
      type: 'minecraft:crafting_shapeless',
      ingredients: dryIngredients.concat([dye]),
      result: { id: powder, count: 8 },
    });
    add(`${color}_powder_from_aggregate`, {
      type: 'minecraft:crafting_shapeless',
      ingredients: [aggregate, aggregate, aggregate, aggregate, aggregate, aggregate, aggregate, aggregate, dye],
      result: { id: powder, count: 8 },
    });
    // Одно ведро цветного бетона из одной порции: без прежнего возврата 25% порошка.
    add(`${color}_cement`, {
      type: 'create:mixing',
      ingredients: [{ type: 'neoforge:single', fluid: 'minecraft:water', amount: 100 }, { item: powder }],
      results: [{ id: `createdieselgenerators:${color}_cement`, amount: 1000 }],
    });
  });

  // Как в исходном рецепте IE: жидкостный ингредиент расходует воду из ёмкости.
  add('ie_blocks', {
    type: 'immersiveengineering:turn_and_copy',
    category: 'misc',
    group: 'ie_concrete',
    pattern: ['aaa', 'awa', 'aaa'],
    key: {
      a: aggregate,
      w: { type: 'immersiveengineering:fluid_stack', amount: 1000, tag: 'minecraft:water' },
    },
    quarter_turn: true,
    result: { id: 'immersiveengineering:concrete', count: 8 },
  });
  // MixingProcess IE замещает воду бетоном строго 1:1; энергия на ведро сохранена (6400 RF).
  add('ie_mixer', {
    type: 'immersiveengineering:mixer',
    energy: 6400,
    fluid: { amount: 1000, tag: 'minecraft:water' },
    inputs: [aggregate],
    result: { id: 'immersiveengineering:concrete', amount: 1000 },
  });
  // Дорожный состав использует ту же основу; штатные 200 мБ воды на порошок остаются в бочке RnR.
  add('rnr_powder', {
    type: 'minecraft:crafting_shapeless',
    ingredients: [aggregate],
    result: { id: 'rnr:concrete_powder', count: 1 },
  });

  // Переход aggregate → бетон IE оставлен в датапаке сайта «Бетон»; здесь его не дублируем.
});
