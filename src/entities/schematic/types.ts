/** Схема из библиотеки и общие избранные замены блоков. */

/**
 * Схема в библиотеке: исходный .nbt лежит в хранилище файлов (files/{fileId}, без задачи),
 * а замены хранятся отдельно — скачивание собирает файл с заменами, схему можно открыть и поправить.
 */
export interface SavedSchematic {
  id: string;
  name: string;
  fileName: string;
  fileId: string;
  fileSize: number;
  /** Габариты x×y×z, если есть в файле */
  size: number[] | null;
  /** Всего блоков в схеме (до удалений) */
  blocks: number;
  /** Замены: to = '#remove' — блок удаляется из схемы */
  replace: { from: string; to: string }[];
  /** Обрезка и отступы при скачивании; нет у схем, сохранённых раньше */
  shape?: {
    crop: boolean;
    sides: number;
    bottom: number;
    top: number;
    clearAir: boolean;
    platform?: boolean;
    platformHeight?: number;
    platformBlock?: string;
    platformHollow?: boolean;
  };
  /** Превью (data URL webp/png ≤ ~200 КБ), рисуется в браузере сохранившего; нет у старых записей */
  preview?: string;
  /** Описание (Markdown), правят все */
  description?: string;
  author: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export type NewSavedSchematic = Omit<SavedSchematic, 'id' | 'createdAt' | 'updatedAt'>;

/** Избранная замена блока в схемах: общая для группы, у одного блока может быть несколько вариантов */
export interface ReplaceFavorite {
  id: string;
  from: string;
  to: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export type NewReplaceFavorite = Omit<ReplaceFavorite, 'id' | 'createdAt' | 'updatedAt'>;
