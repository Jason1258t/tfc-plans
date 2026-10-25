import type { DatapackEntry } from '@/entities/datapack';

/** Подпись вида записи — бейдж в списке файлов датапака */
export const KIND_LABEL: Record<DatapackEntry['kind'], string> = {
  add: 'новый',
  replace: 'замена',
  remove: 'удаление',
  file: 'файл',
};
