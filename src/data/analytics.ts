import { arrayUnion, collection, doc, increment, Timestamp, writeBatch } from 'firebase/firestore';
import { useEffect } from 'react';
import { auth, authReady, db } from '../firebase';
import { readNick } from '../lib/nick';

/**
 * Статистика сайта: кто заходит, какие разделы открывает, что делает. Своя, в Firestore — без Google Analytics.
 *
 * visits/{id} — один заход (вкладка): ник, uid анонимного входа и лента событий. События копятся в памяти и уходят
 * одной записью раз в 30 с и при уходе со вкладки — так на заход выходит несколько записей, а не сотни.
 * Через 90 дней заход удаляется сам (TTL-политика Firestore по полю expireAt).
 * visitDays/{ГГГГ-ММ-ДД} — дневные счётчики (разделы, действия, ники): графики за месяц стоят 30 чтений.
 *
 * Не считаем: dev-сервер, ник ClaudeTest и браузер с флажком «не считать меня» (страница /stats).
 * Проверить сбор на dev-сервере: localStorage tfc-analytics-dev=1 — заходы помечаются dev, дни пишутся в dev-ГГГГ-ММ-ДД.
 */

export type VisitEventKind = 'view' | 'act' | 'search' | 'hide' | 'show';

export interface VisitEvent {
  /** Порядковый номер в заходе: без него arrayUnion склеил бы одинаковые события */
  i: number;
  /** Время, мс */
  t: number;
  k: VisitEventKind;
  /** Адрес страницы (путь + параметры, обрезан) */
  p: string;
  /** view — раздел; act — действие; search — где искали */
  n?: string;
  /** Подробности: id задачи, текст поиска, число найденного… */
  d?: Record<string, string | number | boolean>;
  /** Сколько раз подряд повторилось (правки документа с автосохранением) */
  c?: number;
}

export interface Visit {
  id: string;
  uid: string;
  nick: string;
  startedAt: number;
  lastAt: number;
  device: 'mobile' | 'desktop';
  events: VisitEvent[];
  dev?: boolean;
}

export interface VisitDay {
  id: string;
  visits?: number;
  views?: Record<string, number>;
  actions?: Record<string, number>;
  searches?: Record<string, number>;
  nicks?: Record<string, number>;
}

const OFF_KEY = 'tfc-analytics-off';
const DEV_KEY = 'tfc-analytics-dev';
const EXCLUDED_NICKS = new Set(['ClaudeTest']);
export const KEEP_DAYS = 90;
/** Больше событий в одном документе не держим: следующие уйдут в новый заход */
export const MAX_EVENTS = 400;
const FLUSH_MS = 30_000;
/** Одинаковое действие на той же странице в течение минуты — один счётчик, а не новая запись */
const COALESCE_MS = 60_000;

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export const analyticsOff = () => flag(OFF_KEY);

export function setAnalyticsOff(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, '1');
    else localStorage.removeItem(OFF_KEY);
  } catch {
    /* без хранилища флажок не запомнить */
  }
}

const devMode = import.meta.env.DEV;
const devForced = devMode && flag(DEV_KEY);

function enabled(): boolean {
  if (!db || analyticsOff()) return false;
  if (devForced) return true;
  if (devMode) return false;
  const nick = readNick();
  return !!nick && !EXCLUDED_NICKS.has(nick);
}

/** Локальная дата ГГГГ-ММ-ДД — ключ дневных счётчиков */
export function dayKey(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${devForced ? 'dev-' : ''}${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Раздел по адресу: первый кусок пути + вкладка (?tab=) */
export function sectionOf(pathname: string, search: string): string {
  const seg = pathname.split('/').filter(Boolean);
  const base = !seg.length ? 'tasks' : seg[0] === 'doc' ? 'doc' : seg[0] === 'addons' && seg[1] ? 'addon' : seg[0];
  const tab = new URLSearchParams(search).get('tab');
  return tab ? `${base}:${tab}` : base;
}

const here = () => (location.pathname + location.search).slice(0, 160);

let visitId = '';
let started = 0;
let seq = 0;
let created = false;
let stored = 0;
let pending: VisitEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

function newVisit() {
  visitId = doc(collection(db!, 'visits')).id;
  started = Date.now();
  created = false;
  stored = 0;
}

function push(e: Omit<VisitEvent, 'i' | 't' | 'p'> & { p?: string }) {
  if (!enabled()) return;
  if (!visitId) newVisit();
  const now = Date.now();
  const p = e.p ?? here();
  const last = pending[pending.length - 1];
  // Тот же просмотр второй раз подряд (повторный эффект React) — не новый просмотр
  if (e.k === 'view' && last?.k === 'view' && last.n === e.n && last.p === p && now - last.t < 2000) return;
  if (
    e.k === 'act' &&
    last?.k === 'act' &&
    last.n === e.n &&
    last.p === p &&
    now - last.t < COALESCE_MS &&
    JSON.stringify(last.d) === JSON.stringify(e.d)
  ) {
    last.c = (last.c ?? 1) + 1;
    last.t = now;
    return;
  }
  pending.push({ ...e, p, i: seq++, t: now });
  if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
}

/** Действие игрока: 'task.create', 'file.download'… Подробности — короткие строки и числа */
export function track(name: string, d?: VisitEvent['d']) {
  push({ k: 'act', n: name, d });
}

/** Поиск: где, что искали и сколько нашлось. Вызывать, когда текст устоялся (useSearchTrack) */
export function trackSearch(where: string, query: string, found: number) {
  const q = query.trim().toLowerCase().slice(0, 80);
  if (q.length < 2) return;
  push({ k: 'search', n: where, d: { q, found } });
}

/**
 * Поиск в поле ввода: записывается, когда текст не меняется 1,5 с (не каждая буква).
 * found — сколько нашлось; undefined — ещё считается, не записываем.
 */
export function useSearchTrack(where: string, query: string, found: number | undefined) {
  useEffect(() => {
    if (found === undefined || query.trim().length < 2) return;
    const t = setTimeout(() => trackSearch(where, query, found), 1500);
    return () => clearTimeout(t);
  }, [where, query, found]);
}

/** Переход в раздел: зовёт App при смене адреса */
export function trackView(pathname: string, search: string) {
  push({ k: 'view', n: sectionOf(pathname, search) });
}

function countersOf(events: VisitEvent[]) {
  const views: Record<string, ReturnType<typeof increment>> = {};
  const actions: Record<string, ReturnType<typeof increment>> = {};
  const searches: Record<string, ReturnType<typeof increment>> = {};
  const add = (m: Record<string, number>, k: string, n: number) => (m[k] = (m[k] ?? 0) + n);
  const v: Record<string, number> = {};
  const a: Record<string, number> = {};
  const s: Record<string, number> = {};
  for (const e of events) {
    if (e.k === 'view' && e.n) add(v, e.n, 1);
    else if (e.k === 'act' && e.n) add(a, e.n, e.c ?? 1);
    else if (e.k === 'search' && e.n) add(s, e.d?.found === 0 ? `${e.n}:пусто` : e.n, 1);
  }
  for (const [k, n] of Object.entries(v)) views[k] = increment(n);
  for (const [k, n] of Object.entries(a)) actions[k] = increment(n);
  for (const [k, n] of Object.entries(s)) searches[k] = increment(n);
  return { views, actions, searches, count: events.length };
}

async function write(events: VisitEvent[]) {
  await authReady;
  const uid = auth?.currentUser?.uid;
  const nick = readNick();
  if (!db || !uid || !nick) return;
  const now = Date.now();
  const batch = writeBatch(db);
  const ref = doc(db, 'visits', visitId);
  if (!created) {
    batch.set(ref, {
      uid,
      nick,
      startedAt: started,
      lastAt: now,
      device: matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop',
      events,
      expireAt: Timestamp.fromMillis(started + KEEP_DAYS * 86_400_000),
      ...(devForced ? { dev: true } : {}),
    });
  } else {
    batch.update(ref, { lastAt: now, nick, events: arrayUnion(...events) });
  }
  const c = countersOf(events);
  batch.set(
    doc(db, 'visitDays', dayKey(now)),
    {
      ...(created ? {} : { visits: increment(1) }),
      views: c.views,
      actions: c.actions,
      searches: c.searches,
      nicks: { [nick]: increment(c.count) },
      updatedAt: now,
    },
    { merge: true },
  );
  await batch.commit();
  created = true;
  stored += events.length;
  if (stored >= MAX_EVENTS - 50) newVisit();
}

/** Отправить накопленное. Ошибки только в консоль: статистика не должна мешать сайту */
export function flush(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (flushing) return flushing.then(() => flush());
  if (!pending.length || !visitId) return Promise.resolve();
  const events = pending.splice(0, MAX_EVENTS - stored);
  flushing = write(events)
    .catch((e) => console.warn('Статистика не записалась:', e))
    .finally(() => {
      flushing = null;
      if (pending.length && !timer) timer = setTimeout(() => void flush(), FLUSH_MS);
    });
  return flushing;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      push({ k: 'hide' });
      void flush();
    } else if (visitId) push({ k: 'show' });
  });
  // Ссылки со скачиванием прямо в странице (аддоны, tfc, мультиблоки) — без правок в каждом месте
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[download]') as HTMLAnchorElement | null;
      if (a)
        track('file.download', {
          name: (a.getAttribute('download') || a.pathname.split('/').pop() || '').slice(0, 80),
        });
    },
    true,
  );
}

/** Для отладки и проверки: что сейчас в буфере и id захода */
export const analyticsDebug = () => ({ visitId, pending: [...pending], created, stored, enabled: enabled() });

// На dev-сервере — доступ из консоли: __analytics.analyticsDebug(), __analytics.flush()
if (devMode) (window as unknown as { __analytics: object }).__analytics = { analyticsDebug, flush };
