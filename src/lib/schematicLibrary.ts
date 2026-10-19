import { schematicsStore } from '../data/store';
import type { SavedSchematic } from '../types';
import { fileBlob, removeFile, uploadFile } from './files';
import { DEFAULT_SHAPE, editedSource, loadSchematic, type Schematic } from './schematic';

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
): Promise<{ id: string; fileId?: string }> {
  const edited = s.rev !== (s.savedRev ?? 0);
  if (s.libraryId) {
    if (!edited) {
      await schematicsStore.update(s.libraryId, { replace: replaceList(s, replace), shape: s.shape, updatedBy: nick });
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
  schematic.shape = { ...DEFAULT_SHAPE, ...entry.shape };
  return { schematic, replace: new Map(entry.replace.map((r) => [r.from, r.to])) };
}

export async function removeFromLibrary(entry: SavedSchematic) {
  await schematicsStore.remove(entry.id);
  // Файл — следом: запись уже не ссылается на него, даже если удаление файла сорвётся
  await removeFile(entry.fileId).catch((e) => console.error('Не удалось удалить файл схемы:', e));
}
