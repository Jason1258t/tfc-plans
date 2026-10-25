import { BookOpen, ListChecks, Plus, Scale, Search, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArtifactPane } from '@/widgets/agent-panel';
import { CompareDialog } from './ui/CompareDialog';
import { DocsSection } from './ui/DocsSection';
import { GroupDialog } from './ui/GroupDialog';
import { ItemIcon } from '@/shared/pack-data';
import { TaskDialog, type TaskDialogMode } from './ui/TaskDialog';
import { TaskRow } from './ui/TaskRow';
import { useNick } from '@/entities/user';
import {Segmented, ErrorBox } from '@/shared/ui';
import { useTasks } from '@/entities/task';
import { useGroups } from '@/entities/group';
import { useArtifacts } from '@/entities/artifact';
import { usePeople } from '@/entities/user';
import { groupsStore } from '@/entities/group';
import { useSearchTrack } from '@/shared/api';
import { SORTS, sortTasks, type SortMode } from './model/tasks';
import { cx, timeAgo } from '@/shared/lib';
import { PRIORITIES } from '@/entities/task';
import type { Group } from '@/entities/group';
import type { Priority } from '@/entities/task';
import styles from './TasksPage.module.css';

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
  const { items: tasks, loading, error } = useTasks();
  const { items: groups } = useGroups();
  const { items: artifacts } = useArtifacts();
  const nick = useNick();
  const allPeople = usePeople();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const groupFilter = params.get('group') ?? ALL;
  const tab = params.get('tab') === 'done' ? 'done' : 'active';
  const editId = params.get('task');
  const docId = params.get('doc');
  // Раздел «Планы» (Markdown-документы) живёт здесь же, вместо списка задач
  const docsView = params.get('view') === 'docs';
  // Раздел «Люди» — справочник участников сайта
  const peopleView = params.get('view') === 'people';
  // Фильтр по человеку: его задачи как автора или исполнителя
  const who = params.get('who');

  const [sort, setSort] = useState<SortMode>(() => readPref('tfc-tm:sort', 'priority'));
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const [minImp, setMinImp] = useState<Priority>(0);
  const [creating, setCreating] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | 'new' | null>(null);
  // Перетаскивание групп: какую тащим и куда вставим (над/под какой группой)
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);

  // Несколько вызовов подряд не должны затирать друг друга: функциональная форма setParams в react-router
  // получает параметры с последнего рендера, а не с прошлого вызова — поэтому копим их в ref
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(paramsRef.current);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    paramsRef.current = next;
    setParams(next);
  };

  const inScope = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (groupFilter === NONE && t.groupId) return false;
      if (groupFilter !== ALL && groupFilter !== NONE && t.groupId !== groupFilter) return false;
      if (mine && t.author !== nick && t.assignee !== nick) return false;
      if (who && t.assignee !== who && t.author !== who) return false;
      if (q && !`${t.title}\n${t.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, groupFilter, mine, nick, search, who]);
  useSearchTrack('tasks', search, inScope.length);

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

  const people = useMemo(
    () =>
      [...allPeople]
        .sort((a, b) => b.lastSeen - a.lastSeen || a.id.localeCompare(b.id))
        .map((u) => ({
          ...u,
          doing: tasks.filter((t) => t.assignee === u.id && t.status !== 'done').length,
          authored: tasks.filter((t) => t.author === u.id && t.status !== 'done').length,
        })),
    [allPeople, tasks],
  );

  const dialog: TaskDialogMode | null = creating
    ? { kind: 'create', groupId: groupFilter !== ALL && groupFilter !== NONE ? groupFilter : null }
    : editId
      ? { kind: 'edit', taskId: editId }
      : null;

  // Новый порядок — индекс в списке; пишем только группы, у которых он поменялся
  const moveGroup = (id: string, target: string, after: boolean) => {
    if (id === target) return;
    const list = groups.filter((g) => g.id !== id);
    const moved = groups.find((g) => g.id === id);
    if (!moved) return;
    list.splice(list.findIndex((g) => g.id === target) + (after ? 1 : 0), 0, moved);
    list.forEach((g, i) => {
      if (g.order !== i) groupsStore.update(g.id, { order: i }).catch((e) => console.error('Порядок групп:', e));
    });
  };
  const endDrag = () => {
    setDragId(null);
    setDropAt(null);
  };

  const groupItems = [
    { id: ALL, name: 'Все задачи', icon: null as string | null | undefined, group: null as Group | null },
    ...groups.map((g) => ({ id: g.id, name: g.name, icon: g.icon, group: g })),
    { id: NONE, name: 'Без группы', icon: null, group: null },
  ];

  return (
    <div className={cx(styles.tasksLayout, docId && styles.withDoc)}>
      <aside className={styles.groups} data-tour="tasks-groups">
        <ul className={styles.groupsSections}>
          <li>
            <button
              className={cx(styles.groupItem, !docsView && !peopleView && styles.active)}
              onClick={() => setParam({ view: null })}
            >
              <span className={styles.groupIcon}>
                <ListChecks size={16} />
              </span>
              <span className={cx('grow', styles.groupName)}>Задачи</span>
              <span className={styles.groupCount}>{countFor(ALL) || ''}</span>
            </button>
          </li>
          <li>
            <button
              className={cx(styles.groupItem, docsView && styles.active)}
              onClick={() => setParam({ view: 'docs' })}
            >
              <span className={styles.groupIcon}>
                <BookOpen size={16} />
              </span>
              <span className={cx('grow', styles.groupName)}>Планы</span>
              <span className={styles.groupCount}>{artifacts.length || ''}</span>
            </button>
          </li>
          <li>
            <button
              className={cx(styles.groupItem, peopleView && styles.active)}
              onClick={() => setParam({ view: 'people' })}
            >
              <span className={styles.groupIcon}>
                <Users size={16} />
              </span>
              <span className={cx('grow', styles.groupName)}>Люди</span>
              <span className={styles.groupCount}>{allPeople.length || ''}</span>
            </button>
          </li>
        </ul>
        <div className={styles.groupsHead}>
          <span>Группы</span>
          <button className="btn ghost sm icon" onClick={() => setEditingGroup('new')} aria-label="Новая группа">
            <Plus size={15} />
          </button>
        </div>
        <ul>
          {groupItems.map((g) => (
            <li
              key={g.id}
              className={cx(
                dragId === g.id && styles.dragging,
                dropAt?.id === g.id && (dropAt.after ? styles.dropAfter : styles.dropBefore),
              )}
              draggable={!!g.group}
              onDragStart={(e) => {
                if (!g.group) return;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', g.id);
                setDragId(g.id);
              }}
              onDragOver={(e) => {
                if (!dragId || !g.group) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const r = e.currentTarget.getBoundingClientRect();
                const after = e.clientY > r.top + r.height / 2;
                if (dropAt?.id !== g.id || dropAt.after !== after) setDropAt({ id: g.id, after });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dropAt) moveGroup(dragId, dropAt.id, dropAt.after);
                endDrag();
              }}
              onDragEnd={endDrag}
            >
              <button
                className={cx(styles.groupItem, !docsView && groupFilter === g.id && styles.active)}
                onClick={() => setParam({ group: g.id === ALL ? null : g.id, view: null })}
                onDoubleClick={() => g.group && setEditingGroup(g.group)}
                title={g.group ? 'Перетащите, чтобы поменять порядок; двойной клик — настроить группу' : undefined}
              >
                <span className={styles.groupIcon}>{g.icon && <ItemIcon id={g.icon} size={16} tip={false} />}</span>
                <span className={cx('grow', styles.groupName)}>{g.name}</span>
                <span className={styles.groupCount}>{countFor(g.id) || ''}</span>
              </button>
              {g.group && (
                <button
                  className={styles.groupEdit}
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

      <main className={styles.tasksMain}>
        {docsView ? (
          <DocsSection openId={docId} onOpen={(id) => setParam({ doc: id })} />
        ) : peopleView ? (
          <section>
            <header className={styles.peopleHead}>
              <h2>Люди</h2>
              <span className="faint small">
                Кто заходил на сайт. Нажмите на человека — увидите его задачи; назначить можно в карточке задачи.
              </span>
            </header>
            {people.length === 0 ? (
              <div className="empty">Список пуст — наполнится, когда участники откроют сайт.</div>
            ) : (
              <ul className={styles.peopleList}>
                {people.map((u) => (
                  <li key={u.id}>
                    <button className={styles.person} onClick={() => setParam({ view: null, group: null, who: u.id })}>
                      <span className={styles.personAvatar}>{u.id.slice(0, 1).toUpperCase()}</span>
                      <span className={styles.personMain}>
                        <span className={styles.personName}>
                          {u.id}
                          {u.id === nick && <span className="faint"> — вы</span>}
                        </span>
                        <span className={cx(styles.personSub, 'faint', 'small')}>
                          в работе {u.doing} · автор {u.authored} ·{' '}
                          {u.lastSeen > 0 ? 'был(а) ' + timeAgo(u.lastSeen) : 'только в задачах'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <>
            <div className={styles.tasksTop}>
              <Segmented
                role="tablist"
                className={styles.tabs}
                value={tab}
                onChange={(v) => setParam({ tab: v === 'done' ? 'done' : null })}
                options={[
                  { value: 'active', label: 'Активные', count: inScope.filter((t) => t.status !== 'done').length },
                  { value: 'done', label: 'Выполненные', count: done.length },
                ]}
              />
              <span className="grow" />
              <button
                className="btn"
                data-tour="tasks-compare"
                onClick={() => setComparing(true)}
                title="Попарно сравнить задачи по важности"
              >
                <Scale size={15} />
                <span className="hide-sm">Что важнее?</span>
              </button>
              <button className="btn primary" data-tour="tasks-new" onClick={() => setCreating(true)}>
                <Plus size={16} />
                Задача
              </button>
            </div>

            <div className={styles.tasksFilters} role="search" aria-label="Поиск и фильтры задач">
              <label className={styles.search}>
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
              {who && (
                <button className={styles.whoChip} onClick={() => setParam({ who: null })}>
                  {who} <X size={13} />
                </button>
              )}
            </div>

            {error && <ErrorBox>Ошибка базы данных: {error}</ErrorBox>}

            {loading ? (
              <div className="empty">Загрузка…</div>
            ) : list.length === 0 ? (
              <div className="empty">
                {tab === 'done' ? (
                  'Выполненных задач пока нет'
                ) : (
                  <>
                    Задач нет.{' '}
                    <button className={styles.linkBtn} onClick={() => setCreating(true)}>
                      Создать первую
                    </button>
                  </>
                )}
              </div>
            ) : (
              <ul className={styles.taskList}>
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
          </>
        )}
      </main>

      {docId && (
        <ArtifactPane
          key={docId}
          artifactId={docId}
          variant="side"
          onClose={() => setParam({ doc: null })}
          onToggleSize={() => navigate(`/doc/${docId}`)}
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
