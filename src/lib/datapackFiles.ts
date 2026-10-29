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

/** Ошибка пути, из-за которой Minecraft не прочитает файл датапака. */
export function datapackPathError(path: string): string | null {
  if (/^data\/[^/]+\/recipes\//.test(path)) return 'В Minecraft 1.21.1 рецепты лежат в recipe/, без s.';
  if (/^data\/[^/]+\/recipe(?:\/|$)/.test(path) && !path.endsWith('.json'))
    return 'Файл рецепта должен заканчиваться на .json — иначе Minecraft его не загрузит.';
  if (!/^data\/[a-z0-9_.-]+\/[a-z0-9_./-]+\.[a-z0-9]+$/.test(path))
    return 'Путь должен быть вида data/<ns>/…, только a-z 0-9 _ . - / и расширение файла.';
  return null;
}

/** Ошибки записей, из-за которых файл не загрузится или потеряется: путь, повтор пути, синтаксис JSON */
export function datapackIssues(entries: { path: string; content: string }[]): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const pathError = datapackPathError(e.path);
    if (pathError) issues.push({ path: e.path, message: pathError });
    if (seen.has(e.path)) issues.push({ path: e.path, message: 'этот путь встречается дважды — победит последний' });
    seen.add(e.path);
    if (e.path.endsWith('.json')) {
      try {
        JSON.parse(e.content);
      } catch (err) {
        issues.push({ path: e.path, message: `ошибка JSON: ${err instanceof Error ? err.message : err}` });
      }
    }
  }
  return issues;
}
