import { Check, ChevronDown, ChevronUp, Minus, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { itemName, useItems } from '../lib/items';
import { entryDone } from '../lib/tasks';
import { cx, uid } from '../lib/util';
import type { ChecklistEntry } from '../types';
import './Checklist.css';
import { ItemIcon } from './ItemIcon';
import { ItemPicker } from './ItemPicker';

interface Props {
  entries: ChecklistEntry[];
  onChange: (next: ChecklistEntry[]) => void;
}

/**
 * Чеклист задачи: ресурсы (предмет + сколько собрано из нужного) и обычные пункты.
 * В поле добавления: выбрал предмет из подсказки — ресурс, нажал Enter на тексте — обычный пункт.
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
        <ul className="cl-list">
          {entries.map((e) => {
            const done = entryDone(e);
            return (
              <li key={e.id} className={cx('cl-row', done && 'done')}>
                {e.itemId ? (
                  <>
                    <button
                      className={cx('cl-check', done && 'on')}
                      aria-label={done ? 'Сбросить' : 'Собрано всё'}
                      aria-pressed={done}
                      onClick={() => patch(e.id, { got: done ? 0 : (e.qty ?? 1) })}
                    >
                      {done && <Check size={12} strokeWidth={3} />}
                    </button>
                    <ItemIcon id={e.itemId} size={22} />
                    <span className="grow cl-text">{itemName(items?.byId.get(e.itemId), e.text || e.itemId)}</span>
                    <span className="cl-counter">
                      <button
                        className="btn ghost sm icon"
                        aria-label="Минус один"
                        onClick={() => patch(e.id, { got: Math.max(0, (e.got ?? 0) - 1) })}
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        className="cl-num"
                        type="number"
                        min={0}
                        value={e.got ?? 0}
                        aria-label="Собрано"
                        onChange={(ev) => patch(e.id, { got: Math.max(0, Number(ev.target.value) || 0) })}
                      />
                      <span className="faint">/</span>
                      <input
                        className="cl-num"
                        type="number"
                        min={1}
                        value={e.qty ?? 1}
                        aria-label="Нужно"
                        onChange={(ev) => patch(e.id, { qty: Math.max(1, Number(ev.target.value) || 1) })}
                      />
                      <button
                        className="btn ghost sm icon"
                        aria-label="Плюс один"
                        onClick={() => patch(e.id, { got: (e.got ?? 0) + 1 })}
                      >
                        <Plus size={14} />
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <button
                      className={cx('cl-check', done && 'on')}
                      aria-label={done ? 'Снять отметку' : 'Отметить'}
                      aria-pressed={done}
                      onClick={() => patch(e.id, { done: !e.done })}
                    >
                      {done && <Check size={12} strokeWidth={3} />}
                    </button>
                    <span className="grow cl-text">{e.text}</span>
                  </>
                )}
                <span className="cl-actions">
                  <button className="btn ghost sm icon" aria-label="Выше" onClick={() => move(e.id, -1)}>
                    <ChevronUp size={14} />
                  </button>
                  <button className="btn ghost sm icon" aria-label="Ниже" onClick={() => move(e.id, 1)}>
                    <ChevronDown size={14} />
                  </button>
                  <button className="btn ghost sm icon danger" aria-label="Удалить" onClick={() => remove(e.id)}>
                    <X size={14} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="row">
        <input
          className="input cl-qty"
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          aria-label="Количество для нового ресурса"
          title="Количество для ресурса"
        />
        <div className="grow">
          <ItemPicker
            placeholder="Добавить предмет или пункт (Enter — текстом)"
            onPick={(it) => addItem(it.i, it.r ?? it.e)}
            onSubmitText={(text) => onChange([...entries, { id: uid(), text, done: false }])}
          />
        </div>
      </div>
      {entries.length > 0 && (
        <div className="faint small" style={{ marginTop: 6 }}>
          Выполнено {doneCount} из {entries.length}
        </div>
      )}
    </div>
  );
}
