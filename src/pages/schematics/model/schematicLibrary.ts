import { schematicsStore } from '@/entities/schematic';
import type { SavedSchematic } from '@/entities/schematic';
import { fileBlob, removeFile, uploadFile } from '@/entities/file';
import type { ItemIndex } from '@/shared/pack-data';
import { editedSource, loadSchematic, type Schematic } from '@/lib/schematic';
import { savedEdits } from '@/lib/schematicFile';

/**
 * Библиотека схем. Исходник .nbt — в хранилище файлов без привязки к задаче, в записи — имя и замены.
 * Файл с заменами собирается при скачивании, поэтому замены можно поправить в любой момент.
 */

/** Только замены блоков, которые есть в этой схеме */
const replaceList = (s: Schematic, replace: Map<string, string>) =>
  [...replace].filter(([from]) => s.counts.has(from)).map(([from, to]) => ({ from, to }));

const blockTotal = (s: Schematic) => [...s.counts.values()].reduce((a, n) => a + n, 0);

/**
 * Сохранить в библиотеку. Блоки правили по клеткам (редактор слоёв) — исходник загружается заново
 * с правками, старый файл удаляется после того, как запись перешла на новый.
 */
export async function saveToLibrary(
  s: Schematic,
  replace: Map<string, string>,
  nick: string,
  preview?: string | null,
): Promise<{ id: string; fileId?: string }> {
  const edited = s.rev !== (s.savedRev ?? 0);
  const withPreview = preview ? { preview } : {};
  if (s.libraryId) {
    if (!edited) {
      await schematicsStore.update(s.libraryId, {
        replace: replaceList(s, replace),
        shape: s.shape,
        updatedBy: nick,
        ...withPreview,
      });
      return { id: s.libraryId };
    }
    const file = await editedSource(s);
    const fileId = await uploadFile(file, { taskId: null, author: nick });
    await schematicsStore.update(s.libraryId, {
      fileId,
      fileSize: file.size,
      blocks: blockTotal(s),
      replace: replaceList(s, replace),
      shape: s.shape,
      updatedBy: nick,
      ...withPreview,
    });
    if (s.libraryFileId)
      await removeFile(s.libraryFileId).catch((e) => console.error('Не удалось удалить прежний файл схемы:', e));
    return { id: s.libraryId, fileId };
  }
  const file = await editedSource(s);
  const fileId = await uploadFile(file, { taskId: null, author: nick });
  const id = await schematicsStore.add({
    name: s.fileName.replace(/\.nbt$/i, ''),
    fileName: s.fileName,
    fileId,
    fileSize: file.size,
    size: s.size,
    blocks: blockTotal(s),
    replace: replaceList(s, replace),
    shape: s.shape,
    author: nick,
    updatedBy: nick,
    ...withPreview,
  });
  return { id, fileId };
}

/** Схема из библиотеки с её заменами — для редактора и для скачивания */
export async function openFromLibrary(
  entry: SavedSchematic,
): Promise<{ schematic: Schematic; replace: Map<string, string> }> {
  const blob = await fileBlob(entry.fileId);
  // Имя файла — по названию схемы: его могли поменять после загрузки, а скачивается файл под ним
  const safe = entry.name
    .replace(/\.nbt$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .trim();
  const schematic = await loadSchematic(new File([blob], `${safe || entry.fileName.replace(/\.nbt$/i, '')}.nbt`));
  schematic.key = `lib:${entry.id}`;
  schematic.libraryId = entry.id;
  schematic.libraryFileId = entry.fileId;
  const { replace, shape } = savedEdits(entry);
  schematic.shape = shape;
  return { schematic, replace };
}

export async function removeFromLibrary(entry: SavedSchematic) {
  await schematicsStore.remove(entry.id);
  // Файл — следом: запись уже не ссылается на него, даже если удаление файла сорвётся
  await removeFile(entry.fileId).catch((e) => console.error('Не удалось удалить файл схемы:', e));
}

/** Превью больше этого не пишем в запись (лимит правил — 300 тыс. символов) */
const MAX_PREVIEW = 280_000;

/**
 * Нарисовать превью схемы в этом браузере (three.js грузится только здесь). null — не вышло:
 * нет WebGL, слишком большая схема или картинка; сохранению схемы это не мешает.
 */
export async function makePreview(s: Schematic, replace: Map<string, string>, items: ItemIndex) {
  try {
    const { renderPreview } = await import('@/lib/schematicRender');
    const url = await renderPreview(s, replace, items);
    return url.length <= MAX_PREVIEW ? url : null;
  } catch (e) {
    console.error('Превью схемы не нарисовано:', e);
    return null;
  }
}

/** Превью для записи, сохранённой раньше: исходник из хранилища → картинка → в запись */
export async function refreshPreview(entry: SavedSchematic, items: ItemIndex) {
  const { schematic, replace } = await openFromLibrary(entry);
  const preview = await makePreview(schematic, replace, items);
  if (!preview) throw new Error('не удалось нарисовать превью (нужен WebGL)');
  await schematicsStore.update(entry.id, { preview });
}
