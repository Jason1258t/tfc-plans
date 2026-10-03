import { useState } from 'react';
import { useData } from '../data/DataContext';
import { groupsStore, tasksStore } from '../data/store';
import type { Group } from '../types';
import { ItemIcon } from './ItemIcon';
import { ItemPicker } from './ItemPicker';
import { Modal } from './Modal';

interface Props {
  /** null — создание новой группы */
  group: Group | null;
  onClose: () => void;
  onDeleted: () => void;
}

export function GroupModal({ group, onClose, onDeleted }: Props) {
  const { groups, tasks, nick } = useData();
  const [name, setName] = useState(group?.name ?? '');
  const [icon, setIcon] = useState<string | null>(group?.icon ?? null);

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    if (group) await groupsStore.update(group.id, { name: n, icon });
    else await groupsStore.add({ name: n, icon, order: groups.length, author: nick });
    onClose();
  };

  const remove = async () => {
    if (!group) return;
    const inGroup = tasks.filter((t) => t.groupId === group.id);
    if (!confirm(`Удалить группу «${group.name}»? ${inGroup.length} задач(и) останутся без группы.`)) return;
    await Promise.all(inGroup.map((t) => tasksStore.update(t.id, { groupId: null })));
    await groupsStore.remove(group.id);
    onDeleted();
    onClose();
  };

  return (
    <Modal onClose={onClose} narrow label="Группа">
      <form
        className="mc-panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2>{group ? 'Группа' : 'Новая группа'}</h2>
        <div>
          <label className="mc-label" htmlFor="g-name">
            Название
          </label>
          <input
            id="g-name"
            className="mc-input"
            value={name}
            autoFocus
            maxLength={40}
            placeholder="Металлургия, База, Ферма…"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <span className="mc-label">Иконка</span>
          <div className="row">
            <span
              className="mc-slot"
              style={{
                width: 40,
                height: 40,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
              }}
            >
              {icon && <ItemIcon id={icon} size={32} />}
            </span>
            <div className="grow">
              <ItemPicker placeholder="Найти предмет…" onPick={(it) => setIcon(it.i)} />
            </div>
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          {group ? (
            <button type="button" className="mc-btn red sm" onClick={remove}>
              Удалить
            </button>
          ) : (
            <span />
          )}
          <div className="row">
            <button type="button" className="mc-btn" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="mc-btn green" disabled={!name.trim()}>
              Сохранить
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
