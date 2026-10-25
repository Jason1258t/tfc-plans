import { collection, documentId, getDocs, orderBy, query, where } from 'firebase/firestore';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  authReady,
  db,
  analyticsOff,
  flush,
  purgeExpired,
  setAnalyticsOff,
  type Visit,
  type VisitDay,
  type VisitEvent,
} from '@/shared/api';
import { cx } from '@/shared/lib';
import { Button, Segmented } from '@/shared/ui';
import styles from './StatsPage.module.css';

/**
 * Статистика сайта — страница только по прямой ссылке /stats (в меню её нет).
 * Сводка, разделы и действия — из дневных счётчиков visitDays (одно чтение на день),
 * люди, поиск и хронология — из заходов visits за выбранный период.
 */

const PERIODS = [
  { days: 1, label: 'Сегодня' },
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
] as const;

const SECTION_LABEL: Record<string, string> = {
  tasks: 'Задачи',
  'tasks:done': 'Задачи · готовые',
  docs: 'Файлы и планы',
  doc: 'Документ',
  schematics: 'Схемы',
  datapacks: 'Датапаки',
  recipes: 'Рецепты',
  tags: 'Теги',
  reference: 'Справочник',
  addons: 'Аддоны',
  addon: 'Аддон',
  updates: 'Обновления',
  freshness: 'Свежесть модов',
  dev: 'Разработка',
};

const REF_TAB: Record<string, string> = {
  ores: 'руды',
  fuel: 'топливо',
  food: 'еда',
  metals: 'металлы',
  map: 'карта',
  guides: 'гайды',
  botany: 'ботаника',
  power: 'электричество',
  multiblocks: 'мультиблоки',
  meals: 'блюда',
};

function sectionLabel(key: string): string {
  if (SECTION_LABEL[key]) return SECTION_LABEL[key];
  const [base, tab] = key.split(':');
  const name = SECTION_LABEL[base] ?? base;
  return tab ? `${name} · ${REF_TAB[tab] ?? tab}` : name;
}

const ACTION_LABEL: Record<string, string> = {
  'task.open': 'Открыл задачу по ссылке',
  'tasks.create': 'Создал задачу',
  'tasks.edit': 'Правил задачу',
  'tasks.status': 'Сменил статус задачи',
  'tasks.assignee': 'Сменил исполнителя',
  'tasks.checklist': 'Отметил чеклист',
  'tasks.rating': 'Сравнил задачи («что важнее»)',
  'tasks.delete': 'Удалил задачу',
  'groups.create': 'Создал группу',
  'groups.edit': 'Правил группу',
  'artifacts.create': 'Создал план',
  'artifacts.edit': 'Правил план',
  'artifacts.delete': 'Удалил план',
  'guides.create': 'Создал гайд',
  'guides.edit': 'Правил гайд',
  'guide.open': 'Открыл гайд',
  'schematics.create': 'Сохранил схему',
  'schematics.edit': 'Правил схему',
  'schematics.delete': 'Удалил схему',
  'datapacks.create': 'Создал датапак',
  'datapacks.edit': 'Правил датапак',
  'datapacks.delete': 'Удалил датапак',
  'kubejsScripts.create': 'Создал скрипт KubeJS',
  'kubejsScripts.edit': 'Правил скрипт KubeJS',
  'replaceFavorites.create': 'Добавил замену в избранное',
  'recipes.item': 'Рецепты предмета',
  'recipes.usage': 'Где используется предмет',
  'file.upload': 'Загрузил файл',
  'file.download': 'Скачал файл',
  'ai.ask': 'Спросил помощника',
  'ai.resources': 'Ресурсы через ИИ',
  'ai.replacements': 'Замены в схеме через ИИ',
  'ai.recipeHint': 'Подсказка к рецепту через ИИ',
  'ai.patchNotes': 'Патчноут через ИИ',
};

const SEARCH_LABEL: Record<string, string> = {
  tasks: 'Задачи',
  docs: 'Планы',
  schematics: 'Схемы',
  recipes: 'Рецепты',
  tags: 'Теги',
  items: 'Поиск предмета',
  ores: 'Руды',
  fuel: 'Топливо',
  food: 'Еда',
  metals: 'Металлы',
};

const actionLabel = (k: string) => ACTION_LABEL[k] ?? k;

const DAY = 86_400_000;
/** Дольше без событий — человек отошёл, время в разделе дальше не считаем */
const IDLE_CAP = 30 * 60_000;

function dayKeyOf(t: number, dev: boolean) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dev ? 'dev-' : ''}${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const fmtTime = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (t: number) =>
  new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return '<1 мин';
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

const sum = (m?: Record<string, number>) => Object.values(m ?? {}).reduce((a, b) => a + b, 0);

function addTo(m: Map<string, number>, k: string, n = 1) {
  m.set(k, (m.get(k) ?? 0) + n);
}

const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);

/** Время по разделам в одном заходе: от просмотра до следующего просмотра или ухода со вкладки */
function sectionTimes(v: Visit): Map<string, number> {
  const out = new Map<string, number>();
  const ev = [...v.events].sort((a, b) => a.t - b.t);
  let cur: string | null = null;
  let since = 0;
  const close = (t: number) => {
    if (cur) addTo(out, cur, Math.min(t - since, IDLE_CAP));
  };
  for (const e of ev) {
    if (e.k === 'view') {
      close(e.t);
      cur = e.n ?? null;
      since = e.t;
    } else if (e.k === 'hide') {
      close(e.t);
      since = e.t;
      if (cur) cur = `~${cur}`; // скрыт: время не идёт, раздел запомнили
    } else if (e.k === 'show' && cur?.startsWith('~')) {
      cur = cur.slice(1);
      since = e.t;
    } else if (cur && !cur.startsWith('~') && e.t - since > IDLE_CAP) {
      close(e.t);
      since = e.t;
    }
  }
  if (cur && !cur.startsWith('~')) close(Math.max(v.lastAt, ev.at(-1)?.t ?? v.lastAt));
  return out;
}

function eventText(e: VisitEvent): string {
  if (e.k === 'view') return `→ ${sectionLabel(e.n ?? '')}`;
  if (e.k === 'hide') return 'ушёл со вкладки';
  if (e.k === 'show') return 'вернулся на вкладку';
  if (e.k === 'search')
    return `поиск (${SEARCH_LABEL[e.n ?? ''] ?? e.n}): «${e.d?.q}» — ${e.d?.found === 0 ? 'ничего' : `найдено ${e.d?.found}`}`;
  const extra = e.d ? Object.values(e.d).join(', ') : '';
  return `${actionLabel(e.n ?? '')}${extra ? ` · ${extra}` : ''}${e.c && e.c > 1 ? ` ×${e.c}` : ''}`;
}

export function StatsPage() {
  const [days, setDays] = useState<number>(7);
  // Только на dev-сервере: проверочные записи (tfc-analytics-dev) вместо настоящих
  const [dev, setDev] = useState(false);
  const [dayDocs, setDayDocs] = useState<VisitDay[] | null>(null);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState(analyticsOff);
  const [person, setPerson] = useState<string | null>(null);
  const [openVisit, setOpenVisit] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!db) return setError('Нет подключения к базе');
    setError(null);
    setDayDocs(null);
    setVisits(null);
    try {
      await flush();
      await authReady;
      const now = Date.now();
      setLoadedAt(now);
      const from = dayKeyOf(now - (days - 1) * DAY, dev);
      const to = dayKeyOf(now, dev);
      const since = new Date(now - (days - 1) * DAY).setHours(0, 0, 0, 0);
      const [d, v] = await Promise.all([
        getDocs(query(collection(db, 'visitDays'), where(documentId(), '>=', from), where(documentId(), '<=', to))),
        getDocs(query(collection(db, 'visits'), where('startedAt', '>=', since), orderBy('startedAt', 'desc'))),
      ]);
      setDayDocs(d.docs.map((x) => ({ ...(x.data() as Omit<VisitDay, 'id'>), id: x.id })));
      setVisits(
        v.docs.map((x) => ({ ...(x.data() as Omit<Visit, 'id'>), id: x.id })).filter((x) => Boolean(x.dev) === dev),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [days, dev]);

  useEffect(() => {
    void load();
  }, [load]);

  // Уборка просроченных заходов (старше 90 дней) — раз при открытии страницы
  useEffect(() => {
    purgeExpired().then(
      (n) => n && console.info(`Статистика: удалено старых заходов — ${n}`),
      (e) => console.warn('Статистика: старые заходы не удалились:', e),
    );
  }, []);

  const toggleOff = (v: boolean) => {
    setAnalyticsOff(v);
    setOff(v);
  };

  const s = useMemo(() => {
    if (!dayDocs || !visits) return null;
    const now = loadedAt;
    const byDay = new Map(dayDocs.map((d) => [d.id, d]));
    const chart = Array.from({ length: Math.max(days, 7) }, (_, i) => {
      const t = now - (Math.max(days, 7) - 1 - i) * DAY;
      const d = byDay.get(dayKeyOf(t, dev));
      return {
        t,
        visits: d?.visits ?? 0,
        people: Object.keys(d?.nicks ?? {}).length,
        views: sum(d?.views),
        inPeriod: i >= Math.max(days, 7) - days,
      };
    });
    const views = new Map<string, number>();
    const actions = new Map<string, number>();
    const people = new Set<string>();
    let visitCount = 0;
    for (const d of dayDocs) {
      visitCount += d.visits ?? 0;
      Object.entries(d.views ?? {}).forEach(([k, n]) => addTo(views, k, n));
      Object.entries(d.actions ?? {}).forEach(([k, n]) => addTo(actions, k, n));
      Object.keys(d.nicks ?? {}).forEach((n) => people.add(n));
    }

    // Из заходов: время по разделам, люди, поиски
    const time = new Map<string, number>();
    const sectionPeople = new Map<string, Set<string>>();
    const searches = new Map<string, { where: string; q: string; n: number; found: number; who: Set<string> }>();
    const persons = new Map<
      string,
      { nick: string; visits: Visit[]; last: number; events: number; time: number; sections: Map<string, number> }
    >();
    for (const v of visits) {
      const p = persons.get(v.nick) ?? {
        nick: v.nick,
        visits: [] as Visit[],
        last: 0,
        events: 0,
        time: 0,
        sections: new Map(),
      };
      p.visits.push(v);
      p.last = Math.max(p.last, v.lastAt);
      p.events += v.events.length;
      for (const [k, ms] of sectionTimes(v)) {
        addTo(time, k, ms);
        addTo(p.sections, k, ms);
        p.time += ms;
        const set = sectionPeople.get(k) ?? new Set();
        set.add(v.nick);
        sectionPeople.set(k, set);
      }
      persons.set(v.nick, p);
      for (const e of v.events) {
        if (e.k !== 'search' || !e.d) continue;
        const q = String(e.d.q);
        const key = `${e.n}\n${q}`;
        const r = searches.get(key) ?? { where: e.n ?? '', q, n: 0, found: 0, who: new Set<string>() };
        r.n++;
        r.found = Number(e.d.found);
        r.who.add(v.nick);
        searches.set(key, r);
      }
    }
    const searchList = [...searches.values()].sort((a, b) => b.n - a.n);
    return {
      chart,
      people: people.size,
      visitCount,
      viewCount: sum(Object.fromEntries(views)),
      actionCount: sum(Object.fromEntries(actions)),
      views: sorted(views),
      actions: sorted(actions),
      time,
      sectionPeople,
      searches: searchList.filter((x) => x.found > 0).slice(0, 30),
      misses: searchList.filter((x) => x.found === 0).slice(0, 30),
      persons: [...persons.values()].sort((a, b) => b.last - a.last),
    };
  }, [dayDocs, visits, days, dev, loadedAt]);

  const chartMax = Math.max(1, ...(s?.chart.map((c) => c.visits) ?? [1]));
  const sel = s?.persons.find((p) => p.nick === person) ?? null;

  return (
    <main className={styles.statsPage}>
      <div className={styles.head}>
        <h1>Статистика сайта</h1>
        <p className="faint small">
          Кто заходит, какие разделы открывает и что делает. Подробные заходы хранятся 90 дней (старые удаляются при
          открытии этой страницы), дневные счётчики — всегда. Не считаются: dev-сервер, ник ClaudeTest и браузеры с
          флажком ниже.
        </p>
      </div>

      <div className={styles.bar}>
        <Segmented value={days} onChange={setDays} options={PERIODS.map((p) => ({ value: p.days, label: p.label }))} />
        {import.meta.env.DEV && (
          <label className={cx(styles.check, 'small')}>
            <input type="checkbox" checked={dev} onChange={(e) => setDev(e.target.checked)} /> проверочные (dev)
          </label>
        )}
        <Button variant="ghost" className="small" onClick={() => void load()} title="Обновить">
          <RefreshCw size={14} /> Обновить
        </Button>
        <span className="grow" />
        <label className={cx(styles.check, 'small')}>
          <input type="checkbox" checked={off} onChange={(e) => toggleOff(e.target.checked)} /> не считать меня в этом
          браузере
        </label>
      </div>

      {error && <div className={styles.error}>Не загрузилось: {error}</div>}
      {!s && !error && <div className="empty">Загружаю…</div>}

      {s && (
        <>
          <div className={styles.tiles}>
            <Tile label="Людей" value={s.people} />
            <Tile label="Заходов" value={s.visitCount} />
            <Tile label="Просмотров разделов" value={s.viewCount} />
            <Tile label="Действий" value={s.actionCount} />
          </div>

          <section className={styles.card}>
            <h2>Заходы по дням</h2>
            <div className={styles.chart} role="img" aria-label="Заходы по дням">
              {s.chart.map((c) => (
                <div
                  key={c.t}
                  className={cx(styles.col, !c.inPeriod && styles.out)}
                  title={`${new Date(c.t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}: заходов ${c.visits}, людей ${c.people}, просмотров ${c.views}`}
                >
                  <span className={styles.colN}>{c.visits || ''}</span>
                  <div className={styles.colBar} style={{ height: `${(c.visits / chartMax) * 100}%` }} />
                  <span className={styles.colD}>{new Date(c.t).getDate()}</span>
                </div>
              ))}
            </div>
          </section>

          <div className={styles.grid}>
            <section className={styles.card}>
              <h2>Разделы</h2>
              <Table
                head={['Раздел', 'Просмотров', 'Людей', 'Время']}
                rows={s.views.map(([k, n]) => [
                  sectionLabel(k),
                  n,
                  s.sectionPeople.get(k)?.size ?? 0,
                  s.time.get(k) ? fmtDuration(s.time.get(k)!) : '—',
                ])}
              />
            </section>
            <section className={styles.card}>
              <h2>Действия</h2>
              <Table head={['Что', 'Раз']} rows={s.actions.map(([k, n]) => [actionLabel(k), n])} />
            </section>
          </div>

          <div className={styles.grid}>
            <section className={styles.card}>
              <h2>Искали и не нашли</h2>
              <Table
                head={['Где', 'Запрос', 'Раз', 'Кто']}
                rows={s.misses.map((r) => [SEARCH_LABEL[r.where] ?? r.where, r.q, r.n, [...r.who].join(', ')])}
              />
            </section>
            <section className={styles.card}>
              <h2>Частые поиски</h2>
              <Table
                head={['Где', 'Запрос', 'Раз', 'Нашлось']}
                rows={s.searches.map((r) => [SEARCH_LABEL[r.where] ?? r.where, r.q, r.n, r.found])}
              />
            </section>
          </div>

          <section className={styles.card}>
            <h2>Люди</h2>
            <Table
              head={['Ник', 'Последний раз', 'Заходов', 'Событий', 'Время', 'Чаще всего']}
              rows={s.persons.map((p) => [
                <button key="nick" className="link-btn" onClick={() => setPerson(p.nick === person ? null : p.nick)}>
                  {p.nick}
                </button>,
                fmtDateTime(p.last),
                p.visits.length,
                p.events,
                fmtDuration(p.time),
                sorted(p.sections)
                  .slice(0, 3)
                  .map(([k]) => sectionLabel(k))
                  .join(', '),
              ])}
              selected={s.persons.findIndex((p) => p.nick === person)}
            />
          </section>

          {sel && (
            <section className={styles.card}>
              <h2>Заходы: {sel.nick}</h2>
              <div className={styles.visits}>
                {sel.visits.map((v) => (
                  <div key={v.id} className={styles.visit}>
                    <button className={styles.visitHead} onClick={() => setOpenVisit(openVisit === v.id ? null : v.id)}>
                      <b>{fmtDateTime(v.startedAt)}</b>
                      <span className="faint">
                        {fmtDuration(v.lastAt - v.startedAt)} · событий {v.events.length} ·{' '}
                        {v.device === 'mobile' ? 'телефон' : 'компьютер'}
                      </span>
                    </button>
                    {openVisit === v.id && (
                      <ol className={styles.timeline}>
                        {[...v.events]
                          .sort((a, b) => a.t - b.t)
                          .map((e) => (
                            <li key={e.i} className={`k-${e.k}`}>
                              <span className="faint mono">{fmtTime(e.t)}</span> {eventText(e)}
                              {(e.k === 'view' || e.k === 'act') && <span className="faint small"> {e.p}</span>}
                            </li>
                          ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileValue}>{value}</div>
      <div className="faint small">{label}</div>
    </div>
  );
}

function Table({ head, rows, selected = -1 }: { head: string[]; rows: ReactNode[][]; selected?: number }) {
  if (!rows.length) return <div className="faint small">Пока пусто</div>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={i ? 'num' : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cx(i === selected && styles.sel)}>
              {r.map((c, j) => (
                <td key={j} className={j && typeof c === 'number' ? 'num' : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
