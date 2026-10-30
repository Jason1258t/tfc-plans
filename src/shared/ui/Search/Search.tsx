import type { ReactNode } from 'react';
import { cx } from '@/shared/lib';
import styles from './Search.module.css';

interface Props {
  /** Иконка (обычно лупа) и поле ввода — их передаёт страница */
  children: ReactNode;
  /** Размер и растяжение задаёт потребитель своим классом */
  className?: string;
}

/** Строка поиска: рамка, фон и фокус. Раньше это был глобальный класс `.search` из темы. */
export function Search({ children, className }: Props) {
  return <label className={cx(styles.search, className)}>{children}</label>;
}
