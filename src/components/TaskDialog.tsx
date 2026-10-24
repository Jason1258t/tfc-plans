import { BookOpen, Boxes, Eye, FilePlus2, Pencil, Sparkles, Trash2, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useData } from '../data/DataContext';
import { artifactsStore, tasksStore } from '@/shared/api';
import { extractResources, geminiEnabled, geminiErrorText } from '../lib/gemini';
import { useItems } from '../lib/items';
import { mergeResources } from '../lib/resources';
import { cx, timeAgo } from '@/shared/lib';
import { PRIORITIES, STATUSES, type NewTask, type Task } from '../types';
import { filesEnabled, removeFile, uploadFile } from '../lib/files';
import { isImage, prepareFile, startUpload, validateFiles } from '../lib/uploads';
import { Attachments } from './Attachments';
import { Gallery } from './Gallery';
import { Checklist } from './Checklist';
import { ItemIcon } from './ItemIcon';
import { ItemPicker } from './ItemPicker';
import { Markdown, itemToken, toggleTaskLine } from './Markdown';
import { Modal } from '@/shared/ui';
import { PlaceField } from './PlaceField';
import { SchematicImport } from './SchematicImport';
import './TaskDialog.css';
import { MarkdownField } from './MarkdownField';
import { useTextImages } from './useTextImages';

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
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn primary"
            disabled={!canSave}
            onClick={save}
            title={withPlan ? 'Создать задачу и открыть её план' : 'Создать задачу'}
          >
            {withPlan && <FilePlus2 size={16} />}
            {withPlan ? 'Создать с планом' : 'Создать'}
          </button>
        </>
      }
    >
      <div
        className="task-form"
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
              <section className="tf-section">
                <div className="tf-section-head">
                  <h3>Планы</h3>
                  {!withPlan && (
                    <button className="btn sm" onClick={() => setWithPlan(true)} title="Создать задачу вместе с планом">
                      <FilePlus2 size={14} />
                      Новый план
                    </button>
                  )}
                </div>
                {withPlan ? (
                  <ul className="doc-links">
                    <li>
                      <div className="doc-link planned">
                        <BookOpen size={16} className="faint" />
                        <span className="grow">План: {draft.title.trim() || 'без названия'}</span>
                        <span className="faint small">создастся вместе с задачей</span>
                        <button
                          className="btn ghost sm icon"
                          aria-label="Не создавать план"
                          title="Не создавать план"
                          onClick={() => setWithPlan(false)}
                        >
                          <X size={14} />
                        </button>
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
              <section className="tf-section">
                <div className="tf-section-head">
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
          taskId={task.id}
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
          gallery={<Gallery taskId={task.id} onAdd={intake.add} />}
          belowDescription={
            <>
              <section className="tf-section">
                <div className="tf-section-head">
                  <h3>Планы</h3>
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

              <section className="tf-section">
                <div className="tf-section-head">
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

// ---------------------------------------------------------------- приём файлов

/**
 * Общий вход для файлов из кнопок, drag&drop и буфера обмена: проверка размера, сжатие картинок,
 * затем — загрузка (существующая задача) или добавление в черновик. Ctrl+V с картинкой в любом месте окна.
 */
function useFileIntake(target: { taskId: string; author: string } | { addPending: (files: File[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });

  const add = useCallback(async (list: File[]) => {
    setError(null);
    const prepared = await Promise.all(list.map(prepareFile));
    const { ok, error } = validateFiles(prepared);
    setError(error);
    const t = targetRef.current;
    if ('addPending' in t) t.addPending(ok);
    else ok.forEach((f) => startUpload(f, t.taskId, t.author));
  }, []);

  useEffect(() => {
    if (!filesEnabled) return;
    const onPaste = (e: ClipboardEvent) => {
      // Картинку уже вставил в текст редактор описания
      if (e.defaultPrevented) return;
      const images = [...(e.clipboardData?.files ?? [])].filter(isImage);
      if (!images.length) return;
      e.preventDefault();
      add(images);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [add]);

  return { add, error };
}

// ---------------------------------------------------------------- общие поля

type Values = Pick<
  Task,
  'title' | 'description' | 'status' | 'priority' | 'checklist' | 'icon' | 'groupId' | 'assignee' | 'place'
>;

interface FieldsProps {
  value: Values;
  onPatch: (p: Partial<Task>) => void;
  /** true — правки сразу уходят в базу (текст — по blur); false — черновик новой задачи */
  live: boolean;
  autoFocusTitle?: boolean;
  checklistExtra?: React.ReactNode;
  checklistError?: string | null;
  /** Галерея картинок под описанием */
  gallery?: React.ReactNode;
  /** Секции сразу под описанием: планы, вложения, чеклист — в нужном окну порядке */
  belowDescription?: React.ReactNode;
  /** Существующая задача: картинки из описания загружаются в её вложения */
  taskId?: string;
}

const DESC_SAVE_DELAY = 800;

/**
 * Описание: черновик с автосохранением через паузу, как у планов (флажки в редакторе меняют текст без потери
 * фокуса — сохранение «по blur» их бы теряло). Текст из базы подтягиваем, только когда наш уже сохранён.
 */
function useAutosaveText(remote: string, live: boolean, commit: (v: string) => void) {
  const [draft, setDraft] = useState(remote);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ draft, dirty, commit });
  useEffect(() => {
    latest.current = { draft, dirty, commit };
  });
  useEffect(() => {
    if (!dirty) setDraft(remote);
    else if (remote === draft) setDirty(false);
  }, [remote, dirty, draft]);
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const l = latest.current;
    if (l.dirty) l.commit(l.draft);
  }, []);
  useEffect(() => flush, [flush]);
  return {
    value: live ? draft : remote,
    set: (v: string) => {
      if (!live) return commit(v);
      setDraft(v);
      setDirty(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => commit(v), DESC_SAVE_DELAY);
    },
    commit: flush,
  };
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

function TaskFields({
  value,
  onPatch,
  live,
  autoFocusTitle,
  checklistExtra,
  checklistError,
  gallery,
  belowDescription,
  taskId,
}: FieldsProps) {
  const { groups, nick, people } = useData();
  const title = useTextField(value.title, live, (v) => {
    // В черновике пишем как есть; у существующей задачи пустое название не сохраняем
    if (!live) onPatch({ title: v });
    else if (v.trim()) onPatch({ title: v.trim() });
  });
  const desc = useAutosaveText(value.description, live, (v) => onPatch({ description: v }));
  const images = useTextImages({
    owner: live && taskId ? { kind: 'task', id: taskId } : null,
    taskId: taskId ?? null,
    initial: value.description,
    content: desc.value,
    setContent: desc.set,
    insert: (text, pos) => desc.set(desc.value.slice(0, pos) + text + desc.value.slice(pos)),
  });
  const [descMode, setDescMode] = useState<'edit' | 'view'>(value.description ? 'view' : 'edit');
  const [pickingIcon, setPickingIcon] = useState(false);
  const [importing, setImporting] = useState(false);

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
        <div className="seg tf-imp" role="group" aria-label="Важность" title="Важность">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={value.priority === p.value}
              title={p.label}
              onClick={() => onPatch({ priority: p.value })}
            >
              <span className="imp-dot" style={{ background: p.color }} />
              {p.label}
            </button>
          ))}
        </div>
        <select
          className="input"
          aria-label="Статус"
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
        <select
          className="input"
          aria-label="Группа"
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
        <div className="tf-assignee">
          <span className="tf-assignee-input">
            <UserRound size={14} className="faint tf-field-icon" />
            <input
              className="input with-icon"
              aria-label="Исполнитель"
              title="Исполнитель"
              list="tf-users"
              value={value.assignee ?? ''}
              placeholder="Никто"
              onChange={(e) => onPatch({ assignee: e.target.value.trim() || null })}
            />
          </span>
          <datalist id="tf-users">
            {people.map((u) => (
              <option key={u.id} value={u.id} />
            ))}
          </datalist>
          {value.assignee === nick ? (
            <button className="btn sm" onClick={() => onPatch({ assignee: null })}>
              Отказаться
            </button>
          ) : (
            <button
              className="btn sm"
              onClick={() => onPatch({ assignee: nick, status: value.status === 'todo' ? 'doing' : value.status })}
            >
              Взять себе
            </button>
          )}
        </div>
        <PlaceField compact value={value.place} onChange={(place) => onPatch({ place })} />
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
          <MarkdownField
            rows={5}
            value={desc.value}
            placeholder={
              'Подробности в Markdown: списки, - [ ] чекбоксы, таблицы.\nПредмет: [[tfc:metal/ingot/bronze|4]]' +
              (images.enabled ? '\nКартинка — Ctrl+V или перетащить сюда.' : '')
            }
            autoFocus={Boolean(value.description)}
            onChange={desc.set}
            onBlur={desc.commit}
            onImages={images.enabled && filesEnabled ? images.add : undefined}
            onMediaChange={images.noteMedia}
          />
        ) : (
          <div className="tf-desc" onDoubleClick={() => setDescMode('edit')}>
            <Markdown
              source={value.description}
              onToggleTask={(line) => {
                const next = toggleTaskLine(value.description, line);
                if (next !== null) onPatch({ description: next });
              }}
            />
          </div>
        )}
        {gallery && <div className="tf-gallery">{gallery}</div>}
      </section>

      {belowDescription}

      <section className="tf-section">
        <div className="tf-section-head">
          <h3>Ресурсы и чеклист</h3>
          <button
            className="btn sm"
            onClick={() => setImporting(true)}
            title="Посчитать блоки .nbt-схемы и добавить их как ресурсы"
          >
            <Boxes size={14} />
            Из схемы
          </button>
          {checklistExtra}
        </div>
        {importing && (
          <SchematicImport
            checklist={value.checklist}
            onApply={(checklist) => onPatch({ checklist })}
            onClose={() => setImporting(false)}
          />
        )}
        {checklistError && <div className="error-box">{checklistError}</div>}
        <Checklist entries={value.checklist} onChange={(checklist) => onPatch({ checklist })} />
      </section>
    </>
  );
}
