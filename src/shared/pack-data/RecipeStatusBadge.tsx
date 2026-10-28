import type { ComponentPropsWithoutRef } from 'react';
import { cx } from '@/shared/lib';
import styles from './RecipeStatusBadge.module.css';

interface Props extends ComponentPropsWithoutRef<'span'> {
  /** Рецепт удалён, изменён или добавлен сборкой. */
  kind: 'removed' | 'changed' | 'added';
}

/** Статус рецепта KubeJS: одинаковый в каталоге и справочнике. */
export function RecipeStatusBadge({ kind, className, children, ...rest }: Props) {
  return (
    <span {...rest} className={cx(styles.badge, className)} data-kind={kind}>
      {children}
    </span>
  );
}
