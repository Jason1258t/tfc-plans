// Переработка сперрилита (dev #362). Кусок руды ≈ обычная руда TFC: 3 чистые пыли платины = 21 мБ.
// Попутно — палладий и родий: в реальных месторождениях платиноиды идут вместе, а других источников в сборке нет.
// Дальше пыли идут штатной цепочкой metal_dusts.js: плавка TFC, дуговая печь, брикеты.
ServerEvents.recipes((event) => {
  const ORE = 'kubejs:ore/sperrylite';
  const PT = 'destroy_extras:platinum_dust';
  const PD = 'destroy_extras:palladium_dust';
  const RH = 'destroy_extras:rhodium_dust';

  // Дробилка IE — основной путь, выход выше.
  event
    .custom({
      type: 'immersiveengineering:crusher',
      input: { item: ORE },
      result: { id: PT, count: 3 },
      secondaries: [
        { chance: 0.25, output: { item: PT } },
        { chance: 0.5, output: { item: PD } },
        { chance: 0.2, output: { item: RH } },
      ],
      energy: 6000,
    })
    .id('tfc_plans:platinum_ore/crusher');

  // Дробильные колёса Create — доступнее, попутных металлов меньше.
  event
    .custom({
      type: 'create:crushing',
      ingredients: [{ item: ORE }],
      results: [
        { id: PT, count: 3 },
        { id: PD, chance: 0.3 },
        { id: RH, chance: 0.1 },
      ],
      processing_time: 250,
    })
    .id('tfc_plans:platinum_ore/crushing');
});
