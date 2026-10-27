import { Ban, ChevronDown, ChevronRight, Copy, FilePen, Search as SearchIcon, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  itemName,
  useItems,
  filterToJs,
  recipePath,
  searchRecipes,
  STATUS_LABEL,
  type Recipe,
  type RecipeCatalog as Catalog,
  type RecipeStatus,
  ItemIcon,
  ItemPicker,
} from '@/shared/pack-data';
import { cx } from '@/shared/lib';
import { Modal, Search, Segmented, Button, Select, Tag } from '@/shared/ui';
import { track, useSearchTrack } from '@/shared/api';
import styles from './RecipeCatalog.module.css';

const PAGE = 150;

interface BrowserProps {
  catalog: Catalog | null;
  /** Кнопки действий у рецепта */
  actions: (r: Recipe) => ReactNode;
  /** Рецепт режет KubeJS — открыть конструктор */
  onConstructor?: (r: Recipe) => void;
  /** Список с собственной прокруткой (в модалке) */
  scroll?: boolean;
  autoFocus?: boolean;
  /** Начальные фильтры — для ссылок из справочника (/recipes?item=…&type=…) */
  initial?: { query?: string; type?: string; itemId?: string; usage?: boolean };
}

/**
 * Значки: удалён / изменён / добавлен KubeJS, из kubejs/data.
 * Имена классов глобальные (стили — в RecipeCatalog.module.css через :global): тот же значок
 * ставит справочник, ReferencePage.tsx — таблица металлов.
 */
function StatusBadges({ r }: { r: Recipe }) {
  return (
    <>
      {r.runtime && <span className="kjs-badge added">создаётся при запуске</span>}
      {r.kjsRemoved.length > 0 && <span className="kjs-badge removed">удалён KubeJS</span>}
      {r.kjsRemoved.length === 0 && r.kjsMaybe.length > 0 && (
        <span className="kjs-badge changed" title="Фильтр не разобрать без игры">
          возможно удалён
        </span>
      )}
      {r.kjsChanged.length > 0 && <span className="kjs-badge changed">изменён KubeJS</span>}
      {r.origin === 'kubejs-script' && <span className="kjs-badge added">скрипт KubeJS</span>}
      {r.origin === 'kubejs-data' && <span className="kjs-badge added">kubejs/data</span>}
    </>
  );
}

/** Поиск по каталогу рецептов сборки: по названию/id/типу, по предмету и по статусу в игре */
export function RecipeBrowser({ catalog, actions, onConstructor, scroll, autoFocus, initial }: BrowserProps) {
  const items = useItems();
  const [query, setQuery] = useState(initial?.query ?? '');
  const [type, setType] = useState(initial?.type ?? '');
  const [status, setStatus] = useState<RecipeStatus | ''>('');
  const [itemId, setItemId] = useState<string | null>(initial?.itemId ?? null);
  const [usage, setUsage] = useState(initial?.usage ?? false);
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const results = useMemo(
    () =>
      catalog
        ? searchRecipes(
            catalog,
            {
              query,
              type: type || undefined,
              itemId: itemId ?? undefined,
              usage,
              items,
              status: status || undefined,
            },
            Infinity,
          )
        : [],
    [catalog, query, type, itemId, usage, items, status],
  );
  useSearchTrack('recipes', query, catalog ? results.length : undefined);
  useEffect(() => {
    if (itemId) track(usage ? 'recipes.usage' : 'recipes.item', { id: itemId });
  }, [itemId, usage]);
  const hasFilter = Boolean(query.trim() || type || itemId || status);
  const rules = catalog?.kubejs?.rules ?? [];
  const resetPage = () => setLimit(PAGE);

  return (
    <div className={styles.catBrowser}>
      <div className={styles.catFilters}>
        <Search className={styles.catSearch}>
          <SearchIcon size={15} className="faint" />
          <input
            autoFocus={autoFocus}
            placeholder="Название результата, id рецепта или тип…"
            value={query}
            onChange={(e) => (setQuery(e.target.value), resetPage())}
          />
        </Search>
        <Select value={type} onChange={(e) => (setType(e.target.value), resetPage())} aria-label="Тип рецепта">
          <option value="">Все типы ({catalog?.types.length ?? '…'})</option>
          {catalog?.types.map(([t, n]) => (
            <option key={t} value={t}>
              {t} · {n}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => (setStatus(e.target.value as RecipeStatus | ''), resetPage())}
          aria-label="Статус в игре"
        >
          <option value="">Любой статус</option>
          {(Object.keys(STATUS_LABEL) as RecipeStatus[])
            .filter((s) => catalog?.kubejs || !s.startsWith('kjs-'))
            .map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
        </Select>
      </div>
      <div>
        {itemId ? (
          <div className="row">
            <Segmented
              value={usage}
              onChange={setUsage}
              options={[
                { value: false, label: 'Что делает' },
                { value: true, label: 'Где используется' },
              ]}
            />
            <span className={styles.catItemChip}>
              <ItemIcon id={itemId} size={18} />
              {itemName(items?.byId.get(itemId), itemId)}
              <Button variant="ghost" size="sm" icon onClick={() => setItemId(null)} aria-label="Сбросить предмет">
                ×
              </Button>
            </span>
          </div>
        ) : (
          <ItemPicker
            small
            placeholder="По предмету: что его делает / где используется…"
            onPick={(it) => (setItemId(it.i), resetPage())}
          />
        )}
      </div>

      {!catalog ? (
        <div className="empty">Загружаю рецепты сборки…</div>
      ) : catalog.list.length === 0 ? (
        <div className="empty">Каталог рецептов пуст — пересоберите библиотеку: npm run mods</div>
      ) : !hasFilter ? (
        <div className="empty">
          {catalog.list.length.toLocaleString('ru-RU')} рецептов, {catalog.types.length} типов
          {catalog.kubejs && `, правил KubeJS: ${catalog.kubejs.rules.length}`}. Начните с поиска или выберите тип.
        </div>
      ) : results.length === 0 ? (
        <div className="empty">Ничего не найдено</div>
      ) : (
        <>
          <div className="faint small">Найдено: {results.length.toLocaleString('ru-RU')}</div>
          <ul className={cx(styles.catList, scroll && styles.scroll)}>
            {results.slice(0, limit).map((r) => {
              const first = r.outputs.find((o) => !o.startsWith('#'));
              const expanded = open === r.i;
              const hitRules = [...r.kjsRemoved, ...r.kjsMaybe, ...r.kjsChanged].map((n) => rules[n]);
              return (
                <li key={r.i} className={cx(styles.catRow, (r.removed || r.kjsRemoved.length > 0) && styles.removed)}>
                  <div className={styles.catMain}>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      onClick={() => setOpen(expanded ? null : r.i)}
                      aria-label={expanded ? 'Свернуть JSON' : 'Показать JSON'}
                    >
                      {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </Button>
                    <span className={styles.catIcons}>
                      {r.outputs
                        .filter((o) => !o.startsWith('#'))
                        .slice(0, 3)
                        .map((o) => (
                          <ItemIcon key={o} id={o} size={22} />
                        ))}
                    </span>
                    <span className={cx('grow', styles.catNames)}>
                      <span className={styles.catTitle}>
                        {r.removed ? 'удалён в сборке' : first ? itemName(items?.byId.get(first), first) : r.i}
                      </span>
                      <code className={styles.catId}>{r.i}</code>
                    </span>
                    <StatusBadges r={r} />
                    {r.t && <Tag className={styles.recipeType}>{r.t}</Tag>}
                    <span className={cx('faint', 'small', styles.catSrc)} title={r.s}>
                      {r.s.split(/[-_](?=\d)/)[0]}
                    </span>
                    <span className={styles.catActions}>
                      {onConstructor && r.kjsRemoved.length > 0 && (
                        <Button
                          size="sm"
                          onClick={() => onConstructor(r)}
                          title="Снять ограничение или сделать рецепт на основе"
                        >
                          <ShieldAlert size={13} /> Конструктор
                        </Button>
                      )}
                      {actions(r)}
                    </span>
                  </div>
                  {expanded && (
                    <div className={styles.catDetail}>
                      <code className="faint small">{recipePath(r.i)}</code>
                      {r.runtime && (
                        <div className="faint small">
                          Мод создаёт этот рецепт при запуске игры. JSON восстановлен из кода для использования как
                          шаблон.
                        </div>
                      )}
                      {r.k && (
                        <div className={cx(styles.catKjs, 'small')}>
                          Добавлен скриптом:{' '}
                          <code>
                            {r.k.file}:{r.k.line}
                          </code>{' '}
                          <code className="faint">{r.k.code}</code>
                        </div>
                      )}
                      {hitRules.map((rule, n) => (
                        <div key={n} className={cx(styles.catKjs, 'small')}>
                          {rule.kind === 'remove'
                            ? 'Удаляет'
                            : rule.kind === 'replaceInput'
                              ? 'Меняет вход'
                              : 'Меняет выход'}
                          :{' '}
                          <code>
                            {rule.file}:{rule.idLine ?? rule.line}
                          </code>{' '}
                          <code className="faint">{rule.idCode ?? rule.code}</code>
                          {rule.kind !== 'remove' && (
                            <span className="faint">
                              {' '}
                              ({filterToJs(rule.from as never)} → {filterToJs(rule.to as never)})
                            </span>
                          )}
                        </div>
                      ))}
                      <pre className={styles.catJson}>{JSON.stringify(r.j, null, 2)}</pre>
                    </div>
                  )}
                </li>
              );
            })}
            {results.length > limit && (
              <li className={styles.catMore}>
                <Button size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                  Показать ещё {Math.min(PAGE, results.length - limit)} из {results.length - limit}
                </Button>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

interface Props {
  catalog: Catalog | null;
  /** template — взять рецепт за основу нового; existing — заменить/удалить рецепт сборки */
  mode: 'template' | 'existing';
  onPick: (kind: 'add' | 'replace' | 'remove', recipe: Recipe) => void;
  onConstructor?: (r: Recipe) => void;
  onClose: () => void;
}

/** Кнопки «Шаблон» / «Заменить» / «Удалить» для рецепта */
export function recipeActions(mode: 'template' | 'existing', onPick: Props['onPick']) {
  return (r: Recipe) =>
    mode === 'template' ? (
      <Button size="sm" onClick={() => onPick('add', r)} disabled={r.removed}>
        <Copy size={13} /> Шаблон
      </Button>
    ) : (
      <>
        <Button size="sm" onClick={() => onPick('replace', r)} disabled={r.removed}>
          <FilePen size={13} /> Заменить
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => onPick('remove', r)}
          disabled={r.removed || r.kjsRemoved.length > 0}
          title={r.kjsRemoved.length ? 'Уже удалён KubeJS' : undefined}
        >
          {r.removed ? <Ban size={13} /> : <Trash2 size={13} />} Удалить
        </Button>
      </>
    );
}

/** Каталог рецептов в модалке редактора датапака */
export function RecipeCatalog({ catalog, mode, onPick, onConstructor, onClose }: Props) {
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
      <RecipeBrowser
        catalog={catalog}
        actions={recipeActions(mode, onPick)}
        onConstructor={onConstructor}
        scroll
        autoFocus
      />
    </Modal>
  );
}
