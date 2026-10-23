import { collection, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, authReady, db } from '../firebase';
import type { SiteUser } from '../types';

/**
 * Справочник участников сайта (users/{ник}). Ник — та же сущность, что подпись author/assignee/updatedBy
 * в остальных коллекциях. Каждый заход обновляет свою запись (lastSeen/uid), чтобы задача могла назначаться
 * конкретному человеку, а не только «взять себе».
 */

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
