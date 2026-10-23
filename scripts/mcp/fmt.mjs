/**
 * Общее для инструментов MCP: короткий текст ответа, страницы списков, названия по id, схемы входа.
 * Новые инструменты — в tools/<раздел>.mjs (export const TOOLS), они собираются в tools.mjs.
 */
import { itemName, tags } from './data.mjs';

export const MAX = 20000;

/** Подпись записей в базу сайта: имя агента (Claude, Codex…) из TFC_AGENT_NICK */
export const NICK = process.env.TFC_AGENT_NICK?.trim() || 'Claude';

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
export const paging = { limit: num('how many records (default 20)'), offset: num('start offset (for «дальше»)') };

/**
 * Регулярка из запроса агента. Регистр и так не учитывается; встроенные флаги в начале, как в Java/PCRE
 * («(?i)…», «(?s)…»), JS не понимает — снимаем и переводим в флаги. Ошибка — с понятным текстом.
 */
export function userRegex(q, flags = 'i') {
  let s = String(q ?? '');
  let f = flags;
  for (let m; (m = s.match(/^\(\?([imsx]+)\)/)); s = s.slice(m[0].length))
    for (const c of m[1]) if ('ms'.includes(c) && !f.includes(c)) f += c;
  try {
    return new RegExp(s, f);
  } catch (e) {
    throw new Error(`регулярка «${q}» не разобралась: ${e.message.replace(/^Invalid regular expression: /, '')}`);
  }
}

/**
 * Проверка строки по запросу: regex — регулярка (userRegex); иначе «a|b» — любая из частей, часть — подстрока
 * (или все слова части, если words=true). Без учёта регистра и «ё».
 */
export function textTest(q, { regex = false, words: byWords = false } = {}) {
  if (regex) {
    const re = userRegex(q);
    return (s) => re.test(s);
  }
  const alts = String(q ?? '')
    .split('|')
    .map((x) => (byWords ? words(x) : [norm(x.trim())]).filter(Boolean))
    .filter((x) => x.length);
  if (!alts.length) return null;
  return (s) => {
    const n = norm(s);
    return alts.some((ws) => ws.every((w) => n.includes(w)));
  };
}
