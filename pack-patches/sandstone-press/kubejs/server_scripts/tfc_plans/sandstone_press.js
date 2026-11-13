// Сырой песчаник TFC из песка того же цвета: уплотнение Create с известковой водой как связкой.
// 4 песка + 250 мБ известковой воды → 1 блок. Известь делает цикл «песчаник → дробилка IE → песок + селитра» платным.
ServerEvents.recipes((event) => {
  const colors = ['brown', 'white', 'black', 'red', 'yellow', 'green', 'pink'];
  colors.forEach((color) => {
    const sand = { item: `tfc:sand/${color}` };
    event
      .custom({
        type: 'create:compacting',
        ingredients: [sand, sand, sand, sand, { type: 'neoforge:single', fluid: 'tfc:limewater', amount: 250 }],
        results: [{ id: `tfc:raw_sandstone/${color}` }],
      })
      .id(`tfc_plans:sandstone/compacting/${color}`);
  });
});
