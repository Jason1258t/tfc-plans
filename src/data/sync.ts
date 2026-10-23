import { useSyncExternalStore } from 'react';

/**
 * Состояние связи с Firestore. Сайт держит копию базы в браузере и пишет сначала в неё, поэтому без связи
 * всё выглядит как обычно — а на других устройствах изменений нет. Здесь собираем, что известно из подписок:
 * читаем ли мы из кэша, какие документы ещё не отправлены и какие записи сервер отклонил.
 */
interface CollectionSync {
  name: string;
  fromCache: boolean;
  pending: ReadonlySet<string>;
}

export type SyncState = 'ok' | 'sending' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** Сколько документов ждут отправки */
  pendingCount: number;
  /** Последняя ошибка подписки или записи */
  error: string | null;
  /** С какого момента нет связи с сервером (мс), для подсказки */
  offlineSince: number | null;
  /** Когда началось текущее состояние (мс) */
  since: number;
}

const EMPTY: ReadonlySet<string> = new Set();
/** Первый снимок всегда из кэша — не пугаем, пока сервер не ответил за это время */
const OFFLINE_GRACE_MS = 6000;

/** По подписке: одну коллекцию могут слушать несколько страниц сразу */
const collections = new Map<number, CollectionSync>();
let nextKey = 1;
const listeners = new Set<() => void>();
let lastError: string | null = null;
let cacheSince: number | null = null;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let status: SyncStatus = { state: 'ok', pendingCount: 0, error: null, offlineSince: null, since: Date.now() };

function recompute(force = false) {
  let pendingCount = 0;
  let fromCache = false;
  for (const c of collections.values()) {
    pendingCount += c.pending.size;
    if (c.fromCache) fromCache = true;
  }
  if (!fromCache) cacheSince = null;
  else if (cacheSince === null) {
    cacheSince = Date.now();
    if (graceTimer) clearTimeout(graceTimer);
    graceTimer = setTimeout(() => recompute(), OFFLINE_GRACE_MS + 50);
  }
  const offline =
    (cacheSince !== null && Date.now() - cacheSince >= OFFLINE_GRACE_MS) ||
    (typeof navigator !== 'undefined' && navigator.onLine === false);
  const state: SyncState = lastError ? 'error' : offline ? 'offline' : pendingCount ? 'sending' : 'ok';
  const offlineSince = offline ? (cacheSince ?? Date.now()) : null;
  if (
    !force &&
    state === status.state &&
    pendingCount === status.pendingCount &&
    lastError === status.error &&
    (offlineSince === null) === (status.offlineSince === null)
  )
    return;
  const since = state === status.state ? status.since : Date.now();
  status = { state, pendingCount, error: lastError, offlineSince, since };
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => recompute());
  window.addEventListener('offline', () => recompute());
}

/** Ключ для одной подписки на коллекцию */
export function syncKey(): number {
  return nextKey++;
}

export function forgetSubscription(key: number) {
  if (collections.delete(key)) recompute(true);
}

export function reportSnapshot(key: number, name: string, fromCache: boolean, pending: ReadonlySet<string>) {
  const prev = collections.get(key)?.pending ?? EMPTY;
  const changed = prev.size !== pending.size || [...pending].some((id) => !prev.has(id));
  // Тот же набор — оставляем прежний Set, чтобы карточки не перерисовывались зря
  collections.set(key, { name, fromCache, pending: changed ? pending : prev });
  // Сервер ответил свежим снимком — прошлая ошибка подписки уже неактуальна
  if (!fromCache && lastError?.startsWith('Подписка')) lastError = null;
  recompute(changed);
}

export function reportError(message: string) {
  lastError = message;
  recompute();
}

export function clearSyncError() {
  lastError = null;
  recompute();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, () => status);
}

/** id документов коллекции, которые ещё не дошли до сервера */
export function usePendingIds(name: string): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => {
    for (const c of collections.values()) if (c.name === name) return c.pending;
    return EMPTY;
  });
}
