import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { authReady, db } from '../firebase';

/**
 * Конфиги модов, импортированные скриптом scripts/serverconfig.mjs (коллекция config, только чтение).
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
    if (!db || !path) return;
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

/** Откуда взято значение настройки: переопределение сервера, конфиг сборки или значение мода по умолчанию */
export type ConfigOrigin = 'world' | 'server' | 'config' | 'default';

export const CONFIG_ORIGIN_LABEL: Record<ConfigOrigin, string> = {
  world: 'сохранение мира сервера',
  server: 'переопределение сервера (serverconfig/)',
  config: 'конфиг сборки (config/)',
  default: 'значение мода по умолчанию, конфиг не импортирован',
};

/**
 * Число из конфига по слоям, как их читает игра: serverconfig/ (scope server) перекрывает config/ (scope config),
 * а если файл не импортирован — значение по умолчанию из кода мода (public/botany.json → meta.config).
 * world — где то же значение лежит в сохранении мира (scripts/world.mjs), оно перекрывает всё.
 */
export function useLayeredNumber(
  file: string | null | undefined,
  key: string | undefined,
  fallback: number,
  world?: { file: string; key: string },
): { value: number; origin: ConfigOrigin } {
  const server = useModConfig(file ?? '', 'server');
  const pack = useModConfig(file ?? '', 'config');
  // То, что мир хранит сам (длина месяца после команды), важнее любого конфига
  const saved = useModConfig(world?.file ?? '', 'world');
  if (world) {
    const w = configValue(saved, world.key, 'number');
    if (w !== undefined) return { value: w, origin: 'world' };
  }
  if (file && key) {
    const s = configValue(server, key, 'number');
    if (s !== undefined) return { value: s, origin: 'server' };
    const c = configValue(pack, key, 'number');
    if (c !== undefined) return { value: c, origin: 'config' };
  }
  return { value: fallback, origin: 'default' };
}
