import { useCallback, useEffect, useState } from 'react';
import { devApi, type DevTask } from './api';

/** Кеш переживает переходы между страницами; фоновое обновление не скрывает список. */
let cached: DevTask[] | null = null;
let pending: Promise<DevTask[]> | null = null;
let generation = 0;
const POLL_MS = 10_000;

export function useDevTasks() {
  const [tasks, setTasks] = useState<DevTask[] | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    const started = generation;
    setRefreshing(true);
    try {
      pending ??= devApi.list().finally(() => {
        pending = null;
      });
      const next = await pending;
      if (started === generation) {
        cached = next;
        setTasks(next);
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const tick = () => document.visibilityState === 'visible' && void reload();
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [reload]);

  const put = useCallback(
    (t: DevTask) =>
      setTasks((list) => {
        generation++;
        const current = list ?? [];
        const old = current.find((x) => x.id === t.id);
        cached = old ? current.map((x) => (x.id === t.id ? { ...x, ...t } : x)) : [t, ...current];
        return cached;
      }),
    [],
  );
  const drop = useCallback(
    (id: number) =>
      setTasks((list) => {
        generation++;
        cached = list?.filter((x) => x.id !== id) ?? null;
        return cached;
      }),
    [],
  );

  return { tasks, error, refreshing, reload, put, drop };
}
