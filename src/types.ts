export type TaskStatus = 'todo' | 'doing' | 'done';

/** Важность задачи: 0 — низкая … 3 — критическая */
export type Priority = 0 | 1 | 2 | 3;

export const PRIORITIES: { value: Priority; label: string; short: string; color: string }[] = [
  { value: 0, label: 'Низкая', short: 'Низк.', color: 'var(--imp-0)' },
  { value: 1, label: 'Обычная', short: 'Обычн.', color: 'var(--imp-1)' },
  { value: 2, label: 'Высокая', short: 'Высок.', color: 'var(--imp-2)' },
  { value: 3, label: 'Критическая', short: 'Крит.', color: 'var(--imp-3)' },
];

export const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'Надо сделать' },
  { value: 'doing', label: 'В работе' },
  { value: 'done', label: 'Готово' },
];

/**
 * Пункт чеклиста. Если указан itemId — это ресурс, который нужно собрать (got из qty),
 * иначе — обычный пункт, отмечаемый галочкой (done).
 */
export interface ChecklistEntry {
  id: string;
  text: string;
  itemId?: string;
  qty?: number;
  got?: number;
  done?: boolean;
}

export interface TaskPlace {
  x: number;
  z: number;
  label?: string;
}

export interface Task {
  id: string;
  title: string;
  /** Markdown */
  description: string;
  status: TaskStatus;
  priority: Priority;
  /** Elo-рейтинг из режима «Что важнее?» */
  rating: number;
  checklist: ChecklistEntry[];
  /** Иконка задачи — id предмета */
  icon?: string | null;
  groupId: string | null;
  author: string;
  /** Кто взялся за задачу */
  assignee?: string | null;
  /** Когда задачу отметили выполненной */
  completedAt?: number | null;
  /** Где в мире: блоковые координаты и подпись (база, жила, точка экспедиции) — показывается на карте */
  place?: TaskPlace | null;
  createdAt: number;
  updatedAt: number;
}

export interface Group {
  id: string;
  name: string;
  icon?: string | null;
  order: number;
  author: string;
  createdAt: number;
}

/** Markdown-документ: подробный план, привязанный к задаче (или свободный) */
export interface Artifact {
  id: string;
  title: string;
  content: string;
  taskId: string | null;
  author: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

/** Насколько проверено то, что написано в гайде */
export type GuideChecked = 'game' | 'server' | 'code' | 'none';

/** Гайд справочника: Markdown со вставками (живые значения, калькуляторы, виджеты) — см. docs/plans/guides.md */
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

export type NewTask = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;
export type NewGroup = Omit<Group, 'id' | 'createdAt'>;
export type NewArtifact = Omit<Artifact, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Файл датапака.
 * add — новый рецепт по шаблону; replace — переопределение существующего рецепта по тому же пути;
 * remove — отключение рецепта (`neoforge:conditions: [neoforge:false]`, как это делает сам TFC);
 * file — произвольный файл (например, реестр WoodenCog).
 */
export type DatapackEntryKind = 'add' | 'replace' | 'remove' | 'file';

export interface DatapackEntry {
  id: string;
  kind: DatapackEntryKind;
  /** Путь внутри zip: data/<ns>/recipe/<path>.json */
  path: string;
  /** Содержимое файла (JSON текстом) */
  content: string;
  /** Тип рецепта — для подсказки */
  recipeType?: string;
  /** Откуда взят шаблон/оригинал: id рецепта «ns:path» */
  sourceRecipe?: string;
  /** Отпечаток исходного рецепта на момент, когда его взяли (src/lib/hash.ts) — чтобы заметить, что мод его поменял */
  sourceHash?: string;
  note?: string;
}

export interface Datapack {
  id: string;
  name: string;
  /** namespace для новых рецептов: data/<namespace>/recipe/… */
  namespace: string;
  description: string;
  entries: DatapackEntry[];
  /** «Ставить в мир»: программа tfc ставит только отмеченные; тестовые не отмечают */
  install?: boolean;
  author: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export type NewDatapack = Omit<Datapack, 'id' | 'createdAt' | 'updatedAt'>;

/** Скрипт KubeJS для kubejs/server_scripts/ (из конструктора или написанный руками) */
export interface KubejsScript {
  id: string;
  /** Имя файла в server_scripts: латиница, цифры, _ . -, на конце .js */
  fileName: string;
  text: string;
  /** «Ставить на сервер»: программа tfc ставит только отмеченные */
  install?: boolean;
  author: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export type NewKubejsScript = Omit<KubejsScript, 'id' | 'createdAt' | 'updatedAt'>;

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
