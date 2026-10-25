import { useState } from 'react';
import { useNick } from '@/entities/user';
import { useGroups } from '@/entities/group';
import { useTasks } from '@/entities/task';
import { groupsStore } from '@/entities/group';
import { tasksStore } from '@/entities/task';
import type { Group } from '@/entities/group';
import { ItemIcon, ItemPicker } from '@/shared/pack-data';
import { Button, Modal } from '@/shared/ui';
import styles from './GroupDialog.module.css';

interface Props {
  /** null — новая группа */
  group: Group | null;
  onClose: () => void;
  onDeleted: () => void;
}

export function GroupDialog({ group, onClose, onDeleted }: Props) {
  const { items: groups } = useGroups();
  const { items: tasks } = useTasks();
  const nick = useNick();
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
    if (!confirm(`Удалить группу «${group.name}»? Задачи (${inGroup.length}) останутся без группы.`)) return;
    await Promise.all(inGroup.map((t) => tasksStore.update(t.id, { groupId: null })));
    await groupsStore.remove(group.id);
    onDeleted();
    onClose();
  };

  return (
    <Modal
      onClose={onClose}
      narrow
      title={group ? 'Группа' : 'Новая группа'}
      footer={
        <>
          {group && (
            <Button variant="ghost" className={styles.dangerGhost} onClick={remove}>
              Удалить
            </Button>
          )}
          <span className="grow" />
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="label" htmlFor="g-name">
          Название
        </label>
        <input
          id="g-name"
          className="input"
          value={name}
          autoFocus
          maxLength={40}
          placeholder="Металлургия, База, Ферма…"
          onChange={(e) => setName(e.target.value)}
        />
      </form>
      <div>
        <span className="label">Иконка</span>
        <div className="row">
          <span className={styles.tfIcon} style={{ cursor: 'default' }}>
            {icon ? <ItemIcon id={icon} size={24} /> : null}
          </span>
          <div className="grow">
            <ItemPicker placeholder="Найти предмет…" onPick={(it) => setIcon(it.i)} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
