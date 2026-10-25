import { Check, Copy, Search as SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { searchItems, useItems } from './items';
import { cx } from '@/shared/lib';
import { Search, Button } from '@/shared/ui';
import { ItemIcon } from './ItemIcon';
import { useSearchTrack } from '@/shared/api';
import styles from './ItemIdSearch.module.css';

interface Props {
  autoFocus?: boolean;
  /** Компактный вид для боковой панели редактора */
  compact?: boolean;
  limit?: number;
}

/** Поиск предмета по названию (ru/en) или id с копированием id — без автоподстановки куда-либо */
export function ItemIdSearch({ autoFocus, compact, limit = 40 }: Props) {
  const items = useItems();
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const results = useMemo(() => (items && q.trim().length >= 2 ? searchItems(items, q, limit) : []), [items, q, limit]);
  useSearchTrack('items', q, items ? results.length : undefined);

  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      /* без доступа к буферу — id всё равно виден и выделяется */
    }
  };

  return (
    <div className={cx(styles.root, compact && styles.compact)}>
      <Search className={styles.searchBox}>
        <SearchIcon size={15} className="faint" />
        <input
          value={q}
          autoFocus={autoFocus}
          placeholder={items ? 'Название или id предмета…' : 'Загружаю предметы…'}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) copy(results[0].i);
          }}
          aria-label="Поиск предмета"
        />
      </Search>
      {q.trim().length >= 2 && (
        <ul className={styles.results}>
          {results.length === 0 && <li className={cx('faint', 'small', styles.empty)}>Ничего не найдено</li>}
          {results.map((it) => (
            <li key={it.i}>
              <ItemIcon id={it.i} size={compact ? 20 : 24} tip={false} />
              <span className={cx('grow', styles.names)}>
                <span className={styles.name}>{it.r ?? it.e}</span>
                {it.r && !compact && <span className="faint small"> · {it.e}</span>}
                <code
                  className={styles.code}
                  onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}
                >
                  {it.i}
                </code>
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon
                className={cx(copied === it.i && styles.copied)}
                onClick={() => copy(it.i)}
                aria-label={`Скопировать ${it.i}`}
                title="Скопировать id"
              >
                {copied === it.i ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!compact && q.trim().length < 2 && (
        <p className="faint small" style={{ margin: 0 }}>
          Ищет по русскому и английскому названию и по id. Enter — скопировать первый результат.
        </p>
      )}
    </div>
  );
}
