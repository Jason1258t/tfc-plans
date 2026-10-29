/**
 * Данные пакета, общие для всего сайта: предметы с иконками, рецепты с фильтрами KubeJS, теги, нечёткий поиск.
 * Снаружи — `@/shared/pack-data`. Это «общий справочник»: знание о предметах нужно почти каждой странице, поэтому
 * слой общий, а не сущность (см. план FSD, раздел «Места, где нужно решение»).
 */
export type { ItemIndex, McBlock, McItem } from './items';
export { itemIconClasses } from './itemIconClasses';
export {
  blockEntry,
  blockIcon,
  guiIcon,
  iconUrl,
  inPack,
  isBlock,
  itemName,
  loadItems,
  matchItem,
  placedBy,
  searchItems,
  textureUrl,
  useItems,
} from './items';
export type { Candidate } from './fuzzy';
export { fuzzyCandidates } from './fuzzy';
export type {
  FieldStat,
  KjsRule,
  KubejsData,
  RawRecipe,
  Recipe,
  RecipeCatalog,
  RecipeOrigin,
  RecipeStatus,
} from './recipes';
export {
  STATUS_LABEL,
  hasStatus,
  itemRefsOf,
  kubejsHits,
  loadRecipes,
  recipePath,
  ruleIsIdOnly,
  searchRecipes,
  targetOf,
  typeFieldStats,
  useRecipes,
} from './recipes';
export type { FilterTarget, KjsFilter, Match } from '@tfc/core/recipeFilter';
export { filterKeys, filterToJs, matchFilter } from '@tfc/core/recipeFilter';
export { collectRefs, recipeRefs } from '@tfc/core/recipeRefs';
export type { KjsTagOp, McFluid, RawTag, Tag, TagCatalog, TagEdit, TagKind, TagSource } from './tags';
export {
  ID_RE,
  TAG_KINDS,
  TAG_KIND_LABEL,
  baseMembers,
  directMembers,
  flattenTag,
  kindsOf,
  loadTags,
  memberName,
  parseTagFile,
  resultMembers,
  searchTags,
  sourceName,
  tagFileContent,
  tagFromPath,
  tagKey,
  tagPath,
  useTags,
} from './tags';
export { ItemIcon } from './ItemIcon';
export { ItemIdSearch } from './ItemIdSearch';
export { ItemPicker } from './ItemPicker';
export { RecipeStatusBadge } from './RecipeStatusBadge';

export { burnerHeat, burnerMode, burnerRate, mergeLiquidFuels } from '@tfc/core/liquidFuel';
export type { BlazeFuel, LiquidFuels, LiquidFamily, LiquidStack, FuelRecipe, EngineStats } from '@tfc/core/liquidFuel';
