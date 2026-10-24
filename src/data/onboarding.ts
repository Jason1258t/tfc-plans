import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, authReady, db } from '@/shared/api';

/**
 * Какие подсказки знакомства уже показаны: Firestore onboarding/{uid} — uid анонимного входа, то есть свой документ
 * у каждого браузера. Копия в localStorage — чтобы решить сразу, без ожидания базы, и для режима без Firebase.
 */

export interface OnboardingState {
  /** Ключ подсказок раздела → когда показаны (закончены или пропущены) */
  seen: Record<string, number>;
  /** «Больше не показывать подсказки» — сами не появляются, но открываются кнопкой «?» */
  off: boolean;
}

const LOCAL_KEY = 'tfc-onboarding';
const empty = (): OnboardingState => ({ seen: {}, off: false });

function readLocal(): OnboardingState {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null');
    if (v && typeof v === 'object') return { seen: v.seen ?? {}, off: Boolean(v.off) };
  } catch {
    /* нет доступа к хранилищу — начнём с пустого */
  }
  return empty();
}

function writeLocal(s: OnboardingState) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
  } catch {
    /* не запомним в браузере — останется в базе */
  }
}

let state: OnboardingState = readLocal();
/** false — ещё не сверились с базой: самим подсказки пока не показываем, вдруг их уже видели */
let loaded = !db;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export const onboardingState = () => state;
export const onboardingLoaded = () => loaded;

export function subscribeOnboarding(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

async function ref() {
  await authReady;
  const uid = auth?.currentUser?.uid;
  return db && uid ? doc(db, 'onboarding', uid) : null;
}

// Сверка с базой при запуске: показанное где угодно (в базе или в этом браузере) считается показанным
if (db)
  ref()
    .then(async (r) => {
      if (!r) return;
      const snap = await getDoc(r);
      const remote = (snap.data() as Partial<OnboardingState> | undefined) ?? {};
      state = { seen: { ...(remote.seen ?? {}), ...state.seen }, off: Boolean(remote.off) || state.off };
      writeLocal(state);
    })
    .catch((e) => console.warn('Подсказки: не удалось прочитать, что уже показано', e))
    .finally(() => {
      loaded = true;
      emit();
    });

function save(next: OnboardingState) {
  state = next;
  writeLocal(state);
  emit();
  ref()
    .then((r) => r && setDoc(r, { ...state, updatedAt: Date.now() }))
    .catch((e) => console.warn('Подсказки: не удалось сохранить', e));
}

export const markOnboardingSeen = (key: string) =>
  state.seen[key] ? undefined : save({ ...state, seen: { ...state.seen, [key]: Date.now() } });

export const setOnboardingOff = (off: boolean) => save({ ...state, off });

/** Показать всё заново, как в первый раз */
export const resetOnboarding = () => save(empty());
