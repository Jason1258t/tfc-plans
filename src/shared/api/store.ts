import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { authReady, db } from './firebase';
import { forgetSubscription, reportError, reportSnapshot, syncKey } from './sync';
import { track } from './analytics';

/** Минимальный CRUD + подписка на коллекцию. Реализации: Firestore и localStorage. */
export interface CollectionStore<T extends { id: string }, N> {
  subscribe(cb: (items: T[]) => void, onError?: (e: Error) => void): () => void;
  add(data: N): Promise<string>;
  update(id: string, patch: Partial<Omit<T, 'id'>>): Promise<void>;
  remove(ids: string | string[]): Promise<void>;
}

/** Для статистики: у задач важно, что именно поменяли — статус, исполнителя, чеклист */
const TASK_FIELDS = ['status', 'assignee', 'checklist', 'rating'] as const;
function trackUpdate(name: string, patch: object) {
  if (name === 'tasks') {
    const field = TASK_FIELDS.find((f) => f in patch);
    if (field === 'status') return track('tasks.status', { to: String((patch as { status: unknown }).status) });
    if (field) return track(`tasks.${field}`);
  }
  track(`${name}.edit`);
}

function firestoreStore<T extends { id: string }, N extends object>(name: string): CollectionStore<T, N> {
  const ref = collection(db!, name);
  /** Отказ сервера в записи: локальное изменение откатится, человек должен об этом узнать */
  const report = (e: Error) => {
    console.error(`Не удалось сохранить в ${name}:`, e);
    reportError(`Не сохранилось: ${e.message}`);
  };
  const failed = (e: Error): never => {
    report(e);
    throw e;
  };
  return {
    subscribe(cb, onError) {
      let unsub = () => {};
      let cancelled = false;
      const key = syncKey();
      authReady.then(() => {
        if (cancelled) return;
        let first = true;
        // С метаданными: узнаём, читаем ли из кэша и какие документы ещё не дошли до сервера
        unsub = onSnapshot(
          ref,
          { includeMetadataChanges: true },
          (snap) => {
            reportSnapshot(
              key,
              name,
              snap.metadata.fromCache,
              new Set(snap.docs.filter((d) => d.metadata.hasPendingWrites).map((d) => d.id)),
            );
            // Изменились только метаданные — список тот же
            if (!first && snap.docChanges().length === 0) return;
            first = false;
            cb(snap.docs.map((d) => ({ ...(d.data() as Omit<T, 'id'>), id: d.id }) as T));
          },
          (e) => {
            reportError(`Подписка на ${name}: ${e.message}`);
            onError?.(e);
          },
        );
      });
      return () => {
        cancelled = true;
        unsub();
        forgetSubscription(key);
      };
    },
    async add(data) {
      await authReady;
      const now = Date.now();
      // id известен сразу, запись применяется локально мгновенно — не ждём подтверждения сервера
      const created = doc(ref);
      track(`${name}.create`);
      setDoc(created, { ...data, createdAt: now, updatedAt: now }).catch(report);
      return created.id;
    },
    async update(id, patch) {
      await authReady;
      trackUpdate(name, patch);
      await updateDoc(doc(ref, id), { ...patch, updatedAt: Date.now() }).catch(failed);
    },
    async remove(ids) {
      await authReady;
      const list = Array.isArray(ids) ? ids : [ids];
      track(`${name}.delete`, { n: list.length });
      if (list.length === 1) return deleteDoc(doc(ref, list[0])).catch(failed);
      const batch = writeBatch(db!);
      list.forEach((id) => batch.delete(doc(ref, id)));
      await batch.commit().catch(failed);
    },
  };
}

function localStore<T extends { id: string }, N extends object>(name: string): CollectionStore<T, N> {
  const key = `tfc-tm:${name}`;
  const listeners = new Set<(items: T[]) => void>();
  const read = (): T[] => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '[]');
    } catch {
      return [];
    }
  };
  const write = (items: T[]) => {
    localStorage.setItem(key, JSON.stringify(items));
    listeners.forEach((l) => l(items));
  };
  window.addEventListener('storage', (e) => {
    if (e.key === key) listeners.forEach((l) => l(read()));
  });
  return {
    subscribe(cb) {
      listeners.add(cb);
      queueMicrotask(() => cb(read()));
      return () => listeners.delete(cb);
    },
    async add(data) {
      const now = Date.now();
      const id = crypto.randomUUID().slice(0, 20);
      write([...read(), { ...data, id, createdAt: now, updatedAt: now } as unknown as T]);
      return id;
    },
    async update(id, patch) {
      write(read().map((it) => (it.id === id ? { ...it, ...patch, updatedAt: Date.now() } : it)));
    },
    async remove(ids) {
      const list = new Set(Array.isArray(ids) ? ids : [ids]);
      write(read().filter((it) => !list.has(it.id)));
    },
  };
}

/**
 * Хранилище коллекции по имени: Firestore, а без Firebase — localStorage.
 * Сами коллекции создаёт сущность, которой они принадлежат (`entities/<x>/store.ts`) — общий слой не знает
 * о задачах, датапаках и схемах.
 */
export const createCollectionStore = db ? firestoreStore : localStore;
