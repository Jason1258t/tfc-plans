import type { Firestore } from 'firebase/firestore';
import { createFileStore, type FileStoreConfig } from 'firestore-files';
import type { FileAdapter, StoredFile } from './types';

/** Реализация на пакете firestore-files: метаданные в {collection}/{id}, содержимое в {collection}/{id}/chunks/{n} */
export function firestoreAdapter<M extends object>(
  db: Firestore,
  config: FileStoreConfig,
  ready: () => Promise<unknown>,
): FileAdapter<M> {
  const store = createFileStore<M>(db, config, { ready });
  return {
    kind: 'firestore',
    maxFileSize: store.config.maxFileSize,
    upload: (data, { meta, name, type, onProgress, signal }) =>
      store.upload(data, { meta, name, type, onProgress, signal }),
    get: (id) => store.get(id),
    subscribe: (onNext, onError) => store.subscribe([], onNext, onError),
    read: (f) => store.read(f as StoredFile<M> & { chunks: number; complete: boolean }),
    objectUrl: (f) => store.objectUrl(f as StoredFile<M> & { chunks: number; complete: boolean }),
    release: (id) => store.release(id),
    download: (f) => store.download(f as StoredFile<M> & { chunks: number; complete: boolean }),
    remove: (f) => store.remove(f as StoredFile<M> & { chunks: number; complete: boolean }),
  };
}
