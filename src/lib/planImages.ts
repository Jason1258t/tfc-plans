import type { Artifact, Task } from '../types';
import { fileUrl, removeFile, uploadFile, type FileMeta } from './files';
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
  opts: { taskId: string | null; author: string; artifactId: string },
): Promise<{ markdown: string; error: string | null; ids: string[] }> {
  const images = files.filter(isImage);
  const skipped = files.length - images.length;
  const prepared = await Promise.all(images.map(prepareFile));
  const { ok, error } = validateFiles(prepared);
  const parts: string[] = [];
  const ids: string[] = [];
  for (const f of ok) {
    const id = await uploadFile(f, opts);
    ids.push(id);
    parts.push(`![${caption(f.name)}](${FILE_SCHEME}${id})`);
  }
  const notImages = skipped ? `не картинки пропущены: ${skipped}` : null;
  return { markdown: parts.join('\n'), error: [error, notImages].filter(Boolean).join('; ') || null, ids };
}

// ---------------------------------------------------------------- уборка: картинки без ссылок не копятся в базе

const FILE_REF = /\(file:([A-Za-z0-9_-]+)\)/g;

/** id файлов, на которые ссылается Markdown */
export const fileRefs = (text: string) => new Set([...text.matchAll(FILE_REF)].map((m) => m[1]));

/** Картинку плана из чужого плана или описания задачи могли скопировать вместе с текстом — такие не трогаем */
function usedElsewhere(artifactId: string, artifacts: Artifact[], tasks: Task[]) {
  const used = new Set<string>();
  for (const a of artifacts) if (a.id !== artifactId) for (const id of fileRefs(a.content)) used.add(id);
  for (const t of tasks) for (const id of fileRefs(t.description ?? '')) used.add(id);
  return used;
}

/**
 * Удаляет картинки, загруженные в план, на которые больше нет ссылок ни в нём, ни в других планах и задачах.
 * only — удалять лишь из этого списка (то, что видел этот редактор); minAge — не трогать свежие
 * (в чужом открытом редакторе ссылка на только что загруженную картинку могла ещё не сохраниться).
 */
export function removeOrphanImages(
  artifactId: string,
  content: string,
  data: { files: FileMeta[]; artifacts: Artifact[]; tasks: Task[] },
  opts: { only?: Set<string>; minAge?: number } = {},
): string[] {
  const owned = data.files.filter((f) => f.artifactId === artifactId);
  if (!owned.length) return [];
  const used = usedElsewhere(artifactId, data.artifacts, data.tasks);
  for (const id of fileRefs(content)) used.add(id);
  const now = Date.now();
  const orphans = owned.filter(
    (f) => !used.has(f.id) && (!opts.only || opts.only.has(f.id)) && (!opts.minAge || now - f.createdAt >= opts.minAge),
  );
  // Без ожидания: закрытие редактора не должно ждать сети; не удалось — уберётся при следующем открытии плана
  for (const f of orphans) removeFile(f.id).catch(() => {});
  return orphans.map((f) => f.id);
}
