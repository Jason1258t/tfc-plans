import { Link } from 'react-router-dom';
import { RecipeGrid, useRecipes } from '@/shared/pack-data';

/** Виджет гайда «::craft recipe=<id>»: сетка рецепта сборки — та же, что в каталоге рецептов */
export function RecipeEmbed({ id }: { id: string }) {
  const catalog = useRecipes();
  if (!id) return <div className="empty">Нужен id рецепта: ::craft recipe=…</div>;
  if (!catalog) return <div className="empty">Загружаю рецепт…</div>;
  const recipe = catalog.byId.get(id);
  if (!recipe) return <div className="empty">Рецепта {id} нет в сборке</div>;
  if (recipe.removed) return <div className="empty">Рецепт {id} отключён в сборке</div>;
  const out = recipe.outputs.find((o) => !o.startsWith('#'));
  return (
    <RecipeGrid
      recipe={recipe}
      fallback={
        <div className="empty">
          Рецепт {id} ({recipe.t}) сайт пока не умеет показать — смотрите JEI в игре
        </div>
      }
      caption={
        <>
          {recipe.kjsRemoved.length > 0 && <b> В игре этого рецепта нет — его удаляет KubeJS сборки. </b>}В клетках с
          тегом (#) по очереди показаны допустимые предметы, состав — при наведении.{' '}
          <Link to={`/recipes?q=${encodeURIComponent(id)}`}>В каталоге рецептов</Link>
          {out && (
            <>
              {' · '}
              <Link to={`/recipes?item=${encodeURIComponent(out)}`}>все рецепты предмета</Link>
            </>
          )}
        </>
      }
    />
  );
}
