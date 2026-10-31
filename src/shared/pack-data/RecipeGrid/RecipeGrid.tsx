import { type ReactNode } from 'react';
import { cx } from '@/shared/lib';
import { recipeView, type RecipeView, type ViewSlot } from '@tfc/core/recipeView';
import { ItemIcon } from '../ItemIcon';
import { itemName, useItems, type ItemIndex } from '../items';
import { ingredientSlot, recipeGrid, type GridSlot } from '../craftGrid';
import type { Recipe } from '../recipes';
import { RecipeStatusBadges } from '../RecipeStatusBadge';
import { useTags, type TagCatalog } from '../tags';
import { SlotCell, SlotIcon, type IconOverrides } from './SlotCell';
import { useCycle } from './useCycle';
import styles from './RecipeGrid.module.css';

/** Слот раскладки → клетка: предмет раскрываем по тегам, как в сетке крафта */
function resolve(s: ViewSlot, tags: TagCatalog): GridSlot | null {
  if (s.fluid) return { options: [], fluid: s.fluid };
  if (s.item === undefined) return null;
  return ingredientSlot(s.item, tags);
}

/**
 * Сетка крафта рецепта сборки: пустые клетки, теги и варианты (листаются, состав — в подсказке), результат
 * с количеством, статус KubeJS. Остальные типы — раскладкой станции, как в JEI (`@tfc/core/recipeView`):
 * входы → станция с условиями → выходы. Общая для каталога рецептов и гайдов; не разобрали — fallback.
 */
export function RecipeGrid({
  recipe,
  caption,
  compact,
  fallback = null,
  icons,
}: {
  recipe: Recipe;
  caption?: ReactNode;
  compact?: boolean;
  /** Что показать, если рецепт не разобрать ни сеткой, ни раскладкой */
  fallback?: ReactNode;
  /** Картинки предметов вне библиотеки (рецепт из карточки аддона) */
  icons?: IconOverrides;
}) {
  const tags = useTags();
  const items = useItems();
  const grid = tags ? recipeGrid(recipe, tags) : null;
  const view = tags && !grid && !recipe.removed ? recipeView(recipe) : null;
  const tick = useCycle(
    !!grid?.cells.some((c) => c && c.options.length > 1) ||
      !!view?.inputs.some((s) => s.item !== undefined && typeof s.item !== 'string'),
  );
  if (!tags) return <p className="faint small">Загружаю теги…</p>;
  if (view)
    return (
      <RecipeProcess
        recipe={recipe}
        view={view}
        caption={caption}
        compact={compact}
        tick={tick}
        tags={tags}
        items={items}
      />
    );
  if (!grid) return fallback;
  const name = (id: string) => icons?.get(id)?.name ?? itemName(items?.byId.get(id), id);
  return (
    <figure className={cx(styles.recipe, compact && styles.compact)} aria-label={`Сетка крафта: ${grid.station}`}>
      <div className={styles.flow}>
        <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${grid.width}, var(--craft-cell))` }}>
          {grid.cells.map((c, i) => (
            <SlotCell key={i} slot={c} tick={tick} tags={tags} items={items} icons={icons} />
          ))}
        </div>
        <span className={styles.arrow} aria-hidden>
          →
        </span>
        <div
          className={cx(styles.cell, styles.out)}
          role="img"
          aria-label={grid.result.id ? `${name(grid.result.id)} ×${grid.result.count}` : 'результат'}
        >
          {grid.result.id && icons?.has(grid.result.id) ? (
            <SlotIcon id={grid.result.id} icons={icons} />
          ) : (
            <ItemIcon id={grid.result.id} size={32} />
          )}
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

/** Раскладка станции: входы → (станция, условия) → выходы; ниже — шаги и узор */
function RecipeProcess({
  recipe,
  view,
  icons,
  caption,
  compact,
  tick,
  tags,
  items,
}: {
  recipe: Recipe;
  view: RecipeView;
  icons?: IconOverrides;
  caption?: ReactNode;
  compact?: boolean;
  tick: number;
  tags: TagCatalog;
  items: ItemIndex | null;
}) {
  const width = view.pattern ? Math.max(...view.pattern.rows.map((r) => r.length)) : 0;
  const cell = (s: ViewSlot, i: number, out?: boolean) => (
    <SlotCell
      key={i}
      slot={resolve(s, tags)}
      tick={tick}
      tags={tags}
      items={items}
      count={s.count}
      chance={s.chance}
      role={s.role}
      note={s.note}
      out={out}
      fluidInSlot
      icons={icons}
    />
  );
  const stationName = view.stationIcon ? itemName(items?.byId.get(view.stationIcon), view.stationIcon) : null;
  return (
    <figure className={cx(styles.recipe, compact && styles.compact)} aria-label={`Рецепт: ${view.station}`}>
      <div className={styles.flow}>
        <div className={styles.slots}>{view.inputs.map((s, i) => cell(s, i))}</div>
        <div className={styles.station}>
          {view.stationIcon && <ItemIcon id={view.stationIcon} size={28} />}
          <span className={styles.arrow} aria-hidden>
            →
          </span>
          {view.facts.map((f) => (
            <span key={f.label} className={styles.fact}>
              {f.label}: <b>{f.value}</b>
            </span>
          ))}
        </div>
        <div className={styles.slots}>{view.outputs.map((s, i) => cell(s, i, true))}</div>
      </div>
      {view.pattern && (
        <div className={styles.patternWrap}>
          <div
            className={styles.pattern}
            style={{ gridTemplateColumns: `repeat(${width}, 1fr)` }}
            role="img"
            aria-label={`Узор: закрашено — ${view.pattern.filled}`}
          >
            {view.pattern.rows.flatMap((row, y) =>
              [...row.padEnd(width)].map((ch, x) => (
                <span key={`${y}-${x}`} className={cx(styles.px, ch !== ' ' && styles.pxOn)} />
              )),
            )}
          </div>
          <span className="faint small">
            закрашено — {view.pattern.filled}
            {view.pattern.empty ? `, пусто — ${view.pattern.empty}` : ''}
          </span>
        </div>
      )}
      {view.steps && (
        <ol className={styles.steps}>
          {view.steps.map((s, i) => (
            <li key={i}>
              <span>{s.label}</span>
              {s.slots?.map((sl, n) => cell(sl, n))}
            </li>
          ))}
        </ol>
      )}
      <figcaption>
        <span className={styles.badges}>
          <b>{view.station}</b>
          {stationName && stationName !== view.station && <span className="faint">({stationName})</span>}
          {view.guessed && (
            <span
              className="faint"
              title="у этого типа нет своего правила — входы и выходы взяты из обычных полей JSON"
            >
              · раскладка по общим полям
            </span>
          )}
          <RecipeStatusBadges r={recipe} />
        </span>
        {caption}
      </figcaption>
    </figure>
  );
}
