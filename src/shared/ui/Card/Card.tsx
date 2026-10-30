import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cx } from '@/shared/lib';
import styles from './Card.module.css';

type OwnProps = {
  children?: ReactNode;
  className?: string;
};

type CardProps<T extends ElementType = 'section'> = OwnProps & {
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, keyof OwnProps | 'as'>;

/** Карточка справочника: бывший глобальный `.ref-card` из `ReferenceShared.css`. */
export function Card<T extends ElementType = 'section'>({ as, children, className, ...rest }: CardProps<T>) {
  const Component = (as ?? 'section') as ElementType;
  return (
    <Component className={cx(styles.card, className)} {...rest}>
      {children}
    </Component>
  );
}

type CardHeadProps<T extends ElementType = 'header'> = ComponentPropsWithoutRef<T> & {
  as?: T;
  className?: string;
  children?: ReactNode;
};

/** Шапка карточки: бывший `.ref-card-head`; заголовок `h2` стилизуется через `.head h2`. */
export function CardHead<T extends ElementType = 'header'>({ as, className, children, ...rest }: CardHeadProps<T>) {
  const Component = (as ?? 'header') as ElementType;
  return (
    <Component className={cx(styles.head, className)} {...rest}>
      {children}
    </Component>
  );
}
