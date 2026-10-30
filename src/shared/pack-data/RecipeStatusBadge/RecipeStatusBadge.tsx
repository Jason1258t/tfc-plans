import type { ComponentPropsWithoutRef } from 'react';
import { cx } from '@/shared/lib';
import type { Recipe } from '../recipes';
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

/** Все статусы рецепта в сборке — в каталоге, на странице предмета и в гайдах */
export function RecipeStatusBadges({ r }: { r: Recipe }) {
  return (
    <>
      {r.runtime && <RecipeStatusBadge kind="added">создаётся при запуске</RecipeStatusBadge>}
      {r.kjsRemoved.length > 0 && <RecipeStatusBadge kind="removed">удалён KubeJS</RecipeStatusBadge>}
      {r.kjsRemoved.length === 0 && r.kjsMaybe.length > 0 && (
        <RecipeStatusBadge kind="changed" title="Фильтр не разобрать без игры">
          возможно удалён
        </RecipeStatusBadge>
      )}
      {r.kjsChanged.length > 0 && <RecipeStatusBadge kind="changed">изменён KubeJS</RecipeStatusBadge>}
      {r.origin === 'kubejs-script' && <RecipeStatusBadge kind="added">скрипт KubeJS</RecipeStatusBadge>}
      {r.origin === 'kubejs-data' && <RecipeStatusBadge kind="added">kubejs/data</RecipeStatusBadge>}
    </>
  );
}
