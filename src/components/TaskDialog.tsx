import { BookOpen, Eye, FilePlus2, Pencil, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useData } from '../data/DataContext';
import { artifactsStore, tasksStore } from '../data/store';
import { extractResources, geminiEnabled, geminiErrorText } from '../lib/gemini';
import { useItems } from '../lib/items';
import { mergeResources } from '../lib/resources';
import { cx, timeAgo } from '../lib/util';
import { PRIORITIES, STATUSES, type NewTask, type Task } from '../types';
import { removeFile, uploadFile } from '../lib/files';
import { Attachments } from './Attachments';
import { Checklist } from './Checklist';
import { ItemIcon } from './ItemIcon';
import { ItemPicker } from './ItemPicker';
import { Markdown, itemToken } from './Markdown';
import { Modal } from './Modal';
import './TaskDialog.css';

export type TaskDialogMode = { kind: 'create'; groupId: string | null } | { kind: 'edit'; taskId: string };

interface Props {
  mode: TaskDialogMode;
  onClose: () => void;
  onOpenArtifact: (id: string) => void;
}

export function TaskDialog({ mode, onClose, onOpenArtifact }: Props) {
  return mode.kind === 'create' ? (
    <CreateTask groupId={mode.groupId} onClose={onClose} onOpenArtifact={onOpenArtifact} />
  ) : (
    <EditTask taskId={mode.taskId} onClose={onClose} onOpenArtifact={onOpenArtifact} />
  );
}

// ---------------------------------------------------------------- создание

function CreateTask({
  groupId,
  onClose,
  onOpenArtifact,
}: {
  groupId: string | null;
  onClose: () => void;
  onOpenArtifact: (id: string) => void;
}) {
  const { nick } = useData();
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
  }));
  const [busy, setBusy] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const canSave = draft.title.trim().length > 0 && !busy;

  const save = async (withDoc: boolean) => {
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
      if (withDoc) {
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
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn"
            disabled={!canSave}
            onClick={() => save(true)}
            title="Создать и открыть документ-план"
          >
            <FilePlus2 size={16} />
            <span className="hide-sm">Создать с планом</span>
          </button>
          <button className="btn primary" disabled={!canSave} onClick={() => save(false)}>
            Создать
          </button>
        </>
      }
    >
      <div
        className="task-form"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save(false);
          }
        }}
      >
        <TaskFields value={draft} live={false} onPatch={(p) => setDraft((d) => ({ ...d, ...p }))} autoFocusTitle />
        <section className="tf-section">
          <div className="tf-section-head">
            <h3>Файлы</h3>
          </div>
          <Attachments pending={pendingFiles} onPendingChange={setPendingFiles} />
        </section>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- редактирование

function EditTask({
  taskId,
  onClose,
  onOpenArtifact,
}: {
  taskId: string;
  onClose: () => void;
  onOpenArtifact: (id: string) => void;
}) {
  const { tasks, artifacts, files, loading, nick } = useData();
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
      linked.length && `${linked.length} документ(ов)`,
      taskFiles.length && `${taskFiles.length} файл(ов)`,
    ].filter(Boolean);
    const extra = extras.length ? ` вместе с ${extras.join(' и ')}` : '';
    if (!confirm(`Удалить задачу «${task.title}»${extra}? Это нельзя отменить.`)) return;
    if (linked.length) await artifactsStore.remove(linked.map((a) => a.id));
    await Promise.all(taskFiles.map((f) => removeFile(f)));
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
          <button className="btn ghost danger icon" onClick={remove} aria-label="Удалить задачу" title="Удалить">
            <Trash2 size={16} />
          </button>
          <button className="btn primary" onClick={onClose}>
            Готово
          </button>
        </>
      }
    >
      <div className="task-form">
        <TaskFields
          key={task.id}
          value={task}
          live
          onPatch={update}
          checklistExtra={
            geminiEnabled && (
              <button className="btn ai sm" onClick={aiResources} disabled={aiBusy}>
                <Sparkles size={14} />
                {aiBusy ? 'Ищу…' : 'Ресурсы из текста'}
              </button>
            )
          }
          checklistError={aiError}
        />

        <section className="tf-section">
          <div className="tf-section-head">
            <h3>Файлы</h3>
          </div>
          <Attachments taskId={task.id} />
        </section>

        <section className="tf-section">
          <div className="tf-section-head">
            <h3>Документы</h3>
            <button className="btn sm" onClick={createDoc}>
              <FilePlus2 size={14} />
              Новый план
            </button>
          </div>
          {linked.length ? (
            <ul className="doc-links">
              {linked.map((a) => (
                <li key={a.id}>
                  <button
                    className="doc-link"
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
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- общие поля

type Values = Pick<
  Task,
  'title' | 'description' | 'status' | 'priority' | 'checklist' | 'icon' | 'groupId' | 'assignee'
>;

interface FieldsProps {
  value: Values;
  onPatch: (p: Partial<Task>) => void;
  /** true — правки сразу уходят в базу (текст — по blur); false — черновик новой задачи */
  live: boolean;
  autoFocusTitle?: boolean;
  checklistExtra?: React.ReactNode;
  checklistError?: string | null;
}

/** Текстовое поле: в live-режиме держит локальный черновик и коммитит на blur */
function useTextField(remote: string, live: boolean, commit: (v: string) => void) {
  const [draft, setDraft] = useState(remote);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(remote);
  }, [remote, dirty]);
  return {
    value: live ? draft : remote,
    set: (v: string) => {
      if (!live) return commit(v);
      setDraft(v);
      setDirty(true);
    },
    commit: () => {
      if (live && dirty && draft !== remote) commit(draft);
      setDirty(false);
    },
  };
}

function TaskFields({ value, onPatch, live, autoFocusTitle, checklistExtra, checklistError }: FieldsProps) {
  const { groups, nick } = useData();
  const title = useTextField(value.title, live, (v) => {
    // В черновике пишем как есть; у существующей задачи пустое название не сохраняем
    if (!live) onPatch({ title: v });
    else if (v.trim()) onPatch({ title: v.trim() });
  });
  const desc = useTextField(value.description, live, (v) => onPatch({ description: v }));
  const [descMode, setDescMode] = useState<'edit' | 'view'>(value.description ? 'view' : 'edit');
  const [pickingIcon, setPickingIcon] = useState(false);

  return (
    <>
      <div className="tf-title-row">
        <button
          className={cx('tf-icon', !value.icon && 'no-icon')}
          onClick={() => setPickingIcon((v) => !v)}
          aria-label="Иконка задачи"
          title="Иконка задачи (предмет)"
        >
          {value.icon ? (
            <ItemIcon id={value.icon} size={28} />
          ) : (
            <ItemIcon texture="minecraft/item/paper" size={22} tip={false} />
          )}
        </button>
        <textarea
          className="tf-title"
          rows={1}
          value={title.value}
          placeholder="Что нужно сделать?"
          aria-label="Название задачи"
          autoFocus={autoFocusTitle}
          onChange={(e) => title.set(e.target.value.replace(/\n/g, ' '))}
          onBlur={title.commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              if (live) e.currentTarget.blur();
            }
          }}
        />
      </div>
      {pickingIcon && (
        <div className="row">
          <div className="grow">
            <ItemPicker
              autoFocus
              placeholder="Найти предмет для иконки…"
              onPick={(it) => {
                onPatch({ icon: it.i });
                setPickingIcon(false);
              }}
            />
          </div>
          {value.icon && (
            <button
              className="btn ghost"
              onClick={() => {
                onPatch({ icon: null });
                setPickingIcon(false);
              }}
            >
              <X size={14} /> Убрать
            </button>
          )}
        </div>
      )}

      <div className="tf-meta">
        <div className="tf-field tf-imp">
          <span className="label">Важность</span>
          <div className="seg" role="group" aria-label="Важность">
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                aria-pressed={value.priority === p.value}
                onClick={() => onPatch({ priority: p.value })}
              >
                <span className="imp-dot" style={{ background: p.color }} />
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="tf-field">
          <label className="label" htmlFor="tf-status">
            Статус
          </label>
          <select
            id="tf-status"
            className="input"
            value={value.status}
            onChange={(e) => {
              const status = e.target.value as Task['status'];
              onPatch({ status, completedAt: status === 'done' ? Date.now() : null });
            }}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="tf-field">
          <label className="label" htmlFor="tf-group">
            Группа
          </label>
          <select
            id="tf-group"
            className="input"
            value={value.groupId ?? ''}
            onChange={(e) => onPatch({ groupId: e.target.value || null })}
          >
            <option value="">Без группы</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="tf-field">
          <span className="label">Исполнитель</span>
          {value.assignee === nick ? (
            <button className="btn" style={{ width: '100%' }} onClick={() => onPatch({ assignee: null })}>
              Я · отказаться
            </button>
          ) : (
            <button
              className="btn"
              style={{ width: '100%' }}
              onClick={() => onPatch({ assignee: nick, status: value.status === 'todo' ? 'doing' : value.status })}
            >
              {value.assignee ? `${value.assignee} → я` : 'Взять себе'}
            </button>
          )}
        </div>
      </div>

      <section className="tf-section">
        <div className="tf-section-head">
          <h3>Описание</h3>
          {descMode === 'edit' && (
            <div className="tf-insert">
              <ItemPicker
                small
                placeholder="Вставить предмет…"
                onPick={(it) =>
                  desc.set(`${desc.value}${desc.value && !/\s$/.test(desc.value) ? ' ' : ''}${itemToken(it.i)}`)
                }
              />
            </div>
          )}
          {value.description && (
            <div className="seg">
              <button aria-pressed={descMode === 'edit'} onClick={() => setDescMode('edit')} aria-label="Править">
                <Pencil size={13} />
              </button>
              <button
                aria-pressed={descMode === 'view'}
                onClick={() => {
                  desc.commit();
                  setDescMode('view');
                }}
                aria-label="Просмотр"
              >
                <Eye size={13} />
              </button>
            </div>
          )}
        </div>
        {descMode === 'edit' || !value.description ? (
          <textarea
            className="input mono"
            rows={5}
            value={desc.value}
            placeholder={
              'Подробности в Markdown: списки, - [ ] чекбоксы, таблицы.\nПредмет: [[tfc:metal/ingot/bronze|4]]'
            }
            onChange={(e) => desc.set(e.target.value)}
            onBlur={desc.commit}
          />
        ) : (
          <div className="tf-desc" onDoubleClick={() => setDescMode('edit')}>
            <Markdown source={value.description} />
          </div>
        )}
      </section>

      <section className="tf-section">
        <div className="tf-section-head">
          <h3>Ресурсы и чеклист</h3>
          {checklistExtra}
        </div>
        {checklistError && <div className="error-box">{checklistError}</div>}
        <Checklist entries={value.checklist} onChange={(checklist) => onPatch({ checklist })} />
      </section>
    </>
  );
}
