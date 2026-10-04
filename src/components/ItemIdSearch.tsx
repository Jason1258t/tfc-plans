import { Check, Copy, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { searchItems, useItems } from '../lib/items';
import { cx } from '../lib/util';
import { ItemIcon } from './ItemIcon';
import './ItemIdSearch.css';

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
    <div className={cx('id-search', compact && 'compact')}>
      <label className="search">
        <Search size={15} className="faint" />
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
      </label>
      {q.trim().length >= 2 && (
        <ul className="id-results">
          {results.length === 0 && <li className="faint small id-empty">Ничего не найдено</li>}
          {results.map((it) => (
            <li key={it.i}>
              <ItemIcon id={it.i} size={compact ? 20 : 24} tip={false} />
              <span className="grow id-names">
                <span className="id-name">{it.r ?? it.e}</span>
                {it.r && !compact && <span className="faint small"> · {it.e}</span>}
                <code className="id-code" onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}>
                  {it.i}
                </code>
              </span>
              <button
                className={cx('btn ghost sm icon', copied === it.i && 'copied')}
                onClick={() => copy(it.i)}
                aria-label={`Скопировать ${it.i}`}
                title="Скопировать id"
              >
                {copied === it.i ? <Check size={14} /> : <Copy size={14} />}
              </button>
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
