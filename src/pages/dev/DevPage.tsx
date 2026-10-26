import { GitBranch, MessageSquare, Plus, Search as SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { firebaseEnabled, useSearchTrack } from '@/shared/api';
import { cx, timeAgo } from '@/shared/lib';
import { Button, ErrorBox, Search, Segmented, Select, Tag } from '@/shared/ui';
import { AREAS, KINDS, label, STATUSES, type DevStatus, type DevTask } from './model/api';
import { useDevTasks } from './model/useDevTasks';
import { CopyRef } from './ui/CopyRef';
import { DevTaskDialog } from './ui/DevTaskDialog';
import styles from './DevPage.module.css';

/**
 * «Разработка» — задачи и журнал работ агентов и хоста. Данные — на сервере сборки (не Firestore),
 * см. docs/plans/dev-tracker.md. Открытая задача — в адресе (?task=12), так на неё ссылаются агенты.
 */

type View = 'open' | 'doing' | 'closed' | 'all';
const VIEWS: Record<View, DevStatus[] | null> = {
  open: ['backlog', 'todo', 'doing', 'review'],
  doing: ['doing', 'review'],
  closed: ['done', 'dropped'],
  all: null,
};
const RANK: Record<DevStatus, number> = { doing: 0, review: 1, todo: 2, backlog: 3, done: 4, dropped: 5 };

export function DevPage() {
  const { tasks, error, reload, put, drop } = useDevTasks();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('open');
  const [kind, setKind] = useState('');
  const [area, setArea] = useState('');
  const [query, setQuery] = useState('');

  const open = params.get('task');
  const setOpen = (id: number | 'new' | null) =>
    setParams(
      (p) => {
        if (id === null) p.delete('task');
        else p.set('task', String(id));
        return p;
      },
      { replace: id === null },
    );

  const counts = useMemo(() => {
    const c: Record<View, number> = { open: 0, doing: 0, closed: 0, all: tasks?.length ?? 0 };
    for (const t of tasks ?? [])
      for (const v of ['open', 'doing', 'closed'] as const) if (VIEWS[v]!.includes(t.status)) c[v]++;
    return c;
  }, [tasks]);

  const list = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const want = VIEWS[view];
    return (tasks ?? [])
      .filter((t) => !want || want.includes(t.status))
      .filter((t) => !kind || t.kind === kind)
      .filter((t) => !area || t.area === area)
      .filter((t) => {
        if (!words.length) return true;
        const hay = `#${t.id} ${t.title} ${t.body} ${t.assignee ?? ''} ${t.branch ?? ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) =>
        view === 'closed'
          ? (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt)
          : RANK[a.status] - RANK[b.status] || b.priority - a.priority || b.updatedAt - a.updatedAt,
      );
  }, [tasks, view, kind, area, query]);
  useSearchTrack('dev', query, tasks ? list.length : undefined);

  if (!firebaseEnabled)
    return (
      <main className={styles.page}>
        <ErrorBox>Задачи разработки доступны только с подключённым Firebase (нужен вход сайта).</ErrorBox>
      </main>
    );

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <h1>Разработка</h1>
        <span className={styles.hint}>задачи сайта, MCP, аддонов и сервера · журнал работ агентов</span>
        <span className="grow" />
        <Button variant="primary" onClick={() => setOpen('new')}>
          <Plus size={15} /> Новая задача
        </Button>
      </div>

      <div className={styles.filters}>
        <Segmented
          className={styles.views}
          label="Какие задачи"
          value={view}
          onChange={setView}
          options={[
            { value: 'open', label: 'Открытые', count: counts.open },
            { value: 'doing', label: 'В работе', count: counts.doing },
            { value: 'closed', label: 'Закрытые', count: counts.closed },
            { value: 'all', label: 'Все', count: counts.all },
          ]}
        />
        <Select className={styles.filter} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Вид">
          <option value="">Любой вид</option>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
        <Select className={styles.filter} value={area} onChange={(e) => setArea(e.target.value)} aria-label="Область">
          <option value="">Любая область</option>
          {AREAS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </Select>
        <Search className={styles.search}>
          <SearchIcon size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: слова, #номер, ветка"
            aria-label="Поиск задач разработки"
          />
        </Search>
      </div>

      {error && (
        <ErrorBox>
          {error}{' '}
          <Button size="sm" variant="ghost" onClick={() => void reload()}>
            Повторить
          </Button>
        </ErrorBox>
      )}
      {!tasks && !error && <p className={styles.empty}>Загружаю…</p>}
      {tasks && !list.length && <p className={styles.empty}>Задач не найдено.</p>}

      <ul className={styles.list}>
        {list.map((t) => (
          <DevRow key={t.id} task={t} onOpen={() => setOpen(t.id)} />
        ))}
      </ul>

      {open && (
        <DevTaskDialog
          id={open === 'new' ? null : Number(open)}
          onClose={() => setOpen(null)}
          onSaved={(t, created) => {
            put(t);
            if (created) setOpen(t.id);
          }}
          onDeleted={(id) => {
            drop(id);
            setOpen(null);
          }}
        />
      )}
    </main>
  );
}

function DevRow({ task: t, onOpen }: { task: DevTask; onOpen: () => void }) {
  const done = t.checklist.filter((c) => c.done).length;
  return (
    <li className={styles.item}>
      <button
        className={cx(styles.row, (t.status === 'done' || t.status === 'dropped') && styles.closed)}
        onClick={onOpen}
      >
        <span className={styles.num}>#{t.id}</span>
        <span className={cx(styles.status, styles[t.status])}>{label(STATUSES, t.status)}</span>
        <span className={styles.title}>
          {t.priority >= 2 && <span className={styles.prio}>{t.priority === 3 ? '‼' : '!'}</span>}
          {t.title}
        </span>
        <span className={styles.meta}>
          <Tag>{label(KINDS, t.kind)}</Tag>
          {t.area && <Tag>{label(AREAS, t.area)}</Tag>}
          {t.checklist.length > 0 && (
            <span>
              {done}/{t.checklist.length}
            </span>
          )}
          {!!t.notes && (
            <span>
              <MessageSquare size={12} /> {t.notes}
            </span>
          )}
          {t.branch && (
            <span className={styles.branch}>
              <GitBranch size={12} /> {t.branch}
            </span>
          )}
          {t.assignee && <span className={styles.who}>{t.assignee}</span>}
          <span className={styles.when}>{timeAgo(t.updatedAt)}</span>
        </span>
      </button>
      {/* Рядом с кнопкой строки, а не внутри: кнопка в кнопке недопустима */}
      <CopyRef task={t} className={styles.copy} />
    </li>
  );
}
