import { fileUrl, uploadFile } from './files';
import { isImage, prepareFile, validateFiles } from './uploads';

/**
 * Картинки в Markdown планов: `![подпись](file:<id>)` — файл из хранилища (firestore-files, как вложения задач),
 * обычная ссылка `![](https://…)` тоже показывается. Пока файл грузится, в тексте стоит `![…](uploading:<ключ>)`.
 */
export const FILE_SCHEME = 'file:';
export const UPLOADING_SCHEME = 'uploading:';

/** Адрес для <img>: файл из хранилища — object URL, остальное как есть */
export const imageSrc = (src: string): Promise<string> =>
  src.startsWith(FILE_SCHEME) ? fileUrl(src.slice(FILE_SCHEME.length)) : Promise.resolve(src);

/** Подпись по имени файла: без расширения, без скобок, ломающих Markdown */
const caption = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '');

/**
 * Сжимает (WebP, стороны до 2560 px) и загружает картинки; возвращает Markdown для вставки.
 * Не картинки и слишком большие файлы пропускает — их список в `error`.
 */
export async function uploadImages(
  files: File[],
  opts: { taskId: string | null; author: string },
): Promise<{ markdown: string; error: string | null }> {
  const images = files.filter(isImage);
  const skipped = files.length - images.length;
  const prepared = await Promise.all(images.map(prepareFile));
  const { ok, error } = validateFiles(prepared);
  const parts: string[] = [];
  for (const f of ok) {
    const id = await uploadFile(f, opts);
    parts.push(`![${caption(f.name)}](${FILE_SCHEME}${id})`);
  }
  const notImages = skipped ? `не картинки пропущены: ${skipped}` : null;
  return { markdown: parts.join('\n'), error: [error, notImages].filter(Boolean).join('; ') || null };
}
