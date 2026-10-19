/**
 * Хранилище вложений — общий интерфейс. Сейчас две реализации:
 * - firestore — пакет firestore-files (файлы кусками в Firestore, бесплатный тариф);
 * - server — свой сервер файлов (server/file-server, HTTP + SSE).
 * Компоненты работают только через src/lib/files.ts, какая реализация под ним — решает сборка (VITE_FILES_SERVER).
 * Формат записи один и тот же, id при переезде сохраняется (scripts/files-migrate.mjs) — ссылки из задач и схем не ломаются.
 */

/** Поля, которые задаёт само хранилище; свои поля (taskId, author) лежат рядом в той же записи */
export interface FileRecord {
  id: string;
  name: string;
  size: number;
  type: string;
  /** мс с 1970 */
  createdAt: number;
  /** hex; по нему сверяется содержимое при чтении и переезде */
  sha256?: string;
}

export type StoredFile<M extends object> = FileRecord & M;

export interface UploadOptions<M extends object> {
  meta: M;
  name?: string;
  type?: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface FileAdapter<M extends object> {
  /** для отладки и подписи в интерфейсе */
  readonly kind: 'firestore' | 'server';
  readonly maxFileSize: number;
  upload(data: Blob, opts: UploadOptions<M>): Promise<StoredFile<M>>;
  get(id: string): Promise<StoredFile<M> | null>;
  /** Все загруженные до конца файлы; onNext вызывается с полным списком при каждом изменении */
  subscribe(onNext: (files: StoredFile<M>[]) => void, onError?: (e: Error) => void): () => void;
  /** Содержимое (кешируется) */
  read(file: StoredFile<M> | string): Promise<Blob>;
  /** object URL для <img>; живёт до release() */
  objectUrl(file: StoredFile<M> | string): Promise<string>;
  release(id: string): void;
  /** Скачивание в браузере */
  download(file: StoredFile<M> | string): Promise<void>;
  remove(file: StoredFile<M> | string): Promise<void>;
}

/** Поля записи, которые нельзя передавать в meta */
export const RESERVED_FIELDS = ['id', 'name', 'size', 'type', 'createdAt', 'sha256', 'chunks', 'complete', 'uid'];
