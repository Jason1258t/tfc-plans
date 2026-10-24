import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where, writeBatch } from 'firebase/firestore';
import { authReady, db, track } from '@/shared/api';
import type { Guide, GuideRevision } from '@/entities/guide';

/**
 * Гайды справочника — коллекция guides, у каждого история правок guides/{id}/revisions (последняя запись — текущая
 * версия). Статью правят все, поэтому каждое сохранение пишет и версию: испорченную можно откатить.
 * Без Firebase гайдов нет — их негде хранить.
 */

export const guidesEnabled = Boolean(db);

export function subscribeGuides(section: string, cb: (g: Guide[]) => void, onError?: (e: Error) => void) {
  if (!db) {
    queueMicrotask(() => cb([]));
    return () => {};
  }
  let unsub = () => {};
  let cancelled = false;
  authReady.then(() => {
    if (cancelled) return;
    unsub = onSnapshot(
      query(collection(db!, 'guides'), where('section', '==', section)),
      (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<Guide, 'id'>), id: d.id }))),
      (e) => onError?.(e),
    );
  });
  return () => {
    cancelled = true;
    unsub();
  };
}

/** Один гайд по id (статья аддона): null — статьи ещё нет */
export function subscribeGuide(id: string, cb: (g: Guide | null) => void, onError?: (e: Error) => void) {
  if (!db) {
    queueMicrotask(() => cb(null));
    return () => {};
  }
  let unsub = () => {};
  let cancelled = false;
  authReady.then(() => {
    if (cancelled) return;
    unsub = onSnapshot(
      doc(db!, 'guides', id),
      (d) => cb(d.exists() ? { ...(d.data() as Omit<Guide, 'id'>), id: d.id } : null),
      (e) => onError?.(e),
    );
  });
  return () => {
    cancelled = true;
    unsub();
  };
}

export type GuideDraft = Omit<Guide, 'id' | 'createdAt' | 'updatedAt'>;

/** Сохранить гайд и его версию одной записью; id === null — новый. Возвращает id */
export async function saveGuide(id: string | null, draft: GuideDraft, createdAt?: number): Promise<string> {
  track(id ? 'guides.edit' : 'guides.create');
  await authReady;
  const ref = id ? doc(db!, 'guides', id) : doc(collection(db!, 'guides'));
  const now = Date.now();
  const batch = writeBatch(db!);
  batch.set(ref, { ...draft, createdAt: createdAt ?? now, updatedAt: now });
  batch.set(doc(collection(ref, 'revisions')), {
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    updatedBy: draft.updatedBy,
    at: now,
  });
  await batch.commit();
  return ref.id;
}

/** Последние версии гайда, новые сверху */
export async function guideRevisions(id: string, n = 30): Promise<GuideRevision[]> {
  await authReady;
  const snap = await getDocs(query(collection(db!, 'guides', id, 'revisions'), orderBy('at', 'desc'), limit(n)));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<GuideRevision, 'id'>), id: d.id }));
}
