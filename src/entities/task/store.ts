import { createCollectionStore, createLiveList } from '@/shared/api';
import type { NewTask, Task } from './types';

/** Коллекция задач: Firestore `tasks`, без Firebase — localStorage (см. `shared/api/store.ts`) */
export const tasksStore = createCollectionStore<Task, NewTask>('tasks');

/** Задачи: источник работает, пока список нужен хотя бы одному потребителю. */
export const useTasks = createLiveList<Task>(
  (onItems, onError) => tasksStore.subscribe(onItems, onError),
  (tasks) => tasks.map(normalizeTask),
);

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
