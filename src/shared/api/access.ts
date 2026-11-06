import { getToken } from 'firebase/app-check';
import { onIdTokenChanged, signOut } from 'firebase/auth';
import { create } from 'zustand';
import { appCheck, auth, authReady, firebaseEnabled } from './firebase';

/**
 * Доступ по ключу игрока (dev #281). Сайт входит в Firebase анонимно; ключ сервера сборки (`tfc_…`, его выдаёт хост
 * командой `tfc admin invite <ник>`) сервер сборки обменивает на отметку `player` у этого анонимного пользователя
 * (POST /site/login). Сам ключ браузер не хранит. Без отметки правила Firestore пускают только читать справку:
 * задачи, планы и любые правки закрыты; здесь — то же для интерфейса.
 */

/** Адрес сервера сборки; VITE_DEV_API — другой (свой сервер при разработке) */
export const PACK_SERVER_URL = (import.meta.env.VITE_DEV_API?.trim() || 'https://tfc-pack.duckdns.org:28788').replace(
  /\/+$/,
  '',
);

export type AccessStatus = 'loading' | 'guest' | 'player';

interface AccessState {
  status: AccessStatus;
  /** Имя ключа, которым вошли */
  keyName: string | null;
  /** Открыт ли запрос ключа (кнопка, которой нужен ключ, или «Войти с ключом» в шапке) */
  asking: boolean;
  /** Что именно просили сделать — подпись в окне ключа */
  reason: string | null;
}

/** Без Firebase (локальный режим) всё хранится в этом браузере — ключ не нужен */
const accessStore = create<AccessState>(() => ({
  status: firebaseEnabled ? 'loading' : 'player',
  keyName: null,
  asking: false,
  reason: null,
}));

async function readClaims() {
  await authReady;
  const result = await auth?.currentUser?.getIdTokenResult();
  const player = result?.claims.player === true;
  accessStore.setState({
    status: player ? 'player' : 'guest',
    keyName: player && typeof result?.claims.keyName === 'string' ? result.claims.keyName : null,
  });
}

if (auth) {
  onIdTokenChanged(auth, () => {
    readClaims().catch((e) => {
      console.warn('Не удалось прочитать вход:', e);
      accessStore.setState({ status: 'guest', keyName: null });
    });
  });
}

export const useAccess = () => accessStore((s) => s.status);
export const useKeyName = () => accessStore((s) => s.keyName);
/** Открыт ли запрос ключа и зачем: [asking, reason] — отдельные значения, чтобы селектор не создавал объект */
export const useKeyRequest = (): [boolean, string | null] => [
  accessStore((s) => s.asking),
  accessStore((s) => s.reason),
];

/** Есть ли право сохранять (пока вход не прочитан — нет) */
export const isPlayer = () => accessStore.getState().status === 'player';

/** Подписка на смену доступа: сразу текущий, если он уже известен */
export function subscribeAccess(cb: (status: AccessStatus) => void) {
  const current = accessStore.getState().status;
  if (current !== 'loading') cb(current);
  return accessStore.subscribe((s, prev) => {
    if (s.status !== prev.status && s.status !== 'loading') cb(s.status);
  });
}

/** Открыть окно ключа; reason — что человек пытался сделать */
export function requestKey(reason?: string) {
  accessStore.setState({ asking: true, reason: reason ?? null });
}

export function closeKeyRequest() {
  accessStore.setState({ asking: false, reason: null });
}

/** Сохранение без ключа: открываем окно ключа и прерываем операцию */
export class KeyRequiredError extends Error {
  constructor() {
    super('Нужен ключ игрока');
    this.name = 'KeyRequiredError';
  }
}

// Кнопка без своей обработки ошибок: отказ из-за ключа уже показан окном ключа
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason instanceof KeyRequiredError) e.preventDefault();
});

/** Перед записью: есть ключ — ничего, нет — окно ключа и KeyRequiredError */
export function requirePlayer(reason?: string) {
  if (isPlayer()) return;
  requestKey(reason);
  throw new KeyRequiredError();
}

async function appCheckHeader(): Promise<Record<string, string>> {
  return appCheck ? { 'X-Firebase-AppCheck': (await getToken(appCheck, false)).token } : {};
}

/** Войти ключом: сервер сборки ставит отметку, затем перечитываем токен. Ошибка — текст для человека. */
export async function loginWithKey(key: string) {
  await authReady;
  const user = auth?.currentUser;
  if (!user) throw new Error('Нет входа на сайт — обновите страницу');
  const k = key.trim();
  if (!/^tfc_\S{10,}$/.test(k)) throw new Error('Ключ начинается с tfc_ — скопируйте его целиком');
  let res: Response;
  try {
    res = await fetch(`${PACK_SERVER_URL}/site/login`, {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}`, ...(await appCheckHeader()) },
      body: JSON.stringify({ idToken: await user.getIdToken() }),
    });
  } catch (e) {
    throw new Error(`Сервер сборки не отвечает (${(e as Error).message})`);
  }
  if (res.status === 401 && !(await res.clone().text()).includes('Вход сайта'))
    throw new Error('Ключ не подошёл — проверьте его или попросите новый у хоста');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Сервер сборки ответил ${res.status}`);
  }
  await user.getIdToken(true);
  await readClaims();
  closeKeyRequest();
}

/** Выйти: снять отметку на сервере (если не вышло — не страшно) и начать новый анонимный вход */
export async function logout() {
  await authReady;
  const user = auth?.currentUser;
  if (!user) return;
  try {
    await fetch(`${PACK_SERVER_URL}/site/logout`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(await appCheckHeader()) },
    });
  } catch (e) {
    console.warn('Отметка входа не снята:', e);
  }
  await signOut(auth!);
  // Новый анонимный вход и чистые подписки — проще всего с перезагрузки
  location.reload();
}

/**
 * Источник списка только для игрока: гостю — пустой список, после входа ключом — подписка.
 * Так задачи и планы не просят у Firestore данные, которые правила всё равно не отдадут.
 */
export function playerOnly<T>(
  source: (onItems: (items: T[]) => void, onError: (e: Error) => void) => () => void,
): (onItems: (items: T[]) => void, onError: (e: Error) => void) => () => void {
  return (onItems, onError) => {
    let stop = () => {};
    const unsubscribe = subscribeAccess((status) => {
      stop();
      if (status === 'player') stop = source(onItems, onError);
      else {
        stop = () => {};
        onItems([]);
      }
    });
    return () => {
      unsubscribe();
      stop();
    };
  };
}
