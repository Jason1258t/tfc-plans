/**
 * Как гайды показывают числа: {{выражение | формат}}. Формат — слова через пробел:
 *   число — знаков после запятой (без него — по величине: 1234 → «1 234», 12,3, 1,23, 0,123)
 *   watts — ватты с приставкой (98 304 → «98,3 кВт»), pct — доля в процентах (0,25 → «25 %»)
 *   остальное — единица после числа: {{x | 1 В}} → «12,3 В»
 * Без импортов — проверяется из Node.
 */

export const num = (v: number, digits?: number) => {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '—' : v > 0 ? '∞' : '−∞';
  const d = digits ?? autoDigits(v);
  return (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('ru-RU', { maximumFractionDigits: d });
};

const autoDigits = (v: number) => {
  const a = Math.abs(v);
  return a === 0 || a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
};

/** Ватты с приставкой: 98 304 Вт → «98,3 кВт» */
export const watts = (w: number, digits?: number) =>
  Math.abs(w) >= 10000 ? `${num(w / 1000, digits ?? 1)} кВт` : `${num(w, digits ?? 0)} Вт`;

export interface FormatSpec {
  digits?: number;
  kind?: 'watts' | 'pct';
  unit?: string;
}

export function parseSpec(spec: unknown): FormatSpec {
  const out: FormatSpec = {};
  const unit: string[] = [];
  for (const w of String(spec ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)) {
    if (/^\d+$/.test(w) && out.digits === undefined && unit.length === 0) out.digits = Number(w);
    else if ((w === 'watts' || w === 'pct') && !out.kind) out.kind = w;
    else unit.push(w);
  }
  if (unit.length) out.unit = unit.join(' ');
  return out;
}

/** Значение выражения — в текст для статьи */
export function formatValue(v: unknown, spec: FormatSpec = {}): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (Array.isArray(v)) return v.map((x) => formatValue(x, spec)).join(', ');
  if (typeof v === 'number') {
    if (spec.kind === 'watts') return watts(v, spec.digits);
    const s = spec.kind === 'pct' ? `${num(v * 100, spec.digits ?? 0)} %` : num(v, spec.digits);
    return spec.unit && Number.isFinite(v) ? `${s} ${spec.unit}` : s;
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'function') return '(функция)';
  if (typeof v === 'object' && 'label' in v && typeof (v as { label: unknown }).label === 'string')
    return (v as { label: string }).label;
  return '(объект)';
}

/** «выражение | формат» → части; «||» — это «или», «|» в строке 'a|b' — часть строки */
export function splitSpec(src: string): { expr: string; spec?: string } {
  let quote = '';
  let at = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '|' && src[i - 1] !== '|' && src[i + 1] !== '|') at = i;
  }
  return at < 0 ? { expr: src } : { expr: src.slice(0, at), spec: src.slice(at + 1) };
}

export const TEMPLATE = /\{\{([\s\S]+?)\}\}/g;

/** Склонение: plural(3, 'ротор', 'ротора', 'роторов') → «ротора» */
export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
