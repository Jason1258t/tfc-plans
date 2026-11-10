import type { GuideChecked } from '@/entities/guide';

/** Насколько проверен гайд — подпись и подсказка значка */
export const CHECKED: Record<GuideChecked, { label: string; title: string }> = {
  game: { label: 'проверено в игре', title: 'Собрано и проверено в игре' },
  server: { label: 'проверено на сервере', title: 'Проверено на сервере разработки (без игрока) и по коду модов' },
  code: { label: 'по коду модов', title: 'Разобрано по коду модов, в игре не проверялось' },
  none: { label: 'не проверено', title: 'Не проверялось ни в игре, ни по коду' },
};

export interface GuideSectionMeta {
  id: string;
  label: string;
  /** Подпись над списком раздела */
  intro?: string;
  order: number;
  /** Значок «проверено в игре / по коду»; разделу про сам сайт он ни к чему */
  checks: boolean;
}

/**
 * Названия и порядок разделов каталога гайдов. Сами разделы берутся из поля section гайдов: раздел без гайдов не
 * показывается, а гайд с новым section сразу даёт новый раздел (до записи сюда — под своим id, в конце списка).
 */
const SECTIONS: Omit<GuideSectionMeta, 'checks'>[] = [
  {
    id: 'power',
    label: 'Энергия и электричество',
    order: 10,
    intro: 'Как собрать типовые схемы — со схемами и калькуляторами на формулах из кода модов и настройках сервера.',
  },
  {
    id: 'logistics',
    label: 'Логистика и хранение',
    order: 20,
    intro: 'Автоматика Create, табло и компьютеры, хранилища предметов и жидкостей.',
  },
  {
    id: 'mining',
    label: 'Добыча и разведка',
    order: 30,
    intro: 'Поиск жил и месторождений, буровая установка Create, нефть, экскаватор и жилы Immersive Engineering.',
  },
  {
    id: 'multiblocks',
    label: 'Мультиблоки IE',
    order: 40,
    intro:
      'Как собирать большие машины Immersive Engineering и Advanced TFC Tech и что в них изменено для TFC. Сами структуры по слоям — во вкладке «Мультиблоки».',
  },
  {
    id: 'chemistry',
    label: 'Химия',
    order: 50,
    intro:
      'С чего начать химию, как собрать машины и что можно получить: раствор для травления, кислоты, масла, пластики. Начните со статьи «С чего начать».',
  },
  {
    id: 'site',
    label: 'TFC Studio',
    order: 90,
    intro: 'Что умеет этот сайт и как им пользоваться: задачи, схемы Create, датапаки, поиск предметов, справочник.',
  },
];

/** Разделы гайдов, которые живут не в каталоге: карточки аддонов и «Как написать свой» — на странице аддонов */
export const OFF_CATALOG_SECTIONS = ['addon', 'addons'];

export function guideSection(id: string): GuideSectionMeta {
  const known = SECTIONS.find((s) => s.id === id);
  return { label: id, order: 1000, ...known, id, checks: id !== 'site' };
}
