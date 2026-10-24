/** Задача: модель (типы, подписи важности и статуса) и её коллекция. Снаружи — `@/entities/task`. */
export type { ChecklistEntry, NewTask, Priority, Task, TaskPlace, TaskStatus } from './types';
export { PRIORITIES, STATUSES } from './types';
export { tasksStore } from './store';
