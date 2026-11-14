import { useCallback, useEffect, useState } from 'react';
import { BASE, DevError, headers } from './api';

/**
 * Отчёты игроков `tfc report` (логи и краш-репорты) — на сервере сборки (dev #360), не в Firestore:
 * список — GET /reports, файл — GET /reports/:id/content, удалить — DELETE /reports/:id. Вход — как у задач разработки.
 */
export interface Report {
  id: string;
  name: string;
  type: string;
  size: number;
  sha256: string;
  author: string;
  createdAt: number;
  /** задача сайта, к которой приложен отчёт */
  taskId: string | null;
  report: {
    kind: 'crash' | 'log';
    /** вид: game-log, crash-report, debug-log, kubejs-log, jvm-crash, server-log, server-crash */
    type: string;
    label: string;
    note: string;
    /** что внутри (у zip — несколько), путь от папки игры */
    files: { name: string; size: number; mtime: number }[];
    source: 'tfc';
  };
}

async function call(method: string, path: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/reports${path}`, { method, headers: await headers() });
  } catch (e) {
    if (e instanceof DevError) throw e;
    throw new DevError(`Сервер сборки не отвечает (${(e as Error).message})`, 0);
  }
  if (!res.ok) {
    const out = await res.json().catch(() => ({}));
    throw new DevError(`Отчёты: ${out.error ?? `${res.status} ${res.statusText}`}`, res.status);
  }
  return res;
}

/** Кеш переживает переход между вкладками «Краш-репорты» и «Логи» */
let cached: Report[] | null = null;

export function useReports() {
  const [reports, setReports] = useState<Report[] | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const { reports: next } = (await (await call('GET', '')).json()) as { reports: Report[] };
      cached = next;
      setReports(next);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
    const tick = () => document.visibilityState === 'visible' && void reload();
    window.addEventListener('focus', tick);
    return () => window.removeEventListener('focus', tick);
  }, [reload]);
  return { reports: reports ?? [], loading: reports === null && !error, error, reload };
}

export async function downloadReport(r: Report) {
  const blob = await (await call('GET', `/${encodeURIComponent(r.id)}/content`)).blob();
  if (blob.size !== r.size) throw new Error(`Файл «${r.name}» пришёл не целиком: ${blob.size} байт из ${r.size}`);
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = r.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 10_000);
}

export async function removeReport(r: Report) {
  try {
    await call('DELETE', `/${encodeURIComponent(r.id)}`);
  } catch (e) {
    if (!(e instanceof DevError && e.status === 404)) throw e;
  }
  if (cached) cached = cached.filter((x) => x.id !== r.id);
}
