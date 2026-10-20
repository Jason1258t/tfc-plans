/**
 * Файлы датапака из документа `datapacks`: pack.mcmeta + тексты записей, имя zip.
 * Сам zip здесь не собирается — сайт зипует через fflate, сервер сборки и программа tfc — своим способом.
 *
 * Без импортов, только стираемый синтаксис TS: модуль запускает и сайт, и Node (`import '../src/lib/datapackFiles.ts'`).
 */

/** pack_format датапаков Minecraft 1.21.1 */
export const PACK_FORMAT = 48;

/** Сколько нужно от документа датапака, чтобы собрать файлы */
export interface DatapackSource {
  name: string;
  description?: string;
  entries: { path: string; content: string }[];
}

/** { путь в zip: текст }. Записи с одинаковым путём — побеждает последняя (validatePack об этом предупреждает) */
export function datapackFiles(pack: DatapackSource): Record<string, string> {
  const files: Record<string, string> = {
    'pack.mcmeta': JSON.stringify(
      { pack: { pack_format: PACK_FORMAT, description: pack.description || pack.name } },
      null,
      2,
    ),
  };
  for (const e of pack.entries) files[e.path] = e.content;
  return files;
}

/** Имя zip: кириллица допустима, убираем только символы, запрещённые в именах файлов */
export const zipName = (pack: { name: string }) =>
  `${
    pack.name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_') || 'datapack'
  }.zip`;
