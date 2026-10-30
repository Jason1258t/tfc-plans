/** Схема из библиотеки и избранные замены блоков: модель и коллекции. Снаружи — `@/entities/schematic`. */
export type { NewReplaceFavorite, NewSavedSchematic, ReplaceFavorite, SavedSchematic } from './types';
export { replaceFavoritesStore, schematicsStore } from './store';
export { libraryEntry, libraryParsed, schematicLink } from './library';
export {
  agentReplace,
  applyRules,
  changesIn,
  editedSource,
  exportSchematic,
  invalidTargets,
  loadSchematic,
  shapedSize,
  DEFAULT_SHAPE,
  EMPTY_BLOCKS,
  REMOVE,
  countBlocks,
  intList,
  nameOf,
  paletteLists,
  posOf,
} from './schematic';
export type { AgentFailure, AgentResult, Rule, RuleResult, Schematic, Shape, Vec } from './schematic';
export {
  blockNbtOf,
  buildGrid,
  canRedo,
  canUndo,
  cellInfo,
  connectedGroup,
  editCells,
  frameObject,
  namesByState,
  posOfIndex,
  propsByState,
  redoEdit,
  revertEdits,
  stateOf,
  undoEdit,
} from './schematicEdit';
export type { CellInfo, Grid } from './schematicEdit';
export { blockTopView } from './blockModels';
export { drawnByCode, isFullCube } from './schematicShape';
