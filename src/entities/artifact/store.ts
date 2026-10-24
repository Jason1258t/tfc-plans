import { create } from 'zustand';
import { createCollectionStore } from '@/shared/api';
import type { Artifact, NewArtifact } from './types';

/** Коллекция документов-планов: Firestore `artifacts` */
export const artifactsStore = createCollectionStore<Artifact, NewArtifact>('artifacts');

interface ArtifactList {
  items: Artifact[];
  /** Первый снимок коллекции ещё не пришёл */
  loading: boolean;
  error: string | null;
}

/** Документы-планы для страниц */
export const useArtifacts = create<ArtifactList>(() => ({ items: [], loading: true, error: null }));

let stop: (() => void) | null = null;

export function startArtifacts(): () => void {
  if (stop) return stop;
  const unsub = artifactsStore.subscribe(
    (artifacts) => useArtifacts.setState({ items: artifacts, loading: false, error: null }),
    (e) => useArtifacts.setState({ loading: false, error: e.message }),
  );
  stop = () => {
    unsub();
    stop = null;
  };
  return stop;
}
