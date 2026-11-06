import { createCollectionStore, createLiveList, playerOnly } from '@/shared/api';
import type { Artifact, NewArtifact } from './types';

/** Коллекция документов-планов: Firestore `artifacts` */
export const artifactsStore = createCollectionStore<Artifact, NewArtifact>('artifacts');

/** Документы-планы: подписка запускается при первом потребителе списка; без ключа игрока — пусто. */
export const useArtifacts = createLiveList<Artifact>(
  playerOnly((onItems, onError) => artifactsStore.subscribe(onItems, onError)),
);
