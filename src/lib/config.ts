import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { authReady, db } from '../firebase';

/**
 * Конфиги модов, импортированные скриптом scripts/import-config.mjs (коллекция config, только чтение).
 * Документ config/{scope}__{путь с / → __}: values — разобранный TOML.
 */
export interface ModConfig {
  scope: string;
  path: string;
  mod: string;
  values: Record<string, unknown>;
  sha1: string;
  source: string;
  importedBy: string;
  importedAt: number;
}

export const configId = (path: string, scope = 'server') => `${scope}__${path.replaceAll('/', '__')}`;

/** undefined — загружается, null — не импортирован */
export function useModConfig(path: string, scope = 'server'): ModConfig | null | undefined {
  const [c, setC] = useState<ModConfig | null | undefined>(db ? undefined : null);
  useEffect(() => {
    if (!db) return;
    let unsub = () => {};
    let cancelled = false;
    authReady.then(() => {
      if (cancelled) return;
      unsub = onSnapshot(
        doc(db!, 'config', configId(path, scope)),
        (snap) => setC(snap.exists() ? (snap.data() as ModConfig) : null),
        () => setC(null),
      );
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [path, scope]);
  return c;
}

/** Значение по пути «раздел.ключ» с проверкой типа */
export function configValue<T extends 'number' | 'string' | 'boolean'>(
  c: ModConfig | null | undefined,
  key: string,
  type: T,
): (T extends 'number' ? number : T extends 'string' ? string : boolean) | undefined {
  let v: unknown = c?.values;
  for (const k of key.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
  return typeof v === type ? (v as never) : undefined;
}
