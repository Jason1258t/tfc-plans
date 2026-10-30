import { Link } from 'react-router-dom';
import { directMembers, flattenTag, ItemIcon, useRecipes, useTags } from '@/shared/pack-data';
import styles from './CraftingRecipe.module.css';

/** Сетка берётся из рецепта каталога; для тега показан один из допустимых предметов. */
export function CraftingRecipe({ id }: { id: string }) {
  const catalog = useRecipes();
  const tags = useTags();
  if (!catalog) return <p className="faint">Загружаю рецепт…</p>;
  const recipe = catalog.byId.get(id);
  if (!recipe || recipe.removed || recipe.kjsRemoved.length) return <p>Рецепт недоступен в сборке: {id}</p>;
  const { pattern, key, result } = recipe.j;
  if (!Array.isArray(pattern) || !pattern.every((row) => typeof row === 'string') || !key || typeof key !== 'object')
    return <p>У рецепта нет сетки крафта.</p>;
  const rows = pattern as string[];
  const width = Math.max(...rows.map((row) => row.length));
  if (width < 1 || width > 9 || rows.length > 9) return <p>Сетка рецепта слишком большая.</p>;
  const ingredients = key as Record<string, unknown>;
  const resolve = (value: unknown): { id?: string; tag?: string } => {
    if (Array.isArray(value)) return resolve(value[0]);
    if (typeof value === 'string') return { id: value };
    if (!value || typeof value !== 'object') return {};
    const v = value as { item?: string; tag?: string };
    if (v.item) return { id: v.item };
    if (v.tag) {
      const tag = tags?.byKey.get(`item|${v.tag}`);
      return { id: tags && tag ? flattenTag(tags, 'item', directMembers(tag))[0] : undefined, tag: v.tag };
    }
    return {};
  };
  const output =
    typeof result === 'object' && result ? (result as { id?: string; item?: string; count?: number }) : null;
  const outputId = output?.id ?? output?.item ?? (typeof result === 'string' ? result : undefined);
  return (
    <figure className={styles.recipe} aria-label="Сетка крафта">
      <div className={styles.flow}>
        <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${width}, var(--craft-cell))` }}>
          {rows.flatMap((row, y) =>
            Array.from({ length: width }, (_, x) => {
              const symbol = row[x] ?? ' ';
              const ingredient = resolve(ingredients[symbol]);
              return (
                <div
                  className={styles.cell}
                  key={`${x},${y}`}
                  title={ingredient.tag ? `Любой из #${ingredient.tag}` : undefined}
                >
                  {ingredient.id ? <ItemIcon id={ingredient.id} size={32} /> : symbol !== ' ' ? <span>?</span> : null}
                </div>
              );
            }),
          )}
        </div>
        <span className={styles.arrow} aria-label="Результат">
          →
        </span>
        <div className={styles.cell}>
          <ItemIcon id={outputId} size={32} />
          {output?.count && output.count > 1 ? <span>×{output.count}</span> : null}
        </div>
      </div>
      <figcaption>
        {recipe.t === 'create:mechanical_crafting' ? 'Механический крафт Create' : 'Верстак'} · {width}×{rows.length}. В
        клетках с тегом показан один допустимый предмет; наведите на клетку, чтобы увидеть тег.{' '}
        <Link to={`/recipes?item=${encodeURIComponent(outputId ?? '')}`}>Рецепт в каталоге</Link>
      </figcaption>
    </figure>
  );
}
