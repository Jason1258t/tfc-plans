/**
 * Общее для инструментов MCP: короткий текст ответа, страницы списков, названия по id, схемы входа.
 * Новые инструменты — в tools/<раздел>.mjs (export const TOOLS), они собираются в tools.mjs.
 */
import { itemName, tags } from './data.mjs';

export const MAX = 20000;

export const norm = (s) => String(s).toLowerCase().replaceAll('ё', 'е');
export const words = (q) =>
  norm(q ?? '')
    .split(/\s+/)
    .filter(Boolean);
export const short = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function clip(text) {
  return text.length > MAX
    ? `${text.slice(0, MAX)}\n… обрезано: ещё ${text.length - MAX} симв. Сузьте запрос (фильтр, limit, offset).`
    : text;
}

/** Страница списка: строка-итог + строки; страница кончается и по limit, и по объёму (MAX) — тогда «дальше» раньше */
export function page(list, args, fmt, defLimit = 20) {
  const offset = Math.max(0, Number(args.offset ?? 0) | 0);
  const limit = Math.min(200, Math.max(1, Number(args.limit ?? defLimit) | 0));
  const lines = [];
  let size = 0;
  let end = offset;
  for (; end < Math.min(list.length, offset + limit); end++) {
    const part = fmt(list[end], end);
    const add = part.reduce((n, l) => n + l.length + 1, 0);
    if (end > offset && size + add > MAX - 300) break;
    lines.push(...part);
    size += add;
  }
  const head = !list.length
    ? 'Ничего не найдено.'
    : `Всего ${list.length}; показаны ${offset + 1}–${end}${end < list.length ? `; дальше: offset=${end}` : ''}.`;
  return [head, ...lines].join('\n');
}

/** «tfc:metal/ingot/copper «Медный слиток»» — id с названием, если оно есть */
export const named = (ref) => {
  if (ref.startsWith('#')) return ref;
  const n = itemName(ref) ?? tags().fluids.get(ref)?.r ?? tags().fluids.get(ref)?.e;
  return n ? `${ref} «${n}»` : ref;
};

/** Название предмета или жидкости по id, иначе пусто */
export const nameOf = (id) => {
  const f = tags().fluids.get(id);
  return itemName(id) ?? (f ? `${f.r ?? ''} ${f.e}` : '');
};

export const dateOf = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '?');

export const str = (description) => ({ type: 'string', description });
export const num = (description) => ({ type: 'integer', description });
export const paging = { limit: num('сколько записей (по умолчанию 20)'), offset: num('с какой записи (для «дальше»)') };
