import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cx } from '@/shared/lib';
import styles from './Tag.module.css';

type OwnProps = {
  children?: ReactNode;
  className?: string;
};

type Props<T extends ElementType> = OwnProps & { as?: T } & Omit<ComponentPropsWithoutRef<T>, keyof OwnProps | 'as'>;

/** Маленькая метка: «в работе», «нет в сборке», счётчики изменений сборки */
export function Tag<T extends ElementType = 'span'>({ as, children, className, ...rest }: Props<T>) {
  const Component = as ?? 'span';
  return (
    <Component className={cx(styles.tag, className)} {...rest}>
      {children}
    </Component>
  );
}
