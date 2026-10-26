import { Check, Clock, Copy, FileText, Image as ImageIcon, Paperclip, UserRound } from 'lucide-react';
import { isImage } from '@/lib/uploads';
import { useNick } from '@/entities/user';
import { useArtifacts } from '@/entities/artifact';
import { useGroups } from '@/entities/group';
import { useFiles } from '@/entities/file';
import { useState } from 'react';
import { tasksStore } from '@/entities/task';
import { usePendingIds } from '@/shared/api';
import { checklistProgress, entryDone } from '../model/tasks';
import { cx, timeAgo } from '@/shared/lib';
import { PRIORITIES, type Task } from '@/entities/task';
import { ItemIcon } from '@/shared/pack-data';
import { ImpPill, Tag, tooltipHandlers } from '@/shared/ui';
import styles from './TaskRow.module.css';

interface Props {
  task: Task;
  selected?: boolean;
  onOpen: () => void;
  onOpenDoc: (id: string) => void;
}

export function TaskRow({ task, selected, onOpen, onOpenDoc }: Props) {
  const { items: artifacts } = useArtifacts();
  const { items: groups } = useGroups();
  const { items: files } = useFiles();
  const nick = useNick();
  const pending = usePendingIds('tasks').has(task.id);
  const imp = PRIORITIES[task.priority];
  const done = task.status === 'done';
  const progress = checklistProgress(task.checklist);
  const resources = task.checklist.filter((c) => c.itemId && !entryDone(c));
  const docs = artifacts.filter((a) => a.taskId === task.id).sort((a, b) => b.updatedAt - a.updatedAt);
  const group = groups.find((g) => g.id === task.groupId);
  const taskFiles = files.filter((f) => f.taskId === task.id);
  const imageCount = taskFiles.filter(isImage).length;
  const fileCount = taskFiles.length - imageCount;
  const [copied, setCopied] = useState(false);

  // Передать задачу агенту: по id её находит MCP task_get, название и ссылка — для человека
  const copyRef = async () => {
    const text = `Задача «${task.title}» — id ${task.id} — ${location.origin}/?task=${task.id}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('Скопируйте вручную:', text);
    }
  };

  const toggleDone = () =>
    tasksStore.update(
      task.id,
      done ? { status: 'todo', completedAt: null } : { status: 'done', completedAt: Date.now() },
    );

  return (
    <li className={cx(styles.taskRow, done && styles.done, selected && styles.selected)}>
      <button
        className={cx(styles.taskCheck, done && styles.on)}
        style={{ '--imp': imp.color } as React.CSSProperties}
        onClick={toggleDone}
        aria-label={done ? 'Вернуть в работу' : 'Отметить выполненной'}
        aria-pressed={done}
      >
        <Check size={13} strokeWidth={3} />
      </button>

      <div
        className={styles.taskMain}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      >
        <div className={styles.taskLine}>
          {task.icon && <ItemIcon id={task.icon} size={20} />}
          <span className={styles.taskTitle}>{task.title}</span>
          {task.status === 'doing' && <Tag className={styles.doing}>в работе</Tag>}
          {pending && (
            <span
              className={styles.taskPending}
              aria-label="Не отправлено"
              {...tooltipHandlers(
                'Ещё не отправлено',
                'Изменение пока только в этом браузере — уйдёт, когда будет связь',
              )}
            >
              <Clock size={13} />
            </span>
          )}
        </div>
        <div className={styles.taskMeta}>
          {group && (
            <span className={styles.metaGroup}>
              {group.icon && <ItemIcon id={group.icon} size={14} tip={false} />}
              {group.name}
            </span>
          )}
          {task.assignee ? (
            <span className={cx(styles.metaUser, task.assignee === nick && styles.me)}>
              <UserRound size={12} />
              {task.assignee}
            </span>
          ) : (
            <span className="faint">{task.author}</span>
          )}
          {done && task.completedAt ? <span className="faint">выполнено {timeAgo(task.completedAt)}</span> : null}
          {!done && resources.length > 0 && (
            <span className={styles.metaRes}>
              {resources.slice(0, 6).map((c) => (
                <span
                  key={c.id}
                  className={styles.res}
                  {...tooltipHandlers(`${c.text}: ещё ${(c.qty ?? 1) - (c.got ?? 0)}`)}
                >
                  <ItemIcon id={c.itemId} size={16} tip={false} />
                  <span>{(c.qty ?? 1) - (c.got ?? 0)}</span>
                </span>
              ))}
              {resources.length > 6 && <span className="faint">+{resources.length - 6}</span>}
            </span>
          )}
          {!done && progress !== null && (
            <span className={styles.metaProgress} {...tooltipHandlers(`Чеклист: ${Math.round(progress * 100)}%`)}>
              <span className="progress">
                <span style={{ width: `${progress * 100}%` }} />
              </span>
            </span>
          )}
        </div>
      </div>

      <div className={styles.taskSide}>
        {imageCount > 0 && (
          <span className={styles.fileCount} {...tooltipHandlers(`Изображений: ${imageCount}`)}>
            <ImageIcon size={13} />
            {imageCount}
          </span>
        )}
        {fileCount > 0 && (
          <span className={styles.fileCount} {...tooltipHandlers(`Файлов: ${fileCount}`)}>
            <Paperclip size={13} />
            {fileCount}
          </span>
        )}
        {docs.length > 0 && (
          <button
            className={styles.docBtn}
            onClick={() => onOpenDoc(docs[0].id)}
            {...tooltipHandlers(docs.length > 1 ? `Планов: ${docs.length}` : docs[0].title)}
            aria-label={`Открыть план ${docs[0].title}`}
          >
            <FileText size={14} />
            {docs.length > 1 && <span>{docs.length}</span>}
          </button>
        )}
        <button
          className={cx(styles.copyBtn, copied && styles.on)}
          onClick={copyRef}
          aria-label="Скопировать id задачи для агента"
          {...tooltipHandlers(copied ? 'Скопировано' : 'Скопировать для агента', 'Название, id и ссылка на задачу')}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        {!done && (
          <ImpPill color={imp.color} title={`Важность: ${imp.label}`}>
            {imp.label}
          </ImpPill>
        )}
      </div>
    </li>
  );
}
