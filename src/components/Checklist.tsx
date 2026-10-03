import { useState } from 'react';
import { itemName, useItems } from '../lib/items';
import { entryDone } from '../lib/tasks';
import { cx, uid } from '../lib/util';
import type { ChecklistEntry } from '../types';
import { ItemIcon } from './ItemIcon';
import { ItemPicker } from './ItemPicker';
import './Checklist.css';

interface Props {
  entries: ChecklistEntry[];
  onChange: (next: ChecklistEntry[]) => void;
}

/**
 * Чеклист задачи: ресурсы (предмет + сколько нужно/собрано) и обычные пункты.
 * Поле добавления: выбрал предмет из подсказки — добавился ресурс, нажал Enter на тексте — обычный пункт.
 */
export function Checklist({ entries, onChange }: Props) {
  const items = useItems();
  const [qty, setQty] = useState(1);

  const patch = (id: string, p: Partial<ChecklistEntry>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const remove = (id: string) => onChange(entries.filter((e) => e.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = entries.findIndex((e) => e.id === id);
    const j = i + dir;
    if (j < 0 || j >= entries.length) return;
    const next = [...entries];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const addItem = (itemId: string, text: string) => {
    const existing = entries.find((e) => e.itemId === itemId);
    if (existing) patch(existing.id, { qty: (existing.qty ?? 1) + qty });
    else onChange([...entries, { id: uid(), itemId, text, qty, got: 0 }]);
    setQty(1);
  };

  const doneCount = entries.filter(entryDone).length;

  return (
    <div className="checklist">
      {entries.length > 0 && (
        <ul className="checklist-list">
          {entries.map((e) => {
            const done = entryDone(e);
            return (
              <li key={e.id} className={cx('checklist-row', done && 'done')}>
                {e.itemId ? (
                  <>
                    <span className="mc-slot cl-slot">
                      <ItemIcon id={e.itemId} size={28} />
                    </span>
                    <span className="grow cl-text">{itemName(items?.byId.get(e.itemId), e.text || e.itemId)}</span>
                    <span className="cl-counter">
                      <button
                        className="mc-btn sm icon-only"
                        aria-label="Минус один"
                        onClick={() => patch(e.id, { got: Math.max(0, (e.got ?? 0) - 1) })}
                      >
                        −
                      </button>
                      <input
                        className="mc-input cl-num"
                        type="number"
                        min={0}
                        value={e.got ?? 0}
                        aria-label="Собрано"
                        onChange={(ev) => patch(e.id, { got: Math.max(0, Number(ev.target.value) || 0) })}
                      />
                      <span className="cl-sep">/</span>
                      <input
                        className="mc-input cl-num"
                        type="number"
                        min={1}
                        value={e.qty ?? 1}
                        aria-label="Нужно"
                        onChange={(ev) => patch(e.id, { qty: Math.max(1, Number(ev.target.value) || 1) })}
                      />
                      <button
                        className="mc-btn sm icon-only"
                        aria-label="Плюс один"
                        onClick={() => patch(e.id, { got: (e.got ?? 0) + 1 })}
                      >
                        +
                      </button>
                      <button
                        className={cx('mc-btn sm icon-only', done && 'green')}
                        aria-label="Собрано всё"
                        title="Собрано всё"
                        onClick={() => patch(e.id, { got: done ? 0 : (e.qty ?? 1) })}
                      >
                        ✓
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <label className="row grow cl-text" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(e.done)}
                        onChange={(ev) => patch(e.id, { done: ev.target.checked })}
                      />
                      <span>{e.text}</span>
                    </label>
                  </>
                )}
                <span className="cl-actions">
                  <button className="cl-mini" aria-label="Выше" onClick={() => move(e.id, -1)}>
                    ▲
                  </button>
                  <button className="cl-mini" aria-label="Ниже" onClick={() => move(e.id, 1)}>
                    ▼
                  </button>
                  <button className="cl-mini danger" aria-label="Удалить" onClick={() => remove(e.id)}>
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="row cl-add">
        <input
          className="mc-input cl-num"
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          aria-label="Количество для нового ресурса"
          title="Количество для ресурса"
        />
        <div className="grow">
          <ItemPicker
            placeholder="Предмет или пункт… (Enter — текстовый пункт)"
            onPick={(it) => addItem(it.i, it.r ?? it.e)}
            onSubmitText={(text) => onChange([...entries, { id: uid(), text, done: false }])}
          />
        </div>
      </div>
      {entries.length > 0 && (
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          Выполнено {doneCount} из {entries.length}
        </div>
      )}
    </div>
  );
}
