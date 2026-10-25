import { Boxes, Eye, Pencil, UserRound, X } from 'lucide-react';
import { Segmented } from '@/shared/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGroups } from '@/entities/group';
import { useNick, usePeople } from '@/entities/user';
import { PRIORITIES, STATUSES, type Task } from '@/entities/task';
import { ItemIcon, ItemPicker } from '@/shared/pack-data';
import { Markdown, itemToken, toggleTaskLine } from '@/components/Markdown';
import { MarkdownField } from '@/components/MarkdownField';
import { useTextImages } from '@/components/useTextImages';
import { filesEnabled } from '@/entities/file';
import { cx } from '@/shared/lib';
import { Checklist } from './Checklist';
import { PlaceField } from './PlaceField';
import { SchematicImport } from './SchematicImport';
import styles from './TaskDialog.module.css';

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

export function TaskFields({
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
  const { items: groups } = useGroups();
  const nick = useNick();
  const people = usePeople();
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
      <div className={styles.tfTitleRow}>
        <button
          className={cx(styles.tfIcon, !value.icon && styles.noIcon)}
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
          className={styles.tfTitle}
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

      <div className={styles.tfMeta}>
        <Segmented
          className={styles.tfImp}
          label="Важность"
          value={value.priority}
          onChange={(priority) => onPatch({ priority })}
          options={PRIORITIES.map((p) => ({
            value: p.value,
            title: p.label,
            icon: <span className="imp-dot" style={{ background: p.color }} />,
            label: p.label,
          }))}
        />
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
        <div className={styles.tfAssignee}>
          <span className={styles.tfAssigneeInput}>
            <UserRound size={14} className={cx('faint', styles.tfFieldIcon)} />
            <input
              className={cx('input', styles.withIcon)}
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

      <section>
        <div className={styles.tfSectionHead}>
          <h3>Описание</h3>
          {descMode === 'edit' && (
            <div className={styles.tfInsert}>
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
            <Segmented
              value={descMode}
              onChange={(v) => {
                if (v === 'view') desc.commit();
                setDescMode(v);
              }}
              options={[
                { value: 'edit', icon: <Pencil size={13} />, ariaLabel: 'Править' },
                { value: 'view', icon: <Eye size={13} />, ariaLabel: 'Просмотр' },
              ]}
            />
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
          <div className={styles.tfDesc} onDoubleClick={() => setDescMode('edit')}>
            <Markdown
              source={value.description}
              onToggleTask={(line) => {
                const next = toggleTaskLine(value.description, line);
                if (next !== null) onPatch({ description: next });
              }}
            />
          </div>
        )}
        {gallery && <div className={styles.tfGallery}>{gallery}</div>}
      </section>

      {belowDescription}

      <section>
        <div className={styles.tfSectionHead}>
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
