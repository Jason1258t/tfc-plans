import { recoverSession, subscribeSessionRecovery } from './sessionRecovery';

/** Перезапускает завершившуюся подписку после обновления токенов Firebase. */
export function recoverableSubscription<T>(
  source: (receive: (value: T) => void, fail: (error: Error) => void) => () => void,
  receive: (value: T) => void,
  onError?: (error: Error) => void,
) {
  let cancelled = false;
  let failed = false;
  let stop = () => {};
  const start = () => {
    stop = source(receive, (error) => {
      failed = true;
      onError?.(error);
      if ('code' in error && (error.code === 'permission-denied' || error.code === 'unauthenticated')) {
        void recoverSession();
      }
    });
  };
  const stopRecovery = subscribeSessionRecovery(() => {
    if (cancelled || !failed) return;
    failed = false;
    stop();
    start();
  });
  start();
  return () => {
    cancelled = true;
    stopRecovery();
    stop();
  };
}
