import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { authReady, db } from '../firebase';
import type {
  Artifact,
  Datapack,
  Group,
  NewArtifact,
  NewDatapack,
  NewGroup,
  NewSavedSchematic,
  NewTask,
  SavedSchematic,
  Task,
} from '../types';

/** Минимальный CRUD + подписка на коллекцию. Реализации: Firestore и localStorage. */
export interface CollectionStore<T extends { id: string }, N> {
  subscribe(cb: (items: T[]) => void, onError?: (e: Error) => void): () => void;
  add(data: N): Promise<string>;
  update(id: string, patch: Partial<Omit<T, 'id'>>): Promise<void>;
  remove(ids: string | string[]): Promise<void>;
}

function firestoreStore<T extends { id: string }, N extends object>(name: string): CollectionStore<T, N> {
  const ref = collection(db!, name);
  return {
    subscribe(cb, onError) {
      let unsub = () => {};
      let cancelled = false;
      authReady.then(() => {
        if (cancelled) return;
        unsub = onSnapshot(
          ref,
          (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<T, 'id'>), id: d.id }) as T)),
          (e) => onError?.(e),
        );
      });
      return () => {
        cancelled = true;
        unsub();
      };
    },
    async add(data) {
      await authReady;
      const now = Date.now();
      // id известен сразу, запись применяется локально мгновенно — не ждём подтверждения сервера
      const created = doc(ref);
      setDoc(created, { ...data, createdAt: now, updatedAt: now }).catch((e) =>
        console.error(`Не удалось сохранить в ${name}:`, e),
      );
      return created.id;
    },
    async update(id, patch) {
      await authReady;
      await updateDoc(doc(ref, id), { ...patch, updatedAt: Date.now() });
    },
    async remove(ids) {
      await authReady;
      const list = Array.isArray(ids) ? ids : [ids];
      if (list.length === 1) return deleteDoc(doc(ref, list[0]));
      const batch = writeBatch(db!);
      list.forEach((id) => batch.delete(doc(ref, id)));
      await batch.commit();
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

const make = db ? firestoreStore : localStore;

export const tasksStore = make<Task, NewTask>('tasks');
export const groupsStore = make<Group, NewGroup>('groups');
export const artifactsStore = make<Artifact, NewArtifact>('artifacts');
export const datapacksStore = make<Datapack, NewDatapack>('datapacks');
export const schematicsStore = make<SavedSchematic, NewSavedSchematic>('schematics');
