import { useEffect, useMemo, useRef, useState } from 'react';
import { isBlock, searchItems, useItems, type McItem } from '../items';
import { cx } from '@/shared/lib';
import { Input } from '@/shared/ui';
import { ItemIcon } from '../ItemIcon';
import styles from './ItemPicker.module.css';

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
  /** Только то, что ставится блоком (замены в схемах) */
  blocksOnly?: boolean;
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
  blocksOnly,
}: Props) {
  const items = useItems();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(
    () =>
      items && q.trim().length >= 2
        ? searchItems(items, q, blocksOnly ? 120 : 40)
            .filter((it) => !blocksOnly || isBlock(items, it.i))
            .slice(0, 40)
        : [],
    [items, q, blocksOnly],
  );

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
    <div className={styles.picker}>
      <Input
        className={small ? styles.smallInput : undefined}
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
        <ul className={cx(styles.list, dropUp && styles.up)} ref={listRef} role="listbox">
          {results.map((it, i) => (
            <li
              key={it.i}
              role="option"
              aria-selected={i === active}
              className={i === active ? styles.active : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(it);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <ItemIcon id={it.i} size={24} tip={false} />
              <span className="grow">
                <span className={styles.name}>{it.r ?? it.e}</span>
                {it.r && <span className={styles.en}> · {it.e}</span>}
                {/* Мод жирным: «Медный люк» есть и в TFC, и в ванили — различаются только им */}
                <span className={styles.id}>
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
