import { useMemo } from 'react';
import {
  downloadFile,
  fileUrl,
  filesEnabled,
  MAX_FILE_SIZE,
  removeFile,
  useFiles,
  type FileMeta,
} from '@/entities/file';

/** Вложение, как его показывают галерея и список: хранилище может быть любым */
export interface TaskFile {
  id: string;
  name: string;
  size: number;
  type: string;
  author: string;
  createdAt: number;
}

/**
 * Откуда берутся вложения задачи. По умолчанию — общее хранилище файлов сайта (Firestore); задачи разработки
 * передают свой источник — сервер сборки (dev #357), чтобы страница «Разработка» не читала Firestore.
 */
export interface FileSource {
  enabled: boolean;
  /** Файлы этой задачи */
  files: TaskFile[];
  /** Сообщение, если список не загрузился */
  error?: string | null;
  maxSize: number;
  url(f: TaskFile): Promise<string>;
  download(f: TaskFile): Promise<void>;
  remove(f: TaskFile): Promise<void>;
}

/** Общее хранилище сайта: одна подписка на все файлы, отбор по taskId */
export function useStoreSource(taskId: string | undefined): FileSource {
  const { items, error } = useFiles();
  return useMemo(() => {
    const files = taskId ? items.filter((f) => f.taskId === taskId) : [];
    return {
      enabled: filesEnabled,
      files,
      error,
      maxSize: MAX_FILE_SIZE,
      url: (f) => fileUrl(f as FileMeta),
      download: (f) => downloadFile(f as FileMeta),
      remove: (f) => removeFile(f as FileMeta),
    };
  }, [items, error, taskId]);
}
