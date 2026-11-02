import { FileText, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toggleTaskLine } from '@/components/Markdown';
import { MarkdownField } from '@/components/MarkdownField';
import { Attachments, Gallery, useFileIntake } from '@/features/task-files';
import { filesEnabled, removeFile, useFiles } from '@/entities/file';
import { startUpload, useUploads } from '@/lib/uploads';
import { useNick } from '@/entities/user';
import { cx, timeAgo } from '@/shared/lib';
import { Button, ErrorBox, Input, Modal, Select } from '@/shared/ui';
import {
  AREAS,
  DevError,
  devApi,
  KINDS,
  PRIORITY_LABEL,
  STATUSES,
  type CheckOps,
  type DevCheck,
  type DevNote,
  type DevTask,
  type DevTaskFull,
  type TaskPatch,
} from '../../model/api';
import { DevPriority } from '../DevPriority';
import { DevProgress } from '../DevProgress';
import { CopyRef } from '../CopyRef';
import { DevLinks, brokenRefs } from '../DevLinks';
import { DevMarkdown } from '../DevMarkdown';
import styles from './DevTaskDialog.module.css';

interface Props {
  /** null — новая задача */
  id: number | null;
  /** Куда прокрутить после загрузки: data-dev-focus («note-881», «item-3») */
  focus?: string | null;
  /** Открыть ссылку #175, #175.3, doc:12, note:881 */
  onOpenRef: (ref: string) => void;
  onClose: () => void;
  onSaved: (t: DevTask, created: boolean) => void;
  onDeleted: (id: number) => void;
}

type Draft = Required<TaskPatch> & { checklist: DevCheck[] };

const EMPTY: Draft = {
  title: '',
  body: '',
  kind: 'feature',
  area: 'site',
  status: 'todo',
  priority: 1,
  assignee: null,
  branch: null,
  checklist: [],
};

const pick = (t: DevTask): Draft => ({
  title: t.title,
  body: t.body,
  kind: t.kind,
  area: t.area,
  status: t.status,
  priority: t.priority,
  assignee: t.assignee,
  branch: t.branch,
  // Пункты существующей задачи сохраняются сразу отдельными операциями, в черновик не входят
  checklist: [],
});

/** Только изменённые поля */
function diff(a: Draft, b: Draft): TaskPatch {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(b) as (keyof Draft)[])
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) out[k] = b[k];
  return out as TaskPatch;
}

const BODY_LIMIT = 2400;

const NOTE_KIND = { note: '', status: 'статус', report: 'отчёт' } as const;
const NOTE_CLASS: Record<DevNote['kind'], string | undefined> = {
  note: undefined,
  status: styles.status,
  report: styles.report,
};

export function DevTaskDialog({ id, focus, onOpenRef, onClose, onSaved, onDeleted }: Props) {
  const nick = useNick();
  const [full, setFull] = useState<DevTaskFull | null>(() => (id === null ? null : devApi.cached(id)));
  const [draft, setDraft] = useState<Draft>(() => {
    const cached = id === null ? null : devApi.cached(id);
    return cached ? pick(cached.task) : EMPTY;
  });
  const [editBody, setEditBody] = useState(id === null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [newItem, setNewItem] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  // Числовые id dev-задач отделены от id задач игроков в общем хранилище файлов.
  const fileTaskId = id === null ? undefined : `dev:${id}`;
  const files = useFiles();
  const uploads = useUploads(fileTaskId);
  const intake = useFileIntake(
    fileTaskId
      ? { taskId: fileTaskId, author: nick }
      : { addPending: (list) => setPending((cur) => [...cur, ...list]) },
  );
  const removePending = (file: File) => setPending((cur) => cur.filter((f) => f !== file));

  const editing = useRef(false);
  const load = useCallback(async () => {
    if (id === null) return;
    try {
      const f = await devApi.get(id);
      if (editing.current) return;
      setFull(f);
      setDraft(pick(f.task));
      setStale(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (id === null) return;
    let active = true;
    const refresh = async () => {
      if (document.visibilityState !== 'visible' || editing.current) return;
      try {
        const next = await devApi.get(id);
        if (!active || editing.current) return;
        setFull(next);
        setDraft(pick(next.task));
        setError(null);
        setStale(false);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    const timer = setInterval(() => void refresh(), 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);

  const changes = full ? diff(pick(full.task), draft) : null;
  const dirty = Object.keys(id === null ? diff(EMPTY, draft) : (changes ?? {})).length > 0;
  useEffect(() => {
    editing.current = dirty || busy || editBody || !!note.trim();
  }, [dirty, busy, editBody, note]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof DevError && e.status === 409) setStale(true);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      if (id === null) {
        const f = await devApi.create({ ...draft, title: draft.title.trim() }, nick);
        setFull(f);
        setDraft(pick(f.task));
        setEditBody(false);
        pending.forEach((file) => startUpload(file, `dev:${f.task.id}`, nick));
        setPending([]);
        onSaved(f.task, true);
        return;
      }
      if (!full || !changes) return;
      const f = await devApi.update(id, full.task.rev, changes, nick);
      setFull(f);
      setDraft(pick(f.task));
      setEditBody(false);
      onSaved(f.task, false);
    });

  const addNote = () =>
    run(async () => {
      if (!id || !note.trim()) return;
      await devApi.note(id, note.trim(), nick);
      setNote('');
      // Перечитываем целиком: в ответе только последние записи, а черновик полей не трогаем
      const f = await devApi.get(id);
      setFull((cur) => (cur ? { ...f, task: cur.task } : f));
    });

  const remove = () =>
    run(async () => {
      if (!full || !confirm(`Удалить задачу #${full.task.id} вместе с журналом? Это не отменить.`)) return;
      if (files.loading || files.error || uploads.length)
        throw new Error('Дождитесь загрузки списка файлов и завершения отправки вложений перед удалением.');
      for (const file of files.items.filter((f) => f.taskId === fileTaskId)) await removeFile(file);
      await devApi.remove(full.task.id, full.task.rev);
      onDeleted(full.task.id);
    });

  const newDoc = () =>
    run(async () => {
      if (!full) return;
      const d = await devApi.createDoc(full.task.id, `План: ${full.task.title}`.slice(0, 300), nick);
      const next = await devApi.get(full.task.id);
      setFull((cur) => (cur ? { ...next, task: cur.task } : next));
      onOpenRef(`doc:${d.id}`);
    });

  /** Операция над пунктами: сразу на сервер; черновик и журнал не трогаем, берём только новый список */
  const checkOp = (ops: CheckOps) =>
    run(async () => {
      if (!id) return;
      const f = await devApi.checks(id, ops, nick);
      setFull((cur) =>
        cur ? { ...cur, task: { ...cur.task, checklist: f.task.checklist, checklistLegacy: undefined } } : f,
      );
    });

  const isNew = id === null;
  const items = isNew ? draft.checklist : (full?.task.checklist ?? []);
  const legacy = !!full?.task.checklistLegacy;
  const toggle = (c: DevCheck, i: number) => {
    if (isNew)
      set(
        'checklist',
        draft.checklist.map((x, j): DevCheck => (j === i ? { ...x, done: !x.done } : x)),
      );
    else if (c.num) void checkOp(c.done ? { undone: [c.num] } : { done: [c.num] });
  };

  const loaded = !!full;
  useEffect(() => {
    if (!loaded || !focus) return;
    const item = /^item-(\d+)$/.exec(focus)?.[1];
    const el = item
      ? document.querySelector<HTMLElement>(`input[aria-label="Пункт ${item}"]`)?.closest('li')
      : document.querySelector<HTMLElement>(`[data-dev-focus="${CSS.escape(focus)}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.animate([{ outline: '2px solid var(--accent)' }, { outline: '2px solid transparent' }], { duration: 1800 });
  }, [loaded, focus]);

  // Уход на другую задачу теряет несохранённое; документ открывается поверх, он ничего не теряет
  const openRef = (ref: string) => {
    if (
      ref.startsWith('doc:') ||
      !(dirty || pending.length || note.trim()) ||
      confirm('Перейти без сохранения изменений?')
    )
      onOpenRef(ref);
  };
  const reloadLinks = async () => {
    if (id === null) return;
    const next = await devApi.get(id);
    setFull((cur) => (cur ? { ...cur, links: next.links } : next));
  };
  const broken = full ? brokenRefs(full.links) : undefined;

  const t = full?.task;
  const title = id === null ? 'Новая задача разработки' : t ? `#${t.id}` : `#${id}`;

  return (
    <Modal
      wide
      onClose={() =>
        !busy &&
        (!(dirty || pending.length || note.trim()) || confirm('Закрыть без сохранения изменений?')) &&
        onClose()
      }
      title={title}
      actions={t && <CopyRef task={t} label />}
      footer={
        <>
          {t && (
            <Button variant="danger" size="sm" onClick={remove} disabled={busy}>
              <Trash2 size={14} /> Удалить
            </Button>
          )}
          <span className={styles.footerSpacer} />
          {t && (
            <span className={styles.byline}>
              {t.author} · создана {timeAgo(t.createdAt)} · rev {t.rev}
            </span>
          )}
          <Button
            variant="primary"
            onClick={save}
            disabled={
              busy ||
              !dirty ||
              stale ||
              !draft.title.trim() ||
              (id === null && draft.body.length > BODY_LIMIT) ||
              draft.checklist.some((c) => !c.text.trim())
            }
          >
            {busy ? 'Отправляю…' : id === null ? 'Создать' : 'Сохранить'}
          </Button>
        </>
      }
    >
      {error && (
        <ErrorBox>
          {error}
          {stale && (
            <>
              {' '}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  editing.current = false;
                  void load();
                }}
              >
                Перечитать (ваши правки пропадут)
              </Button>
            </>
          )}
        </ErrorBox>
      )}
      {id !== null && !full && !error && <p className={styles.muted}>Загружаю…</p>}
      {(id === null || full) && (
        <div className={styles.body}>
          <Input
            className={styles.title}
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Что сделать"
            maxLength={300}
            autoFocus={id === null}
            aria-label="Название"
          />
          <div className={styles.fields}>
            <label>
              Статус
              <Select value={draft.status} onChange={(e) => set('status', e.target.value as Draft['status'])}>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Вид
              <Select value={draft.kind} onChange={(e) => set('kind', e.target.value as Draft['kind'])}>
                {KINDS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Область
              <Select value={draft.area ?? ''} onChange={(e) => set('area', (e.target.value || null) as Draft['area'])}>
                <option value="">—</option>
                {AREAS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Важность <DevPriority value={draft.priority} />
              <Select value={draft.priority} onChange={(e) => set('priority', Number(e.target.value))}>
                {PRIORITY_LABEL.map((p, i) => (
                  <option key={p} value={i}>
                    {p}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Исполнитель
              <Input
                value={draft.assignee ?? ''}
                onChange={(e) => set('assignee', e.target.value || null)}
                placeholder="ник или агент"
                maxLength={40}
              />
            </label>
            <label>
              Ветка
              <Input
                value={draft.branch ?? ''}
                onChange={(e) => set('branch', e.target.value || null)}
                placeholder="feat/…"
                maxLength={120}
              />
            </label>
          </div>

          <section>
            {id === null && (
              <p className={styles.muted}>
                Кратко: цель и результат, примерно один экран (до {BODY_LIMIT} символов). Подробный план прикрепите
                документом после создания задачи. {draft.body.length}/{BODY_LIMIT}
              </p>
            )}
            {!draft.body && (
              <div className={styles.templates}>
                <span className={styles.muted}>Заготовка описания:</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    set('kind', 'fix');
                    set(
                      'body',
                      '## Что произошло\n\n\n## Как повторить\n\n1. \n\n## Ожидаемое поведение\n\n\n## Версия сборки и условия\n\n\n## Как проверить исправление\n\n',
                    );
                    setEditBody(true);
                  }}
                >
                  Баг
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    set('area', 'addon');
                    set(
                      'body',
                      '## Назначение аддона\n\n\n## Что добавить\n\n\n## Совместимость с модами сборки\n\n\n## Как проверить\n\n',
                    );
                    setEditBody(true);
                  }}
                >
                  Аддон
                </Button>
              </div>
            )}
            <div className={styles.sectionHead}>
              <h3>Описание</h3>
              <Button size="sm" variant="ghost" onClick={() => setEditBody(!editBody)}>
                {editBody ? 'Просмотр' : 'Изменить'}
              </Button>
            </div>
            {editBody ? (
              <MarkdownField
                value={draft.body}
                onChange={(value) => set('body', value)}
                rows={8}
                maxRows={16}
                placeholder="Markdown: зачем, что сделать, как проверить"
              />
            ) : draft.body ? (
              <DevMarkdown
                source={draft.body}
                onOpenRef={openRef}
                broken={broken}
                onToggleTask={(line) => {
                  const next = toggleTaskLine(draft.body, line);
                  if (next !== null) set('body', next);
                }}
              />
            ) : (
              <p className={styles.muted}>Без описания.</p>
            )}
          </section>

          <section>
            <h3>Вложения и скриншоты</h3>
            <div className={styles.files}>
              <Gallery taskId={fileTaskId} pending={pending} onRemovePending={removePending} onAdd={intake.add} />
              <Attachments
                taskId={fileTaskId}
                pending={pending}
                onRemovePending={removePending}
                onAdd={intake.add}
                error={intake.error}
              />
              {files.error && <ErrorBox>{files.error}</ErrorBox>}
              {filesEnabled && (
                <p className={styles.muted}>
                  Скриншот можно вставить через Ctrl+V.{' '}
                  {id === null ? 'Файлы загрузятся после создания задачи.' : 'Вложения сохраняются сразу.'}
                </p>
              )}
            </div>
          </section>

          <details open>
            <summary>
              Чек-лист <DevProgress done={items.filter((c) => c.done).length} total={items.length} />
            </summary>
            {legacy && (
              <p className={styles.muted}>
                Старый формат закрытой задачи: только чтение. Переоткройте задачу, чтобы править пункты.
              </p>
            )}
            {items.filter((c) => c.done).length > 5 && (
              <Button size="sm" variant="ghost" onClick={() => setShowCompleted(!showCompleted)}>
                {showCompleted ? 'Скрыть старые выполненные' : 'Показать все выполненные'}
              </Button>
            )}
            <ul className={styles.checklist}>
              {items.map((c, i) =>
                !showCompleted && c.done && items.slice(i + 1).filter((item) => item.done).length >= 5 ? null : (
                  <li key={c.num ?? i}>
                    <label className={cx(c.done && styles.checked)}>
                      <input
                        type="checkbox"
                        aria-label={`Выполнен пункт ${c.num ?? i + 1}`}
                        checked={c.done}
                        disabled={legacy}
                        title={c.doneBy ? `Отметил ${c.doneBy}` : undefined}
                        onChange={() => toggle(c, i)}
                      />
                    </label>
                    {isNew ? (
                      <Input
                        aria-label={`Пункт ${i + 1}`}
                        className={cx(styles.checkText, c.done && styles.checked)}
                        value={c.text}
                        maxLength={500}
                        onChange={(e) =>
                          set(
                            'checklist',
                            draft.checklist.map((item, j) => (j === i ? { ...item, text: e.target.value } : item)),
                          )
                        }
                      />
                    ) : (
                      // Свой текст до потери фокуса: обновление раз в 10 секунд не сбивает ввод
                      <Input
                        key={c.text}
                        aria-label={`Пункт ${c.num ?? i + 1}`}
                        className={cx(styles.checkText, c.done && styles.checked)}
                        defaultValue={c.text}
                        maxLength={500}
                        readOnly={legacy}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        onBlur={(e) => {
                          const text = e.target.value.trim();
                          if (c.num && text && text !== c.text) void checkOp({ edit: [{ num: c.num, text }] });
                          else e.target.value = c.text;
                        }}
                      />
                    )}
                    {!legacy && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon
                        aria-label="Убрать пункт"
                        onClick={() =>
                          isNew
                            ? set(
                                'checklist',
                                draft.checklist.filter((_, j) => j !== i),
                              )
                            : c.num && void checkOp({ remove: [c.num] })
                        }
                      >
                        ×
                      </Button>
                    )}
                  </li>
                ),
              )}
            </ul>
            <form
              className={styles.inline}
              onSubmit={(e) => {
                e.preventDefault();
                if (!newItem.trim()) return;
                if (isNew) set('checklist', [...draft.checklist, { text: newItem.trim(), done: false }]);
                else void checkOp({ add: [newItem.trim()] });
                setNewItem('');
              }}
            >
              <Input
                disabled={legacy}
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                placeholder="Новый пункт"
                maxLength={500}
              />
              <Button size="sm" type="submit" disabled={legacy || !newItem.trim()}>
                <Plus size={14} /> Пункт
              </Button>
            </form>
          </details>

          {full && (
            <>
              <section>
                <div className={styles.sectionHead}>
                  <h3>Планы</h3>
                  <Button size="sm" variant="ghost" onClick={newDoc} disabled={busy}>
                    <Plus size={14} /> Новый план
                  </Button>
                </div>
                {full.docs.length ? (
                  <ul className={styles.docs}>
                    {full.docs.map((d) => (
                      <li key={d.id}>
                        <button onClick={() => openRef(`doc:${d.id}`)}>
                          <FileText size={14} /> {d.title}
                        </button>
                        <span className={styles.muted}>
                          {d.author} · {timeAgo(d.updatedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.muted}>Планов нет.</p>
                )}
              </section>

              <DevLinks taskId={full.task.id} links={full.links} onOpenRef={openRef} onChanged={reloadLinks} />

              <details open>
                <summary>
                  Журнал{' '}
                  {full.noteCount > full.notes.length && (
                    <span className={styles.muted}>
                      (последние {full.notes.length} из {full.noteCount})
                    </span>
                  )}
                </summary>
                <ol className={styles.log} tabIndex={0} aria-label="Журнал задачи">
                  {full.notes.map((n) => (
                    <li key={n.id} className={NOTE_CLASS[n.kind]} data-dev-focus={`note-${n.id}`}>
                      <div className={styles.logHead}>
                        <b>{n.author}</b>
                        {NOTE_KIND[n.kind] && <span className={styles.logKind}>{NOTE_KIND[n.kind]}</span>}
                        <span className={styles.muted}>{new Date(n.createdAt).toLocaleString('ru-RU')}</span>
                        <span className={styles.muted}>note:{n.id}</span>
                      </div>
                      {n.kind === 'status' ? (
                        <span>{statusText(n.text)}</span>
                      ) : (
                        <DevMarkdown source={n.text} onOpenRef={openRef} broken={broken} />
                      )}
                    </li>
                  ))}
                </ol>
                <div className={styles.noteForm}>
                  <MarkdownField
                    value={note}
                    onChange={setNote}
                    maxRows={10}
                    rows={2}
                    placeholder="Запись в журнал: что сделано, что проверено"
                  />
                  <Button size="sm" onClick={addNote} disabled={busy || !note.trim()}>
                    {busy ? 'Отправляю…' : 'Добавить запись'}
                  </Button>
                </div>
              </details>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** «todo → doing» → «Надо → В работе» */
function statusText(s: string): string {
  return s
    .split(' → ')
    .map((v) => STATUSES.find((x) => x.value === v)?.label ?? v)
    .join(' → ');
}
