import type { BotanyMeta } from './botany';
import { useModConfig, type ConfigOrigin, type ModConfig } from './config';

export interface Resolved {
  value: unknown;
  origin: ConfigOrigin;
}

/**
 * Настройки, от которых зависят сроки в ботанике, по слоям, как их видит игра:
 * сохранение мира → serverconfig/ → config/ → значение мода по умолчанию из кода.
 * Какие ключи и в каких файлах искать, приходит из public/botany.json (meta.config) — их нашёл разбор кода мода.
 */
export function useBotanyConfig(meta: BotanyMeta) {
  const cfg = meta.config ?? {};
  const serverFile = cfg.cropGrowthModifier?.file ?? '';
  const commonFile = cfg.defaultMonthLength?.file ?? '';
  const worldFile = cfg.defaultMonthLength?.world?.file ?? cfg.calendarTickRate?.world?.file ?? '';
  // Число хуков постоянно: два файла конфига в двух слоях и сохранение мира
  const docs: Record<string, ModConfig | null | undefined> = {
    [`server|${serverFile}`]: useModConfig(serverFile, 'server'),
    [`config|${serverFile}`]: useModConfig(serverFile, 'config'),
    [`server|${commonFile}`]: useModConfig(commonFile, 'server'),
    [`config|${commonFile}`]: useModConfig(commonFile, 'config'),
    [`world|${worldFile}`]: useModConfig(worldFile, 'world'),
  };
  const read = (scope: string, file: string, key: string): unknown => {
    let v: unknown = docs[`${scope}|${file}`]?.values;
    for (const k of key.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
    return v;
  };

  /** Значение настройки по имени из meta.config; vars подставляются в шаблон ключа ({name}) */
  const get = (name: string, vars: Record<string, string> = {}): Resolved | null => {
    const k = cfg[name];
    if (!k) return null;
    if (k.world) {
      const w = read('world', k.world.file, k.world.key);
      if (w !== undefined) return { value: w, origin: 'world' };
    }
    if (k.file && k.key) {
      const key = k.key.replace(/\{(\w+)\}/g, (_, v: string) => vars[v] ?? '');
      for (const scope of ['server', 'config'] as const) {
        const v = read(scope, k.file, key);
        if (v !== undefined) return { value: v, origin: scope };
      }
    }
    return k.default === null || k.default === undefined ? null : { value: k.default, origin: 'default' };
  };
  const num = (name: string, vars?: Record<string, string>) => {
    const r = get(name, vars);
    return r && typeof r.value === 'number' ? { value: r.value, origin: r.origin } : null;
  };
  return { get, num };
}

export type BotanyConfig = ReturnType<typeof useBotanyConfig>;
