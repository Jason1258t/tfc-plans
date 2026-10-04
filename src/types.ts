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
  note?: string;
}

export interface Datapack {
  id: string;
  name: string;
  /** namespace для новых рецептов: data/<namespace>/recipe/… */
  namespace: string;
  description: string;
  entries: DatapackEntry[];
  author: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export type NewDatapack = Omit<Datapack, 'id' | 'createdAt' | 'updatedAt'>;
