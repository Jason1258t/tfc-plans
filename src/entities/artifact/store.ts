import { createCollectionStore, createLiveList } from '@/shared/api';
import type { Artifact, NewArtifact } from './types';

/** Коллекция документов-планов: Firestore `artifacts` */
export const artifactsStore = createCollectionStore<Artifact, NewArtifact>('artifacts');

/** Документы-планы: подписка запускается при первом потребителе списка. */
export const useArtifacts = createLiveList<Artifact>((onItems, onError) => artifactsStore.subscribe(onItems, onError));
