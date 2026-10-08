import { schematicsStore } from '../data/store';
import type { SavedSchematic } from '../types';
import { fileBlob, removeFile, uploadFile } from './files';
import { loadSchematic, type Schematic } from './schematic';

/**
 * Библиотека схем. Исходник .nbt — в хранилище файлов без привязки к задаче, в записи — имя и замены.
 * Файл с заменами собирается при скачивании, поэтому замены можно поправить в любой момент.
 */

/** Только замены блоков, которые есть в этой схеме */
const replaceList = (s: Schematic, replace: Map<string, string>) =>
  [...replace].filter(([from]) => s.counts.has(from)).map(([from, to]) => ({ from, to }));

export async function saveToLibrary(s: Schematic, replace: Map<string, string>, nick: string): Promise<string> {
  if (s.libraryId) {
    await schematicsStore.update(s.libraryId, { replace: replaceList(s, replace), updatedBy: nick });
    return s.libraryId;
  }
  const fileId = await uploadFile(s.file, { taskId: null, author: nick });
  return schematicsStore.add({
    name: s.fileName.replace(/\.nbt$/i, ''),
    fileName: s.fileName,
    fileId,
    fileSize: s.fileSize,
    size: s.size,
    blocks: [...s.counts.values()].reduce((a, n) => a + n, 0),
    replace: replaceList(s, replace),
    author: nick,
    updatedBy: nick,
  });
}

/** Схема из библиотеки с её заменами — для редактора и для скачивания */
export async function openFromLibrary(
  entry: SavedSchematic,
): Promise<{ schematic: Schematic; replace: Map<string, string> }> {
  const blob = await fileBlob(entry.fileId);
  const schematic = await loadSchematic(new File([blob], entry.fileName));
  schematic.key = `lib:${entry.id}`;
  schematic.libraryId = entry.id;
  return { schematic, replace: new Map(entry.replace.map((r) => [r.from, r.to])) };
}

export async function removeFromLibrary(entry: SavedSchematic) {
  await schematicsStore.remove(entry.id);
  // Файл — следом: запись уже не ссылается на него, даже если удаление файла сорвётся
  await removeFile(entry.fileId).catch((e) => console.error('Не удалось удалить файл схемы:', e));
}
