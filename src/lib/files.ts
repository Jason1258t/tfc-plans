import { getToken } from 'firebase/app-check';
import { appCheck, auth, authReady, db } from '../firebase';
import filesConfig from './files.config';
import { firestoreAdapter } from './fileStorage/firestore';
import { serverAdapter } from './fileStorage/server';
import type { FileAdapter, StoredFile } from './fileStorage/types';

/**
 * Вложения задач и исходники схем. Хранилище — за интерфейсом FileAdapter (lib/fileStorage):
 * - по умолчанию Firestore кусками, пакет firestore-files (Firebase Storage на бесплатном тарифе недоступен);
 * - если задан VITE_FILES_SERVER — свой сервер файлов (server/file-server).
 * Здесь — тонкая обёртка с API, к которому привыкли компоненты.
 */
/**
 * artifactId / descTaskId — картинка вставлена в текст плана / описания задачи: он ей владелец,
 * удаляется вместе с последней ссылкой (planImages)
 */
type Meta = { taskId: string | null; author: string; artifactId?: string; descTaskId?: string };
export type FileMeta = StoredFile<Meta>;

const serverUrl = import.meta.env.VITE_FILES_SERVER?.trim();

/** Заголовки для сервера файлов: ID-токен анонимного входа и токен App Check — по ним сервер отсекает чужих */
async function serverHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  const idToken = await auth?.currentUser?.getIdToken();
  if (idToken) h.Authorization = `Bearer ${idToken}`;
  if (appCheck) {
    const { token } = await getToken(appCheck, false);
    h['X-Firebase-AppCheck'] = token;
  }
  return h;
}

const store: FileAdapter<Meta> | null = serverUrl
  ? serverAdapter<Meta>({
      baseUrl: serverUrl,
      maxFileSize: filesConfig.maxFileSize,
      ready: () => authReady,
      headers: serverHeaders,
    })
  : db
    ? firestoreAdapter<Meta>(db, filesConfig, () => authReady)
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
  return store.subscribe(cb, onError);
}

export async function uploadFile(
  file: File,
  opts: { taskId: string | null; author: string; artifactId?: string; descTaskId?: string },
  onProgress?: (fraction: number) => void,
): Promise<string> {
  if (file.size > MAX_FILE_SIZE) throw new Error(`Файл больше ${formatSize(MAX_FILE_SIZE)}`);
  const f = await requireStore().upload(file, { meta: opts, onProgress });
  return f.id;
}

/** Содержимое файла (кешируется хранилищем) */
export const fileBlob = (f: FileMeta | string) => requireStore().read(f);
/** object URL для показа картинки в <img> (кешируется хранилищем) */
export const fileUrl = (f: FileMeta | string) => requireStore().objectUrl(f);
export const downloadFile = (f: FileMeta) => requireStore().download(f);
export const removeFile = (f: FileMeta | string) => requireStore().remove(f);
