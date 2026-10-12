import { isImage } from './uploads';

/** Вид файла по расширению: от него зависят значок и цвет (компонент FileBadge) и фильтр на странице файлов */
export type FileKind = 'image' | 'schematic' | 'archive' | 'mod' | 'code' | 'text' | 'other';

export const FILE_KINDS: { id: FileKind; label: string }[] = [
  { id: 'image', label: 'Картинки' },
  { id: 'schematic', label: 'Схемы' },
  { id: 'archive', label: 'Архивы' },
  { id: 'mod', label: 'Моды' },
  { id: 'code', label: 'Скрипты и данные' },
  { id: 'text', label: 'Тексты' },
  { id: 'other', label: 'Остальное' },
];

const BY_EXT: [RegExp, FileKind][] = [
  [/\.(nbt|schem|litematic)$/i, 'schematic'],
  [/\.jar$/i, 'mod'],
  [/\.(zip|rar|7z|gz|tar)$/i, 'archive'],
  [/\.(js|ts|json5?|toml|ya?ml|cfg|properties|mcfunction|mcmeta|snbt|csv|xml)$/i, 'code'],
  [/\.(txt|md|pdf|docx?|rtf|log)$/i, 'text'],
];

export const fileKind = (f: { name: string; type?: string }): FileKind =>
  isImage({ name: f.name, type: f.type ?? '' }) ? 'image' : (BY_EXT.find(([re]) => re.test(f.name))?.[1] ?? 'other');
