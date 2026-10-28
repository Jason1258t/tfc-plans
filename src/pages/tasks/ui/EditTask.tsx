import { BookOpen, FilePlus2, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNick } from '@/entities/user';
import { useTasks, tasksStore, type Task } from '@/entities/task';
import { useArtifacts, artifactsStore } from '@/entities/artifact';
import { useFiles } from '@/entities/file';
import { useItems } from '@/shared/pack-data';
import { extractResources, geminiEnabled, geminiErrorText } from '@/shared/api';
import { mergeResources } from '@/lib/resources';
import { removeFile } from '@/entities/file';
import { timeAgo } from '@/shared/lib';
import { Button, Modal } from '@/shared/ui';
import { Attachments, Gallery, useFileIntake } from '@/features/task-files';
import { TaskFields } from './TaskFields';
import styles from './TaskDialog.module.css';

export function EditTask({
  taskId,
  onClose,
  onOpenArtifact,
}: {
  taskId: string;
  onClose: () => void;
  onOpenArtifact: (id: string) => void;
}) {
  const { items: tasks, loading } = useTasks();
  const { items: artifacts } = useArtifacts();
  const { items: files } = useFiles();
  const nick = useNick();
  const intake = useFileIntake({ taskId, author: nick });
  const items = useItems();
  const task = tasks.find((t) => t.id === taskId);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  if (!task) {
    return (
      <Modal onClose={onClose} title="Задача" narrow>
        <div className="empty">{loading ? 'Загрузка…' : 'Задача не найдена — возможно, её уже удалили.'}</div>
      </Modal>
    );
  }

  const linked = artifacts.filter((a) => a.taskId === task.id).sort((a, b) => b.updatedAt - a.updatedAt);
  const update = (patch: Partial<Task>) => tasksStore.update(task.id, patch);

  const createDoc = async () => {
    const id = await artifactsStore.add({
      title: `План: ${task.title}`,
      content: '',
      taskId: task.id,
      author: nick,
      updatedBy: nick,
    });
    onOpenArtifact(id);
    onClose();
  };

  const remove = async () => {
    const taskFiles = files.filter((f) => f.taskId === task.id);
    const extras = [
      linked.length && `${linked.length} план(ов)`,
      taskFiles.length && `${taskFiles.length} файл(ов)`,
    ].filter(Boolean);
    const extra = extras.length ? ` вместе с ${extras.join(' и ')}` : '';
    if (!confirm(`Удалить задачу «${task.title}»${extra}? Это нельзя отменить.`)) return;
    if (linked.length) await artifactsStore.remove(linked.map((a) => a.id));
    // Картинки планов, отвязанных от задачи раньше, остаются с планом
    const goneFiles = taskFiles.filter((f) => !f.artifactId || linked.some((a) => a.id === f.artifactId));
    await Promise.all(goneFiles.map((f) => removeFile(f)));
    await tasksStore.remove(task.id);
    onClose();
  };

  const aiResources = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      const source = [task.title, task.description, ...linked.map((a) => a.content)].join('\n\n');
      const found = await extractResources(source);
      if (!found.length) setAiError('Gemini не нашёл ресурсов в описании и документах');
      else await update({ checklist: mergeResources(task.checklist, found, items) });
    } catch (e) {
      setAiError(geminiErrorText(e));
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      label="Задача"
      footer={
        <>
          <span className="faint small grow">
            {task.author} · создано {timeAgo(task.createdAt)} · изменено {timeAgo(task.updatedAt)}
          </span>
          <Button
            variant="ghost"
            icon
            className={styles.dangerGhost}
            onClick={remove}
            aria-label="Удалить задачу"
            title="Удалить"
          >
            <Trash2 size={16} />
          </Button>
          <Button variant="primary" onClick={onClose}>
            Готово
          </Button>
        </>
      }
    >
      <div className={styles.taskForm}>
        <TaskFields
          key={task.id}
          value={task}
          taskId={task.id}
          live
          onPatch={update}
          checklistExtra={
            geminiEnabled && (
              <Button variant="ai" size="sm" onClick={aiResources} disabled={aiBusy}>
                <Sparkles size={14} />
                {aiBusy ? 'Ищу…' : 'Ресурсы из текста'}
              </Button>
            )
          }
          checklistError={aiError}
          gallery={<Gallery taskId={task.id} onAdd={intake.add} />}
          belowDescription={
            <>
              <section>
                <div className={styles.tfSectionHead}>
                  <h3>Планы</h3>
                  <Button size="sm" onClick={createDoc}>
                    <FilePlus2 size={14} />
                    Новый план
                  </Button>
                </div>
                {linked.length ? (
                  <ul className={styles.docLinks}>
                    {linked.map((a) => (
                      <li key={a.id}>
                        <button
                          className={styles.docLink}
                          onClick={() => {
                            onOpenArtifact(a.id);
                            onClose();
                          }}
                        >
                          <BookOpen size={16} className="faint" />
                          <span className="grow">{a.title || 'Без названия'}</span>
                          <span className="faint small">
                            {a.updatedBy} · {timeAgo(a.updatedAt)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="faint small">
                    Для сложных планов — отдельный Markdown-документ с агентом Gemini. Откроется справа от списка.
                  </div>
                )}
              </section>

              <section>
                <div className={styles.tfSectionHead}>
                  <h3>Файлы</h3>
                </div>
                <Attachments taskId={task.id} onAdd={intake.add} error={intake.error} />
              </section>
            </>
          }
        />
      </div>
    </Modal>
  );
}
