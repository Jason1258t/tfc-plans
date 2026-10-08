import { useEffect, useMemo, useRef, useState } from 'react';
import { searchItems, useItems, type McItem } from '../lib/items';
import { cx } from '../lib/util';
import { ItemIcon } from './ItemIcon';
import './ItemPicker.css';

interface Props {
  onPick: (item: McItem) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Очищать поле после выбора */
  clearOnPick?: boolean;
  /** Enter без выбранного предмета — отдаёт введённый текст (для свободных пунктов) */
  onSubmitText?: (text: string) => void;
  small?: boolean;
  /** Список открывается вверх (поле внизу экрана) */
  dropUp?: boolean;
}

/** Поле поиска предмета с выпадающим списком (по-русски, по-английски или по id) */
export function ItemPicker({
  onPick,
  placeholder = 'Найти предмет…',
  autoFocus,
  clearOnPick = true,
  onSubmitText,
  small,
  dropUp,
}: Props) {
  const items = useItems();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => (items && q.trim().length >= 2 ? searchItems(items, q, 40) : []), [items, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (it: McItem) => {
    onPick(it);
    if (clearOnPick) setQ('');
    setOpen(false);
  };

  return (
    <div className="item-picker">
      <input
        className={cx('input', small && 'sm')}
        value={q}
        placeholder={items ? placeholder : 'Загружаю предметы…'}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && results[active]) pick(results[active]);
            else if (onSubmitText && q.trim()) {
              onSubmitText(q.trim());
              setQ('');
            }
          } else if (e.key === 'Escape' && open && results.length > 0) {
            // Закрываем только список, а не модалку вокруг
            e.stopPropagation();
            setOpen(false);
          }
        }}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-autocomplete="list"
      />
      {open && results.length > 0 && (
        <ul className={cx('item-picker-list', dropUp && 'up')} ref={listRef} role="listbox">
          {results.map((it, i) => (
            <li
              key={it.i}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(it);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <ItemIcon id={it.i} size={24} tip={false} />
              <span className="grow">
                <span className="name">{it.r ?? it.e}</span>
                {it.r && <span className="en"> · {it.e}</span>}
                {/* Мод жирным: «Медный люк» есть и в TFC, и в ванили — различаются только им */}
                <span className="id">
                  <b>{it.i.split(':')[0]}</b>:{it.i.split(':').slice(1).join(':')}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
