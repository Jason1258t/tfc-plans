import { useCallback, useRef, useState } from 'react';

/** Сколько шагов отмены хранить */
const LIMIT = 100;
/** Правки чаще этого (набор числа в поле) сливаются в один шаг отмены */
const MERGE_MS = 700;

/**
 * Состояние с отменой и повтором. set(fn | value) — новый шаг; replace — без шага (загрузка из библиотеки).
 */
export function useHistory<T>(initial: () => T) {
  const [state, setState] = useState(() => ({ past: [] as T[], present: initial(), future: [] as T[] }));
  const last = useRef(0);
  const set = useCallback((next: T | ((prev: T) => T)) => {
    const now = Date.now();
    const merge = now - last.current < MERGE_MS;
    last.current = now;
    setState((s) => {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(s.present) : next;
      if (value === s.present) return s;
      const past = merge && s.past.length ? s.past : [...s.past, s.present].slice(-LIMIT);
      return { past, present: value, future: [] };
    });
  }, []);
  const replace = useCallback((value: T) => setState({ past: [], present: value, future: [] }), []);
  const undo = useCallback(() => {
    last.current = 0;
    setState((s) =>
      s.past.length
        ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] }
        : s,
    );
  }, []);
  const redo = useCallback(() => {
    last.current = 0;
    setState((s) =>
      s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s,
    );
  }, []);
  return {
    value: state.present,
    set,
    replace,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
