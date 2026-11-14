import { useCallback, useEffect, useRef, useState } from 'react';
import { filesEnabled } from '@/entities/file';
import { isImage, prepareFile, startUpload, validateFiles, type Uploader } from '@/lib/uploads';

/**
 * Общий вход для файлов из кнопок, drag&drop и буфера обмена: проверка размера, сжатие картинок,
 * затем — загрузка (существующая задача) или добавление в черновик. Ctrl+V с картинкой в любом месте окна.
 */
export function useFileIntake(
  target:
    | { taskId: string; author: string; upload?: Uploader; maxSize?: number }
    | { addPending: (files: File[]) => void; maxSize?: number },
) {
  const [error, setError] = useState<string | null>(null);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });

  const add = useCallback(async (list: File[]) => {
    setError(null);
    const prepared = await Promise.all(list.map(prepareFile));
    const t = targetRef.current;
    const { ok, error } = validateFiles(prepared, t.maxSize);
    setError(error);
    if ('addPending' in t) t.addPending(ok);
    else ok.forEach((f) => startUpload(f, t.taskId, t.author, t.upload));
  }, []);

  useEffect(() => {
    if (!filesEnabled) return;
    const onPaste = (e: ClipboardEvent) => {
      // Картинку уже вставил в текст редактор описания
      if (e.defaultPrevented) return;
      const images = [...(e.clipboardData?.files ?? [])].filter(isImage);
      if (!images.length) return;
      e.preventDefault();
      add(images);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [add]);

  return { add, error };
}
