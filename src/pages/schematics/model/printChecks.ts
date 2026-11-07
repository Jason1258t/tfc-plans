import { getToken } from 'firebase/app-check';
import { useEffect, useSyncExternalStore } from 'react';
import type { PrintSchematic } from '@tfc/core/printCheck';
import { appCheck, auth, authReady, PACK_SERVER_URL, subscribeAccess } from '@/shared/api';

/**
 * Фоновая проверка печати схем пушкой (dev #305): очередь и итоги лежат на сервере сборки (GET /print-checks), печатает
 * стенд на отдельной машине. Firestore не читается. Список обновляется раз в минуту, пока открыта библиотека.
 */

export interface PrintRecord {
  revision: string | null;
  snapshot: string | null;
  addons: string[];
  checkedAt: string;
  schematic: PrintSchematic;
}

export interface PrintItem {
  name: string;
  updatedAt: number | null;
  state: 'queued' | 'running' | 'done';
  position?: number;
  current: PrintRecord | null;
  previous: PrintRecord | null;
}

export interface PrintChecks {
  env: { snapshot: string | null; addons: string[] };
  running: { ids: string[]; stage: string | null; startedAt: number; beatAt: number; timeoutSec: number } | null;
  queued: number;
  items: Record<string, PrintItem>;
}

let data: PrintChecks | null = null;
let error: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function load() {
  try {
    await authReady;
    const idToken = await auth?.currentUser?.getIdToken();
    if (!idToken) return;
    const h: Record<string, string> = { Authorization: `Bearer ${idToken}` };
    if (appCheck) h['X-Firebase-AppCheck'] = (await getToken(appCheck, false)).token;
    const res = await fetch(`${PACK_SERVER_URL}/print-checks`, { headers: h, signal: AbortSignal.timeout(20_000) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error ?? `${res.status}`);
    data = out as PrintChecks;
    error = null;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  emit();
}

let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let unsub = () => {};

/** Состояние проверок; пока хоть один компонент подписан — опрос раз в минуту (только со входом игрока) */
export function usePrintChecks(): { data: PrintChecks | null; error: string | null } {
  useEffect(() => {
    users++;
    if (users === 1) {
      unsub = subscribeAccess((s) => {
        if (s === 'player') load();
      });
      timer = setInterval(load, 60_000);
    }
    return () => {
      users--;
      if (users) return;
      unsub();
      if (timer) clearInterval(timer);
      timer = null;
    };
  }, []);
  const d = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => data,
  );
  return { data: d, error };
}

/** Что показать по схеме: свежий итог, «в проверке» (с прошлым итогом серым) или ничего — сервер ещё не знает */
export function printView(checks: PrintChecks | null, id: string, updatedAt: number) {
  const item = checks?.items[id];
  if (!item) return checks ? { state: 'queued' as const, item: null } : null;
  // Схему правили после того, как сервер её видел (его список кешируется до 5 минут) — она уже ждёт проверки
  if (item.state === 'done' && item.updatedAt != null && updatedAt > item.updatedAt)
    return { state: 'queued' as const, item: { ...item, previous: item.current, current: null } };
  return { state: item.state, item };
}
