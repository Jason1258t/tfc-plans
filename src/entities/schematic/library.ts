import { doc, getDoc } from 'firebase/firestore';
import { readNbt, type ParsedNbt } from '@tfc/core/nbt';
import { applyEdits, paletteLists, savedEdits } from '@tfc/core/schematicFile';
import { authReady, db } from '@/shared/api';
import { fileBlob } from '@/entities/file';
import type { SavedSchematic } from './types';

/**
 * Одна схема библиотеки по id карточки — для вставки в гайд (`::schematic id=…`) и других мест, где не нужна вся
 * коллекция: 1 чтение записи + куски файла. Результаты кэшируются на время сессии вкладки.
 */

const entries = new Map<string, Promise<SavedSchematic | null>>();
const files = new Map<string, Promise<ParsedNbt>>();

/** Запись библиотеки; null — карточки нет (удалили или id с ошибкой) */
export function libraryEntry(id: string): Promise<SavedSchematic | null> {
  let p = entries.get(id);
  if (!p) {
    p = (async () => {
      if (!db) throw new Error('библиотека схем хранится в Firestore — без Firebase её негде взять');
      await authReady;
      const snap = await getDoc(doc(db, 'schematics', id));
      return snap.exists() ? ({ ...snap.data(), id } as SavedSchematic) : null;
    })();
    p.catch(() => entries.delete(id));
    entries.set(id, p);
  }
  return p;
}

/**
 * Схема как её скачивают с сайта: исходник из хранилища + замены и форма карточки (тот же applyEdits, что у
 * кнопки «Скачать» и сервера сборки), уже разобранная.
 */
export function libraryParsed(entry: SavedSchematic): Promise<ParsedNbt> {
  const key = `${entry.fileId}|${JSON.stringify(entry.replace)}|${JSON.stringify(entry.shape ?? null)}`;
  let p = files.get(key);
  if (!p) {
    p = (async () => {
      const source = await readNbt(new Uint8Array(await (await fileBlob(entry.fileId)).arrayBuffer()));
      if (!paletteLists(source.root.value).length) throw new Error('в файле нет палитры блоков — это не схема');
      const { replace, shape } = savedEdits(entry);
      return readNbt(await applyEdits(source, replace, shape));
    })();
    p.catch(() => files.delete(key));
    files.set(key, p);
  }
  return p;
}

/** Адрес карточки на странице «Схемы» — тот же, что выдаёт MCP schematics_list */
export const schematicLink = (id: string) => `/schematics?id=${encodeURIComponent(id)}`;
