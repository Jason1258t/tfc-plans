import { Check, FileText, Image as ImageIcon, Paperclip, UserRound } from 'lucide-react';
import { isImage } from '../lib/uploads';
import { useData } from '../data/DataContext';
import { tasksStore } from '../data/store';
import { checklistProgress, entryDone } from '../lib/tasks';
import { cx, timeAgo } from '../lib/util';
import { PRIORITIES, type Task } from '../types';
import { ItemIcon } from './ItemIcon';
import { tooltipHandlers } from './Tooltip';

interface Props {
  task: Task;
  selected?: boolean;
  onOpen: () => void;
  onOpenDoc: (id: string) => void;
}

export function TaskRow({ task, selected, onOpen, onOpenDoc }: Props) {
  const { artifacts, groups, files, nick } = useData();
  const imp = PRIORITIES[task.priority];
  const done = task.status === 'done';
  const progress = checklistProgress(task.checklist);
  const resources = task.checklist.filter((c) => c.itemId && !entryDone(c));
  const docs = artifacts.filter((a) => a.taskId === task.id).sort((a, b) => b.updatedAt - a.updatedAt);
  const group = groups.find((g) => g.id === task.groupId);
  const taskFiles = files.filter((f) => f.taskId === task.id);
  const imageCount = taskFiles.filter(isImage).length;
  const fileCount = taskFiles.length - imageCount;

  const toggleDone = () =>
    tasksStore.update(
      task.id,
      done ? { status: 'todo', completedAt: null } : { status: 'done', completedAt: Date.now() },
    );

  return (
    <li className={cx('task-row', done && 'done', selected && 'selected')}>
      <button
        className={cx('task-check', done && 'on')}
        style={{ '--imp': imp.color } as React.CSSProperties}
        onClick={toggleDone}
        aria-label={done ? 'Вернуть в работу' : 'Отметить выполненной'}
        aria-pressed={done}
      >
        <Check size={13} strokeWidth={3} />
      </button>

      <div
        className="task-main"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      >
        <div className="task-line">
          {task.icon && <ItemIcon id={task.icon} size={20} />}
          <span className="task-title">{task.title}</span>
          {task.status === 'doing' && <span className="tag doing">в работе</span>}
        </div>
        <div className="task-meta">
          {group && (
            <span className="meta-group">
              {group.icon && <ItemIcon id={group.icon} size={14} tip={false} />}
              {group.name}
            </span>
          )}
          {task.assignee ? (
            <span className={cx('meta-user', task.assignee === nick && 'me')}>
              <UserRound size={12} />
              {task.assignee}
            </span>
          ) : (
            <span className="faint">{task.author}</span>
          )}
          {done && task.completedAt ? <span className="faint">выполнено {timeAgo(task.completedAt)}</span> : null}
          {!done && resources.length > 0 && (
            <span className="meta-res">
              {resources.slice(0, 6).map((c) => (
                <span key={c.id} className="res" {...tooltipHandlers(`${c.text}: ещё ${(c.qty ?? 1) - (c.got ?? 0)}`)}>
                  <ItemIcon id={c.itemId} size={16} tip={false} />
                  <span>{(c.qty ?? 1) - (c.got ?? 0)}</span>
                </span>
              ))}
              {resources.length > 6 && <span className="faint">+{resources.length - 6}</span>}
            </span>
          )}
          {!done && progress !== null && (
            <span className="meta-progress" {...tooltipHandlers(`Чеклист: ${Math.round(progress * 100)}%`)}>
              <span className="progress">
                <span style={{ width: `${progress * 100}%` }} />
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="task-side">
        {imageCount > 0 && (
          <span className="file-count" {...tooltipHandlers(`Изображений: ${imageCount}`)}>
            <ImageIcon size={13} />
            {imageCount}
          </span>
        )}
        {fileCount > 0 && (
          <span className="file-count" {...tooltipHandlers(`Файлов: ${fileCount}`)}>
            <Paperclip size={13} />
            {fileCount}
          </span>
        )}
        {docs.length > 0 && (
          <button
            className="doc-btn"
            onClick={() => onOpenDoc(docs[0].id)}
            {...tooltipHandlers(docs.length > 1 ? `Документов: ${docs.length}` : docs[0].title)}
            aria-label={`Открыть документ ${docs[0].title}`}
          >
            <FileText size={14} />
            {docs.length > 1 && <span>{docs.length}</span>}
          </button>
        )}
        {!done && (
          <span className="imp-pill" style={{ color: imp.color }} title={`Важность: ${imp.label}`}>
            {imp.label}
          </span>
        )}
      </div>
    </li>
  );
}
