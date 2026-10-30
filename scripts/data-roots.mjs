/**
 * Корни данных сборки в public/ (и на хостинге): их собирают разборщики из снимка сборки, а на сайт выкладывает
 * только сервер сборки (scripts/publish-data.mjs). Деплой сайта с машины разработчика (scripts/deploy-site.mjs)
 * их не трогает — берёт из текущего релиза. Новый выход разборщика — добавить сюда.
 */

/** Что собирает npm run mods (scripts/mods.mjs) */
export const MODS_OUTPUTS = [
  'items.json',
  'blocks.json',
  'block-colors.json',
  'icons',
  'recipes.json',
  'reference.json',
  'pack-manifest.json',
  'geo.json',
  'geo',
  'tags.json',
  'botany.json',
  'config-defaults.json',
  'meals.json',
  'power.json',
  'multiblocks.json',
  'multiblocks',
  'block-models',
];

/** Что собирает npm run kubejs (scripts/kubejs.mjs) */
export const KUBEJS_OUTPUTS = ['kubejs.json', 'kubejs-items.json', 'kubejs-data.json', 'icons-kubejs'];

export const DATA_ROOTS = [...MODS_OUTPUTS, ...KUBEJS_OUTPUTS];

/** Путь хостинга («/icons/a.png») лежит в корнях данных */
export function isDataPath(p) {
  const first = p.replace(/^\//, '').split('/')[0];
  return DATA_ROOTS.includes(first);
}
