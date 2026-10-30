import type { HTMLAttributes } from 'react';
import { cx } from '@/shared/lib';
import styles from './Progress.module.css';

export type ProgressProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  /** Текущий прогресс в процентах. */
  value: number;
};

/** Полоса прогресса: бывший глобальный `.progress` из темы. */
export function Progress({ value, className, ...rest }: ProgressProps) {
  return (
    <span className={cx(styles.progress, className)} {...rest}>
      <span style={{ width: `${value}%` }} />
    </span>
  );
}
