import { useEffect, useState, type ReactNode } from 'react';
import { cx } from '@/shared/lib';
import { tooltipHandlers } from '@/shared/ui';
import { ItemIcon } from '../ItemIcon';
import { itemName, useItems } from '../items';
import { recipeGrid, type GridSlot } from '../craftGrid';
import type { Recipe } from '../recipes';
import { RecipeStatusBadges } from '../RecipeStatusBadge';
import { useTags } from '../tags';
import styles from './RecipeGrid.module.css';

/** Смена варианта в клетке с тегом — как в JEI; при «меньше движения» не листаем */
const CYCLE_MS = 1500;

function useCycle(on: boolean) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setTick((n) => n + 1), CYCLE_MS);
    return () => window.clearInterval(t);
  }, [on]);
  return tick;
}

/**
 * Сетка крафта рецепта сборки: пустые клетки, теги и варианты (листаются, состав — в подсказке), результат
 * с количеством, статус KubeJS. Общая для каталога рецептов и гайдов; у рецепта без сетки — fallback.
 */
export function RecipeGrid({
  recipe,
  caption,
  compact,
  fallback = null,
}: {
  recipe: Recipe;
  caption?: ReactNode;
  compact?: boolean;
  /** Что показать, если у рецепта нет сетки */
  fallback?: ReactNode;
}) {
  const tags = useTags();
  const items = useItems();
  const grid = tags ? recipeGrid(recipe, tags) : null;
  const tick = useCycle(!!grid?.cells.some((c) => c && c.options.length > 1));
  if (!tags) return <p className="faint small">Загружаю теги…</p>;
  if (!grid) return fallback;
  const name = (id: string) => itemName(items?.byId.get(id), id);
  const cell = (slot: GridSlot | null, i: number) => {
    if (!slot) return <div key={i} className={cx(styles.cell, styles.empty)} aria-label="пусто" role="img" />;
    const id = slot.options.length ? slot.options[tick % slot.options.length] : undefined;
    const label = slot.tag
      ? `Любой из #${slot.tag}${slot.options.length ? ` (${slot.options.length})` : ''}`
      : slot.options.length > 1
        ? `Любой из ${slot.options.length}: ${slot.options.slice(0, 6).map(name).join(', ')}`
        : id
          ? name(id)
          : `Не показать: ${slot.unknown}`;
    const sub = slot.tag && slot.options.length ? slot.options.slice(0, 8).map(name).join(', ') : id;
    return (
      <div
        key={i}
        className={cx(styles.cell, (slot.tag || slot.options.length > 1) && styles.many)}
        role="img"
        aria-label={label}
        {...tooltipHandlers(label, sub)}
      >
        {id ? (
          <ItemIcon id={id} size={32} tip={false} />
        ) : (
          // Тег без известного состава (общие теги c:* сайт знает не все) — подписываем его хвостом
          <span className={styles.unknown}>{slot.tag ? slot.tag.split('/').pop() : '?'}</span>
        )}
        {slot.tag && <span className={styles.tagMark}>#</span>}
      </div>
    );
  };
  return (
    <figure className={cx(styles.recipe, compact && styles.compact)} aria-label={`Сетка крафта: ${grid.station}`}>
      <div className={styles.flow}>
        <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${grid.width}, var(--craft-cell))` }}>
          {grid.cells.map(cell)}
        </div>
        <span className={styles.arrow} aria-hidden>
          →
        </span>
        <div
          className={cx(styles.cell, styles.out)}
          role="img"
          aria-label={grid.result.id ? `${name(grid.result.id)} ×${grid.result.count}` : 'результат'}
        >
          <ItemIcon id={grid.result.id} size={32} />
          {grid.result.count > 1 && <span className={styles.count}>{grid.result.count}</span>}
        </div>
      </div>
      <figcaption>
        <span className={styles.badges}>
          <b>{grid.station}</b> · {grid.width}×{grid.height}
          <RecipeStatusBadges r={recipe} />
        </span>
        {caption}
      </figcaption>
    </figure>
  );
}
