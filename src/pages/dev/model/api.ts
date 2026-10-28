import { getToken } from 'firebase/app-check';
import { appCheck, auth, authReady } from '@/shared/api';

/**
 * Задачи разработки живут не в Firestore, а на сервере сборки (SQLite, /dev/…) — чтобы журнал работ агентов
 * не тратил бесплатный лимит чтений. Вход — тот же анонимный вход сайта (+ App Check), ник — подпись.
 * План — docs/plans/dev-tracker.md.
 */

export type DevStatus = 'backlog' | 'todo' | 'doing' | 'review' | 'done' | 'dropped';
export type DevKind = 'feature' | 'fix' | 'refactor' | 'docs' | 'infra' | 'idea';
export type DevArea = 'site' | 'mcp' | 'addon' | 'server' | 'pack' | 'app' | 'agents';

export interface DevCheck {
  text: string;
  done: boolean;
}

export interface DevTask {
  id: number;
  title: string;
  body: string;
  kind: DevKind;
  area: DevArea | null;
  status: DevStatus;
  priority: number;
  assignee: string | null;
  branch: string | null;
  checklist: DevCheck[];
  author: string;
  createdAt: number;
  updatedAt: number;
  doneAt: number | null;
  rev: number;
  /** только в списке */
  notes?: number;
  docs?: number;
  lastNoteAt?: number | null;
}

export interface DevNote {
  id: number;
  task: number;
  author: string;
  kind: 'note' | 'status' | 'report';
  text: string;
  createdAt: number;
}

export interface DevDoc {
  id: number;
  task: number | null;
  title: string;
  content?: string;
  size?: number;
  author: string;
  createdAt: number;
  updatedAt: number;
  rev: number;
}

export interface DevTaskFull {
  task: DevTask;
  notes: DevNote[];
  noteCount: number;
  docs: DevDoc[];
}

export const STATUSES: { value: DevStatus; label: string }[] = [
  { value: 'backlog', label: 'Потом' },
  { value: 'todo', label: 'Надо' },
  { value: 'doing', label: 'В работе' },
  { value: 'review', label: 'Проверка' },
  { value: 'done', label: 'Готово' },
  { value: 'dropped', label: 'Отменена' },
];
export const KINDS: { value: DevKind; label: string }[] = [
  { value: 'feature', label: 'Фича' },
  { value: 'fix', label: 'Фикс' },
  { value: 'refactor', label: 'Рефакторинг' },
  { value: 'docs', label: 'Доки' },
  { value: 'infra', label: 'Инфра' },
  { value: 'idea', label: 'Идея' },
];
export const AREAS: { value: DevArea; label: string }[] = [
  { value: 'site', label: 'Сайт' },
  { value: 'mcp', label: 'MCP' },
  { value: 'addon', label: 'Аддоны' },
  { value: 'server', label: 'Сервер' },
  { value: 'pack', label: 'Сборка' },
  { value: 'app', label: 'Программа tfc' },
  { value: 'agents', label: 'Агенты' },
];
export const PRIORITY_LABEL = ['Низкая', 'Обычная', 'Высокая', 'Срочно'];
export const label = <T extends string>(list: { value: T; label: string }[], v: T | null) =>
  list.find((x) => x.value === v)?.label ?? '—';

/** Адрес сервера сборки; VITE_DEV_API — другой (свой сервер при разработке) */
const BASE = (import.meta.env.VITE_DEV_API?.trim() || 'https://tfc-pack.duckdns.org:28788').replace(/\/+$/, '');

async function headers(): Promise<Record<string, string>> {
  await authReady;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const idToken = await auth?.currentUser?.getIdToken();
  if (!idToken) throw new Error('Нет входа на сайт — задачи разработки доступны только с подключённым Firebase');
  h.Authorization = `Bearer ${idToken}`;
  if (appCheck) h['X-Firebase-AppCheck'] = (await getToken(appCheck, false)).token;
  return h;
}

/** Ошибка сервера; status 409 — запись изменилась после чтения */
export class DevError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: string, path: string, body?: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/dev/${path}`, {
      method,
      signal: AbortSignal.timeout(20_000),
      headers: await headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e instanceof DevError) throw e;
    throw new DevError(`Сервер задач разработки не отвечает (${(e as Error).message})`, 0);
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new DevError(out.error ?? `${res.status} ${res.statusText}`, res.status);
  return out as T;
}

export type TaskPatch = Partial<
  Pick<DevTask, 'title' | 'body' | 'kind' | 'area' | 'status' | 'priority' | 'assignee' | 'branch' | 'checklist'>
>;

const taskCache = new Map<number, DevTaskFull>();
const cacheTask = (full: DevTaskFull) => {
  taskCache.delete(full.task.id);
  taskCache.set(full.task.id, full);
  if (taskCache.size > 40) taskCache.delete(taskCache.keys().next().value!);
  return full;
};

export const devApi = {
  cached: (id: number) => taskCache.get(id) ?? null,
  list: () => call<{ tasks: DevTask[] }>('GET', 'tasks').then((r) => r.tasks),
  get: (id: number) => call<DevTaskFull>('GET', `tasks/${id}?notes=200`).then(cacheTask),
  create: (t: TaskPatch & { title: string }, by: string) =>
    call<DevTaskFull>('POST', 'tasks', { ...t, by }).then(cacheTask),
  update: (id: number, baseRev: number, patch: TaskPatch, by: string) =>
    call<DevTaskFull>('PATCH', `tasks/${id}`, { ...patch, baseRev, by }).then(cacheTask),
  remove: (id: number, baseRev: number) =>
    call('DELETE', `tasks/${id}?baseRev=${baseRev}`).then((result) => {
      taskCache.delete(id);
      return result;
    }),
  note: (id: number, text: string, by: string) => call<DevTaskFull>('POST', `tasks/${id}/notes`, { text, by }),
  doc: (id: number) => call<{ doc: DevDoc }>('GET', `docs/${id}`).then((r) => r.doc),
  createDoc: (task: number, title: string, by: string) =>
    call<{ doc: DevDoc }>('POST', 'docs', { task, title, content: '', by }).then((r) => r.doc),
  saveDoc: (id: number, baseRev: number, patch: { title?: string; content?: string }, by: string) =>
    call<{ doc: DevDoc }>('PATCH', `docs/${id}`, { ...patch, baseRev, by }).then((r) => r.doc),
};
