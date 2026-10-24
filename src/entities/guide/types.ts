/** Гайд справочника: Markdown со вставками (живые значения, калькуляторы, виджеты) — см. docs/plans/guides.md */

/** Насколько проверено то, что написано в гайде */
export type GuideChecked = 'game' | 'server' | 'code' | 'none';

export interface Guide {
  id: string;
  /** Раздел справочника: power, … */
  section: string;
  title: string;
  /** «Коротко» — в списке и плашкой наверху статьи */
  summary: string;
  body: string;
  /** Предмет для значка в списке */
  icon: string | null;
  /** Заголовок группы в списке */
  group: string;
  order: number;
  checked: GuideChecked;
  /** Снят с публикации — виден только в «Снятых» */
  hidden: boolean;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

/** Сохранённая версия гайда (guides/{id}/revisions) */
export interface GuideRevision {
  id: string;
  title: string;
  summary: string;
  body: string;
  updatedBy: string;
  at: number;
}
