import type { ReactNode } from 'react';
import { cx } from '@/shared/lib';
import styles from './Segmented.module.css';

export interface SegmentedOption<T extends string | number | boolean | null> {
  value: T;
  /** Подпись; можно не давать, если есть значок */
  label?: ReactNode;
  /** Значок перед подписью */
  icon?: ReactNode;
  /** Число справа (счётчик) */
  count?: number | string;
  /** Подпись для скринридера — нужна кнопкам-значкам */
  ariaLabel?: string;
  title?: string;
}

interface Props<T extends string | number | boolean | null> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Подпись группы для скринридера */
  label?: string;
  /** Роль контейнера: группа по умолчанию, tablist у вкладок-переключателей */
  role?: 'group' | 'tablist';
  /** Кнопки — вкладки: role="tab" и aria-selected вместо aria-pressed */
  tabs?: boolean;
  className?: string;
}

/** Сегментированный переключатель: ряд кнопок, выбранная — aria-pressed */
export function Segmented<T extends string | number | boolean | null>({
  options,
  value,
  onChange,
  label,
  role = 'group',
  tabs = false,
  className,
}: Props<T>) {
  return (
    <div className={cx(styles.seg, className)} role={role} aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role={tabs ? 'tab' : undefined}
          aria-selected={tabs ? value === o.value : undefined}
          aria-pressed={tabs ? undefined : value === o.value}
          onClick={() => onChange(o.value)}
          aria-label={o.ariaLabel}
          title={o.title}
        >
          {o.icon}
          {o.label}
          {o.count !== undefined && <span className={styles.count}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
