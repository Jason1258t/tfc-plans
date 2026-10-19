import type { GuideChecked } from '../../types';

/** Насколько проверен гайд — подпись и подсказка значка */
export const CHECKED: Record<GuideChecked, { label: string; title: string }> = {
  game: { label: 'проверено в игре', title: 'Собрано и проверено в игре' },
  server: { label: 'проверено на сервере', title: 'Проверено на сервере разработки (без игрока) и по коду модов' },
  code: { label: 'по коду модов', title: 'Разобрано по коду модов, в игре не проверялось' },
  none: { label: 'не проверено', title: 'Не проверялось ни в игре, ни по коду' },
};

/** Разделы гайдов справочника; гайды аддонов показаны ещё и на странице «Аддоны» */
export type GuidesSub = 'power' | 'addons' | 'site';
export const GUIDES_SUBS: { id: GuidesSub; label: string }[] = [
  { id: 'power', label: 'Электричество' },
  { id: 'addons', label: 'Аддоны' },
  { id: 'site', label: 'О сайте' },
];
