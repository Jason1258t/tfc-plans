import { useData } from '../data/DataContext';
import { checklistProgress, entryDone } from '../lib/tasks';
import { cx } from '../lib/util';
import { PRIORITIES, type Task } from '../types';
import { ItemIcon } from './ItemIcon';
import { tooltipHandlers } from './Tooltip';

interface Props {
  task: Task;
  onOpen: () => void;
}

export function TaskCard({ task, onOpen }: Props) {
  const { artifacts, groups } = useData();
  const prio = PRIORITIES[task.priority];
  const progress = checklistProgress(task.checklist);
  const resources = task.checklist.filter((c) => c.itemId && !entryDone(c));
  const artifactCount = artifacts.filter((a) => a.taskId === task.id).length;
  const group = groups.find((g) => g.id === task.groupId);

  return (
    <article
      className={cx('task-card', `prio-${task.priority}`, task.status === 'done' && 'is-done')}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      tabIndex={0}
      role="button"
      aria-label={task.title}
    >
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="mc-slot task-card-icon">
          {task.icon ? (
            <ItemIcon id={task.icon} size={32} />
          ) : (
            <ItemIcon texture="minecraft/item/paper" size={32} tip={false} />
          )}
        </span>
        <div className="grow">
          <div className="task-title" style={{ color: prio.color }}>
            {task.title}
          </div>
          <div className="task-meta">
            {group && <span>{group.name} · </span>}
            <span {...tooltipHandlers('Автор')}>{task.author}</span>
            {task.assignee && (
              <span className="assignee" {...tooltipHandlers('Взялся за задачу')}>
                {' '}
                → {task.assignee}
              </span>
            )}
          </div>
        </div>
        <span
          className="task-rating"
          {...tooltipHandlers(`Рейтинг важности: ${task.rating}`, 'из режима «Что важнее?»')}
        >
          {task.rating}
        </span>
      </div>

      {resources.length > 0 && (
        <div className="task-resources">
          {resources.slice(0, 8).map((c) => (
            <span key={c.id} className="res">
              <ItemIcon id={c.itemId} size={20} />
              <span className="res-qty">{(c.qty ?? 1) - (c.got ?? 0)}</span>
            </span>
          ))}
          {resources.length > 8 && <span className="muted">+{resources.length - 8}</span>}
        </div>
      )}

      {(progress !== null || artifactCount > 0) && (
        <div className="row" style={{ marginTop: 6 }}>
          {progress !== null && (
            <div className="xp-bar grow" {...tooltipHandlers(`Чеклист: ${Math.round(progress * 100)}%`)}>
              <span style={{ width: `${progress * 100}%` }} />
            </div>
          )}
          {artifactCount > 0 && (
            <span className="row" style={{ gap: 2 }} {...tooltipHandlers(`Артефактов: ${artifactCount}`)}>
              <ItemIcon texture="minecraft/item/written_book" size={18} tip={false} />
              <span className="task-meta">{artifactCount}</span>
            </span>
          )}
        </div>
      )}
    </article>
  );
}
