import type { GuideChecked } from '../../types';

/** Насколько проверен гайд — подпись и подсказка значка */
export const CHECKED: Record<GuideChecked, { label: string; title: string }> = {
  game: { label: 'проверено в игре', title: 'Собрано и проверено в игре' },
  server: { label: 'проверено на сервере', title: 'Проверено на сервере разработки (без игрока) и по коду модов' },
  code: { label: 'по коду модов', title: 'Разобрано по коду модов, в игре не проверялось' },
  none: { label: 'не проверено', title: 'Не проверялось ни в игре, ни по коду' },
};
