import { createFileStore, type StoredFile } from 'firestore-files';
import { authReady, db } from '../firebase';
import filesConfig from './files.config';

/**
 * Вложения задач. Firebase Storage на бесплатном тарифе недоступен, поэтому файлы хранятся
 * в Firestore кусками — пакетом firestore-files (метаданные в files/{id}, содержимое в files/{id}/chunks/{n}).
 * Здесь — тонкая обёртка с API, к которому привыкли компоненты.
 */
export type FileMeta = StoredFile<{ taskId: string | null; author: string }>;

const store = db
  ? createFileStore<{ taskId: string | null; author: string }>(db, filesConfig, { ready: () => authReady })
  : null;

export const filesEnabled = Boolean(store);
export const MAX_FILE_SIZE = filesConfig.maxFileSize;

const requireStore = () => {
  if (!store) throw new Error('Вложения доступны только с подключённым Firebase');
  return store;
};

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function subscribeFiles(cb: (files: FileMeta[]) => void, onError?: (e: Error) => void): () => void {
  if (!store) {
    queueMicrotask(() => cb([]));
    return () => {};
  }
  return store.subscribe([], cb, onError);
}

export async function uploadFile(
  file: File,
  opts: { taskId: string | null; author: string },
  onProgress?: (fraction: number) => void,
): Promise<string> {
  if (file.size > MAX_FILE_SIZE) throw new Error(`Файл больше ${formatSize(MAX_FILE_SIZE)}`);
  const f = await requireStore().upload(file, { meta: opts, onProgress });
  return f.id;
}

/** Собирает файл из кусков (кешируется пакетом) */
export const fileBlob = (f: FileMeta | string) => requireStore().read(f);
/** object URL для показа картинки в <img> */
export const fileUrl = (f: FileMeta) => requireStore().objectUrl(f);
export const downloadFile = (f: FileMeta) => requireStore().download(f);
export const removeFile = (f: FileMeta | string) => requireStore().remove(f);
