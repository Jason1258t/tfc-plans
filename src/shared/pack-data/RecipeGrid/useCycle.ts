import { useEffect, useState } from 'react';

/** Смена варианта в клетке с тегом — как в JEI; при «меньше движения» не листаем */
const CYCLE_MS = 1500;

export function useCycle(on: boolean) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setTick((n) => n + 1), CYCLE_MS);
    return () => window.clearInterval(t);
  }, [on]);
  return tick;
}
