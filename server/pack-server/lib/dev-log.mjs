/**
 * Журнал и документы задач разработки: листание журнала, поиск по задачам, журналу и документам, точечная правка и
 * чтение документа по разделам (dev #193, договор — план 42). Подключается в route() из dev.mjs.
 * Поиск — перебор в JS, а не SQL: lower() в SQLite не знает кириллицу, а база маленькая (единицы МБ, запрос — мс).
 */
import { HttpError } from './util.mjs';

const NOTE_KINDS = ['note', 'status', 'report'];
const FIND_KINDS = ['task', 'note', 'doc'];
const SNIPPET = 90;

const bad = (msg) => new HttpError(400, msg);

/** Неизвестные поля — ошибка, а не молчаливый пропуск */
function known(names, allowed, where) {
  const extra = names.filter((k) => !allowed.includes(k));
  if (extra.length) throw bad(`${where}: неизвестные поля ${extra.join(', ')}. Есть: ${allowed.join(', ') || 'нет'}`);
}

function limitOf(v, dflt, max) {
  if (v === null || v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad('limit — целое больше 0');
  return Math.min(n, max);
}

function listOf(v, name, allowed) {
  const out = (v ?? '').split(',').filter(Boolean);
  const wrong = out.filter((x) => !allowed.includes(x));
  if (wrong.length) throw bad(`${name} — из: ${allowed.join(', ')} (не подходит: ${wrong.join(', ')})`);
  return out;
}

// ---------------------------------------------------------------- поиск по словам

/** Без учёта регистра и ё; длина строки сохраняется, поэтому позиции годятся для исходного текста */
const fold = (s) => s.toLowerCase().replaceAll('ё', 'е');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Запрос → слова. «#19» не должно находить #193, поэтому такие слова ищутся с границей */
function matcher(query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const test = words.map((w) => (/^#\d+$/.test(w) ? new RegExp(`${w}(?!\\d)`) : new RegExp(escapeRe(w))));
  const every = (hay) => test.every((re) => re.test(hay));
  const phrase = words.join(' ');
  // Место для отрывка: вся фраза, если она есть, иначе самое раннее слово
  const first = (hay) => {
    const at = hay.indexOf(phrase);
    return at >= 0 ? at : Math.min(...test.map((re) => hay.search(re)).filter((i) => i >= 0));
  };
  return { words, every, first, phrase };
}

/** Короткий отрывок вокруг позиции */
function snippet(text, at) {
  const from = Math.max(0, at - SNIPPET);
  const to = Math.min(text.length, at + SNIPPET);
  const s = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${s}${to < text.length ? '…' : ''}`;
}

// ---------------------------------------------------------------- разделы markdown

const headingKey = (s) => fold(s.trim().replace(/\s+/g, ' '));

/** Заголовки документа: [{ level, text, line }] (line — с нуля); внутри блоков кода заголовков нет */
export function outlineOf(lines) {
  const out = [];
  let fence = null;
  lines.forEach((l, line) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const h = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(l);
    if (h) out.push({ level: h[1].length, text: h[2].trim(), line });
  });
  return out;
}

const outlineText = (list) => list.map((h) => `${h.text} (строка ${h.line + 1})`).join('; ');

/** Раздел по тексту заголовка: { heading, start, end } — от заголовка до следующего такого же или старше */
function sectionOf(lines, outline, heading) {
  const key = headingKey(String(heading).replace(/^#+\s*/, ''));
  const found = outline.filter((h) => headingKey(h.text) === key);
  if (!found.length)
    throw bad(`Раздела «${heading}» нет. Разделы: ${outlineText(outline) || 'в документе нет заголовков'}`);
  if (found.length > 1)
    throw bad(
      `Разделов «${heading}» несколько: ${outlineText(found)}. Для точной правки — dev_doc_edit, чтение — offset`,
    );
  const h = found[0];
  const next = outline.find((x) => x.line > h.line && x.level <= h.level);
  return { heading: h, start: h.line, end: next ? next.line : lines.length };
}

/** Ссылка на место в документе: doc:12#Раздел, если заголовок единственный, иначе просто doc:12 */
function docRef(id, outline, line) {
  let at = null;
  for (const h of outline) if (h.line <= line) at = h;
  const unique = at && outline.filter((h) => headingKey(h.text) === headingKey(at.text)).length === 1;
  return unique ? `doc:${id}#${at.text}` : `doc:${id}`;
}

// ---------------------------------------------------------------- маршруты

/**
 * Маршруты журнала и документов. deps — то, что живёт в openDev: база, чтение задачи и документа, вид записи и
 * документа в ответе, предел размера документа и журнала.
 */
export function devLogRoutes({ db, getTask, getDoc, noteOut, docOut, limits, checkTexts }) {
  const q = {
    notes: db.prepare('select * from notes where task_id = ? order by id desc'),
    allNotes: db.prepare(
      `select n.*, t.title task_title from notes n join tasks t on t.id = n.task_id
       where n.kind != 'status' order by n.id desc`,
    ),
    allTasks: db.prepare('select * from tasks order by id desc'),
    allDocs: db.prepare('select * from docs order by updated_at desc'),
    saveDoc: db.prepare('update docs set content = ?, updated_at = ?, rev = rev + 1 where id = ?'),
  };

  /** Журнал задачи: новые записи ищутся первыми, в ответе — по времени; листание назад через before */
  function taskNotes(id, params) {
    known([...params.keys()], ['before', 'limit', 'kind', 'q'], 'журнал');
    const t = getTask(id);
    const raw = params.get('before');
    const before = raw === null ? null : Number(String(raw).replace(/^note:/, ''));
    if (before !== null && (!Number.isInteger(before) || before <= 0)) throw bad('before — id записи (note:<id>)');
    const limit = limitOf(params.get('limit'), 20, 200);
    const kinds = listOf(params.get('kind'), 'kind', NOTE_KINDS);
    const m = matcher(params.get('q') ?? '');
    const rows = q.notes.all(t.id);
    const matched = rows.filter(
      (n) => (!kinds.length || kinds.includes(n.kind)) && (!m.words.length || m.every(fold(n.text))),
    );
    const rest = before === null ? matched : matched.filter((n) => n.id < before);
    const page = rest.slice(0, limit);
    return {
      notes: page.map(noteOut).reverse(),
      total: rows.length,
      matched: matched.length,
      left: rest.length - page.length,
      nextBefore: rest.length > page.length ? page.at(-1).id : null,
    };
  }

  /** Поиск сразу по задачам, журналу и документам */
  function find(params) {
    known([...params.keys()], ['q', 'kinds', 'limit'], 'поиск');
    const m = matcher(params.get('q') ?? '');
    if (!m.words.length) throw bad('q — что искать');
    const kinds = listOf(params.get('kinds'), 'kinds', FIND_KINDS);
    const limit = limitOf(params.get('limit'), 20, 100);
    const want = (k) => !kinds.length || kinds.includes(k);
    const hits = [];

    if (want('task'))
      for (const t of q.allTasks.all()) {
        const checks = checkTexts(t).join('\n');
        const hay = `#${t.id} ${t.title}\n${t.body}\n${t.branch ?? ''}\n${checks}`;
        const f = fold(hay);
        if (!m.every(f)) continue;
        const title = fold(t.title);
        hits.push({
          kind: 'task',
          ref: `#${t.id}`,
          task: t.id,
          title: t.title,
          status: t.status,
          snippet: snippet(hay, m.first(f)),
          at: t.updated_at,
          score: 2 + (m.every(`#${t.id} ${title}`) ? 4 : 0) + (f.includes(m.phrase) ? 1 : 0),
        });
      }
    if (want('note'))
      for (const n of q.allNotes.all()) {
        const f = fold(n.text);
        if (!m.every(f)) continue;
        hits.push({
          kind: 'note',
          ref: `note:${n.id}`,
          task: n.task_id,
          title: n.task_title,
          noteKind: n.kind,
          author: n.author,
          snippet: snippet(n.text, m.first(f)),
          at: n.created_at,
          score: (n.kind === 'report' ? 1 : 0) + (f.includes(m.phrase) ? 1 : 0),
        });
      }
    if (want('doc'))
      for (const d of q.allDocs.all()) {
        const f = fold(d.content);
        if (!m.every(`${fold(d.title)}\n${f}`)) continue;
        // Все слова могли совпасть только в названии: тогда отрывок — начало документа
        const pos = m.first(f);
        const at = Number.isFinite(pos) ? pos : 0;
        const lines = d.content.split('\n');
        const line = d.content.slice(0, at).split('\n').length - 1;
        hits.push({
          kind: 'doc',
          ref: docRef(d.id, outlineOf(lines), line),
          doc: d.id,
          task: d.task_id,
          title: d.title,
          line: line + 1,
          snippet: snippet(d.content, at),
          at: d.updated_at,
          score: 2 + (m.every(fold(d.title)) ? 4 : 0) + (f.includes(m.phrase) ? 1 : 0),
        });
      }

    hits.sort((a, b) => b.score - a.score || b.at - a.at);
    const counts = Object.fromEntries(FIND_KINDS.map((k) => [k, hits.filter((h) => h.kind === k).length]));
    return { results: hits.slice(0, limit), total: hits.length, counts };
  }

  /** Список документов: по задаче («-» — без задачи) и по словам в названии и тексте */
  function docsList(params) {
    known([...params.keys()], ['task', 'q'], 'список документов');
    const task = params.get('task');
    const m = matcher(params.get('q') ?? '');
    const taskId = !task || task === '-' ? null : getTask(task).id;
    const rows = q.allDocs.all().filter((d) => {
      if (task === '-' ? d.task_id !== null : taskId !== null && d.task_id !== taskId) return false;
      return !m.words.length || m.every(`${fold(d.title)}\n${fold(d.content)}`);
    });
    return { docs: rows.map((d) => docOut({ ...d, size: d.content.length })) };
  }

  /** Чтение документа: оглавление всегда, строки — весь документ или раздел, с offset и limit внутри него */
  function docRead(id, params) {
    known([...params.keys()], ['heading', 'offset', 'limit'], 'чтение документа');
    const d = getDoc(id);
    const lines = d.content.split('\n');
    const outline = outlineOf(lines);
    const heading = params.get('heading');
    const sec = heading ? sectionOf(lines, outline, heading) : { start: 0, end: lines.length };
    const offset = Number(params.get('offset') ?? 0);
    if (!Number.isInteger(offset) || offset < 0) throw bad('offset — целое от 0');
    const from = Math.min(sec.end, sec.start + offset);
    const to = Math.min(sec.end, from + limitOf(params.get('limit'), 400, 5000));
    return {
      doc: docOut({ ...d, size: d.content.length }),
      outline,
      heading: sec.heading?.text ?? null,
      lines: lines.slice(from, to),
      from,
      to,
      offset: to - sec.start,
      end: sec.end,
      total: lines.length,
    };
  }

  function saveDoc(d, content, line) {
    if (content.length > limits.doc) throw bad(`Документ — не длиннее ${limits.doc} символов`);
    if (content !== d.content) q.saveDoc.run(content, Date.now(), d.id);
    const r = getDoc(d.id);
    return { doc: docOut({ ...r, size: r.content.length }), line, changed: content !== d.content };
  }

  /** Замена фрагмента: без baseRev, потому что фрагмент должен встречаться ровно один раз */
  function docEdit(id, b) {
    known(Object.keys(b), ['by', 'old', 'new'], 'правка документа');
    const d = getDoc(id);
    if (typeof b.old !== 'string' || !b.old) throw bad('old — фрагмент, который заменить (не пустой)');
    if (typeof b.new !== 'string') throw bad('new — чем заменить (строка, пустая — удалить)');
    const lineAt = (i) => d.content.slice(0, i).split('\n').length;
    const at = [];
    for (let i = d.content.indexOf(b.old); i >= 0; i = d.content.indexOf(b.old, i + 1)) at.push(i);
    if (!at.length) {
      const head = b.old.split('\n').find((l) => l.trim());
      const near = head ? d.content.indexOf(head) : -1;
      throw bad(
        `Фрагмент не найден в документе ${d.id}.` +
          (near >= 0
            ? ` Его первая строка есть на строке ${lineAt(near)}, дальше текст расходится.`
            : ' Перечитайте документ: dev_doc_get.'),
      );
    }
    if (at.length > 1)
      throw bad(
        `Фрагмент встречается ${at.length} раз (строки ${at.map(lineAt).join(', ')}) — добавьте соседний текст, чтобы он стал единственным`,
      );
    const content = d.content.slice(0, at[0]) + b.new + d.content.slice(at[0] + b.old.length);
    return saveDoc(d, content, lineAt(at[0]));
  }

  /** Дописать в конец документа или в конец раздела (перед следующим заголовком того же уровня или старше) */
  function docAppend(id, b) {
    known(Object.keys(b), ['by', 'text', 'heading'], 'дополнение документа');
    const d = getDoc(id);
    if (typeof b.text !== 'string' || !b.text.trim()) throw bad('text — что дописать (не пустая строка)');
    if (b.heading !== undefined && typeof b.heading !== 'string') throw bad('heading — текст заголовка');
    const add = b.text.replace(/^\n+|\s+$/g, '');
    const lines = d.content.split('\n');
    const end = b.heading ? sectionOf(lines, outlineOf(lines), b.heading).end : lines.length;
    let keep = end;
    while (keep > 0 && !lines[keep - 1].trim()) keep--;
    const before = lines.slice(0, keep);
    const after = lines.slice(end);
    const out = [...before, ...(before.length ? [''] : []), add, ...(after.length ? ['', ...after] : [''])];
    return saveDoc(d, out.join('\n'), before.length + (before.length ? 2 : 1));
  }

  /** Запрос этого модуля → [статус, тело]; не его — null, разбирает route() в dev.mjs */
  return function route(method, parts, params, body) {
    const b = body ?? {};
    const [res, id, sub] = parts;
    if (res === 'find' && !id && method === 'GET') return [200, find(params)];
    if (res === 'tasks' && id && sub === 'notes' && method === 'GET') return [200, taskNotes(id, params)];
    if (res !== 'docs') return null;
    if (!id && method === 'GET') return [200, docsList(params)];
    if (id && sub === 'read' && method === 'GET') return [200, docRead(id, params)];
    if (id && sub === 'edit' && method === 'POST') return [200, docEdit(id, b)];
    if (id && sub === 'append' && method === 'POST') return [200, docAppend(id, b)];
    return null;
  };
}
