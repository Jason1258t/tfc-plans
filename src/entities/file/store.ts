import { create } from 'zustand';
import { subscribeFiles, type FileMeta } from '@/lib/files';

interface FileList {
  items: FileMeta[];
  error: string | null;
}

/** Вложения задач и исходники схем: список из хранилища файлов (Firestore или свой сервер) */
export const useFiles = create<FileList>(() => ({ items: [], error: null }));

let stop: (() => void) | null = null;

export function startFiles(): () => void {
  if (stop) return stop;
  const unsub = subscribeFiles(
    (files) => useFiles.setState({ items: files, error: null }),
    (e) => useFiles.setState({ error: e.message }),
  );
  stop = () => {
    unsub();
    stop = null;
  };
  return stop;
}
