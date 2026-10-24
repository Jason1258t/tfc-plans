import { useMemo } from 'react';
import { collection, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { create } from 'zustand';
import { auth, authReady, db } from '@/shared/api';
import { useArtifacts } from '@/entities/artifact';
import { useGroups } from '@/entities/group';
import { useTasks } from '@/entities/task';
import type { SiteUser } from './types';

/**
 * Справочник участников сайта (users/{ник}). Ник — та же сущность, что подпись author/assignee/updatedBy
 * в остальных коллекциях. Каждый заход обновляет свою запись (lastSeen/uid), чтобы задача могла назначаться
 * конкретному человеку, а не только «взять себе».
 */

interface UserList {
  items: SiteUser[];
  error: string | null;
}

export const useUsers = create<UserList>(() => ({ items: [], error: null }));

let stop: (() => void) | null = null;

export function startUsers(): () => void {
  if (stop) return stop;
  const unsub = subscribeUsers(
    (users) => useUsers.setState({ items: users, error: null }),
    (e) => useUsers.setState({ error: e.message }),
  );
  stop = () => {
    unsub();
    stop = null;
  };
  return stop;
}

/**
 * «Люди» — не только заходившие браузером: агенты и игроки, назначенные на задачи, тоже видны
 * (у них lastSeen = 0 — «только в задачах»).
 */
export function usePeople(): SiteUser[] {
  const users = useUsers((s) => s.items);
  const tasks = useTasks((s) => s.items);
  const groups = useGroups((s) => s.items);
  const artifacts = useArtifacts((s) => s.items);
  return useMemo<SiteUser[]>(() => {
    const map = new Map<string, SiteUser>();
    for (const u of users) map.set(u.id, u);
    const add = (name?: string | null) => {
      if (!name || map.has(name)) return;
      map.set(name, { id: name, nick: name, uid: null, firstSeen: 0, lastSeen: 0 });
    };
    for (const t of tasks) {
      add(t.author);
      add(t.assignee);
    }
    for (const g of groups) add(g.author);
    for (const a of artifacts) {
      add(a.author);
      add(a.updatedBy);
    }
    return [...map.values()];
  }, [users, tasks, groups, artifacts]);
}

export function subscribeUsers(cb: (users: SiteUser[]) => void, onError?: (e: Error) => void): () => void {
  if (!db) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    collection(db, 'users'),
    (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<SiteUser, 'id'>), id: d.id }) as SiteUser)),
    (e) => onError?.(e),
  );
}

/** Отметить, что под этим ником зашёл человек: lastSeen/uid обновляются, firstSeen — один раз при первом заходе */
export async function touchPresence(nick: string): Promise<void> {
  if (!db) return;
  await authReady;
  const uid = auth?.currentUser?.uid ?? null;
  const ref = doc(db, 'users', nick);
  try {
    const existing = await getDoc(ref);
    await setDoc(
      ref,
      { nick, uid, lastSeen: Date.now(), ...(existing.exists() ? {} : { firstSeen: Date.now() }) },
      { merge: true },
    );
  } catch (e) {
    // справочник не должен мешать работе сайта
    console.warn('Справочник участников не записался:', e);
  }
}
