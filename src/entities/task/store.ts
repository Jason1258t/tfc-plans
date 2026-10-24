import { create } from 'zustand';
import { createCollectionStore } from '@/shared/api';
import type { NewTask, Task } from './types';

/** Коллекция задач: Firestore `tasks`, без Firebase — localStorage (см. `shared/api/store.ts`) */
export const tasksStore = createCollectionStore<Task, NewTask>('tasks');

interface TaskList {
  items: Task[];
  /** Первый снимок коллекции ещё не пришёл */
  loading: boolean;
  error: string | null;
}

/** Задачи для страниц: одна подписка на всё приложение, состояние — здесь (zustand) */
export const useTasks = create<TaskList>(() => ({ items: [], loading: true, error: null }));

let stop: (() => void) | null = null;

/** Запустить подписку; повторный вызов возвращает ту же отписку */
export function startTasks(): () => void {
  if (stop) return stop;
  const unsub = tasksStore.subscribe(
    (tasks) => useTasks.setState({ items: tasks.map(normalizeTask), loading: false, error: null }),
    (e) => useTasks.setState({ error: e.message, loading: false }),
  );
  stop = () => {
    unsub();
    stop = null;
  };
  return stop;
}

/** Подстраховка от документов, созданных старыми версиями приложения */
function normalizeTask(t: Task): Task {
  return {
    ...t,
    description: t.description ?? '',
    status: t.status ?? 'todo',
    priority: t.priority ?? 1,
    rating: t.rating ?? 1000,
    checklist: t.checklist ?? [],
    groupId: t.groupId ?? null,
  };
}
