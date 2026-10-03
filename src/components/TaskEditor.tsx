import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { artifactsStore, tasksStore } from '../data/store';
import { extractResources, geminiEnabled } from '../lib/gemini';
import { useItems } from '../lib/items';
import { mergeResources } from '../lib/resources';
import { timeAgo } from '../lib/util';
import { PRIORITIES, STATUSES, type Priority, type Task, type TaskStatus } from '../types';
import { Checklist } from './Checklist';
import { ItemIcon } from './ItemIcon';
import { ItemPicker } from './ItemPicker';
import { Markdown, itemToken } from './Markdown';
import { Modal } from './Modal';
import './TaskEditor.css';

interface Props {
  taskId: string;
  onClose: () => void;
}

export function TaskEditor({ taskId, onClose }: Props) {
  const { tasks, loading } = useData();
  const task = tasks.find((t) => t.id === taskId);

  return (
    <Modal onClose={onClose} label="Задача">
      <div className="mc-panel task-editor">
        <button className="close-x" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
        {task ? (
          <TaskEditorBody key={task.id} task={task} onClose={onClose} />
        ) : (
          <div className="empty" style={{ color: 'var(--panel-text)' }}>
            {loading ? 'Загрузка…' : 'Задача не найдена — возможно, её уже удалили.'}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Черновик поля, который не затирается удалёнными изменениями, пока его редактируют */
function useDraft(remote: string) {
  const [draft, setDraft] = useState(remote);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(remote);
  }, [remote, dirty]);
  return {
    draft,
    dirty,
    set: (v: string) => {
      setDraft(v);
      setDirty(true);
    },
    reset: () => setDirty(false),
  };
}

function TaskEditorBody({ task, onClose }: { task: Task; onClose: () => void }) {
  const { groups, artifacts, nick } = useData();
  const items = useItems();
  const navigate = useNavigate();
  const update = (patch: Partial<Task>) => tasksStore.update(task.id, patch);

  const title = useDraft(task.title);
  const desc = useDraft(task.description);
  const [editingDesc, setEditingDesc] = useState(!task.description);
  const [pickingIcon, setPickingIcon] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const linked = artifacts.filter((a) => a.taskId === task.id).sort((a, b) => b.updatedAt - a.updatedAt);

  const saveTitle = () => {
    const t = title.draft.trim();
    if (t && t !== task.title) update({ title: t });
    else title.set(task.title);
    title.reset();
  };
  const saveDesc = () => {
    if (desc.draft !== task.description) update({ description: desc.draft });
    desc.reset();
  };

  const createArtifact = async () => {
    const id = await artifactsStore.add({
      title: `План: ${task.title}`,
      content: '',
      taskId: task.id,
      author: nick,
      updatedBy: nick,
    });
    navigate(`/a/${id}`);
  };

  const remove = async () => {
    const extra = linked.length ? ` и ${linked.length} артефакт(ов)` : '';
    if (!confirm(`Удалить задачу «${task.title}»${extra}? Это нельзя отменить.`)) return;
    if (linked.length) await artifactsStore.remove(linked.map((a) => a.id));
    await tasksStore.remove(task.id);
    onClose();
  };

  const aiResources = async () => {
    const source = [task.title, task.description, ...linked.map((a) => a.content)].join('\n\n');
    setAiBusy(true);
    setAiError(null);
    try {
      const found = await extractResources(source);
      if (!found.length) setAiError('Gemini не нашёл ресурсов в описании');
      else update({ checklist: mergeResources(task.checklist, found, items) });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'flex-start', paddingRight: 32 }}>
        <button
          className="mc-slot icon-slot"
          onClick={() => setPickingIcon((v) => !v)}
          aria-label="Выбрать иконку задачи"
          title="Иконка задачи"
        >
          {task.icon ? (
            <ItemIcon id={task.icon} size={32} />
          ) : (
            <ItemIcon texture="minecraft/item/paper" size={32} tip={false} />
          )}
        </button>
        <textarea
          className="title-input grow"
          value={title.draft}
          rows={1}
          aria-label="Название задачи"
          style={{ color: PRIORITIES[task.priority].color }}
          onChange={(e) => title.set(e.target.value.replace(/\n/g, ' '))}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
        />
      </div>
      {pickingIcon && (
        <div className="row">
          <div className="grow">
            <ItemPicker
              autoFocus
              placeholder="Иконка: найти предмет…"
              onPick={(it) => {
                update({ icon: it.i });
                setPickingIcon(false);
              }}
            />
          </div>
          {task.icon && (
            <button
              className="mc-btn"
              onClick={() => {
                update({ icon: null });
                setPickingIcon(false);
              }}
            >
              Убрать
            </button>
          )}
        </div>
      )}

      <div className="field-grid">
        <div>
          <label className="mc-label" htmlFor="te-status">
            Статус
          </label>
          <select
            id="te-status"
            className="mc-input"
            value={task.status}
            onChange={(e) => update({ status: e.target.value as TaskStatus })}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mc-label" htmlFor="te-prio">
            Важность (редкость)
          </label>
          <select
            id="te-prio"
            className="mc-input"
            value={task.priority}
            style={{ color: PRIORITIES[task.priority].color }}
            onChange={(e) => update({ priority: Number(e.target.value) as Priority })}
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value} style={{ color: p.color }}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mc-label" htmlFor="te-group">
            Группа
          </label>
          <select
            id="te-group"
            className="mc-input"
            value={task.groupId ?? ''}
            onChange={(e) => update({ groupId: e.target.value || null })}
          >
            <option value="">— без группы —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="mc-label">Исполнитель</span>
          {task.assignee === nick ? (
            <button className="mc-btn" style={{ width: '100%' }} onClick={() => update({ assignee: null })}>
              Отказаться
            </button>
          ) : (
            <button
              className="mc-btn"
              style={{ width: '100%' }}
              onClick={() => update({ assignee: nick, status: task.status === 'todo' ? 'doing' : task.status })}
              title={task.assignee ? `Сейчас: ${task.assignee}` : undefined}
            >
              {task.assignee ? `${task.assignee} → я` : 'Взять себе'}
            </button>
          )}
        </div>
      </div>

      <section>
        <div className="section-head">
          <h3>Описание</h3>
          <div className="row">
            {editingDesc && (
              <div className="insert-item">
                <ItemPicker
                  placeholder="Вставить предмет…"
                  onPick={(it) =>
                    desc.set(`${desc.draft}${desc.draft && !desc.draft.endsWith(' ') ? ' ' : ''}${itemToken(it.i)}`)
                  }
                />
              </div>
            )}
            <button
              className="mc-btn sm"
              onClick={() => {
                if (editingDesc) saveDesc();
                setEditingDesc((v) => !v);
              }}
            >
              {editingDesc ? 'Готово' : 'Править'}
            </button>
          </div>
        </div>
        {editingDesc ? (
          <textarea
            className="mc-input"
            rows={8}
            value={desc.draft}
            placeholder={
              'Markdown: **жирный**, списки, - [ ] чекбоксы, таблицы.\nПредмет: [[tfc:metal/ingot/copper|16]]'
            }
            onChange={(e) => desc.set(e.target.value)}
            onBlur={saveDesc}
            autoFocus={Boolean(task.description)}
          />
        ) : task.description ? (
          <div className="desc-view" onDoubleClick={() => setEditingDesc(true)}>
            <Markdown source={task.description} />
          </div>
        ) : (
          <div className="muted">Нет описания</div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h3>Чеклист и ресурсы</h3>
          {geminiEnabled && (
            <button
              className="mc-btn sm"
              onClick={aiResources}
              disabled={aiBusy}
              title="Gemini прочитает описание и артефакты"
            >
              <ItemIcon texture="minecraft/item/experience_bottle" size={18} tip={false} />
              {aiBusy ? 'Думаю…' : 'Ресурсы из текста'}
            </button>
          )}
        </div>
        {aiError && <div className="ai-error">{aiError}</div>}
        <Checklist entries={task.checklist} onChange={(checklist) => update({ checklist })} />
      </section>

      <section>
        <div className="section-head">
          <h3>Артефакты</h3>
          <button className="mc-btn sm" onClick={createArtifact}>
            <ItemIcon texture="minecraft/item/writable_book" size={18} tip={false} />
            Новый план
          </button>
        </div>
        {linked.length ? (
          <ul className="artifact-links">
            {linked.map((a) => (
              <li key={a.id}>
                <button className="artifact-link" onClick={() => navigate(`/a/${a.id}`)}>
                  <ItemIcon texture="minecraft/item/written_book" size={24} tip={false} />
                  <span className="grow">{a.title || 'Без названия'}</span>
                  <span className="muted">
                    {a.updatedBy} · {timeAgo(a.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="muted">Для мудрёных планов — отдельный Markdown-документ с помощником Gemini.</div>
        )}
      </section>

      <footer className="editor-footer">
        <span className="muted">
          Создал {task.author} · {timeAgo(task.createdAt)} · изменено {timeAgo(task.updatedAt)}
        </span>
        <button className="mc-btn red sm" onClick={remove}>
          Удалить
        </button>
      </footer>
    </div>
  );
}
