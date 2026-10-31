import { Check, Copy, Search as SearchIcon, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSearchTrack } from '@/shared/api';
import { Button, Card, Search } from '@/shared/ui';
import { ItemIcon, itemName, searchItems, useItems } from '@/shared/pack-data';
import { cx } from '@/shared/lib';
import styles from './ItemCatalogTab.module.css';

interface Props {
  query: string;
  selectedId: string | null;
  onQuery: (value: string) => void;
  onSelect: (id: string | null) => void;
}

/** Предметы сборки и переходы к их рецептам и тегам. */
export function ItemCatalogTab({ query, selectedId, onQuery, onSelect }: Props) {
  const items = useItems();
  const [copied, setCopied] = useState(false);
  const results = useMemo(
    () => (items && query.trim().length >= 2 ? searchItems(items, query, 60) : []),
    [items, query],
  );
  const selected = selectedId ? items?.byId.get(selectedId) : undefined;
  useSearchTrack('items', query, items ? results.length : undefined);

  const copy = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.i);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Без доступа к буферу id остаётся видимым и доступным для выделения
    }
  };

  return (
    <div className={styles.root}>
      <Search className={styles.search}>
        <SearchIcon size={15} className="faint" aria-hidden />
        <input
          aria-label="Поиск предметов"
          placeholder="Название или id: медный слиток, ingot/copper…"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </Search>

      <div className={cx(styles.body, selected && styles.withDetails)}>
        <section className={styles.results} aria-label="Результаты поиска предметов">
          {!items ? (
            <div className="empty">Загружаю предметы…</div>
          ) : query.trim().length < 2 ? (
            <p className={cx('faint', 'small', styles.hint)}>
              Введите хотя бы два символа. Ищет по русскому и английскому названию и по id.
            </p>
          ) : results.length === 0 ? (
            <div className="empty">Предметы не найдены</div>
          ) : (
            <ul className={styles.list}>
              {results.map((item) => (
                <li key={item.i}>
                  <button aria-pressed={selectedId === item.i} onClick={() => onSelect(item.i)}>
                    <ItemIcon id={item.i} size={28} tip={false} />
                    <span className={styles.names}>
                      <span>{itemName(item)}</span>
                      {item.r && <span className="faint small">{item.e}</span>}
                      <code>{item.i}</code>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {selectedId && items && (
          <Card className={styles.details}>
            {selected ? (
              <>
                <div className={styles.detailHead}>
                  <ItemIcon id={selected.i} size={48} />
                  <div className="grow">
                    <h2>{itemName(selected)}</h2>
                    {selected.r && <p className="faint small">{selected.e}</p>}
                  </div>
                  <Button variant="ghost" size="sm" icon aria-label="Закрыть предмет" onClick={() => onSelect(null)}>
                    <X size={16} />
                  </Button>
                </div>
                <div className={styles.idRow}>
                  <code>{selected.i}</code>
                  <Button variant="ghost" size="sm" onClick={copy} aria-label={`Скопировать ${selected.i}`}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Скопировано' : 'Копировать id'}
                  </Button>
                </div>
                <div className={styles.links}>
                  <Link to={`/reference?tab=items&sub=recipes&item=${encodeURIComponent(selected.i)}`}>
                    Как получить
                  </Link>
                  <Link to={`/reference?tab=items&sub=recipes&item=${encodeURIComponent(selected.i)}&usage=1`}>
                    Где используется
                  </Link>
                  <Link to={`/reference?tab=items&sub=tags&q=${encodeURIComponent(selected.i)}`}>Теги предмета</Link>
                </div>
              </>
            ) : (
              <div className="empty">Предмет «{selectedId}» не найден в библиотеке сборки</div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
