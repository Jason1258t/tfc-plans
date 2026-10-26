import type { ReactNode } from 'react';
import { cx } from '@/shared/lib';
import styles from './EmptyState.module.css';

interface Props {
  children: ReactNode;
  className?: string;
}

/** Пустой или загружающийся блок: текст по центру, приглушённый цвет */
export function EmptyState({ children, className }: Props) {
  return <div className={cx(styles.empty, className)}>{children}</div>;
}
