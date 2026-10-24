import { createCollectionStore } from '@/shared/api';
import type { NewReplaceFavorite, NewSavedSchematic, ReplaceFavorite, SavedSchematic } from './types';

/** Коллекции библиотеки схем (`schematics`) и избранных замен (`replaceFavorites`) */
export const schematicsStore = createCollectionStore<SavedSchematic, NewSavedSchematic>('schematics');
export const replaceFavoritesStore = createCollectionStore<ReplaceFavorite, NewReplaceFavorite>('replaceFavorites');
