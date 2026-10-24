import { createCollectionStore } from '@/shared/api';
import type { NewTask, Task } from './types';

/** Коллекция задач: Firestore `tasks`, без Firebase — localStorage (см. `shared/api/store.ts`) */
export const tasksStore = createCollectionStore<Task, NewTask>('tasks');
