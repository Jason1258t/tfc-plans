/**
 * Задачи разработки для tfc-plans-dev: журнал работ агентов на сервере сборки (SQLite, /dev/… — см.
 * server/pack-server/lib/dev.mjs, docs/plans/dev-tracker.md). Ни одного чтения Firestore.
 * Адрес и ключ — как у npm run pack:fetch: TFC_PACK_URL / TFC_PACK_TOKEN, .env.local или вход в программу tfc.
 * Подпись записей — TFC_AGENT_NICK, иначе имя запустившего агента (scripts/mcp/env.mjs).
 */
import { NICK } from '../mcp/env.mjs';
import { packServer } from '../pack-fetch.mjs';
import { taskFiles, devFileGet } from './files.mjs';

const SITE = 'https://tfc-plans-fd2c.web.app/dev';

const STATUS_RU = {
  backlog: 'потом',
  todo: 'надо',
  doing: 'в работе',
  review: 'проверка',
  done: 'готово',
  dropped: 'отменена',
};
const KIND_RU = { feature: 'фича', fix: 'фикс', refactor: 'рефакторинг', docs: 'доки', infra: 'инфра', idea: 'идея' };
const OPEN = ['backlog', 'todo', 'doing', 'review'];

async function api(method, pathname, body) {
  const srv = packServer();
  if (!srv) throw new Error('нет адреса сервера сборки: TFC_PACK_URL и TFC_PACK_TOKEN в .env.local или вход в tfc');
  const res = await fetch(`${srv.url}/dev/${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${srv.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify({ by: NICK, ...body }) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `${res.status} ${res.statusText}`);
  return out;
}

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 60) return `${m} мин назад`;
  if (m < 48 * 60) return `${Math.round(m / 60)} ч назад`;
  return `${Math.round(m / 1440)} дн назад`;
};
const day = (t) => new Date(t).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

function line(t) {
  const tags = [STATUS_RU[t.status], KIND_RU[t.kind], t.area].filter(Boolean).join(' · ');
  const who = t.assignee ? ` — ${t.assignee}` : '';
  const extra = [t.notes ? `${t.notes} зап.` : '', t.docs ? `планов ${t.docs}` : '', t.branch ?? '']
    .filter(Boolean)
    .join(', ');
  return `#${t.id} [${tags}] P${t.priority} ${t.title}${who}${extra ? ` (${extra})` : ''} · ${ago(t.updatedAt)}`;
}

function full({ task: t, notes, noteCount, docs }) {
  const out = [
    `#${t.id} ${t.title}`,
    `статус: ${STATUS_RU[t.status]} (${t.status}) · вид: ${t.kind} · область: ${t.area ?? '—'} · важность P${t.priority}`,
    `исполнитель: ${t.assignee ?? '—'} · ветка: ${t.branch ?? '—'} · автор: ${t.author} · создана ${day(t.createdAt)}` +
      (t.doneAt ? ` · закрыта ${day(t.doneAt)}` : ''),
    `rev: ${t.rev} · ${SITE}?task=${t.id}`,
  ];
  if (t.body) out.push('', t.body);
  if (t.checklist.length)
    out.push('', 'Чек-лист:', ...t.checklist.map((c, i) => `${i + 1}. [${c.done ? 'x' : ' '}] ${c.text}`));
  if (docs.length) out.push('', 'Планы:', ...docs.map((d) => `- ${d.id} «${d.title}» (${d.size} симв., rev ${d.rev})`));
  if (notes.length) {
    out.push('', `Журнал (${notes.length} из ${noteCount}):`);
    for (const n of notes)
      out.push(
        `- ${day(n.createdAt)} ${n.author}${n.kind === 'note' ? '' : ` [${n.kind === 'status' ? 'статус' : 'отчёт'}]`}: ${n.text}`,
      );
  }
  return out.join('\n');
}

/** Поля задачи из аргументов: checklist — строки или { text, done } */
function fields(a) {
  const f = {};
  for (const k of ['title', 'body', 'kind', 'area', 'status', 'priority', 'assignee', 'branch', 'checklist', 'note'])
    if (a[k] !== undefined) f[k] = a[k];
  // «me» — сам агент: так он не подпишет задачу чужим ником по привычке
  if (f.assignee === 'me') f.assignee = NICK;
  return f;
}

async function devList(a) {
  const p = new URLSearchParams();
  const status = a.status ?? (a.all ? null : OPEN.join(','));
  if (status) p.set('status', status);
  for (const k of ['kind', 'area', 'assignee']) if (a[k]) p.set(k, a[k] === 'me' && k === 'assignee' ? NICK : a[k]);
  if (a.query) p.set('q', a.query);
  const { tasks } = await api('GET', `tasks?${p}`);
  // Сначала в работе и важные, потом по свежести
  const rank = { doing: 0, review: 1, todo: 2, backlog: 3, done: 4, dropped: 5 };
  tasks.sort((x, y) => rank[x.status] - rank[y.status] || y.priority - x.priority || y.updatedAt - x.updatedAt);
  const offset = a.offset ?? 0;
  const limit = a.limit ?? 30;
  const page = tasks.slice(offset, offset + limit);
  if (!tasks.length) return 'Задач не найдено.';
  const more =
    tasks.length > offset + limit ? `\nЕщё ${tasks.length - offset - limit} — offset=${offset + limit}.` : '';
  return `Задач: ${tasks.length}${status ? ` (статус ${status})` : ''}\n${page.map(line).join('\n')}${more}`;
}

async function devGet(a) {
  const task = full(await api('GET', `tasks/${a.id}?notes=${a.notes ?? 20}`));
  try {
    const files = await taskFiles(a.id);
    return `${task}\n\nВложения (${files.length}):${files.length ? '\n' + files.map((f) => `- ${f.id} «${f.name}» (${f.type}, ${f.size} Б) — dev_file_get task=${a.id} id=${f.id}`).join('\n') : ' нет'}`;
  } catch (e) {
    return `${task}\n\nВложения: не удалось проверить (${e.message}). Отсутствие вложений не подтверждено.`;
  }
}

async function devCreate(a) {
  const r = await api('POST', 'tasks', fields(a));
  return `Создана #${r.task.id} (rev ${r.task.rev}).\n${line(r.task)}`;
}

async function devUpdate(a) {
  const body = { ...fields(a), baseRev: a.baseRev };
  if (a.report) {
    body.note = a.report;
    body.noteKind = 'report';
  }
  const r = await api('PATCH', `tasks/${a.id}`, body);
  return `Обновлена #${r.task.id} (rev ${r.task.rev}).\n${line({ ...r.task, notes: r.noteCount, docs: r.docs.length })}`;
}

async function devNote(a) {
  const r = await api('POST', `tasks/${a.id}/notes`, { text: a.text, kind: a.report ? 'report' : 'note' });
  return `Запись добавлена в #${r.task.id} (всего ${r.noteCount}).`;
}

async function devDocGet(a) {
  const { doc: d } = await api('GET', `docs/${a.id}`);
  const lines = d.content.split('\n');
  const from = a.offset ?? 0;
  const to = Math.min(lines.length, from + (a.limit ?? 400));
  const head = `План ${d.id} «${d.title}» · задача ${d.task ? `#${d.task}` : '—'} · rev ${d.rev} · ${d.author}, ${day(d.updatedAt)}`;
  const tail = to < lines.length ? `\n… строки ${from + 1}–${to} из ${lines.length}; дальше — offset=${to}` : '';
  return `${head}\n\n${lines.slice(from, to).join('\n')}${tail}`;
}

async function devDocPut(a) {
  const body = {};
  for (const k of ['title', 'content', 'task']) if (a[k] !== undefined) body[k] = a[k];
  if (a.id === undefined) {
    if (!body.title && body.task) body.title = `План: #${body.task}`;
    const { doc } = await api('POST', 'docs', body);
    return `Создан план ${doc.id} «${doc.title}» (rev ${doc.rev}).`;
  }
  const { doc } = await api('PATCH', `docs/${a.id}`, { ...body, baseRev: a.baseRev });
  return `План ${doc.id} «${doc.title}» сохранён (rev ${doc.rev}).`;
}

const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });
const TASK_PROPS = {
  title: str('title'),
  body: str('description, markdown'),
  kind: { type: 'string', enum: Object.keys(KIND_RU), description: 'kind (default feature)' },
  area: { type: 'string', enum: ['site', 'mcp', 'addon', 'server', 'pack', 'app', 'agents', '-'], description: 'area' },
  status: { type: 'string', enum: Object.keys(STATUS_RU), description: 'status (default todo)' },
  priority: int('0 low … 3 urgent (default 1)'),
  assignee: str(`agent/person nick; "me" = you (${NICK}); "-" clears`),
  branch: str('git branch, e.g. feat/dev-tracker; "-" clears'),
  checklist: { type: 'array', items: {}, description: 'strings or { text, done }; replaces the whole checklist' },
  note: str('work-log entry added with this change'),
};

export const DEV_TOOLS = [
  {
    name: 'dev_file_get',
    description:
      'Read an attachment of a dev task: image content for PNG/JPEG/WebP/GIF, local paths for all files. Verifies task ownership and SHA256; cached locally. Does not analyse logs automatically.',
    inputSchema: {
      type: 'object',
      properties: { task: int('dev task number'), id: str('attachment id from dev_get') },
      required: ['task', 'id'],
    },
    handler: devFileGet,
  },
  {
    name: 'dev_list',
    description:
      'Dev tasks (pack server, not Firestore): open ones by default (backlog/todo/doing/review), in-progress and important first. Filter by words, status (comma list), kind, area, assignee ("-" — nobody).',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('words in #id, title, description, branch'),
        status: str('comma list of backlog,todo,doing,review,done,dropped'),
        kind: str('comma list of kinds'),
        area: str('comma list of areas'),
        assignee: str(`nick, "me" (${NICK}) or "-"`),
        all: { type: 'boolean', description: 'all statuses incl. done' },
        limit: int('default 30'),
        offset: int('start offset'),
      },
    },
    handler: devList,
  },
  {
    name: 'dev_get',
    description:
      'Whole dev task: description, checklist, plan docs, last work-log entries, rev for dev_update, attachment metadata from Firestore (cached 1 min). Use dev_file_get to view images/download files.',
    inputSchema: {
      type: 'object',
      properties: { id: int('task number'), notes: int('how many last log entries (default 20)') },
      required: ['id'],
    },
    handler: devGet,
  },
  {
    name: 'dev_create',
    description: `Write: new dev task signed ${NICK}. Start of work — status "doing", assignee "me" (= ${NICK}), branch.`,
    inputSchema: { type: 'object', properties: TASK_PROPS, required: ['title'] },
    handler: devCreate,
  },
  {
    name: 'dev_update',
    description:
      'Write: change passed fields (baseRev from dev_get/dev_create; refuses if changed since). A status change logs itself. report — final Russian report into the log (what changed for players, what was checked, what not).',
    inputSchema: {
      type: 'object',
      properties: { id: int('task number'), baseRev: int('rev'), ...TASK_PROPS, report: str('final report entry') },
      required: ['id', 'baseRev'],
    },
    handler: devUpdate,
  },
  {
    name: 'dev_note',
    description: 'Write: append a work-log entry to a dev task (no rev needed).',
    inputSchema: {
      type: 'object',
      properties: { id: int('task number'), text: str('entry, Russian'), report: { type: 'boolean' } },
      required: ['id', 'text'],
    },
    handler: devNote,
  },
  {
    name: 'dev_doc_get',
    description: 'Dev plan doc by lines and its rev.',
    inputSchema: {
      type: 'object',
      properties: { id: int('doc id'), offset: int('first line (0)'), limit: int('lines (400)') },
      required: ['id'],
    },
    handler: devDocGet,
  },
  {
    name: 'dev_doc_put',
    description:
      'Write: without id — new plan doc (title defaults to «План: #task»); with id + baseRev — edit passed fields. content — whole markdown; task — task number or "-".',
    inputSchema: {
      type: 'object',
      properties: {
        id: int('doc id'),
        baseRev: int('rev from dev_doc_get'),
        title: str('title'),
        content: str('whole markdown'),
        task: { type: ['integer', 'string'], description: 'task number or "-"' },
      },
    },
    handler: devDocPut,
  },
];
