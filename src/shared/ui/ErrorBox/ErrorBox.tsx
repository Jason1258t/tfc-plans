import type { ReactNode } from 'react';
import { cx } from '@/shared/lib';
import styles from './ErrorBox.module.css';

interface Props {
  /** Сообщение об ошибке; пусто — ничего не рисуется */
  children?: ReactNode;
  className?: string;
}

/** Плашка ошибки: красный фон, перенос длинных имён, объявление для скринридера */
export function ErrorBox({ children, className }: Props) {
  if (children === null || children === undefined || children === false || children === '') return null;
  return (
    <div role="alert" className={cx(styles.errorBox, className)}>
      {children}
    </div>
  );
}
