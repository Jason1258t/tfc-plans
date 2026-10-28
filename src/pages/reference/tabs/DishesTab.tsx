import { Search } from 'lucide-react';
import { Button, Select, Table, TableWrap, tableStyles } from '@/shared/ui';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { itemName, type ItemIndex, hasStatus, useRecipes, type Recipe, ItemIcon } from '@/shared/pack-data';
import { NUTRIENTS, type Food, type Nutrient } from '@/lib/reference';
import { cx } from '@/shared/lib';
import shell from '../ReferenceShell.module.css';
import styles from './DishesTab.module.css';
import nutrition from '../NutritionTable.module.css';

const NUTRIENT_LABEL: Record<Nutrient, string> = {
  grain: 'Зерн.',
  fruit: 'Фрукты',
  vegetables: 'Овощи',
  protein: 'Белок',
  dairy: 'Молоч.',
};
const PAGE = 150;
const lower = (s: string) => s.toLowerCase().replaceAll('ё', 'е');

interface Values {
  hunger: number;
  saturation: number;
  water: number;
  decay: number;
  nutrients: Partial<Record<Nutrient, number>>;
}

interface Row {
  key: string;
  item: string;
  type: string;
  recipes: Recipe[];
  /** Питательность: из справочника еды; если рецепт задаёт её сам (поле food) — из рецепта */
  food: Values;
  fromRecipe: boolean;
}

/** Еда, записанная прямо в рецепте (firmalife:bowl_pot): те же поля, что в data/…/tfc/food */
function recipeFood(j: Record<string, unknown>): Values | null {
  const f = j.food;
  if (!f || typeof f !== 'object') return null;
  const v = f as Record<string, unknown>;
  const num = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : 0);
  const nutrients: Partial<Record<Nutrient, number>> = {};
  for (const n of NUTRIENTS) if (num(n)) nutrients[n] = num(n);
  return {
    hunger: num('hunger'),
    saturation: num('saturation'),
    water: num('water'),
    decay: typeof v.decay_modifier === 'number' ? v.decay_modifier : 1,
    nutrients,
  };
}

/**
 * Подвкладка «Готовые блюда»: еда с постоянной питательностью — по способу приготовления (тип рецепта).
 * Строится из каталога рецептов сайта, поэтому удалённые KubeJS рецепты не показываются, а добавленные — видны.
 * Блюда, питательность которых зависит от начинки (tfc:meal), сюда не входят — они в «Сборных блюдах».
 */
export function DishesTab({ items, foods }: { items: ItemIndex | null; foods: Food[] }) {
  const catalog = useRecipes();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const name = (id: string) => itemName(items?.byId.get(id), id);

  const foodOf = useMemo(() => {
    const m = new Map<string, Food>();
    for (const f of foods) for (const id of f.items) if (!m.has(id)) m.set(id, f);
    return m;
  }, [foods]);

  const { rows, types, dynamic, removed } = useMemo(() => {
    const byKey = new Map<string, Row>();
    let dyn = 0;
    let gone = 0;
    for (const r of catalog?.list ?? []) {
      if (!r.t) continue;
      const outs = r.outputs.filter((o) => foodOf.has(o));
      if (!outs.length) continue;
      if (!hasStatus(r, 'active')) {
        gone++;
        continue;
      }
      // Питательность считается из начинки — это сборное блюдо
      if (JSON.stringify(r.j.result ?? '').includes('"tfc:meal"')) {
        dyn++;
        continue;
      }
      const own = recipeFood(r.j);
      for (const item of outs) {
        const key = `${r.t}|${item}`;
        const row = byKey.get(key);
        if (row) row.recipes.push(r);
        else
          byKey.set(key, {
            key,
            item,
            type: r.t,
            recipes: [r],
            food: own ?? foodOf.get(item)!,
            fromRecipe: !!own,
          });
      }
    }
    const list = [...byKey.values()];
    const counts = new Map<string, number>();
    for (const row of list) counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
    return { rows: list, types: [...counts].sort((a, b) => b[1] - a[1]), dynamic: dyn, removed: gone };
  }, [catalog, foodOf]);

  // Способ приготовления: если id типа рецепта совпадает с предметом (вок, кастрюля) — его название
  const typeTitle = (t: string) => (items?.byId.has(t) ? `${name(t)} (${t})` : t);

  const shown = useMemo(() => {
    const words = lower(query).split(/\s+/).filter(Boolean);
    return rows
      .filter((r) => !type || r.type === type)
      .filter((r) => {
        if (!words.length) return true;
        const hay = lower(
          `${name(r.item)} ${r.item} ${r.type} ${r.recipes[0].inputs.map((i) => (i.startsWith('#') ? i : name(i))).join(' ')}`,
        );
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => a.type.localeCompare(b.type) || name(a.item).localeCompare(name(b.item), 'ru'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, type, query, items]);

  if (!catalog) return <div className="empty">Загружаю рецепты сборки…</div>;

  return (
    <>
      <div className={cx(shell.filters, shell.filtersEnd)}>
        <label className={cx(shell.search, 'grow')}>
          <Search size={15} className="faint" />
          <input
            placeholder="Блюдо или продукт: паста, рис, варенье…"
            value={query}
            onChange={(e) => (setQuery(e.target.value), setLimit(PAGE))}
          />
        </label>
        <Select
          value={type}
          onChange={(e) => (setType(e.target.value), setLimit(PAGE))}
          aria-label="Способ приготовления"
        >
          <option value="">Все способы ({types.length})</option>
          {types.map(([t, n]) => (
            <option key={t} value={t}>
              {typeTitle(t)} · {n}
            </option>
          ))}
        </Select>
      </div>
      <p className={cx('faint', 'small', shell.note)}>
        Еда с постоянной питательностью по способу приготовления — типу рецепта. Только рецепты, работающие в игре: с
        учётом удалений и добавлений KubeJS{removed ? ` (скрыто удалённых: ${removed})` : ''}. Рецепты блюд, чья
        питательность зависит от начинки ({dynamic}), — в «Сборных блюдах». В игре не проверялось. Показано{' '}
        {Math.min(limit, shown.length)} из {shown.length}.
      </p>
      {shown.length === 0 ? (
        <div className="empty">Ничего не подходит.</div>
      ) : (
        <TableWrap>
          <Table className={nutrition.table}>
            <thead>
              <tr>
                <th>Блюдо</th>
                <th>Способ</th>
                <th>Сытость</th>
                {NUTRIENTS.map((n) => (
                  <th key={n} className={nutrition.nutrient} data-nutrient={n}>
                    {NUTRIENT_LABEL[n]}
                  </th>
                ))}
                <th>Порча</th>
                <th>Из чего</th>
                <th>Рецепты</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, limit).map((r) => {
                const inputs = r.recipes[0].inputs;
                return (
                  <tr key={r.key}>
                    <td>
                      <div className={shell.ing}>
                        <ItemIcon id={r.item} size={24} />
                        <div className={shell.ingName}>
                          <span>{name(r.item)}</span>
                          {r.fromRecipe && <span className="faint small">питательность задана рецептом</span>}
                        </div>
                      </div>
                    </td>
                    <td className={cx('small', styles.type)}>
                      {items?.byId.has(r.type) && <span>{name(r.type)}</span>}
                      <code className="faint">{r.type}</code>
                    </td>
                    <td className={tableStyles.numeric}>{r.food.hunger || '—'}</td>
                    {NUTRIENTS.map((n) => (
                      <td
                        key={n}
                        className={cx(
                          tableStyles.numeric,
                          nutrition.nutrient,
                          !r.food.nutrients[n] && tableStyles.muted,
                        )}
                        data-nutrient={n}
                        data-empty={!r.food.nutrients[n] || undefined}
                      >
                        {r.food.nutrients[n] ?? '·'}
                      </td>
                    ))}
                    <td className={cx(tableStyles.numeric, r.food.decay > 1.5 && tableStyles.warning)}>
                      ×{r.food.decay}
                    </td>
                    <td className={cx('small', styles.inputs)}>
                      {inputs.slice(0, 6).map((i) =>
                        i.startsWith('#') ? (
                          <code key={i}>{i}</code>
                        ) : (
                          <span key={i} className={styles.chip}>
                            <ItemIcon id={i} size={18} tip={false} />
                            {name(i)}
                          </span>
                        ),
                      )}
                      {inputs.length > 6 && <span className="faint">ещё {inputs.length - 6}</span>}
                    </td>
                    <td className="small">
                      <Link to={`/recipes?item=${encodeURIComponent(r.item)}&type=${encodeURIComponent(r.type)}`}>
                        {r.recipes.length}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
      {shown.length > limit && (
        <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + PAGE)}>
          Показать ещё
        </Button>
      )}
    </>
  );
}
