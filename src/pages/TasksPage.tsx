import { Plus, Scale, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArtifactPane } from '../components/ArtifactPane';
import { CompareDialog } from '../components/CompareDialog';
import { GroupDialog } from '../components/GroupDialog';
import { ItemIcon } from '../components/ItemIcon';
import { TaskDialog, type TaskDialogMode } from '../components/TaskDialog';
import { TaskRow } from '../components/TaskRow';
import { useData } from '../data/DataContext';
import { SORTS, sortTasks, type SortMode } from '../lib/tasks';
import { cx } from '../lib/util';
import { PRIORITIES, type Group, type Priority } from '../types';
import './TasksPage.css';

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
    /* storage недоступен — просто не запоминаем */
  }
}

export function TasksPage() {
  const { tasks, groups, artifacts, loading, error, nick } = useData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const groupFilter = params.get('group') ?? ALL;
  const tab = params.get('tab') === 'done' ? 'done' : 'active';
  const editId = params.get('task');
  const docId = params.get('doc');

  const [sort, setSort] = useState<SortMode>(() => readPref('tfc-tm:sort', 'priority'));
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const [minImp, setMinImp] = useState<Priority>(0);
  const [creating, setCreating] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | 'new' | null>(null);

  // Функциональная форма: несколько вызовов подряд не затирают друг друга
  const setParam = (patch: Record<string, string | null>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      return next;
    });

  const inScope = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (groupFilter === NONE && t.groupId) return false;
      if (groupFilter !== ALL && groupFilter !== NONE && t.groupId !== groupFilter) return false;
      if (mine && t.author !== nick && t.assignee !== nick) return false;
      if (q && !`${t.title}\n${t.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, groupFilter, mine, nick, search]);

  const active = useMemo(
    () =>
      sortTasks(
        inScope.filter((t) => t.status !== 'done' && t.priority >= minImp),
        sort,
      ),
    [inScope, minImp, sort],
  );
  const done = useMemo(
    () =>
      inScope
        .filter((t) => t.status === 'done')
        .sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)),
    [inScope],
  );
  const list = tab === 'done' ? done : active;
  // Подсвечиваем задачу, чей документ открыт справа
  const openDocTaskId = docId ? artifacts.find((a) => a.id === docId)?.taskId : null;

  const countFor = (id: string) =>
    tasks.filter((t) => t.status !== 'done' && (id === ALL || (id === NONE ? !t.groupId : t.groupId === id))).length;

  const dialog: TaskDialogMode | null = creating
    ? { kind: 'create', groupId: groupFilter !== ALL && groupFilter !== NONE ? groupFilter : null }
    : editId
      ? { kind: 'edit', taskId: editId }
      : null;

  const groupItems = [
    { id: ALL, name: 'Все задачи', icon: null as string | null | undefined, group: null as Group | null },
    ...groups.map((g) => ({ id: g.id, name: g.name, icon: g.icon, group: g })),
    { id: NONE, name: 'Без группы', icon: null, group: null },
  ];

  return (
    <div className={cx('tasks-layout', docId && 'with-doc')}>
      <aside className="groups">
        <div className="groups-head">
          <span>Группы</span>
          <button className="btn ghost sm icon" onClick={() => setEditingGroup('new')} aria-label="Новая группа">
            <Plus size={15} />
          </button>
        </div>
        <ul>
          {groupItems.map((g) => (
            <li key={g.id}>
              <button
                className={cx('group-item', groupFilter === g.id && 'active')}
                onClick={() => setParam({ group: g.id === ALL ? null : g.id })}
                onDoubleClick={() => g.group && setEditingGroup(g.group)}
                title={g.group ? 'Двойной клик — настроить группу' : undefined}
              >
                <span className="group-icon">{g.icon && <ItemIcon id={g.icon} size={16} tip={false} />}</span>
                <span className="grow group-name">{g.name}</span>
                <span className="group-count">{countFor(g.id) || ''}</span>
              </button>
              {g.group && (
                <button
                  className="group-edit"
                  onClick={() => setEditingGroup(g.group)}
                  aria-label={`Настроить группу ${g.name}`}
                >
                  ···
                </button>
              )}
            </li>
          ))}
        </ul>
      </aside>

      <main className="tasks-main">
        <div className="tasks-top">
          <div className="seg" role="tablist">
            <button aria-pressed={tab === 'active'} onClick={() => setParam({ tab: null })}>
              Активные <span className="count">{inScope.filter((t) => t.status !== 'done').length}</span>
            </button>
            <button aria-pressed={tab === 'done'} onClick={() => setParam({ tab: 'done' })}>
              Выполненные <span className="count">{done.length}</span>
            </button>
          </div>
          <span className="grow" />
          <button className="btn" onClick={() => setComparing(true)} title="Попарно сравнить задачи по важности">
            <Scale size={15} />
            <span className="hide-sm">Что важнее?</span>
          </button>
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={16} />
            Задача
          </button>
        </div>

        <div className="tasks-filters">
          <label className="search">
            <Search size={15} className="faint" />
            <input
              placeholder="Поиск по задачам"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Поиск по задачам"
            />
          </label>
          {tab === 'active' && (
            <>
              <select
                className="input"
                value={minImp}
                onChange={(e) => setMinImp(Number(e.target.value) as Priority)}
                aria-label="Минимальная важность"
              >
                <option value={0}>Любая важность</option>
                {PRIORITIES.slice(1).map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label} и выше
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as SortMode);
                  writePref('tfc-tm:sort', e.target.value);
                }}
                aria-label="Сортировка"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </>
          )}
          <label className="toggle">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            Мои
          </label>
        </div>

        {error && <div className="error-box">Ошибка базы данных: {error}</div>}

        {loading ? (
          <div className="empty">Загрузка…</div>
        ) : list.length === 0 ? (
          <div className="empty">
            {tab === 'done' ? (
              'Выполненных задач пока нет'
            ) : (
              <>
                Задач нет.{' '}
                <button className="link-btn" onClick={() => setCreating(true)}>
                  Создать первую
                </button>
              </>
            )}
          </div>
        ) : (
          <ul className="task-list">
            {list.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                selected={openDocTaskId === t.id}
                onOpen={() => setParam({ task: t.id })}
                onOpenDoc={(id) => setParam({ doc: id })}
              />
            ))}
          </ul>
        )}
      </main>

      {docId && (
        <ArtifactPane
          key={docId}
          artifactId={docId}
          variant="side"
          onClose={() => setParam({ doc: null })}
          onToggleSize={() => navigate(`/docs/${docId}`)}
          onOpenTask={(id) => setParam({ task: id })}
          onDeleted={() => setParam({ doc: null })}
        />
      )}

      {dialog && (
        <TaskDialog
          mode={dialog}
          onClose={() => (creating ? setCreating(false) : setParam({ task: null }))}
          onOpenArtifact={(id) => setParam({ doc: id, task: null })}
        />
      )}
      {comparing && <CompareDialog tasks={active} onClose={() => setComparing(false)} />}
      {editingGroup && (
        <GroupDialog
          group={editingGroup === 'new' ? null : editingGroup}
          onClose={() => setEditingGroup(null)}
          onDeleted={() => setParam({ group: null })}
        />
      )}
    </div>
  );
}
