import { useEffect, useState } from 'react';
import { formatSize, MAX_FILE_SIZE, uploadFile } from './files';

export const isImage = (f: { type: string; name: string }) =>
  f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name);

const MAX_SIDE = 2560;

/**
 * Скриншоты сжимаем в WebP (стороны до 2560 px): Retina-скриншот в PNG весит 3–8 МБ, в WebP — сотни КБ,
 * то есть обычно один кусок в Firestore. GIF (анимация) и SVG не трогаем, как и картинки, которые не уменьшились.
 */
export async function prepareFile(file: File): Promise<File> {
  if (!isImage(file) || /gif|svg/i.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 });
    if (blob.size >= file.size && scale === 1) return file;
    // Из буфера обмена картинка приходит как «image.png» — даём осмысленное имя
    const pasted = /^image\.(png|jpe?g)$/i.test(file.name);
    const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-');
    const base = pasted ? `скриншот_${stamp}` : file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.webp`, { type: 'image/webp' });
  } catch {
    return file;
  }
}

/** Проверка размера; возвращает подходящие файлы и текст ошибки про остальные */
export function validateFiles(files: File[]): { ok: File[]; error: string | null } {
  const tooBig = files.filter((f) => f.size > MAX_FILE_SIZE);
  return {
    ok: files.filter((f) => f.size <= MAX_FILE_SIZE),
    error: tooBig.length ? `Больше ${formatSize(MAX_FILE_SIZE)}: ${tooBig.map((f) => f.name).join(', ')}` : null,
  };
}

// ---------------------------------------------------------------- загрузки в процессе

export interface UploadItem {
  key: string;
  taskId: string;
  name: string;
  image: boolean;
  /** object URL локального файла — превью картинки, пока она грузится */
  preview?: string;
  progress: number;
  error?: string;
}

let items: UploadItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const patch = (key: string, p: Partial<UploadItem>) => {
  items = items.map((x) => (x.key === key ? { ...x, ...p } : x));
  emit();
};

/** Загружает уже подготовленный файл; прогресс виден всем компонентам через useUploads */
export function startUpload(file: File, taskId: string, author: string) {
  const key = `${Date.now()}-${Math.random()}`;
  const image = isImage(file);
  items = [
    ...items,
    { key, taskId, name: file.name, image, preview: image ? URL.createObjectURL(file) : undefined, progress: 0 },
  ];
  emit();
  uploadFile(file, { taskId, author }, (progress) => patch(key, { progress })).then(
    () => dismissUpload(key),
    (e) => patch(key, { error: e instanceof Error ? e.message : String(e) }),
  );
}

export function dismissUpload(key: string) {
  const it = items.find((x) => x.key === key);
  if (it?.preview) setTimeout(() => URL.revokeObjectURL(it.preview!), 2000);
  items = items.filter((x) => x.key !== key);
  emit();
}

export function useUploads(taskId: string | undefined): UploadItem[] {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return taskId ? items.filter((x) => x.taskId === taskId) : [];
}
