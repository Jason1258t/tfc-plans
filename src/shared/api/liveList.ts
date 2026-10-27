import { create } from 'zustand';

/** Состояние списка: предыдущий снимок остаётся в памяти между открытиями страницы. */
interface LiveList<T> {
  items: T[];
  loading: boolean;
  error: string | null;
}

type ListSource<T> = (onItems: (items: T[]) => void, onError: (error: Error) => void) => () => void;

/**
 * Один источник данных на всех потребителей Zustand-хука и его `subscribe`.
 * `getState` только читает кэш: без слушателя источник не запускается.
 */
export function createLiveList<T>(subscribe: ListSource<T>, normalize: (items: T[]) => T[] = (items) => items) {
  return create<LiveList<T>>((set, _get, api) => {
    const subscribeState = api.subscribe;
    let consumers = 0;
    let received = false;
    let session: { active: boolean; stop: () => void } | null = null;

    const start = () => {
      const current = { active: true, stop: () => {} };
      session = current;
      set({ loading: !received, error: null });
      const fail = (error: Error) => {
        if (current.active) set({ loading: false, error: error.message });
      };
      try {
        current.stop = subscribe((items) => {
          if (!current.active) return;
          received = true;
          set({ items: normalize(items), loading: false, error: null });
        }, fail);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    };

    api.subscribe = (listener) => {
      // Сначала слушатель: источник вправе прислать первый снимок синхронно.
      const unsubscribe = subscribeState(listener);
      consumers++;
      if (!session) start();
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        unsubscribe();
        consumers--;
        if (consumers) return;
        const current = session;
        // StrictMode и переходы между потребителями в одном commit сохраняют общую подписку.
        queueMicrotask(() => {
          if (consumers || session !== current || !current) return;
          session = null;
          current.active = false;
          current.stop();
        });
      };
    };

    return { items: [], loading: true, error: null };
  });
}
