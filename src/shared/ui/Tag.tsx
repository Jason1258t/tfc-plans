import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '@/shared/lib';
import styles from './Tag.module.css';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  children?: ReactNode;
}

/** Маленькая метка: «в работе», «нет в сборке», счётчики изменений сборки */
export function Tag({ children, className, ...rest }: Props) {
  return (
    <span className={cx(styles.tag, className)} {...rest}>
      {children}
    </span>
  );
}
