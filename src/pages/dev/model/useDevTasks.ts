import { useCallback, useEffect, useState } from 'react';
import { devApi, type DevTask } from './api';

/** Раз в минуту, пока вкладка открыта, и при возврате на неё — список дешёвый, это один запрос к серверу сборки */
const POLL_MS = 60_000;

export function useDevTasks() {
  const [tasks, setTasks] = useState<DevTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setTasks(await devApi.list());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
    const tick = () => document.visibilityState === 'visible' && void reload();
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [reload]);

  /** Подменить задачу в списке после правки, не дожидаясь перечитывания */
  const put = useCallback(
    (t: DevTask) =>
      setTasks((list) => {
        if (!list) return list;
        const i = list.findIndex((x) => x.id === t.id);
        const old = i >= 0 ? list[i] : {};
        const next = { ...old, ...t };
        return i >= 0 ? list.map((x, j) => (j === i ? next : x)) : [next, ...list];
      }),
    [],
  );
  const drop = useCallback((id: number) => setTasks((list) => list?.filter((x) => x.id !== id) ?? list), []);

  return { tasks, error, reload, put, drop };
}
