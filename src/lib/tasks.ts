import type { ChecklistEntry, Task } from '../types';

export const entryDone = (c: ChecklistEntry) => (c.itemId ? (c.got ?? 0) >= (c.qty ?? 1) : Boolean(c.done));

/** Прогресс чеклиста 0..1: каждый пункт весит одинаково, ресурсы засчитываются частично */
export function checklistProgress(list: ChecklistEntry[]): number | null {
  if (!list.length) return null;
  const sum = list.reduce((acc, c) => {
    if (c.itemId) return acc + Math.min(1, (c.got ?? 0) / Math.max(1, c.qty ?? 1));
    return acc + (c.done ? 1 : 0);
  }, 0);
  return sum / list.length;
}

export type SortMode = 'priority' | 'rating' | 'new' | 'updated';

export const SORTS: { value: SortMode; label: string }[] = [
  { value: 'priority', label: 'По важности' },
  { value: 'rating', label: 'По рейтингу' },
  { value: 'updated', label: 'Недавно изменённые' },
  { value: 'new', label: 'Новые' },
];

export function sortTasks(tasks: Task[], mode: SortMode): Task[] {
  const list = [...tasks];
  switch (mode) {
    case 'priority':
      return list.sort((a, b) => b.priority - a.priority || b.rating - a.rating || b.updatedAt - a.updatedAt);
    case 'rating':
      return list.sort((a, b) => b.rating - a.rating || b.priority - a.priority);
    case 'new':
      return list.sort((a, b) => b.createdAt - a.createdAt);
    case 'updated':
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

/** Elo: победитель забирает очки у проигравшего, тем больше — чем неожиданнее победа */
export function elo(winner: number, loser: number, k = 32): [number, number] {
  const expected = 1 / (1 + 10 ** ((loser - winner) / 400));
  const delta = Math.round(k * (1 - expected));
  return [winner + delta, loser - delta];
}

/**
 * Пара для сравнения: первая задача — случайная, вторая — с близким рейтингом
 * (сравнение близких по рейтингу даёт больше информации).
 */
export function pickPair(tasks: Task[], avoid?: [string, string]): [Task, Task] | null {
  if (tasks.length < 2) return null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const a = tasks[Math.floor(Math.random() * tasks.length)];
    const others = tasks
      .filter((t) => t.id !== a.id)
      .sort((x, y) => Math.abs(x.rating - a.rating) - Math.abs(y.rating - a.rating))
      .slice(0, 4);
    const b = others[Math.floor(Math.random() * others.length)];
    const same = avoid && [a.id, b.id].sort().join() === [...avoid].sort().join();
    if (!same || tasks.length === 2) return Math.random() < 0.5 ? [a, b] : [b, a];
  }
  return null;
}
