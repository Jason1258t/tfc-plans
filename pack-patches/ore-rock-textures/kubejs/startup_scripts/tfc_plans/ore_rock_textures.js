// Вкрапления руды на сырой породе TFC. Добыча задана таблицами в kubejs/data.
StartupEvents.registry('block', (event) => {
  const rocks = {
    basalt: 'базальт',
    diorite: 'диорит',
    dolomite: 'доломит',
    gabbro: 'габбро',
    granite: 'гранит',
    limestone: 'известняк',
    marble: 'мрамор',
    rhyolite: 'риолит',
  };

  const ores = [
    {
      mineral: 'fluorite',
      name: 'Флюоритовая руда',
      tool: 'iron',
      rocks: ['granite', 'rhyolite', 'limestone', 'dolomite', 'marble'],
    },
    {
      mineral: 'titanium',
      name: 'Титановая руда',
      tool: 'diamond',
      rocks: ['gabbro', 'basalt', 'diorite', 'granite'],
    },
  ];

  ores.forEach((ore) => {
    ore.rocks.forEach((rock) => {
      const path = `ore/${ore.mineral}/${rock}`;
      const oreTag = `c:ores/${ore.mineral}`;
      event
        .create(path)
        .displayName(`${ore.name} (${rocks[rock]})`)
        .stoneSoundType()
        .hardness(3)
        .resistance(3)
        .requiresTool(true)
        .texture(`kubejs:block/${path}`)
        .tagBlock('minecraft:mineable/pickaxe')
        .tagBlock(`minecraft:needs_${ore.tool}_tool`)
        .tagBlock('tfc:prospectable')
        .tagBlock('c:ores')
        .tagBlock(oreTag)
        .tagBlock('c:ores_in_ground/stone')
        .tagItem('c:ores')
        .tagItem(oreTag)
        .tagItem('c:ores_in_ground/stone');
    });
  });
});
