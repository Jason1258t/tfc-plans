/**
 * Связи между задачами, пунктами, документами и записями журнала. Источник и цель — канонические ссылки из dev-refs.
 * Виды: mention — найдена в тексте (пересобирается при записи), related и blocks — добавлены явно.
 *
 * Запись текста ловят временные триггеры: они кладут источник в очередь, а чтение связей её разбирает. Так любая
 * новая операция над задачами, журналом и документами попадает в связи без отдельного вызова. Очередь живёт в памяти,
 * поэтому при запуске один раз пересобираются все источники; повторять это безопасно.
 * Цель не обязана существовать: удалённая или неверная ссылка показывается как битая, а запись текста не ломает.
 */
import { docHeadings, formatRef, matchSection, parseRef, parseRefs, sectionText } from './dev-refs.mjs';
import { HttpError } from './util.mjs';

export const LINKS_SCHEMA = `
create table if not exists links (
  id integer primary key autoincrement,
  source text not null,
  target text not null,
  kind text not null,
  author text not null,
  created_at integer not null,
  unique (source, target, kind)
);
create index if not exists links_target on links(target);
`;

const EXPLICIT = ['related', 'blocks'];
const SNIPPET = 90;
const snippet = (s) => {
  const one = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return one.length > SNIPPET ? `${one.slice(0, SNIPPET)}…` : one;
};

const hasTable = (db, name) => !!db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name);

function triggers(db, withChecks) {
  const queue = (name, on, ref) =>
    `create temp trigger ${name} after ${on} begin insert or ignore into links_dirty values (${ref}); end;`;
  const drop = (name, table, where) =>
    `create temp trigger ${name} after delete on ${table} begin delete from links where ${where}; end;`;
  db.exec(`
    create temp table if not exists links_dirty (source text primary key);
    ${queue('links_task_i', 'insert on main.tasks', "'#' || new.id")}
    ${queue('links_task_u', 'update of title, body, checklist on main.tasks', "'#' || new.id")}
    ${queue('links_note_i', 'insert on main.notes', "'note:' || new.id")}
    ${queue('links_note_u', 'update of text on main.notes', "'note:' || new.id")}
    ${queue('links_doc_i', 'insert on main.docs', "'doc:' || new.id")}
    ${queue('links_doc_u', 'update of title, content on main.docs', "'doc:' || new.id")}
    ${drop('links_task_d', 'main.tasks', "source = '#' || old.id or source glob '#' || old.id || '.*'")}
    ${drop('links_note_d', 'main.notes', "source = 'note:' || old.id")}
    ${drop('links_doc_d', 'main.docs', "source = 'doc:' || old.id")}
  `);
  if (withChecks)
    db.exec(`
      ${queue('links_check_i', 'insert on main.checks', "'#' || new.task_id || '.' || new.num")}
      ${queue('links_check_u', 'update of text, removed_at on main.checks', "'#' || new.task_id || '.' || new.num")}
    `);
}

/**
 * Связи поверх открытой базы dev.db. ctx: tx — транзакция из dev.mjs, taskFull(id, notes) — задача для dev_open.
 * Таблицы tasks, notes, docs (и checks, если есть) уже созданы.
 */
export function openLinks(db, { tx, taskFull }) {
  db.exec(LINKS_SCHEMA);
  const withChecks = hasTable(db, 'checks');
  triggers(db, withChecks);

  const q = {
    dirty: db.prepare('select source from links_dirty'),
    clean: db.prepare('delete from links_dirty'),
    mentions: db.prepare("select id, target from links where source = ? and kind = 'mention'"),
    insert: db.prepare('insert or ignore into links (source, target, kind, author, created_at) values (?, ?, ?, ?, ?)'),
    remove: db.prepare('delete from links where id = ?'),
    removeOne: db.prepare('delete from links where source = ? and target = ? and kind = ?'),
    task: db.prepare('select id, title, body, checklist, status, author, created_at from tasks where id = ?'),
    note: db.prepare('select id, task_id, author, kind, text, created_at from notes where id = ?'),
    doc: db.prepare('select id, task_id, title, content, author, created_at, updated_at, rev from docs where id = ?'),
    check: withChecks
      ? db.prepare(
          'select task_id, num, text, done, done_at, done_by, author, created_at, removed_at from checks where task_id = ? and num = ?',
        )
      : null,
    bySource: db.prepare('select * from links where source = ? order by id'),
    byTarget: db.prepare("select * from links where target = ? or target glob ? || '#*' order by id"),
    taskSide: db.prepare(`
      select * from links where
        source = ?1 or source glob ?1 || '.*' or target = ?1 or target glob ?1 || '.*'
        or source in (select 'note:' || id from notes where task_id = ?2)
        or target in (select 'note:' || id from notes where task_id = ?2)
        or source in (select 'doc:' || id from docs where task_id = ?2)
        or target in (select 'doc:' || id from docs where task_id = ?2)
      order by id`),
    taskDocIds: db.prepare('select id from docs where task_id = ?'),
    allTasks: db.prepare('select id from tasks'),
    allNotes: db.prepare('select id from notes'),
    allDocs: db.prepare('select id from docs'),
    allChecks: withChecks ? db.prepare('select task_id, num from checks') : null,
    allLinkSources: db.prepare("select distinct source from links where kind = 'mention'"),
  };

  // ---------------------------------------------------------------- разбор источников

  /** Пункт: { text, done, removed, … } из таблицы или, у старых закрытых задач, из JSON по порядковому номеру */
  function findCheck(taskId, num) {
    const row = q.check?.get(taskId, num);
    if (row)
      return { text: row.text, done: !!row.done, removed: !!row.removed_at, author: row.author, at: row.created_at };
    const t = q.task.get(taskId);
    const it = t && JSON.parse(t.checklist)[num - 1];
    return it ? { text: it.text, done: !!it.done, removed: false, author: t.author, at: t.created_at } : null;
  }

  /** Текст и подпись источника; null — источника нет */
  function sourceText(source) {
    const r = parseRef(source);
    if (r?.type === 'task') {
      const t = q.task.get(r.task);
      if (!t) return null;
      const legacy = JSON.parse(t.checklist).map((c) => c.text);
      return { text: [t.title, t.body, ...legacy].join('\n'), author: t.author, at: t.created_at, owner: t.id };
    }
    if (r?.type === 'note') {
      const n = q.note.get(r.note);
      if (!n) return null;
      return { text: n.kind === 'status' ? '' : n.text, author: n.author, at: n.created_at, owner: n.task_id };
    }
    if (r?.type === 'doc') {
      const d = q.doc.get(r.doc);
      return d && { text: `${d.title}\n${d.content}`, author: d.author, at: d.created_at, owner: null };
    }
    if (r?.type === 'check') {
      const c = q.check?.get(r.task, r.num);
      if (!c) return null;
      return { text: c.removed_at ? '' : c.text, author: c.author, at: c.created_at, owner: r.task };
    }
    return null;
  }

  /** Пересобрать упоминания одного источника: лишние убрать, новые добавить, остальные не трогать */
  function reindex(source) {
    const src = sourceText(source);
    const want = new Set(
      parseRefs(src?.text)
        .map((f) => f.ref)
        .filter((ref) => ref !== source && ref !== (src?.owner ? `#${src.owner}` : '')),
    );
    for (const row of q.mentions.all(source)) if (!want.delete(row.target)) q.remove.run(row.id);
    for (const target of want) q.insert.run(source, target, 'mention', src.author, src.at);
  }

  function flush() {
    const rows = q.dirty.all();
    if (!rows.length) return;
    tx(() => {
      for (const { source } of rows) reindex(source);
      q.clean.run();
    });
  }

  /** Все источники заново: при запуске */
  function rebuild() {
    tx(() => {
      const sources = new Set(q.allLinkSources.all().map((r) => r.source));
      for (const { id } of q.allTasks.all()) sources.add(`#${id}`);
      for (const { id } of q.allNotes.all()) sources.add(`note:${id}`);
      for (const { id } of q.allDocs.all()) sources.add(`doc:${id}`);
      for (const c of q.allChecks?.all() ?? []) sources.add(`#${c.task_id}.${c.num}`);
      for (const s of sources) reindex(s);
      q.clean.run();
    });
  }

  // ---------------------------------------------------------------- показ

  /** Что стоит за ссылкой, кратко: { ref, type, label, broken?, … } */
  function info(ref) {
    const r = parseRef(ref);
    const base = { ref, type: r?.type ?? 'unknown' };
    if (r?.type === 'task') {
      const t = q.task.get(r.task);
      return t ? { ...base, task: t.id, label: t.title, status: t.status } : { ...base, task: r.task, broken: true };
    }
    if (r?.type === 'check') {
      const c = findCheck(r.task, r.num);
      if (!c) return { ...base, task: r.task, broken: true };
      return { ...base, task: r.task, label: snippet(c.text), done: c.done, removed: c.removed };
    }
    if (r?.type === 'note') {
      const n = q.note.get(r.note);
      if (!n) return { ...base, broken: true };
      return { ...base, task: n.task_id, label: `${n.author}: ${snippet(n.text)}` };
    }
    if (r?.type === 'doc') {
      const d = q.doc.get(r.doc);
      if (!d) return { ...base, broken: true };
      const out = { ...base, doc: d.id, task: d.task_id, label: d.title };
      if (!r.section) return out;
      const hit = matchSection(docHeadings(d.content), r.section);
      if (!hit) return { ...out, broken: true, note: 'нет такого раздела' };
      if (hit.ambiguous) return { ...out, note: `заголовков «${r.section}» несколько` };
      return { ...out, label: `${d.title} — ${hit.heading.text}` };
    }
    return { ...base, broken: true };
  }

  const linkOut = (l) => ({
    id: l.id,
    source: info(l.source),
    target: info(l.target),
    kind: l.kind,
    author: l.author,
    createdAt: l.created_at,
  });

  /** Связи задачи, её пунктов, её записей и документов: и исходящие, и входящие */
  function forTask(id) {
    flush();
    const seen = new Set();
    const rows = q.taskSide.all(`#${id}`, id);
    for (const { id: docId } of q.taskDocIds.all(id))
      rows.push(...q.byTarget.all(`doc:${docId}`, `doc:${docId}`).filter((l) => l.target !== `doc:${docId}`));
    return rows
      .filter((l) => !seen.has(l.id) && seen.add(l.id))
      .sort((a, b) => a.id - b.id)
      .map(linkOut);
  }

  /** Исходящие и входящие одного объекта; у задачи и документа входящие считаются и на их пункты и разделы */
  function forRef(ref) {
    flush();
    const r = parseRef(ref);
    if (r.type === 'task') {
      const own = `#${r.task}`;
      const out = db.prepare("select * from links where source = ?1 or source glob ?1 || '.*' order by id").all(own);
      return { out: out.map(linkOut), in: incoming(own, true) };
    }
    if (r.type === 'doc' && r.section) {
      const whole = `doc:${r.doc}`;
      const d = q.doc.get(r.doc);
      const headings = docHeadings(d?.content);
      const mine = matchSection(headings, r.section)?.heading?.line;
      const inc = q.byTarget.all(whole, whole).filter((l) => {
        const t = parseRef(l.target);
        return t.section && matchSection(headings, t.section)?.heading?.line === mine;
      });
      return { out: [], in: inc.map(linkOut) };
    }
    if (r.type === 'doc') {
      const whole = `doc:${r.doc}`;
      return { out: q.bySource.all(whole).map(linkOut), in: q.byTarget.all(whole, whole).map(linkOut) };
    }
    return { out: q.bySource.all(formatRef(r)).map(linkOut), in: incoming(formatRef(r), false) };
  }

  function incoming(ref, withItems) {
    const rows = withItems
      ? db.prepare("select * from links where target = ?1 or target glob ?1 || '.*' order by id").all(ref)
      : db.prepare('select * from links where target = ? order by id').all(ref);
    return rows.map(linkOut);
  }

  /** Содержимое по ссылке для dev_open; не нашлось — 404 с понятным текстом */
  function open(rawRef) {
    const r = parseRef(rawRef);
    if (!r) throw new HttpError(400, 'ref — одна из форм: #175, #175.3, doc:12, doc:12#Раздел, note:881');
    const ref = formatRef(r);
    const missing = (what) => new HttpError(404, `Нет ${what} ${ref} — ссылка битая`);
    if (r.type === 'task') {
      if (!q.task.get(r.task)) throw missing('задачи');
      return { ref, type: r.type, ...taskFull(r.task, 3), linked: forRef(ref) };
    }
    if (r.type === 'check') {
      const t = q.task.get(r.task);
      const c = findCheck(r.task, r.num);
      if (!t || !c) throw missing('пункта');
      const task = { id: t.id, title: t.title, status: t.status };
      return { ref, type: r.type, task, check: { num: r.num, ...c }, linked: forRef(ref) };
    }
    if (r.type === 'note') {
      const n = q.note.get(r.note);
      if (!n) throw missing('записи');
      const t = q.task.get(n.task_id);
      return {
        ref,
        type: r.type,
        task: { id: t.id, title: t.title, status: t.status },
        note: { id: n.id, author: n.author, kind: n.kind, text: n.text, createdAt: n.created_at },
        linked: forRef(ref),
      };
    }
    const d = q.doc.get(r.doc);
    if (!d) throw missing('документа');
    const headings = docHeadings(d.content);
    const doc = {
      id: d.id,
      task: d.task_id,
      title: d.title,
      author: d.author,
      updatedAt: d.updated_at,
      rev: d.rev,
      size: d.content.length,
    };
    const toc = headings.map((h) => ({ text: h.text, level: h.level }));
    if (!r.section) return { ref, type: r.type, doc, toc, text: d.content, linked: forRef(ref) };
    const hit = matchSection(headings, r.section);
    if (!hit)
      throw new HttpError(
        404,
        `В документе ${d.id} нет раздела «${r.section}». Разделы: ${toc.map((h) => h.text).join('; ') || 'нет'}`,
      );
    if (hit.ambiguous)
      throw new HttpError(
        400,
        `Заголовков «${r.section}» несколько, строки: ${hit.ambiguous.map((h) => h.line + 1).join(', ')}`,
      );
    const text = sectionText(d.content, headings, hit.heading);
    return { ref, type: r.type, doc, section: hit.heading.text, toc, text, linked: forRef(ref) };
  }

  // ---------------------------------------------------------------- явные связи

  /** Каноническая ссылка на существующий объект; раздел приводится к настоящему заголовку */
  function existing(raw, name) {
    const r = parseRef(raw);
    if (!r) throw new HttpError(400, `${name} — одна из форм: #175, #175.3, doc:12, doc:12#Раздел, note:881`);
    const shown = info(formatRef(r));
    if (shown.broken) throw new HttpError(404, `${name}: ${formatRef(r)} не существует`);
    if (r.section)
      r.section = matchSection(docHeadings(q.doc.get(r.doc).content), r.section).heading?.text ?? r.section;
    return formatRef(r);
  }

  function addLink(b, by, now = Date.now()) {
    const from = existing(b.from, 'from');
    const to = existing(b.to, 'to');
    const kind = b.kind ?? 'related';
    if (!EXPLICIT.includes(kind)) throw new HttpError(400, `kind — одно из: ${EXPLICIT.join(', ')}`);
    if (from === to) throw new HttpError(400, 'Связь с самим собой не нужна');
    q.insert.run(from, to, kind, by, now);
    return { from, to, kind };
  }

  function removeLink(params) {
    const from = parseRef(params.get('from'));
    const to = parseRef(params.get('to'));
    const kind = params.get('kind') ?? 'related';
    if (!from || !to) throw new HttpError(400, 'from и to — ссылки вида #175, #175.3, doc:12, note:881');
    if (!EXPLICIT.includes(kind))
      throw new HttpError(400, `Снять можно только: ${EXPLICIT.join(', ')}. Упоминание уходит вместе с текстом`);
    const r = q.removeOne.run(formatRef(from), formatRef(to), kind);
    if (!r.changes) throw new HttpError(404, `Связи ${formatRef(from)} → ${formatRef(to)} (${kind}) нет`);
    return { ok: true };
  }

  /**
   * Пункт из поля item записи или документа: номер в задаче task или полная ссылка #175.3. Проверяется до записи.
   * undefined — поля нет.
   */
  function itemRef(item, task) {
    if (item === undefined || item === null) return undefined;
    const r = Number.isInteger(item) ? (task ? { type: 'check', task, num: item } : null) : parseRef(item);
    if (r?.type !== 'check') throw new HttpError(400, 'item — номер пункта этой задачи или ссылка вида #175.3');
    const ref = formatRef(r);
    if (!findCheck(r.task, r.num)) throw new HttpError(404, `Нет пункта ${ref}`);
    return ref;
  }

  /** Привязать запись или документ к пункту из itemRef */
  const attach = (source, item, by) => {
    if (item) q.insert.run(source, item, 'related', by, Date.now());
  };

  /** Маршруты /dev/open и /dev/links; undefined — адрес не отсюда */
  function route(method, res, params, b, by) {
    if (res === 'open' && method === 'GET') return [200, open(params.get('ref'))];
    if (res === 'links' && method === 'POST') {
      addLink(b, by);
      return [201, { ok: true, links: forRef(formatRef(parseRef(b.from))) }];
    }
    if (res === 'links' && method === 'DELETE') return [200, removeLink(params)];
    return undefined;
  }

  rebuild();
  return { forTask, itemRef, attach, route };
}
