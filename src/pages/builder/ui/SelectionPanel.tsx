import { Eraser, Paintbrush, RotateCcw, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Role } from '@tfc/core/building/grid';
import { ItemIcon, blockEntry, isBlock, itemName, searchItems, type ItemIndex } from '@/shared/pack-data';
import { Button, Search, Select } from '@/shared/ui';
import { cx } from '@/shared/lib';
import type { CellEdit } from '../model/edits';
import { ROLE_INFO, ROLE_ORDER } from '../model/roleInfo';
import styles from '../BuilderPage/BuilderPage.module.css';

interface Props {
  count: number;
  /** Сколько из выделенных уже правили */
  edited: number;
  /** Блоки, которые уже есть в постройке — быстрый выбор */
  used: string[];
  items: ItemIndex;
  onEdit: (edit: CellEdit) => void;
  onClear: () => void;
}

/** Правка выделенных клеток: роль (клетка берёт её блоки), конкретный блок, воздух, сброс правок */
export function SelectionPanel({ count, edited, used, items, onEdit, onClear }: Props) {
  const [role, setRole] = useState<Role>('corner');
  const [q, setQ] = useState('');
  const found = useMemo(
    () =>
      q.trim().length >= 2
        ? searchItems(items, q, 40)
            .filter((it) => !it.h && isBlock(items, it.i))
            .slice(0, 10)
        : [],
    [items, q],
  );
  return (
    <div className={styles.selection}>
      <div className={styles.row}>
        <b className="grow">
          Выделено: {count}
          {edited > 0 && <span className="faint small"> · с правками {edited}</span>}
        </b>
        <Button size="sm" variant="ghost" onClick={onClear} title="Снять выделение (Esc)">
          <X size={14} />
          Снять
        </Button>
      </div>
      <div className={styles.row}>
        <Select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Роль для выделенных клеток">
          {ROLE_ORDER.map((r) => (
            <option key={r} value={r}>
              {ROLE_INFO[r]?.name ?? r}
            </option>
          ))}
          <option value="empty">ничего (не ставить)</option>
        </Select>
        <Button size="sm" onClick={() => onEdit({ role })} title="Клетки возьмут блоки этой роли">
          <Paintbrush size={14} />
          Сделать ролью
        </Button>
      </div>
      <div className={styles.row}>
        <Search className="grow">
          <input
            value={q}
            placeholder="Поставить блок: название или id…"
            onChange={(e) => setQ(e.target.value)}
            aria-label="Поиск блока для выделенных клеток"
          />
        </Search>
        <Button size="sm" onClick={() => onEdit({ block: 'minecraft:air' })} title="Поставить воздух (проём, пустота)">
          <Eraser size={14} />
          Воздух
        </Button>
        <Button size="sm" disabled={!edited} onClick={() => onEdit('reset')} title="Вернуть клеткам блоки по ролям">
          <RotateCcw size={14} />
          Сбросить правки
        </Button>
      </div>
      <ul className={styles.suggest}>
        {(found.length ? found.map((it) => it.i) : used).map((id) => (
          <li key={id}>
            <Button variant="ghost" size="sm" onClick={() => onEdit({ block: id })} title={id}>
              <ItemIcon id={id} size={20} tip={false} />
              {itemName(blockEntry(items, id), id)}
            </Button>
          </li>
        ))}
      </ul>
      <p className={cx('faint', 'small')}>
        У ступени, плиты и стекла форма сохраняется — ставится такая же форма выбранного материала.
      </p>
    </div>
  );
}
