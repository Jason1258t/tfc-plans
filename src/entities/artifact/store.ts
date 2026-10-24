import { createCollectionStore } from '@/shared/api';
import type { Artifact, NewArtifact } from './types';

/** Коллекция документов-планов: Firestore `artifacts` */
export const artifactsStore = createCollectionStore<Artifact, NewArtifact>('artifacts');
