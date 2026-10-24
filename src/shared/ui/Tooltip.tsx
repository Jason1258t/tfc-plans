import { useEffect, useState, type ReactNode } from 'react';

/** Глобальная подсказка в стиле Minecraft: одна на страницу, следует за курсором */
interface TipState {
  title: ReactNode;
  sub?: ReactNode;
  x: number;
  y: number;
}

let current: TipState | null = null;
const listeners = new Set<(t: TipState | null) => void>();
const emit = () => listeners.forEach((l) => l(current));

export function tooltipHandlers(title: ReactNode, sub?: ReactNode) {
  return {
    onMouseEnter: (e: React.MouseEvent) => {
      current = { title, sub, x: e.clientX, y: e.clientY };
      emit();
    },
    onMouseMove: (e: React.MouseEvent) => {
      if (!current) return;
      current = { ...current, x: e.clientX, y: e.clientY };
      emit();
    },
    onMouseLeave: () => {
      current = null;
      emit();
    },
  };
}

export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  useEffect(() => {
    listeners.add(setTip);
    const hide = () => {
      current = null;
      emit();
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('mousedown', hide);
    return () => {
      listeners.delete(setTip);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('mousedown', hide);
    };
  }, []);
  if (!tip) return null;
  const left = Math.min(tip.x + 12, window.innerWidth - 310);
  const top = tip.y - 30 < 4 ? tip.y + 20 : tip.y - 30;
  return (
    <div className="tooltip" style={{ left, top }}>
      <div>{tip.title}</div>
      {tip.sub && <div className="sub">{tip.sub}</div>}
    </div>
  );
}
