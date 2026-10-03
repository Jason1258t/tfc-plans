export type TaskStatus = 'todo' | 'doing' | 'done';

/** Редкость = важность. Цвета как у редкости предметов в Minecraft */
export type Priority = 0 | 1 | 2 | 3;

export const PRIORITIES: { value: Priority; label: string; color: string }[] = [
  { value: 0, label: 'Обычная', color: 'var(--mc-white)' },
  { value: 1, label: 'Необычная', color: 'var(--mc-yellow)' },
  { value: 2, label: 'Редкая', color: 'var(--mc-aqua)' },
  { value: 3, label: 'Эпическая', color: 'var(--mc-purple)' },
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
