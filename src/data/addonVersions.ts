import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where, writeBatch } from 'firebase/firestore';
import { authReady, db } from '@/shared/api';
import { ADDON_VERSIONS, sortVersions, type AddonVersion, type AddonVersionRevision } from '../lib/addonVersions';

/**
 * Версии аддонов — коллекция addonVersions (src/lib/addonVersions.ts), у каждой история правок revisions.
 * Создаёт версию выпуск (MCP и сервер сборки), сайт только правит ченджлог, статус и «что проверено».
 */

export const addonVersionsEnabled = Boolean(db);

/** Версии одного аддона, новые сверху */
export function subscribeAddonVersions(
  addon: string,
  cb: (list: AddonVersion[]) => void,
  onError?: (e: Error) => void,
) {
  if (!db) {
    queueMicrotask(() => cb([]));
    return () => {};
  }
  let unsub = () => {};
  let cancelled = false;
  authReady.then(() => {
    if (cancelled) return;
    unsub = onSnapshot(
      query(collection(db!, ADDON_VERSIONS), where('addon', '==', addon)),
      (snap) => cb(sortVersions(snap.docs.map((d) => ({ ...(d.data() as Omit<AddonVersion, 'id'>), id: d.id })))),
      (e) => onError?.(e),
    );
  });
  return () => {
    cancelled = true;
    unsub();
  };
}

/** Версии нескольких аддонов разом (страница обновлений): мод → версии; по одному запросу на мод */
export async function loadAddonVersions(addons: string[]): Promise<Map<string, AddonVersion[]>> {
  const out = new Map<string, AddonVersion[]>();
  if (!db || !addons.length) return out;
  await authReady;
  await Promise.all(
    [...new Set(addons)].map(async (a) => {
      const snap = await getDocs(query(collection(db!, ADDON_VERSIONS), where('addon', '==', a)));
      out.set(a, sortVersions(snap.docs.map((d) => ({ ...(d.data() as Omit<AddonVersion, 'id'>), id: d.id }))));
    }),
  );
  return out;
}

export type AddonVersionEdit = Pick<AddonVersion, 'changelog' | 'status' | 'checked' | 'checkedNote' | 'date'>;

/** Сохранить правку версии и запись в её истории одной записью */
export async function saveAddonVersion(v: AddonVersion, edit: AddonVersionEdit, nick: string) {
  await authReady;
  const ref = doc(db!, ADDON_VERSIONS, v.id);
  const now = Date.now();
  const batch = writeBatch(db!);
  const { id: _id, ...rest } = v;
  batch.set(ref, { ...rest, ...edit, updatedAt: now, updatedBy: nick });
  batch.set(doc(collection(ref, 'revisions')), { ...edit, updatedBy: nick, at: now });
  await batch.commit();
}

/** История правок версии, новые сверху */
export async function addonVersionRevisions(id: string, n = 30): Promise<AddonVersionRevision[]> {
  await authReady;
  const snap = await getDocs(query(collection(db!, ADDON_VERSIONS, id, 'revisions'), orderBy('at', 'desc'), limit(n)));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<AddonVersionRevision, 'id'>), id: d.id }));
}
