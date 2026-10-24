/** Группа задач — раздел в списке задач и на доске. */
export interface Group {
  id: string;
  name: string;
  icon?: string | null;
  order: number;
  author: string;
  createdAt: number;
}

export type NewGroup = Omit<Group, 'id' | 'createdAt'>;
