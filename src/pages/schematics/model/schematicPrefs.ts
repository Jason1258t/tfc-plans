import type { Rule } from '@/entities/schematic';

/** Настройки умной замены и открытой панели — в localStorage, как и раньше */
export const RULES_KEY = 'tfc-tm:schematic-rules';
export const DEFAULT_RULES: Rule[] = [
  { from: 'minecraft:', to: 'tfc:' },
  { from: 'oak', to: 'eucalyptus' },
];

export const AGENT_KEY = 'tfc-tm:schematic-agent';
/** Какая панель инструментов открыта: умная замена, избранное или ни одной */
export const PANEL_KEY = 'tfc-tm:schematic-panel';
export type ToolPanel = 'smart' | 'favs' | null;

export interface AgentPrefs {
  enabled: boolean;
  hint: string;
}

export const DEFAULT_AGENT: AgentPrefs = { enabled: true, hint: 'ванильные материалы → аналоги TerraFirmaCraft' };

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* не запомним — не страшно */
  }
}

export function loadRules(): Rule[] {
  try {
    const r = JSON.parse(localStorage.getItem(RULES_KEY) ?? 'null');
    return Array.isArray(r) && r.length ? r : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

export function saveRules(rules: Rule[]) {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    /* не запомним — не страшно */
  }
}
