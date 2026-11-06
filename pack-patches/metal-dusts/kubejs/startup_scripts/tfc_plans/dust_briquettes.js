// Брикеты чистой пыли. Рецепты и масса заданы в metal_dusts.js.
StartupEvents.registry('item', (event) => {
  const names = {
    copper: 'меди',
    iron: 'железа',
    lead: 'свинца',
    nickel: 'никеля',
    silver: 'серебра',
    gold: 'золота',
    aluminum: 'алюминия',
    uranium: 'урана',
    zinc: 'цинка',
    chromium: 'хрома',
    tin: 'олова',
    bismuth: 'висмута',
    steel: 'стали',
    rhodium: 'родия',
    palladium: 'палладия',
    platinum: 'платины',
    electrum: 'электрума',
    constantan: 'константана',
  };
  const sizes = {
    mini: 'Мини-брикет',
    small: 'Малый брикет',
    ingot: 'Брикет',
    double: 'Двойной брикет',
    large: 'Большой брикет',
  };
  Object.entries(names).forEach(([metal, name]) => {
    Object.entries(sizes).forEach(([size, label]) => {
      event
        .create('dust_briquette/' + size + '/' + metal)
        .displayName(label + ' чистой пыли ' + name)
        .texture('destroy_extras:item/dust_briquette/' + size + '/' + metal);
    });
  });
});

StartupEvents.registry('fluid', (event) => {
  event.create('molten_platinum').displayName('Расплавленная платина').tint(0xd6d6cb).noBucket().noBlock();
  event.create('molten_palladium').displayName('Расплавленный палладий').tint(0xcac9d2).noBucket().noBlock();
  event.create('molten_rhodium').displayName('Расплавленный родий').tint(0xb7bbc1).noBucket().noBlock();
});
