import { BookOpen, FilePlus2, X } from 'lucide-react';
import { useState } from 'react';
import { useNick } from '@/entities/user';
import { tasksStore, type NewTask } from '@/entities/task';
import { artifactsStore } from '@/entities/artifact';
import { uploadFile } from '@/entities/file';
import { Button, Modal } from '@/shared/ui';
import { cx } from '@/shared/lib';
import { Attachments, Gallery, useFileIntake } from '@/features/task-files';
import { TaskFields } from './TaskFields';
import styles from './TaskDialog.module.css';

export function CreateTask({
  groupId,
  onClose,
  onOpenArtifact,
}: {
  groupId: string | null;
  onClose: () => void;
  onOpenArtifact: (id: string) => void;
}) {
  const nick = useNick();
  const [draft, setDraft] = useState<NewTask>(() => ({
    title: '',
    description: '',
    status: 'todo',
    priority: 1,
    rating: 1000,
    checklist: [],
    icon: null,
    groupId,
    author: nick,
    assignee: null,
    completedAt: null,
    place: null,
  }));
  const [busy, setBusy] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const intake = useFileIntake({ addPending: (f) => setPendingFiles((list) => [...list, ...f]) });
  const removePending = (f: File) => setPendingFiles((list) => list.filter((x) => x !== f));
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  // План — не «кнопка в подвале», а выбор в самом окне: под описанием видно, что план будет
  const [withPlan, setWithPlan] = useState(false);
  const canSave = draft.title.trim().length > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const title = draft.title.trim();
      const id = await tasksStore.add({ ...draft, title });
      // Окно не закрываем, пока не загрузились вложения — иначе неудача прошла бы незамеченной
      for (const [i, f] of pendingFiles.entries()) {
        setUploadNote(`Загружаю файлы: ${i + 1} из ${pendingFiles.length}…`);
        try {
          await uploadFile(f, { taskId: id, author: nick });
        } catch (e) {
          alert(`Задача создана, но файл «${f.name}» не загрузился: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (withPlan) {
        const docId = await artifactsStore.add({
          title: `План: ${title}`,
          content: '',
          taskId: id,
          author: nick,
          updatedBy: nick,
        });
        onOpenArtifact(docId);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="Новая задача"
      footer={
        <>
          <span className="faint small grow hide-sm">{uploadNote ?? 'Ctrl+Enter — создать'}</span>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={save}
            title={withPlan ? 'Создать задачу и открыть её план' : 'Создать задачу'}
          >
            {withPlan && <FilePlus2 size={16} />}
            {withPlan ? 'Создать с планом' : 'Создать'}
          </Button>
        </>
      }
    >
      <div
        className={styles.taskForm}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      >
        <TaskFields
          value={draft}
          live={false}
          onPatch={(p) => setDraft((d) => ({ ...d, ...p }))}
          autoFocusTitle
          gallery={<Gallery pending={pendingFiles} onRemovePending={removePending} onAdd={intake.add} />}
          belowDescription={
            <>
              <section>
                <div className={styles.tfSectionHead}>
                  <h3>Планы</h3>
                  {!withPlan && (
                    <Button size="sm" onClick={() => setWithPlan(true)} title="Создать задачу вместе с планом">
                      <FilePlus2 size={14} />
                      Новый план
                    </Button>
                  )}
                </div>
                {withPlan ? (
                  <ul className={styles.docLinks}>
                    <li>
                      <div className={cx(styles.docLink, styles.planned)}>
                        <BookOpen size={16} className="faint" />
                        <span className="grow">План: {draft.title.trim() || 'без названия'}</span>
                        <span className="faint small">создастся вместе с задачей</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon
                          aria-label="Не создавать план"
                          title="Не создавать план"
                          onClick={() => setWithPlan(false)}
                        >
                          <X size={14} />
                        </Button>
                      </div>
                    </li>
                  </ul>
                ) : (
                  <div className="faint small">
                    План — отдельный Markdown-документ с этапами и агентом Gemini. «Новый план» создаст его вместе с
                    задачей и откроет справа.
                  </div>
                )}
              </section>
              <section>
                <div className={styles.tfSectionHead}>
                  <h3>Файлы</h3>
                </div>
                <Attachments
                  pending={pendingFiles}
                  onRemovePending={removePending}
                  onAdd={intake.add}
                  error={intake.error}
                />
              </section>
            </>
          }
        />
      </div>
    </Modal>
  );
}
