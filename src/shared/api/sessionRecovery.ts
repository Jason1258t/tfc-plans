/** После обновления сессии завершившиеся подписки можно создать заново, сохранив данные страницы. */
const listeners = new Set<() => void>();
let refresh: (() => Promise<void>) | undefined;
let pending: Promise<void> | undefined;
let lastAttempt = 0;

export function subscribeSessionRecovery(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recoverSession(): Promise<void> {
  if (pending) return pending;
  if (!refresh || Date.now() - lastAttempt < 30_000) return Promise.resolve();
  lastAttempt = Date.now();
  pending = refresh()
    .then(() => {
      for (const listener of listeners) listener();
    })
    .catch((error: unknown) => {
      console.warn('Не удалось обновить сессию Firebase:', error);
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

export function installSessionRecovery(refreshSession: () => Promise<void>) {
  refresh = refreshSession;
  let hiddenAt: number | undefined = document.hidden ? Date.now() : undefined;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else {
      if (hiddenAt !== undefined && Date.now() - hiddenAt >= 5 * 60_000) void recoverSession();
      hiddenAt = undefined;
    }
  });
  window.addEventListener('online', () => void recoverSession());
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void recoverSession();
  });
}
