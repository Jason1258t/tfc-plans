/**
 * Ссылки в текстах задач разработки: #175 (задача), #175.3 (пункт), doc:12, doc:12#Раздел, note:881.
 * Один разбор на сервер, MCP и сайт (договор — документ 42 трекера). Без зависимостей: файл копируется на VPS вместе
 * с сервером и импортируется сайтом как @tfc/pack-server/dev-refs.
 */

// Код, адреса и готовые ссылки markdown: номера внутри них — не ссылки
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SKIP =
  /(`+)(?!`)[\s\S]*?[^`]\1(?!`)|!?\[[^\]\n]*\]\([^)\n]*\)|\[\[[^\]\n]*\]\]|\b[a-z][a-z0-9+.-]*:\/\/[^\s<>)]+/gi;

const blank = (s) => s.replace(/[^\n]/g, ' ');

/** Текст той же длины, где код и адреса заменены пробелами */
function maskText(text) {
  const out = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null;
      out.push(blank(line));
    } else if (f) {
      fence = f[1];
      out.push(blank(line));
    } else out.push(line);
  }
  return out.join('\n').replace(SKIP, blank);
}

// Слева и справа не буква, не цифра и не часть адреса: «abc#1», «repo#12», «a/doc:3», «#12.3.4», «#ff00», «#123456»
const LEFT = String.raw`(?<![\p{L}\p{N}_#/&=.:@-])`;
const RIGHT = String.raw`(?![\p{L}\p{N}_])`;
const REF = new RegExp(
  String.raw`${LEFT}(?:#(\d{1,5})(?:\.(\d{1,4}))?(?!\.\d)${RIGHT}|doc:(\d{1,6})${RIGHT}(?:#([^\s#][^\n]*))?|note:(\d{1,9})${RIGHT})`,
  'gu',
);
// Раздел идёт до конца предложения, знака препинания, тире или следующей ссылки
const SECTION_END = /[,;:!?()[\]{}«»"'`|*]|\.(?=\s|$)|\s[—–-]\s|\s(?:#\d|doc:\d|note:\d)/u;
const SECTION_TAIL = /\s+(?:и|или|а|но|and|or)$/iu;

function sectionOf(raw) {
  const end = raw.search(SECTION_END);
  const s = (end < 0 ? raw : raw.slice(0, end)).trimEnd();
  return s.replace(SECTION_TAIL, '');
}

/**
 * Ссылки в тексте по порядку: { type: 'task'|'check'|'doc'|'note', task, num, doc, section, note, ref, start, end }.
 * ref — каноническая запись, start/end — положение в исходном тексте.
 */
export function parseRefs(text) {
  if (!text) return [];
  const out = [];
  const masked = maskText(String(text));
  const re = new RegExp(REF);
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    let parsed;
    let len = m[0].length;
    if (m[1]) parsed = m[2] ? { type: 'check', task: +m[1], num: +m[2] } : { type: 'task', task: +m[1] };
    else if (m[5]) parsed = { type: 'note', note: +m[5] };
    else {
      parsed = { type: 'doc', doc: +m[3] };
      const section = m[4] ? sectionOf(m[4]) : '';
      if (section) parsed.section = section;
      len = `doc:${m[3]}`.length + (section ? section.length + 1 : 0);
      // Хвост строки после раздела читаем заново: там может быть следующая ссылка
      re.lastIndex = m.index + len;
    }
    out.push({ ...parsed, ref: formatRef(parsed), start: m.index, end: m.index + len });
  }
  return out;
}

/** Каноническая запись ссылки */
export function formatRef(r) {
  if (r.type === 'task') return `#${r.task}`;
  if (r.type === 'check') return `#${r.task}.${r.num}`;
  if (r.type === 'note') return `note:${r.note}`;
  return r.section ? `doc:${r.doc}#${r.section}` : `doc:${r.doc}`;
}

/** Одна ссылка целиком (dev_open, dev_link): раздел берётся как есть, до конца строки; иначе null */
export function parseRef(s) {
  const v = String(s ?? '').trim();
  let m;
  if ((m = /^#?(\d{1,5})$/.exec(v))) return { type: 'task', task: +m[1] };
  if ((m = /^#?(\d{1,5})\.(\d{1,4})$/.exec(v))) return { type: 'check', task: +m[1], num: +m[2] };
  if ((m = /^note:(\d{1,9})$/.exec(v))) return { type: 'note', note: +m[1] };
  if ((m = /^doc:(\d{1,6})(?:#(.+))?$/.exec(v))) {
    const section = m[2]?.trim();
    return section ? { type: 'doc', doc: +m[1], section } : { type: 'doc', doc: +m[1] };
  }
  return null;
}

/** Заголовки markdown вне блоков кода: { text, level, line } (строки с нуля) */
export function docHeadings(content) {
  const out = [];
  let fence = null;
  String(content ?? '')
    .split('\n')
    .forEach((l, line) => {
      const f = FENCE.exec(l);
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !l.slice(f[0].length).trim()) fence = null;
        return;
      }
      if (f) {
        fence = f[1];
        return;
      }
      const h = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(l);
      if (h) out.push({ text: h[2].trim(), level: h[1].length, line });
    });
  return out;
}

const norm = (s) => s.trim().toLocaleLowerCase('ru');

/**
 * Заголовок по тексту раздела: точное совпадение без учёта регистра; если в тексте после названия шли ещё слова
 * («doc:12#Этап 2 потом проверить») — самый длинный заголовок, с которого раздел начинается.
 * { heading } | { ambiguous: [заголовки] } | null
 */
export function matchSection(headings, section) {
  const want = norm(section);
  const exact = headings.filter((h) => norm(h.text) === want);
  if (exact.length === 1) return { heading: exact[0] };
  if (exact.length > 1) return { ambiguous: exact };
  let best = [];
  for (const h of headings) {
    const n = norm(h.text);
    if (!want.startsWith(`${n} `)) continue;
    if (!best.length || n.length > norm(best[0].text).length) best = [h];
    else if (n.length === norm(best[0].text).length) best.push(h);
  }
  if (best.length === 1) return { heading: best[0] };
  return best.length ? { ambiguous: best } : null;
}

/** Строки раздела: от заголовка до следующего того же уровня или выше */
export function sectionText(content, headings, heading) {
  const next = headings.find((h) => h.line > heading.line && h.level <= heading.level);
  return String(content ?? '')
    .split('\n')
    .slice(heading.line, next?.line)
    .join('\n')
    .trimEnd();
}
