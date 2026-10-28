/**
 * Задачи разработки (журнал работ агентов и хоста) — SQLite в <DATA_DIR>/dev.db, встроенный node:sqlite.
 * Раньше жили в Firestore (группы «Разработка» и «Фиксы») и съедали бесплатный лимит чтений. План —
 * docs/plans/dev-tracker.md. Таблицы: tasks (задачи), notes (журнал по задаче, только дописывается), docs (планы).
 * Правка задачи и плана — с baseRev: изменилось после чтения — 409. Смена статуса сама пишет запись в журнал.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './util.mjs';

// node:sqlite в Node 22 печатает ExperimentalWarning на каждый запуск — глушим только его
const emit = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...a));
const { DatabaseSync } = await import('node:sqlite');
process.emitWarning = emit;

export const KINDS = ['feature', 'fix', 'refactor', 'docs', 'infra', 'idea'];
export const AREAS = ['site', 'mcp', 'addon', 'server', 'pack', 'app', 'agents'];
export const STATUSES = ['backlog', 'todo', 'doing', 'review', 'done', 'dropped'];
const CLOSED = new Set(['done', 'dropped']);

const SCHEMA = `
pragma journal_mode = wal;
pragma foreign_keys = on;
create table if not exists tasks (
  id integer primary key autoincrement,
  title text not null,
  body text not null default '',
  kind text not null default 'feature',
  area text,
  status text not null default 'todo',
  priority integer not null default 1,
  assignee text,
  branch text,
  checklist text not null default '[]',
  author text not null,
  created_at integer not null,
  updated_at integer not null,
  done_at integer,
  rev integer not null default 1,
  legacy text unique
);
create table if not exists notes (
  id integer primary key autoincrement,
  task_id integer not null references tasks(id) on delete cascade,
  author text not null,
  kind text not null default 'note',
  text text not null,
  created_at integer not null
);
create index if not exists notes_task on notes(task_id, id);
create table if not exists docs (
  id integer primary key autoincrement,
  task_id integer references tasks(id) on delete set null,
  title text not null,
  content text not null default '',
  author text not null,
  created_at integer not null,
  updated_at integer not null,
  rev integer not null default 1,
  legacy text unique
);
create index if not exists docs_task on docs(task_id);
`;

const LIMITS = { title: 300, body: 200_000, note: 20_000, doc: 1_000_000, checklist: 500, item: 500 };

// ---------------------------------------------------------------- проверка полей

const bad = (msg) => new HttpError(400, msg);

function text(v, name, max, { required = false } = {}) {
  if (v === undefined || v === null) {
    if (required) throw bad(`${name} — обязательное поле`);
    return v;
  }
  if (typeof v !== 'string') throw bad(`${name} — строка`);
  const s = name === 'title' ? v.trim() : v;
  if (required && !s) throw bad(`${name} — не пустая строка`);
  if (s.length > max) throw bad(`${name} — не длиннее ${max} символов`);
  return s;
}

function oneOf(v, name, list) {
  if (v === undefined) return undefined;
  if (!list.includes(v)) throw bad(`${name} — одно из: ${list.join(', ')}`);
  return v;
}

/** Ник, ветка, исполнитель: "" и null — снять */
function short(v, name, max = 80) {
  if (v === undefined) return undefined;
  if (v === null || v === '' || v === '-') return null;
  if (typeof v !== 'string' || v.length > max) throw bad(`${name} — строка до ${max} символов`);
  return v.trim();
}

function checklist(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > LIMITS.checklist) throw bad(`checklist — список до ${LIMITS.checklist} пунктов`);
  return v.map((x) => {
    const it = typeof x === 'string' ? { text: x, done: false } : x;
    if (!it || typeof it.text !== 'string' || !it.text.trim() || it.text.length > LIMITS.item)
      throw bad(`пункт checklist — { text, done }, текст до ${LIMITS.item} символов`);
    return { text: it.text.trim(), done: it.done === true };
  });
}

function priority(v) {
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || v < 0 || v > 3) throw bad('priority — целое 0…3');
  return v;
}

function intId(s, what) {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, `Нет такой ${what}`);
  return n;
}

// ---------------------------------------------------------------- строки → объекты

const taskOut = (r) =>
  r && {
    id: r.id,
    title: r.title,
    body: r.body,
    kind: r.kind,
    area: r.area,
    status: r.status,
    priority: r.priority,
    assignee: r.assignee,
    branch: r.branch,
    checklist: JSON.parse(r.checklist),
    author: r.author,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    doneAt: r.done_at,
    rev: r.rev,
    ...(r.notes !== undefined && { notes: r.notes, docs: r.docs, lastNoteAt: r.last_note }),
  };
const noteOut = (r) => ({
  id: r.id,
  task: r.task_id,
  author: r.author,
  kind: r.kind,
  text: r.text,
  createdAt: r.created_at,
});
const docOut = (r, full) =>
  r && {
    id: r.id,
    task: r.task_id,
    title: r.title,
    ...(full ? { content: r.content } : { size: r.size }),
    author: r.author,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    rev: r.rev,
  };

// ---------------------------------------------------------------- база

export function openDev(dataDir, { backupDays = 14 } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'dev.db'));
  db.exec(SCHEMA);

  const q = {
    list: db.prepare(`
      select t.*, (select count(*) from notes n where n.task_id = t.id) notes,
        (select count(*) from docs d where d.task_id = t.id) docs,
        (select max(created_at) from notes n where n.task_id = t.id) last_note
      from tasks t order by t.id desc`),
    task: db.prepare('select * from tasks where id = ?'),
    notes: db.prepare('select * from notes where task_id = ? order by id desc limit ?'),
    noteCount: db.prepare('select count(*) c from notes where task_id = ?'),
    addNote: db.prepare('insert into notes (task_id, author, kind, text, created_at) values (?, ?, ?, ?, ?)'),
    taskDocs: db.prepare(
      'select id, task_id, title, length(content) size, author, created_at, updated_at, rev from docs where task_id = ? order by id',
    ),
    docs: db.prepare(
      'select id, task_id, title, length(content) size, author, created_at, updated_at, rev from docs order by updated_at desc',
    ),
    doc: db.prepare('select * from docs where id = ?'),
    legacyTask: db.prepare('select id from tasks where legacy = ?'),
    legacyDoc: db.prepare('select id from docs where legacy = ?'),
  };

  /** Транзакция: всё или ничего; вложенная (перенос → создание задачи) идёт внутри внешней */
  let depth = 0;
  const tx = (fn) => {
    if (depth) return fn();
    depth++;
    db.exec('begin');
    try {
      const r = fn();
      db.exec('commit');
      return r;
    } catch (e) {
      db.exec('rollback');
      throw e;
    } finally {
      depth--;
    }
  };

  const getTask = (id) => {
    const t = q.task.get(intId(id, 'задачи'));
    if (!t) throw new HttpError(404, `Нет задачи #${id}`);
    return t;
  };
  const getDoc = (id) => {
    const d = q.doc.get(intId(id, 'страницы плана'));
    if (!d) throw new HttpError(404, `Нет плана ${id}`);
    return d;
  };
  const checkRev = (row, baseRev, what) => {
    if (!Number.isInteger(baseRev)) throw bad('baseRev — rev из последнего чтения');
    if (row.rev !== baseRev)
      throw new HttpError(409, `${what} изменилась после чтения (rev ${row.rev}, у вас ${baseRev}) — перечитайте`, {
        rev: row.rev,
      });
  };

  /** Поля задачи из тела запроса (только переданные) */
  function taskFields(b, creating) {
    const f = {
      title: text(b.title, 'title', LIMITS.title, { required: creating }),
      body: text(b.body, 'body', LIMITS.body),
      kind: oneOf(b.kind, 'kind', KINDS),
      area: b.area === null || b.area === '-' ? null : oneOf(b.area, 'area', AREAS),
      status: oneOf(b.status, 'status', STATUSES),
      priority: priority(b.priority),
      assignee: short(b.assignee, 'assignee', 40),
      branch: short(b.branch, 'branch', 120),
      checklist: checklist(b.checklist),
    };
    if (b.title !== undefined && !f.title) throw bad('title — не пустая строка');
    return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
  }

  function createTask(b, by, { now = Date.now(), legacy = null, createdAt, updatedAt, doneAt } = {}) {
    if (!legacy && typeof b.body === 'string' && b.body.length > 2400)
      throw bad('Описание — до 2400 символов (примерно один экран). Подробный план прикрепите документом к задаче.');
    const f = { kind: 'feature', status: 'todo', priority: 1, ...taskFields(b, true) };
    const note = text(b.note, 'note', LIMITS.note);
    return tx(() => {
      const r = db
        .prepare(
          `insert into tasks (title, body, kind, area, status, priority, assignee, branch, checklist, author,
            created_at, updated_at, done_at, legacy) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          f.title,
          f.body ?? '',
          f.kind,
          f.area ?? null,
          f.status,
          f.priority,
          f.assignee ?? null,
          f.branch ?? null,
          JSON.stringify(f.checklist ?? []),
          by,
          createdAt ?? now,
          updatedAt ?? now,
          CLOSED.has(f.status) ? (doneAt ?? now) : null,
          legacy,
        );
      const id = Number(r.lastInsertRowid);
      if (note) q.addNote.run(id, by, 'note', note, now);
      return id;
    });
  }

  function updateTask(id, b, by) {
    const cur = getTask(id);
    checkRev(cur, b.baseRev, `Задача #${cur.id}`);
    const f = taskFields(b, false);
    const note = text(b.note, 'note', LIMITS.note);
    const now = Date.now();
    const changed = Object.keys(f).filter((k) =>
      k === 'checklist' ? JSON.stringify(f.checklist) !== cur.checklist : f[k] !== cur[k],
    );
    if (!changed.length && !note) return cur.id;
    tx(() => {
      if (changed.length) {
        const set = changed.map((k) => `${k} = ?`);
        const vals = changed.map((k) => (k === 'checklist' ? JSON.stringify(f.checklist) : f[k]));
        if (f.status !== undefined && f.status !== cur.status) {
          set.push('done_at = ?');
          vals.push(CLOSED.has(f.status) ? now : null);
          q.addNote.run(cur.id, by, 'status', `${cur.status} → ${f.status}`, now);
        }
        db.prepare(`update tasks set ${set.join(', ')}, updated_at = ?, rev = rev + 1 where id = ?`).run(
          ...vals,
          now,
          cur.id,
        );
      }
      if (note) q.addNote.run(cur.id, by, b.noteKind === 'report' ? 'report' : 'note', note, now);
    });
    return cur.id;
  }

  function taskFull(id, noteLimit) {
    const t = getTask(id);
    return {
      task: taskOut(t),
      notes: q.notes.all(t.id, noteLimit).map(noteOut).reverse(),
      noteCount: q.noteCount.get(t.id).c,
      docs: q.taskDocs.all(t.id).map((d) => docOut(d)),
    };
  }

  function docFields(b, creating) {
    const f = {
      title: text(b.title, 'title', LIMITS.title, { required: creating }),
      content: text(b.content, 'content', LIMITS.doc),
    };
    if (b.task !== undefined) f.task_id = b.task === null || b.task === '-' ? null : getTask(b.task).id;
    return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
  }

  function createDoc(b, by, { now = Date.now(), legacy = null, createdAt, updatedAt } = {}) {
    const f = docFields(b, true);
    const r = db
      .prepare(
        'insert into docs (task_id, title, content, author, created_at, updated_at, legacy) values (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(f.task_id ?? null, f.title, f.content ?? '', by, createdAt ?? now, updatedAt ?? now, legacy);
    return Number(r.lastInsertRowid);
  }

  function updateDoc(id, b) {
    const cur = getDoc(id);
    checkRev(cur, b.baseRev, `Страница плана ${cur.id}`);
    const f = docFields(b, false);
    const keys = Object.keys(f).filter((k) => f[k] !== cur[k]);
    if (keys.length)
      db.prepare(
        `update docs set ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ?, rev = rev + 1 where id = ?`,
      ).run(...keys.map((k) => f[k]), Date.now(), cur.id);
    return cur.id;
  }

  /**
   * Разовый перенос из Firestore (scripts/dev-migrate.mjs). Повтор безопасен: записи с тем же legacy пропускаются.
   * tasks: [{ legacy, ...поля, by, createdAt, updatedAt, doneAt, notes: [{ author, text, createdAt }] }],
   * docs: [{ legacy, title, content, task (legacy задачи), by, createdAt, updatedAt }]
   */
  function importLegacy(body) {
    const out = { tasks: 0, docs: 0, skipped: 0 };
    tx(() => {
      for (const t of body?.tasks ?? []) {
        if (q.legacyTask.get(String(t.legacy))) {
          out.skipped++;
          continue;
        }
        const id = createTask(t, String(t.by || 'неизвестно'), {
          legacy: String(t.legacy),
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          doneAt: t.doneAt,
        });
        for (const n of t.notes ?? [])
          q.addNote.run(id, n.author, n.kind ?? 'note', n.text, n.createdAt ?? t.createdAt);
        out.tasks++;
      }
      for (const d of body?.docs ?? []) {
        if (q.legacyDoc.get(String(d.legacy))) {
          out.skipped++;
          continue;
        }
        const task = d.task ? (q.legacyTask.get(String(d.task))?.id ?? null) : null;
        createDoc({ ...d, task: undefined }, String(d.by || 'неизвестно'), {
          legacy: String(d.legacy),
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        });
        if (task) db.prepare('update docs set task_id = ? where legacy = ?').run(task, String(d.legacy));
        out.docs++;
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- бэкап раз в сутки

  const backupDir = path.join(dataDir, 'dev-backup');
  function backup() {
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const file = path.join(backupDir, `dev-${day}.db`);
      if (!fs.existsSync(file)) db.exec(`vacuum into '${file.replaceAll("'", "''")}'`);
      const old = fs
        .readdirSync(backupDir)
        .filter((f) => /^dev-\d{8}\.db$/.test(f))
        .sort()
        .slice(0, -backupDays);
      for (const f of old) fs.rmSync(path.join(backupDir, f));
    } catch (e) {
      console.error(`бэкап dev.db: ${e.message}`);
    }
  }
  backup();
  setInterval(backup, 6 * 3600_000).unref();

  // ---------------------------------------------------------------- маршруты /dev/…

  /**
   * Запрос к /dev: [статус, тело]. who — { name, role, via: 'key' | 'site' }; автор — body.by (ник агента или сайта),
   * иначе имя ключа.
   */
  function route(method, parts, params, body, who) {
    const b = body ?? {};
    const by = typeof b.by === 'string' && b.by.trim().length >= 2 && b.by.length <= 24 ? b.by.trim() : who.name;
    const [res, id, sub] = parts;

    if (res === 'tasks') {
      if (!id && method === 'GET') {
        const want = (k) => params.get(k)?.split(',').filter(Boolean);
        const status = want('status');
        const kind = want('kind');
        const area = want('area');
        const assignee = params.get('assignee')?.toLowerCase();
        const words = (params.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        let list = q.list.all();
        if (status) list = list.filter((t) => status.includes(t.status));
        if (kind) list = list.filter((t) => kind.includes(t.kind));
        if (area) list = list.filter((t) => area.includes(t.area));
        if (assignee)
          list = list.filter((t) => (assignee === '-' ? !t.assignee : t.assignee?.toLowerCase() === assignee));
        if (words.length)
          list = list.filter((t) => {
            const hay = `#${t.id} ${t.title} ${t.body} ${t.branch ?? ''}`.toLowerCase();
            return words.every((w) => hay.includes(w));
          });
        return [200, { tasks: list.map(taskOut) }];
      }
      if (!id && method === 'POST') {
        const tid = createTask(b, by);
        return [201, taskFull(tid, 20)];
      }
      if (id && !sub && method === 'GET') return [200, taskFull(id, Math.min(500, Number(params.get('notes')) || 50))];
      if (id && !sub && method === 'PATCH') return [200, taskFull(updateTask(id, b, by), 20)];
      if (id && !sub && method === 'DELETE') {
        const cur = getTask(id);
        checkRev(cur, Number(params.get('baseRev')), `Задача #${cur.id}`);
        db.prepare('delete from tasks where id = ?').run(cur.id);
        console.log(`− dev #${cur.id} «${cur.title}» — ${by}`);
        return [200, { ok: true }];
      }
      if (id && sub === 'notes' && method === 'POST') {
        const t = getTask(id);
        const note = text(b.text, 'text', LIMITS.note, { required: true });
        const now = Date.now();
        tx(() => {
          q.addNote.run(t.id, by, b.kind === 'report' ? 'report' : 'note', note, now);
          db.prepare('update tasks set updated_at = ? where id = ?').run(now, t.id);
        });
        return [201, taskFull(t.id, 20)];
      }
    }

    if (res === 'docs') {
      if (!id && method === 'GET') {
        const task = params.get('task');
        const rows = task ? q.taskDocs.all(intId(task, 'задачи')) : q.docs.all();
        return [200, { docs: rows.map((d) => docOut(d)) }];
      }
      if (!id && method === 'POST') return [201, { doc: docOut(getDoc(createDoc(b, by)), true) }];
      if (id && method === 'GET') return [200, { doc: docOut(getDoc(id), true) }];
      if (id && method === 'PATCH') return [200, { doc: docOut(getDoc(updateDoc(id, b)), true) }];
      if (id && method === 'DELETE') {
        const cur = getDoc(id);
        checkRev(cur, Number(params.get('baseRev')), `Страница плана ${cur.id}`);
        db.prepare('delete from docs where id = ?').run(cur.id);
        return [200, { ok: true }];
      }
    }

    if (res === 'meta' && method === 'GET') return [200, { kinds: KINDS, areas: AREAS, statuses: STATUSES }];

    if (res === 'import' && method === 'POST') {
      if (who.role !== 'admin') throw new HttpError(403, 'Перенос — только ключом администратора');
      const r = importLegacy(b);
      console.log(`+ dev перенос: задач ${r.tasks}, планов ${r.docs}, пропущено ${r.skipped} — ${who.name}`);
      return [200, r];
    }

    throw new HttpError(404, 'Нет такого адреса');
  }

  return { route, close: () => db.close() };
}
