import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CompareModal } from '../components/CompareModal';
import { GroupModal } from '../components/GroupModal';
import { ItemIcon } from '../components/ItemIcon';
import { TaskCard } from '../components/TaskCard';
import { TaskEditor } from '../components/TaskEditor';
import { useData } from '../data/DataContext';
import { tasksStore } from '../data/store';
import { SORTS, sortTasks, type SortMode } from '../lib/tasks';
import { cx } from '../lib/util';
import { PRIORITIES, STATUSES, type Group, type Priority, type TaskStatus } from '../types';
import './BoardPage.css';

const filtersOpenByDefault = typeof window !== 'undefined' && window.matchMedia('(min-width: 761px)').matches;

const ALL = '__all';
const NONE = '__none';

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* нет доступа к storage — не страшно */
  }
}

export function BoardPage() {
  const { tasks, groups, loading, error, nick } = useData();
  const [params, setParams] = useSearchParams();
  const openTaskId = params.get('task');
  const groupFilter = params.get('group') ?? ALL;

  const [sort, setSort] = useState<SortMode>(() => readPref('tfc-tm:sort', 'priority'));
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const [minPrio, setMinPrio] = useState<Priority>(0);
  const [comparing, setComparing] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | 'new' | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (groupFilter === NONE && t.groupId) return false;
      if (groupFilter !== ALL && groupFilter !== NONE && t.groupId !== groupFilter) return false;
      if (mine && t.author !== nick && t.assignee !== nick) return false;
      if (t.priority < minPrio) return false;
      if (q && !`${t.title}\n${t.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, groupFilter, mine, nick, minPrio, search]);

  const columns = useMemo(
    () =>
      STATUSES.map((s) => {
        const list = filtered.filter((t) => t.status === s.value);
        // Готовые — всегда свежие сверху
        return {
          ...s,
          tasks: s.value === 'done' ? sortTasks(list, 'updated') : sortTasks(list, sort),
        };
      }),
    [filtered, sort],
  );

  const quickAdd = async (title: string) => {
    const groupId = groupFilter !== ALL && groupFilter !== NONE ? groupFilter : null;
    await tasksStore.add({
      title,
      description: '',
      status: 'todo',
      priority: 0,
      rating: 1000,
      checklist: [],
      groupId,
      author: nick,
      assignee: null,
    });
  };

  const countFor = (id: string) =>
    tasks.filter((t) => t.status !== 'done' && (id === ALL || (id === NONE ? !t.groupId : t.groupId === id))).length;

  return (
    <div className="board-layout">
      <aside className="sidebar">
        <section className="mc-panel">
          <h3>Группы</h3>
          <ul className="group-list">
            {[
              { id: ALL, name: 'Все задачи' },
              ...groups.map((g) => ({
                id: g.id,
                name: g.name,
                icon: g.icon,
                group: g,
              })),
              { id: NONE, name: 'Без группы' },
            ].map((g) => (
              <li key={g.id}>
                <button
                  className={cx('group-item', groupFilter === g.id && 'active')}
                  onClick={() => setParam('group', g.id === ALL ? null : g.id)}
                >
                  <span className="mc-slot group-icon">
                    {'icon' in g && g.icon ? <ItemIcon id={g.icon} size={20} tip={false} /> : null}
                  </span>
                  <span className="grow">{g.name}</span>
                  <span className="group-count">{countFor(g.id)}</span>
                </button>
                {'group' in g && g.group && (
                  <button
                    className="group-edit"
                    aria-label={`Настроить группу ${g.name}`}
                    onClick={() => setEditingGroup(g.group!)}
                  >
                    ✎
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button className="mc-btn sm" style={{ width: '100%', marginTop: 8 }} onClick={() => setEditingGroup('new')}>
            + Группа
          </button>
        </section>

        <details className="mc-panel filters" open={filtersOpenByDefault}>
          <summary>
            <h3>Фильтры</h3>
          </summary>
          <div className="stack" style={{ gap: 8 }}>
            <input
              className="mc-input"
              placeholder="Поиск…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Поиск задач"
            />
            <div>
              <label className="mc-label" htmlFor="sort">
                Сортировка
              </label>
              <select
                id="sort"
                className="mc-input"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as SortMode);
                  writePref('tfc-tm:sort', e.target.value);
                }}
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mc-label" htmlFor="minprio">
                Редкость не ниже
              </label>
              <select
                id="minprio"
                className="mc-input"
                value={minPrio}
                onChange={(e) => setMinPrio(Number(e.target.value) as Priority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
              Только мои
            </label>
          </div>
        </details>

        <button className="mc-btn compare-btn" onClick={() => setComparing(true)}>
          <ItemIcon texture="minecraft/item/compass_00" size={24} tip={false} />
          Что важнее?
        </button>
      </aside>

      <main className="board">
        {error && <div className="mc-panel error-panel">Ошибка базы данных: {error}</div>}
        {columns.map((col) => (
          <section
            key={col.value}
            className={cx('column', dragOver === col.value && 'drag-over')}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('text/task-id')) return;
              e.preventDefault();
              setDragOver(col.value);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
            }}
            onDrop={(e) => {
              setDragOver(null);
              const id = e.dataTransfer.getData('text/task-id');
              const task = tasks.find((t) => t.id === id);
              if (task && task.status !== col.value) tasksStore.update(id, { status: col.value });
            }}
          >
            <header className="column-head">
              <h2 className="shadow">{col.label}</h2>
              <span className="muted">{col.tasks.length}</span>
            </header>
            {col.value === 'todo' && <QuickAdd onAdd={quickAdd} />}
            <div className="column-body">
              {loading ? (
                <div className="empty">Загрузка чанков…</div>
              ) : col.tasks.length === 0 ? (
                <div className="empty">Пусто</div>
              ) : (
                col.tasks.map((t) => <TaskCard key={t.id} task={t} onOpen={() => setParam('task', t.id)} />)
              )}
            </div>
          </section>
        ))}
      </main>

      {openTaskId && <TaskEditor taskId={openTaskId} onClose={() => setParam('task', null)} />}
      {comparing && (
        <CompareModal tasks={filtered.filter((t) => t.status !== 'done')} onClose={() => setComparing(false)} />
      )}
      {editingGroup && (
        <GroupModal
          group={editingGroup === 'new' ? null : editingGroup}
          onClose={() => setEditingGroup(null)}
          onDeleted={() => setParam('group', null)}
        />
      )}
    </div>
  );
}

function QuickAdd({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  return (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t) return;
        setTitle('');
        onAdd(t);
      }}
    >
      <input
        className="mc-input"
        placeholder="Новая задача… (Enter)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Название новой задачи"
      />
      <button className="mc-btn icon-only green" aria-label="Добавить задачу" disabled={!title.trim()}>
        +
      </button>
    </form>
  );
}
