import { HelpCircle, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import {
  markOnboardingSeen,
  onboardingLoaded,
  onboardingState,
  resetOnboarding,
  setOnboardingOff,
  subscribeOnboarding,
} from '../data/onboarding';
import { requestTour, tourFor, tourRequests, WELCOME, type Tour, type TourStep } from '../lib/onboarding';
import './Onboarding.css';

/**
 * Подсказки знакомства: сами — при первом входе в раздел (сначала общее знакомство с сайтом), потом — из меню «?»
 * в шапке. Любую можно пропустить, все сразу — выключить. Что уже показано — data/onboarding.
 */

const useOnboarding = () => ({
  state: useSyncExternalStore(subscribeOnboarding, onboardingState),
  loaded: useSyncExternalStore(subscribeOnboarding, onboardingLoaded),
});

/** Ключ страницы для подсказок: сменился — открытые подсказки закрываются */
const pageKey = (pathname: string, search: string) => tourFor(pathname, search)?.key ?? pathname;

export function Onboarding() {
  const { pathname, search } = useLocation();
  const { state, loaded } = useOnboarding();
  const [active, setActive] = useState<{ tour: Tour; page: string } | null>(null);
  const current = tourFor(pathname, search);
  const page = pageKey(pathname, search);

  // Из меню «?»
  useEffect(() => {
    const on = (e: Event) =>
      setActive({ tour: (e as CustomEvent<Tour>).detail, page: pageKey(location.pathname, location.search) });
    tourRequests.addEventListener('tour', on);
    return () => tourRequests.removeEventListener('tour', on);
  }, []);

  // Сами: сначала знакомство с сайтом, потом раздел — каждое один раз
  useEffect(() => {
    if (!loaded || state.off || active) return;
    const next = !state.seen[WELCOME.key] ? WELCOME : current && !state.seen[current.key] ? current : null;
    if (!next) return;
    // Пусть страница дорисуется — цели шагов должны успеть появиться
    const t = setTimeout(() => setActive({ tour: next, page }), 700);
    return () => clearTimeout(t);
  }, [loaded, state, active, current, page]);

  // Ушли на другую страницу — подсказки этой больше не к месту; считаем показанными
  useEffect(() => {
    if (active && active.page !== page) {
      markOnboardingSeen(active.tour.key);
      setActive(null);
    }
  }, [active, page]);

  if (!active) return null;
  return (
    <TourView
      key={active.tour.key}
      tour={active.tour}
      onClose={(off) => {
        markOnboardingSeen(active.tour.key);
        if (off) setOnboardingOff(true);
        setActive(null);
      }}
    />
  );
}

/** Подходящий видимый элемент для шага */
function findTarget(step: TourStep): HTMLElement | null {
  if (!step.target) return null;
  for (const sel of step.target.split(',')) {
    let list: HTMLElement[];
    try {
      list = [...document.querySelectorAll<HTMLElement>(sel.trim())];
    } catch {
      continue;
    }
    const el = list.find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (!step.text || e.innerText.includes(step.text));
    });
    if (el) return el;
  }
  return null;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const same = (a: Box | null, b: Box | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1);

const PAD = 6;
const GAP = 12;

function TourView({ tour, onClose }: { tour: Tour; onClose: (off: boolean) => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  /** Пока цель шага ищется — ничего не показываем, чтобы плашка не прыгала */
  const [ready, setReady] = useState(false);
  /** Открыто модальное окно — подсказка ему не мешает */
  const [paused, setPaused] = useState(false);
  const [size, setSize] = useState({ w: 340, h: 180 });
  const pop = useRef<HTMLDivElement>(null);
  const step = tour.steps[i];
  const last = i === tour.steps.length - 1;

  // Цель шага: ждём её появления (страница могла ещё грузиться), потом следим за положением
  useEffect(() => {
    setReady(false);
    setBox(null);
    let raf = 0;
    let el: HTMLElement | null = null;
    const started = performance.now();
    let scrolled = false;
    const tick = () => {
      setPaused(Boolean(document.querySelector('.modal-backdrop')));
      if (step.target && (!el || !el.isConnected)) el = findTarget(step);
      if (el) {
        if (!scrolled) {
          scrolled = true;
          const r = el.getBoundingClientRect();
          if (r.top < 70 || r.bottom > innerHeight - 20) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        const r = el.getBoundingClientRect();
        const next = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
        setBox((b) => (same(b, next) ? b : next));
        setReady(true);
      } else if (!step.target || performance.now() - started > 2500) {
        // Цели нет (или так и не появилась) — шаг посередине экрана
        setBox(null);
        setReady(true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useLayoutEffect(() => {
    if (!pop.current) return;
    const r = pop.current.getBoundingClientRect();
    setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
  }, [i, box, ready, paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused) return;
      if (e.key === 'Escape') onClose(false);
      else if (e.key === 'ArrowRight') {
        if (last) onClose(false);
        else setI((x) => x + 1);
      } else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last, onClose, paused]);

  if (paused) return null;

  const vw = document.documentElement.clientWidth;
  const vh = innerHeight;
  const narrow = vw < 600;
  let style: React.CSSProperties;
  if (narrow) style = { left: 12, right: 12, bottom: 12 };
  else if (!box) style = { left: (vw - size.w) / 2, top: Math.max(16, (vh - size.h) / 2) };
  else {
    const left = Math.min(Math.max(16, box.left + box.width / 2 - size.w / 2), vw - size.w - 16);
    const below = box.top + box.height + GAP;
    const above = box.top - GAP - size.h;
    const top =
      below + size.h <= vh - 16 ? below : above >= 16 ? above : Math.max(16, Math.min(vh - size.h - 16, below));
    style = { left, top };
  }

  return createPortal(
    <div className={`tour${ready ? '' : ' tour-wait'}`}>
      <div
        className={`tour-spot${box ? '' : ' tour-spot-none'}`}
        style={box ? { top: box.top, left: box.left, width: box.width, height: box.height } : undefined}
      />
      <div ref={pop} className="tour-pop" style={style} role="dialog" aria-label={step.title}>
        <div className="tour-head">
          <b className="grow">{step.title}</b>
          {tour.steps.length > 1 && (
            <span className="faint small">
              {i + 1} / {tour.steps.length}
            </span>
          )}
          <button className="btn ghost sm icon" onClick={() => onClose(false)} aria-label="Закрыть подсказки">
            <X size={15} />
          </button>
        </div>
        <p className="tour-body">{step.body}</p>
        {last && tour.guide && (
          <p className="small tour-more">
            Подробнее — в гайде{' '}
            <Link to={`/reference?tab=guides&sub=site&g=${tour.guide}`} onClick={() => onClose(false)}>
              «О сайте»
            </Link>
          </p>
        )}
        <div className="tour-foot">
          <span className="grow" />
          {!last && (
            <button className="btn ghost sm" onClick={() => onClose(false)}>
              Пропустить
            </button>
          )}
          {i > 0 && (
            <button className="btn sm" onClick={() => setI(i - 1)}>
              Назад
            </button>
          )}
          <button className="btn primary sm" autoFocus onClick={() => (last ? onClose(false) : setI(i + 1))}>
            {last ? 'Понятно' : 'Далее'}
          </button>
        </div>
        <button className="tour-off small faint" onClick={() => onClose(true)}>
          Больше не показывать подсказки
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Кнопка «?» в шапке: подсказки раздела и знакомство заново, включить/выключить */
export function OnboardingMenu() {
  const { pathname, search } = useLocation();
  const { state } = useOnboarding();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = tourFor(pathname, search);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const run = (t: Tour) => {
    setOpen(false);
    requestTour(t);
  };

  return (
    <div className="tour-menu-wrap" ref={ref}>
      <button
        className="btn ghost sm icon"
        data-tour="help"
        aria-label="Подсказки"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <HelpCircle size={16} />
      </button>
      {open && (
        <div className="tour-menu" role="menu">
          {current && (
            <button role="menuitem" onClick={() => run(current)}>
              Подсказки раздела «{current.label}»
            </button>
          )}
          <button role="menuitem" onClick={() => run(WELCOME)}>
            Знакомство с сайтом
          </button>
          <Link role="menuitem" to="/reference?tab=guides&sub=site" onClick={() => setOpen(false)}>
            Гайды «О сайте»
          </Link>
          <hr />
          <label className="tour-menu-check">
            <input type="checkbox" checked={!state.off} onChange={(e) => setOnboardingOff(!e.target.checked)} />
            Показывать подсказки в новых разделах
          </label>
          <button
            role="menuitem"
            className="faint"
            onClick={() => {
              setOpen(false);
              resetOnboarding();
            }}
          >
            Показать все подсказки заново
          </button>
        </div>
      )}
    </div>
  );
}
