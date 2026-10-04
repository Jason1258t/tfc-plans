import { Ban, ChevronDown, ChevronRight, Copy, FilePen, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { itemName, useItems } from '../lib/items';
import { recipePath, searchRecipes, type Recipe, type RecipeCatalog as Catalog } from '../lib/recipes';
import { cx } from '../lib/util';
import { ItemIcon } from './ItemIcon';
import { ItemPicker } from './ItemPicker';
import { Modal } from './Modal';
import './RecipeCatalog.css';

interface Props {
  catalog: Catalog | null;
  /** template — взять рецепт за основу нового; existing — заменить/удалить рецепт сборки */
  mode: 'template' | 'existing';
  onPick: (kind: 'add' | 'replace' | 'remove', recipe: Recipe) => void;
  onClose: () => void;
}

/** Каталог рецептов сборки: поиск по названию/id/типу и по предмету (что делает / где используется) */
export function RecipeCatalog({ catalog, mode, onPick, onClose }: Props) {
  const items = useItems();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [itemId, setItemId] = useState<string | null>(null);
  const [usage, setUsage] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const results = useMemo(
    () =>
      catalog
        ? searchRecipes(catalog, { query, type: type || undefined, itemId: itemId ?? undefined, usage, items }, 150)
        : [],
    [catalog, query, type, itemId, usage, items],
  );
  const hasFilter = Boolean(query.trim() || type || itemId);

  return (
    <Modal
      onClose={onClose}
      title={mode === 'template' ? 'Новый рецепт по шаблону' : 'Заменить или удалить рецепт сборки'}
      wide
    >
      <p className="faint small" style={{ margin: 0 }}>
        {mode === 'template'
          ? 'Найдите рецепт нужного механизма — его JSON станет основой нового рецепта в вашем namespace.'
          : 'Замена переопределяет файл рецепта по тому же пути; удаление кладёт заглушку neoforge:false — так же TFC отключает ванильные рецепты.'}
      </p>
      <div className="cat-filters">
        <label className="search">
          <Search size={15} className="faint" />
          <input
            autoFocus
            placeholder="Название результата, id рецепта или тип…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Тип рецепта">
          <option value="">Все типы ({catalog?.types.length ?? '…'})</option>
          {catalog?.types.map(([t, n]) => (
            <option key={t} value={t}>
              {t} · {n}
            </option>
          ))}
        </select>
      </div>
      <div className="cat-item-filter">
        {itemId ? (
          <div className="row">
            <span className="seg">
              <button aria-pressed={!usage} onClick={() => setUsage(false)}>
                Что делает
              </button>
              <button aria-pressed={usage} onClick={() => setUsage(true)}>
                Где используется
              </button>
            </span>
            <span className="cat-item-chip">
              <ItemIcon id={itemId} size={18} />
              {itemName(items?.byId.get(itemId), itemId)}
              <button className="btn ghost sm icon" onClick={() => setItemId(null)} aria-label="Сбросить предмет">
                ×
              </button>
            </span>
          </div>
        ) : (
          <ItemPicker
            small
            placeholder="По предмету: что его делает / где используется…"
            onPick={(it) => setItemId(it.i)}
          />
        )}
      </div>

      {!catalog ? (
        <div className="empty">Загружаю рецепты сборки…</div>
      ) : catalog.list.length === 0 ? (
        <div className="empty">Каталог рецептов пуст — пересоберите библиотеку: npm run items</div>
      ) : !hasFilter ? (
        <div className="empty">
          {catalog.list.length.toLocaleString('ru-RU')} рецептов, {catalog.types.length} типов. Начните с поиска или
          выберите тип.
        </div>
      ) : results.length === 0 ? (
        <div className="empty">Ничего не найдено</div>
      ) : (
        <ul className="cat-list">
          {results.map((r) => {
            const first = r.outputs.find((o) => !o.startsWith('#'));
            const expanded = open === r.i;
            return (
              <li key={r.i} className={cx('cat-row', r.removed && 'removed')}>
                <div className="cat-main">
                  <button
                    className="btn ghost sm icon"
                    onClick={() => setOpen(expanded ? null : r.i)}
                    aria-label={expanded ? 'Свернуть JSON' : 'Показать JSON'}
                  >
                    {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  <span className="cat-icons">
                    {r.outputs
                      .filter((o) => !o.startsWith('#'))
                      .slice(0, 3)
                      .map((o) => (
                        <ItemIcon key={o} id={o} size={22} />
                      ))}
                  </span>
                  <span className="grow cat-names">
                    <span className="cat-title">
                      {r.removed ? 'удалён в сборке' : first ? itemName(items?.byId.get(first), first) : r.i}
                    </span>
                    <code className="cat-id">{r.i}</code>
                  </span>
                  {r.t && <span className="tag">{r.t}</span>}
                  <span className="faint small cat-src" title={r.s}>
                    {r.s.split(/[-_](?=\d)/)[0]}
                  </span>
                  <span className="cat-actions">
                    {mode === 'template' ? (
                      <button className="btn sm" onClick={() => onPick('add', r)} disabled={r.removed}>
                        <Copy size={13} /> Шаблон
                      </button>
                    ) : (
                      <>
                        <button className="btn sm" onClick={() => onPick('replace', r)} disabled={r.removed}>
                          <FilePen size={13} /> Заменить
                        </button>
                        <button className="btn sm danger" onClick={() => onPick('remove', r)} disabled={r.removed}>
                          {r.removed ? <Ban size={13} /> : <Trash2 size={13} />} Удалить
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {expanded && (
                  <div className="cat-detail">
                    <code className="faint small">{recipePath(r.i)}</code>
                    <pre className="cat-json">{JSON.stringify(r.j, null, 2)}</pre>
                  </div>
                )}
              </li>
            );
          })}
          {results.length >= 150 && <li className="faint small cat-more">Показаны первые 150 — уточните поиск</li>}
        </ul>
      )}
    </Modal>
  );
}
