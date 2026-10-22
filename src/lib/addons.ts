/**
 * Аддоны сборки — свои маленькие моды группы (исходники — tools/<мод>/ в репозитории, разработка — docs/addons.md).
 * Карточка аддона (версия, jar, кому ставить, блоки с рецептами) — tools/<мод>/addon.json рядом с исходниками, jar и
 * иконки — там же (jar — tools/<мод>/<jar>, иконки — tools/<мод>/icons/). Перед dev/build scripts/addons-index.mjs
 * кладёт их в public/addons/ и пишет /addons/index.json для программы tfc (`tfc pull addons`).
 * Подробное описание — статья в Firestore guides (раздел addon, id addon-<мод>), правится на сайте как гайд.
 */

export interface AddonRecipeKey {
  item: string;
  tag?: string;
  /** Картинка из icons/ аддона — для предметов самого аддона (их нет в библиотеке предметов) */
  image?: string;
  name?: string;
}

export interface AddonBlock {
  id: string;
  name: string;
  /** Картинка «вид сверху» из icons/ аддона */
  image?: string;
  /** Рецепт верстака: три строки по три символа и ключ (предмет или #тег; иконка тега — item) */
  recipe?: { pattern: string[]; key: Record<string, AddonRecipeKey> };
}

/** tools/<мод>/addon.json */
export interface AddonCard {
  id: string;
  name: string;
  version: string;
  /** Имя jar в папке исходников (и в /addons/ на сайте) */
  jar: string;
  /** Порядок в списке */
  order: number;
  /** Куда ставит `tfc pull addons` без имён: both — и клиенту, и серверу */
  side: 'both' | 'client' | 'server';
  summary: string;
  needs: string;
  /** Файлы сборки (путь от папки версии), которые аддон заменяет: `tfc pull addons` убирает их с копией */
  replaces?: string[];
  /** Не показывать в списке (диагностика): jar на сайте есть, карточки — нет */
  unlisted?: boolean;
  blocks: AddonBlock[];
}

export interface Addon extends AddonCard {
  /** Папка исходников в репозитории: tools/<мод> */
  source: string;
  /** Адрес jar на сайте */
  file: string;
}

const cards = import.meta.glob<AddonCard>('/tools/*/addon.json', { eager: true, import: 'default' });

export const ADDONS: Addon[] = Object.entries(cards)
  .map(([p, c]) => ({ ...c, source: p.slice(1, p.lastIndexOf('/')), file: `/addons/${c.jar}` }))
  .filter((a) => !a.unlisted)
  .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));

export const addonById = (id: string | undefined) => ADDONS.find((a) => a.id === id);

/** Статья аддона в guides: id документа — латиница, цифры и дефис */
export const addonGuideId = (id: string) => `addon-${id.replace(/_/g, '-')}`;
export const ADDON_GUIDE_SECTION = 'addon';

/** Картинка из icons/ аддона; version — в адрес: новая версия — новая иконка, а не старая из кеша браузера */
export const addonImage = (a: Pick<Addon, 'id' | 'version'>, file: string) =>
  `/addons/icons/${a.id}/${file}?v=${a.version}`;

/** Документация по разработке аддонов — в репозитории */
export type AddonsSub = 'list' | 'guides';
export const ADDONS_SUBS: { id: AddonsSub; label: string }[] = [
  { id: 'list', label: 'Аддоны сборки' },
  { id: 'guides', label: 'Как написать свой' },
];

export const ADDONS_DEV_DOC = 'https://github.com/Jason1258t/tfc-plans/blob/main/docs/addons.md';
export const REPO_TREE = 'https://github.com/Jason1258t/tfc-plans/tree/main/';
