// Платиновая руда (сперрилит, PtAs₂) — единственный источник платины, палладия и родия в сборке (dev #362).
// Блок без своей добычи: таблица kubejs:blocks/ore/platinum лежит в датапаке «Платина — руда сперрилита»
// (без шёлка — кусок сперрилита, с шёлком — сам блок). Жила, теги и переработка — там же.
// Текстуры временные (перекраска никелевой руды Destroy и куска гарниерита TFC); под породы TFC — dev #363.
StartupEvents.registry('block', (event) => {
  event
    .create('ore/platinum')
    .displayName('Платиновая руда')
    .stoneSoundType()
    .hardness(6.5)
    .resistance(10)
    .requiresTool(true)
    .noDrops()
    .texture('kubejs:block/ore/platinum')
    .tagBlock('minecraft:mineable/pickaxe')
    .tagBlock('minecraft:needs_iron_tool')
    .tagBlock('immersiveengineering:mineable/drill')
    .tagBlock('immersiveengineering:mineable/rockcutter')
    .tagBlock('c:ores')
    .tagBlock('c:ores/platinum')
    .tagBlock('c:ores_in_ground/stone')
    .tagBlock('tfc:prospectable')
    .tagBlock('tfc:can_collapse')
    .tagBlock('tfc:can_start_collapse')
    .tagBlock('tfc:can_trigger_collapse')
    .tagBlock('tfc:powderkeg_breaking_blocks');
});

StartupEvents.registry('item', (event) => {
  event.create('ore/sperrylite').displayName('Сперрилит (платиновая руда)').texture('kubejs:item/ore/sperrylite');
});
