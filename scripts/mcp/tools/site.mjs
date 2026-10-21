/**
 * Инструменты MCP: контент сайта из Firestore — задачи и группы, документы-планы, датапаки, скрипты KubeJS с сайта,
 * схемы Create. Пишут только task_create / task_update / artifact_put (подпись Claude, правка — с проверкой ревизии,
 * как guide_put). Экономим чтения (50 тыс. в сутки на всех): списки — с mask (только нужные поля) и кешем на
 * несколько минут, документ целиком — отдельным GET по запросу, вложения задачи — запросом по taskId.
 * В конце каждого ответа — сколько чтений Firestore он стоил (0 — всё из кеша).
 */
import { DOCS, fromValue } from '../../firestore-rest.mjs';
import { datapackFiles, zipName } from '../../../src/lib/datapackFiles.ts';
import { itemName } from '../data.mjs';
import { FirestoreError, api, cached, createDoc, listAll, patchDoc } from '../firestore.mjs';
import { dateOf, nameOf, named, norm, num, page, paging, short, str, words } from '../fmt.mjs';

const TTL = 3 * 60_000;

// ---------------------------------------------------------------- чтение со счётчиком

let reads = 0;
const fields = (d) => Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, fromValue(v)]));
const maskQs = (mask) => (mask ? mask.map((f) => `mask.fieldPaths=${f}`).join('&') : '');

/** Список коллекции с маской; запрос без документов тоже стоит одно чтение */
const listCounted = async (coll, mask) => {
  const list = await listAll(coll, mask);
  reads += Math.max(1, list.length);
  return list;
};

async function getDoc(coll, id, mask) {
  if (!id || id.includes('/')) return null;
  try {
    const d = await api(`${DOCS}/${coll}/${encodeURIComponent(id)}${mask ? `?${maskQs(mask)}` : ''}`);
    reads += 1;
    return { id, updateTime: d.updateTime, ...fields(d) };
  } catch (e) {
    if (e instanceof FirestoreError && e.status === 404) {
      reads += 1;
      return null;
    }
    throw e;
  }
}

/** Документы коллекции, где field == value (вложения и документы задачи) */
async function queryEq(coll, field, value, mask) {
  const structuredQuery = {
    from: [{ collectionId: coll }],
    where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } },
    ...(mask ? { select: { fields: mask.map((fieldPath) => ({ fieldPath })) } } : {}),
  };
  const r = await api(`${DOCS}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery }) });
  const out = r
    .filter((x) => x.document)
    .map((x) => ({
      id: x.document.name.split('/').pop(),
      updateTime: x.document.updateTime,
      ...fields(x.document),
    }));
  reads += Math.max(1, out.length);
  return out;
}

/** Обработчик с подписью «сколько чтений стоил ответ» */
const counted = (fn) => async (a) => {
  reads = 0;
  const text = await fn(a);
  return `${text}\n— Firestore: ${reads ? `${reads} чтен.` : 'из кеша, 0 чтений'}`;
};

// ---------------------------------------------------------------- общее

const TASK_MASK = [
  'title',
  'description',
  'status',
  'priority',
  'groupId',
  'author',
  'assignee',
  'checklist',
  'createdAt',
  'updatedAt',
  'completedAt',
];
let tasksLoaded = 0;
const tasksIndex = cached(TTL, () => {
  tasksLoaded = Date.now();
  return listCounted('tasks', TASK_MASK);
});
const groupsIndex = cached(TTL, () => listCounted('groups', ['name', 'icon', 'order']));
const artifactsIndex = cached(TTL, () =>
  listCounted('artifacts', ['title', 'taskId', 'author', 'updatedBy', 'createdAt', 'updatedAt']),
);
const datapacksIndex = cached(TTL, () =>
  listCounted('datapacks', ['name', 'namespace', 'description', 'install', 'author', 'updatedBy', 'updatedAt']),
);
const scriptsIndex = cached(TTL, () =>
  listCounted('kubejsScripts', ['fileName', 'install', 'author', 'updatedBy', 'updatedAt']),
);
// превью (data URL до ~200 КБ) не берём ни в список, ни в schematic_get
const SCHEM_MASK = [
  'name',
  'fileName',
  'fileId',
  'fileSize',
  'size',
  'blocks',
  'replace',
  'description',
  'author',
  'updatedBy',
  'updatedAt',
];
const schematicsIndex = cached(TTL, () =>
  listCounted(
    'schematics',
    SCHEM_MASK.filter((f) => f !== 'description'),
  ),
);

const STATUS = { todo: 'надо сделать', doing: 'в работе', done: 'готово' };
const PRIORITY = ['низкая', 'обычная', 'высокая', 'критическая'];

const has = (hay, ws) => {
  const h = norm(hay);
  return ws.every((w) => h.includes(w));
};
const byUpdated = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
const kb = (n) =>
  n == null
    ? '?'
    : n < 1024
      ? `${n} Б`
      : n < 1048576
        ? `${(n / 1024).toFixed(1)} КБ`
        : `${(n / 1048576).toFixed(1)} МБ`;
const who = (d) => `${d.author ?? '?'}${d.updatedBy && d.updatedBy !== d.author ? `, правил ${d.updatedBy}` : ''}`;

/** Текст по строкам с offset/limit */
function lines(text, a, defLimit = 300) {
  const all = String(text ?? '').split('\n');
  const offset = Math.max(0, Number(a.offset ?? 0) | 0);
  const limit = Math.max(1, Number(a.limit ?? defLimit) | 0);
  const end = Math.min(all.length, offset + limit);
  const body = all.slice(offset, end).map((l, i) => `${String(offset + i + 1).padStart(4)}| ${l}`);
  const more = end < all.length ? `\n… ещё ${all.length - end} строк; дальше: offset=${end}` : '';
  return `${body.join('\n')}${more}`;
}

/** Документ по id или единственный по словам из списка; иначе — текст отказа */
function pick(list, key, label, what) {
  const k = String(key ?? '').trim();
  if (!k) return { error: `Укажите id ${what}.` };
  const exact = list.find((d) => d.id === k) ?? list.find((d) => norm(label(d)) === norm(k));
  if (exact) return { doc: exact };
  const ws = words(k);
  const found = list.filter((d) => has(`${d.id} ${label(d)}`, ws));
  if (found.length === 1) return { doc: found[0] };
  if (!found.length) return { error: `Не найдено: ${k}.` };
  return {
    error: `Подходит несколько (${found.length}), уточните id:\n${found
      .slice(0, 20)
      .map((d) => `${d.id} — ${label(d)}`)
      .join('\n')}`,
  };
}

const FIRESTORE_ID = /^[A-Za-z0-9]{20}$/;
const SITE = 'https://tfc-plans-fd2c.web.app';
const NICK = 'Claude';

/** Документ целиком: id сайта — сразу GET (1 чтение), иначе поиск по кешированному списку и GET найденного */
async function resolve(coll, index, key, label, what, mask) {
  const k = String(key ?? '').trim();
  if (FIRESTORE_ID.test(k)) {
    const d = await getDoc(coll, k, mask);
    if (d) return { doc: d };
  }
  const r = pick(await index(), k, label, what);
  if (r.error) return r;
  const d = await getDoc(coll, r.doc.id, mask);
  return d ? { doc: d } : { error: `${r.doc.id} удалён.` };
}

// ---------------------------------------------------------------- задачи

function checklistLine(c) {
  if (c.itemId) {
    const n = nameOf(c.itemId);
    return `${(c.got ?? 0) >= (c.qty ?? 1) ? '[x]' : '[ ]'} ${c.got ?? 0}/${c.qty ?? '?'} ${c.itemId}${n ? ` «${n}»` : ''}${
      c.text && c.text !== n ? ` — ${c.text}` : ''
    }`;
  }
  return `${c.done ? '[x]' : '[ ]'} ${c.text}`;
}

function taskLine(t, groups) {
  const g = groups.get(t.groupId);
  const list = t.checklist ?? [];
  const done = list.filter((c) => (c.itemId ? (c.got ?? 0) >= (c.qty ?? 1) : c.done)).length;
  return (
    `${t.id} — ${t.title} [${STATUS[t.status] ?? t.status}, ${PRIORITY[t.priority] ?? '?'}` +
    `${g ? `, группа «${g.name}»` : ''}${t.assignee ? `, делает ${t.assignee}` : ''}` +
    `${list.length ? `, чеклист ${done}/${list.length}` : ''}; ${t.author ?? '?'}, ${dateOf(t.updatedAt)}]`
  );
}

async function groupMap() {
  return new Map((await groupsIndex()).map((g) => [g.id, g]));
}

async function tasksList(a) {
  const [tasks, groups] = await Promise.all([tasksIndex(), groupMap()]);
  let list = [...tasks];
  if (a.status) list = list.filter((t) => t.status === a.status);
  if (a.assignee) {
    const w = norm(a.assignee);
    list = list.filter((t) => (w === '-' ? !t.assignee : norm(t.assignee ?? '').includes(w)));
  }
  if (a.group) {
    const w = norm(a.group);
    list = list.filter((t) =>
      w === '-' ? !t.groupId : t.groupId === a.group || norm(groups.get(t.groupId)?.name ?? '').includes(w),
    );
  }
  const ws = words(a.query);
  if (ws.length)
    list = list.filter((t) =>
      has(
        `${t.title} ${t.description ?? ''} ${(t.checklist ?? []).map((c) => `${c.text} ${c.itemId ?? ''}`).join(' ')}`,
        ws,
      ),
    );
  list.sort(
    (x, y) => (x.status === 'done') - (y.status === 'done') || (y.priority ?? 0) - (x.priority ?? 0) || byUpdated(x, y),
  );
  const head = [];
  if (!a.offset && !a.query && !a.status && !a.assignee && !a.group) {
    const count = (id) => tasks.filter((t) => t.groupId === id).length;
    const gs = [...groups.values()].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
    head.push(
      `Группы: ${gs.map((g) => `«${g.name}» (${g.id}, ${count(g.id)})`).join('; ') || '—'}; без группы — ${count(null)}.`,
    );
  }
  return [...head, page(list, a, (t) => [taskLine(t, groups)])].join('\n');
}

async function taskGet(a) {
  const r = await resolve('tasks', tasksIndex, a.id, (x) => x.title, 'задачи');
  if (r.error) return r.error;
  const t = r.doc;
  const id = t.id;
  const [groups, files, docs] = await Promise.all([
    groupMap(),
    queryEq('files', 'taskId', id, ['name', 'size', 'type', 'author', 'createdAt', 'complete']),
    queryEq('artifacts', 'taskId', id, ['title', 'content', 'author', 'updatedBy', 'updatedAt']),
  ]);
  const g = groups.get(t.groupId);
  const out = [
    `${t.id} — ${t.title}`,
    `статус: ${STATUS[t.status] ?? t.status}${t.completedAt ? ` (${dateOf(t.completedAt)})` : ''}; важность: ${
      PRIORITY[t.priority] ?? '?'
    }; рейтинг: ${t.rating ?? '—'}`,
    `группа: ${g ? `«${g.name}» (${g.id})` : '—'}; автор: ${t.author ?? '?'}; исполнитель: ${t.assignee || '—'}`,
    `создана ${dateOf(t.createdAt)}, изменена ${dateOf(t.updatedAt)}; на сайте: ${SITE}/?task=${t.id}`,
    `revision: ${t.updateTime}   ← для task_update как baseRevision`,
  ];
  if (t.place) out.push(`место: x=${t.place.x}, z=${t.place.z}${t.place.label ? ` — ${t.place.label}` : ''}`);
  if (t.description) out.push('', 'Описание:', t.description);
  const cl = t.checklist ?? [];
  if (cl.length) out.push('', `Чеклист (${cl.length}):`, ...cl.map(checklistLine));
  const ok = files.filter((f) => f.complete !== false);
  if (ok.length) {
    out.push('', `Вложения (${ok.length}; содержимое не выдаётся):`);
    for (const f of ok.sort((x, y) => (x.createdAt ?? 0) - (y.createdAt ?? 0)))
      out.push(`${f.id} — ${f.name} (${kb(f.size)}, ${f.type || '?'}; ${f.author ?? '?'}, ${dateOf(f.createdAt)})`);
  }
  if (docs.length) {
    const max = Math.max(500, Number(a.doc_chars ?? 4000) | 0);
    out.push('', `Документы (${docs.length}):`);
    for (const d of docs.sort(byUpdated)) {
      const text = String(d.content ?? '');
      out.push(
        `— ${d.id} «${d.title}» (${who(d)}, ${dateOf(d.updatedAt)}, ${text.length} симв.; revision ${d.updateTime})`,
        short(text, max),
      );
    }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- группы и запись задач

async function groupsList(a) {
  let list = [...(await groupsIndex())].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
  const ws = words(a.query);
  if (ws.length) list = list.filter((g) => has(`${g.id} ${g.name}`, ws));
  // число задач — только из тёплого кеша: грузить ради него весь список задач не стоит
  const warm = Date.now() - tasksLoaded < TTL ? await tasksIndex() : null;
  return page(list, a, (g) => [
    `${g.id} — «${g.name}» [порядок ${g.order ?? 0}${g.icon ? `, значок ${named(g.icon)}` : ''}${
      warm ? `, задач ${warm.filter((t) => t.groupId === g.id).length}` : ''
    }]`,
  ]);
}

/** Как uid() в src/lib/util.ts — id пункта чеклиста */
const uid = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);

/** Предмет по id — только из библиотеки сайта, иначе отказ */
function itemOrThrow(id, what) {
  const k = String(id).trim();
  if (!itemName(k)) throw new Error(`${what}: нет предмета ${k} в библиотеке (найдите id через items_search)`);
  return k;
}

/**
 * Чеклист как у сайта (components/Checklist.tsx): ресурс — { id, itemId, text, qty, got }, пункт — { id, text, done }.
 * Строка — обычный пункт. id прежнего пункта сохраняется (по id, по предмету или по тексту).
 */
function checklistOf(list, old = []) {
  if (!Array.isArray(list)) throw new Error('checklist — массив пунктов');
  const used = new Set();
  const reuse = (e, same) => {
    const prev = old.find((o) => !used.has(o.id) && (o.id === e.id || same(o)));
    const id = prev?.id ?? uid();
    used.add(id);
    return id;
  };
  return list.map((raw, i) => {
    const e = typeof raw === 'string' ? { text: raw } : (raw ?? {});
    if (e.itemId) {
      const itemId = itemOrThrow(e.itemId, `checklist[${i}]`);
      const qty = Math.max(1, Number(e.qty ?? 1) | 0);
      const got = Math.max(0, Number(e.got ?? 0) | 0);
      const text = String(e.text ?? '').trim() || itemName(itemId);
      return { id: reuse(e, (o) => o.itemId === itemId), itemId, text, qty, got };
    }
    const text = String(e.text ?? '').trim();
    if (!text) throw new Error(`checklist[${i}]: нужен text (или itemId для ресурса)`);
    return { id: reuse(e, (o) => !o.itemId && o.text === text), text, done: Boolean(e.done) };
  });
}

/** Поля задачи из аргументов (только переданные) → patch; task — текущая задача для правки */
async function taskFields(a, task) {
  const p = {};
  if (a.title != null) {
    p.title = String(a.title).trim();
    if (!p.title || p.title.length > 300) throw new Error('title — 1…300 символов');
  }
  if (a.description != null) {
    p.description = String(a.description);
    if (p.description.length > 200000) throw new Error('description — до 200 000 символов');
  }
  if (a.priority != null) {
    p.priority = Number(a.priority);
    if (![0, 1, 2, 3].includes(p.priority)) throw new Error('priority — 0…3 (низкая, обычная, высокая, критическая)');
  }
  if (a.status != null) {
    if (!STATUS[a.status]) throw new Error('status — todo, doing или done');
    p.status = a.status;
    // как сайт: отметка «готово» ставит completedAt, снятие — обнуляет
    if (a.status !== task?.status) p.completedAt = a.status === 'done' ? Date.now() : null;
  }
  if (a.group != null) {
    const g = String(a.group).trim();
    if (g === '-' || !g) p.groupId = null;
    else {
      const r = pick(await groupsIndex(), g, (x) => x.name, 'группы');
      if (r.error) throw new Error(`группа: ${r.error} Список — groups_list.`);
      p.groupId = r.doc.id;
    }
  }
  if (a.icon != null) p.icon = a.icon === '-' || !a.icon ? null : itemOrThrow(a.icon, 'icon');
  if (a.assignee != null) {
    const n = String(a.assignee).trim();
    p.assignee = n === '-' || !n ? null : n;
    if (p.assignee && (p.assignee.length < 2 || p.assignee.length > 24)) throw new Error('assignee — ник 2…24 символа');
  }
  if (a.place != null) {
    if (a.place === '-' || a.place === null) p.place = null;
    else {
      const x = Number(a.place.x);
      const z = Number(a.place.z);
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('place — { x, z, label } (блоковые координаты)');
      p.place = { x: Math.round(x), z: Math.round(z), ...(a.place.label ? { label: String(a.place.label) } : {}) };
    }
  }
  const old = task?.checklist ?? [];
  if (a.checklist != null) p.checklist = checklistOf(a.checklist, old);
  if (a.checklist_add != null) p.checklist = [...(p.checklist ?? old), ...checklistOf(a.checklist_add)];
  if ((p.checklist?.length ?? 0) > 500) throw new Error('чеклист — до 500 пунктов');
  return p;
}

const changed = (p) =>
  Object.keys(p)
    .filter((k) => k !== 'updatedAt' && k !== 'updatedBy')
    .join(', ');

/** Отказ записи из-за условия Firestore (документ изменили между проверкой и записью) */
const preconditionFailed = (e) =>
  e instanceof FirestoreError &&
  (e.status === 400 || e.status === 409 || e.status === 404) &&
  /FAILED_PRECONDITION|NOT_FOUND/.test(e.body);

async function taskCreate(a) {
  const p = await taskFields({ ...a, title: a.title ?? '' });
  const now = Date.now();
  // как CreateTask в components/TaskDialog.tsx + createdAt/updatedAt из store.add
  const task = {
    title: p.title,
    description: p.description ?? '',
    status: p.status ?? 'todo',
    priority: p.priority ?? 1,
    rating: 1000,
    checklist: p.checklist ?? [],
    icon: p.icon ?? null,
    groupId: p.groupId ?? null,
    author: NICK,
    assignee: p.assignee ?? null,
    completedAt: p.completedAt ?? null,
    place: p.place ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const { id, updateTime } = await createDoc('tasks', task);
  tasksIndex.reset();
  const g = task.groupId ? (await groupMap()).get(task.groupId) : null;
  return [
    `Создана задача ${id} — ${task.title} [${STATUS[task.status]}, ${PRIORITY[task.priority]}${
      g ? `, группа «${g.name}»` : ', без группы'
    }${task.checklist.length ? `, чеклист ${task.checklist.length}` : ''}; автор ${NICK}]`,
    `на сайте: ${SITE}/?task=${id}`,
    `revision: ${updateTime}   ← для task_update; план к задаче — artifact_put task="${id}"`,
  ].join('\n');
}

async function taskUpdate(a) {
  const id = String(a.id ?? '').trim();
  const base = String(a.baseRevision ?? '').trim();
  if (!FIRESTORE_ID.test(id)) throw new Error('id — id задачи (20 символов) из task_get или tasks_list');
  if (!base) throw new Error('нужен baseRevision — revision из task_get');
  const cur = await getDoc('tasks', id);
  if (!cur) return `Отказ: задачи ${id} нет.`;
  if (cur.updateTime !== base)
    return `Отказ: задачу изменили после чтения — ваша ревизия ${base}, сейчас ${cur.updateTime} (изменена ${dateOf(cur.updatedAt)}). Перечитайте task_get и перенесите правки; ничего не записано.`;
  const p = await taskFields(a, cur);
  if (!Object.keys(p).length) throw new Error('нечего менять: передайте хотя бы одно поле');
  p.updatedAt = Date.now();
  try {
    const rev = await patchDoc('tasks', id, p, base);
    tasksIndex.reset();
    return `Сохранено: ${id} — ${p.title ?? cur.title}; изменено: ${changed(p)}. Новая ревизия ${rev}.\nна сайте: ${SITE}/?task=${id}`;
  } catch (e) {
    if (preconditionFailed(e))
      return 'Отказ: задачу изменили одновременно с записью. Перечитайте task_get; ничего не записано.';
    throw e;
  }
}

// ---------------------------------------------------------------- документы-планы (artifacts)

/** Название задачи — только из тёплого кеша, иначе id */
async function taskLabel(id) {
  if (!id) return 'свободный';
  if (Date.now() - tasksLoaded >= TTL) return `задача ${id}`;
  const t = (await tasksIndex()).find((x) => x.id === id);
  return t ? `задача ${id} «${t.title}»` : `задача ${id} (удалена?)`;
}

/** Задача по id или словам названия; "-" — без задачи */
async function taskRef(key) {
  const k = String(key).trim();
  if (k === '-' || !k) return { id: null };
  const r = await resolve('tasks', tasksIndex, k, (x) => x.title, 'задачи', ['title']);
  if (r.error) throw new Error(`задача: ${r.error}`);
  return { id: r.doc.id, title: r.doc.title };
}

async function artifactsList(a) {
  let list = [...(await artifactsIndex())];
  if (a.task != null) {
    const t = String(a.task).trim();
    const id = t === '-' ? null : FIRESTORE_ID.test(t) ? t : (await taskRef(t)).id;
    list = list.filter((d) => (d.taskId ?? null) === id);
  }
  const ws = words(a.query);
  if (ws.length) list = list.filter((d) => has(`${d.id} ${d.title}`, ws));
  list.sort(byUpdated);
  const shown = page(list, a, (d) => [
    `${d.id} — «${d.title}» [@@${d.taskId ?? ''}; ${who(d)}, ${dateOf(d.updatedAt)}]`,
  ]);
  // подписи задач подставляем после страницы, чтобы не искать по всему списку
  const ids = [...new Set([...shown.matchAll(/@@(\w*)/g)].map((m) => m[1]))];
  const labels = new Map(await Promise.all(ids.map(async (id) => [id, await taskLabel(id)])));
  return shown.replace(/@@(\w*)/g, (_, id) => labels.get(id));
}

async function artifactGet(a) {
  const r = await resolve('artifacts', artifactsIndex, a.id, (x) => x.title, 'документа');
  if (r.error) return r.error;
  const d = r.doc;
  const text = String(d.content ?? '');
  return [
    `${d.id} — «${d.title}»; ${await taskLabel(d.taskId)}; ${who(d)}; создан ${dateOf(d.createdAt)}, изменён ${dateOf(d.updatedAt)}`,
    `на сайте: ${SITE}/doc/${d.id}; ${text.length} симв.`,
    `revision: ${d.updateTime}   ← для artifact_put как baseRevision`,
    '',
    text ? lines(text, a) : '(пусто)',
  ].join('\n');
}

async function artifactPut(a) {
  const p = {};
  if (a.title != null) {
    p.title = String(a.title).trim();
    if (!p.title || p.title.length > 300) throw new Error('title — 1…300 символов');
  }
  if (a.content != null) {
    p.content = String(a.content);
    if (p.content.length > 900000) throw new Error('content — до 900 000 символов (правило Firestore)');
  }
  const task = a.task != null ? await taskRef(a.task) : null;
  if (task) p.taskId = task.id;
  const now = Date.now();
  const id = String(a.id ?? '').trim();
  if (!id) {
    // как TaskDialog/DocsSection: «План: <задача>» или «Новый план»
    const doc = {
      title: p.title ?? (task?.title ? `План: ${task.title}` : 'Новый план'),
      content: p.content ?? '',
      taskId: p.taskId ?? null,
      author: NICK,
      updatedBy: NICK,
      createdAt: now,
      updatedAt: now,
    };
    const r = await createDoc('artifacts', doc);
    artifactsIndex.reset();
    return [
      `Создан документ ${r.id} — «${doc.title}»; ${doc.taskId ? `к задаче ${doc.taskId}` : 'свободный'}; ${doc.content.length} симв.; автор ${NICK}`,
      `на сайте: ${SITE}/doc/${r.id}`,
      `revision: ${r.updateTime}`,
    ].join('\n');
  }
  const base = String(a.baseRevision ?? '').trim();
  if (!FIRESTORE_ID.test(id))
    throw new Error('id — id документа (20 символов) из artifact_get; без id — новый документ');
  if (!base) throw new Error('нужен baseRevision — revision из artifact_get');
  if (!Object.keys(p).length) throw new Error('нечего менять: передайте title, content или task');
  const cur = await getDoc('artifacts', id, ['title', 'updatedBy', 'updatedAt']);
  if (!cur) return `Отказ: документа ${id} нет.`;
  if (cur.updateTime !== base)
    return `Отказ: документ изменили после чтения — ваша ревизия ${base}, сейчас ${cur.updateTime} (правил ${cur.updatedBy ?? '?'} ${dateOf(cur.updatedAt)}). Перечитайте artifact_get и перенесите правки; ничего не записано.`;
  Object.assign(p, { updatedBy: NICK, updatedAt: now });
  try {
    const rev = await patchDoc('artifacts', id, p, base);
    artifactsIndex.reset();
    return `Сохранено: ${id} — «${p.title ?? cur.title}»; изменено: ${changed(p)}. Новая ревизия ${rev}.\nна сайте: ${SITE}/doc/${id}`;
  } catch (e) {
    if (preconditionFailed(e))
      return 'Отказ: документ изменили одновременно с записью. Перечитайте artifact_get; ничего не записано.';
    throw e;
  }
}

// ---------------------------------------------------------------- датапаки

const installMark = (d) => (d.install ? 'ставится' : 'не ставится');

/**
 * Задачи, где упомянуто имя датапака/схемы: связи в данных нет, ищем по тексту. Только из тёплого кеша задач —
 * грузить ради подсказки весь список (чтение на каждую задачу) не стоит; иначе — совет, как проверить.
 */
async function mentions(name) {
  const n = norm(name ?? '');
  if (n.length < 4) return null;
  if (Date.now() - tasksLoaded > TTL) return `в каких задачах упомянут — tasks_list query="${name}"`;
  const found = (await tasksIndex()).filter((t) => norm(`${t.title} ${t.description ?? ''}`).includes(n));
  return found.length ? `упоминается в задачах: ${found.map((t) => `${t.id} «${t.title}»`).join('; ')}` : null;
}

async function datapacksList(a) {
  let list = [...(await datapacksIndex())];
  const ws = words(a.query);
  if (ws.length) list = list.filter((d) => has(`${d.id} ${d.name} ${d.namespace} ${d.description ?? ''}`, ws));
  if (a.install != null) list = list.filter((d) => Boolean(d.install) === a.install);
  list.sort(byUpdated);
  return page(list, a, (d) => [
    `${d.id} — ${d.name} [ns ${d.namespace}, ${installMark(d)}; ${who(d)}, ${dateOf(d.updatedAt)}]${
      d.description ? `: ${short(d.description, 150)}` : ''
    }`,
  ]);
}

async function datapackGet(a) {
  const r = await resolve('datapacks', datapacksIndex, a.id, (x) => x.name, 'датапака');
  if (r.error) return r.error;
  const d = r.doc;
  const files = datapackFiles({ name: d.name, description: d.description, entries: d.entries ?? [] });
  if (a.path) {
    const p = String(a.path).trim();
    const key = files[p] != null ? p : Object.keys(files).find((k) => k.endsWith(p));
    if (key == null) return `В датапаке ${d.name} нет файла ${p}. Файлы: ${Object.keys(files).join(', ')}`;
    return `${zipName(d)} → ${key}\n${lines(files[key], a)}`;
  }
  const entries = d.entries ?? [];
  const out = [
    `${d.id} — ${d.name} (${zipName(d)})`,
    `namespace: ${d.namespace}; ${installMark(d)} в мир (программа tfc); ${who(d)}; изменён ${dateOf(d.updatedAt)}`,
  ];
  if (d.description) out.push(`описание: ${d.description}`);
  const m = await mentions(d.name);
  if (m) out.push(m);
  out.push('', `Записи (${entries.length}); файл целиком — path=<путь>:`);
  for (const e of entries) {
    const src = e.sourceRecipe ? `; из ${named(e.sourceRecipe)}` : '';
    out.push(
      `• ${e.kind} ${e.path} (${e.content?.length ?? 0} симв.${e.recipeType ? `, ${e.recipeType}` : ''}${src})${
        e.note ? ` — ${short(e.note, 200)}` : ''
      }`,
    );
  }
  const dup = entries.length + 1 - Object.keys(files).length;
  if (dup > 0) out.push(`внимание: ${dup} записей с повторным путём — в zip попадёт последняя`);
  return out.join('\n');
}

// ---------------------------------------------------------------- скрипты KubeJS с сайта

async function kubejsSiteList(a) {
  let list = [...(await scriptsIndex())];
  const ws = words(a.query);
  if (ws.length) list = list.filter((s) => has(`${s.id} ${s.fileName}`, ws));
  if (a.install != null) list = list.filter((s) => Boolean(s.install) === a.install);
  list.sort(byUpdated);
  const head =
    'Скрипты KubeJS для server_scripts/, добавленные на сайте (свои скрипты сборки — kubejs.json, не здесь):';
  return `${head}\n${page(list, a, (s) => [`${s.id} — ${s.fileName} [${installMark(s)}; ${who(s)}, ${dateOf(s.updatedAt)}]`])}`;
}

async function kubejsSiteGet(a) {
  const r = await resolve('kubejsScripts', scriptsIndex, a.id, (x) => x.fileName, 'скрипта');
  if (r.error) return r.error;
  const s = r.doc;
  return [
    `${s.id} — server_scripts/${s.fileName}; ${installMark(s)} на сервер; ${who(s)}; изменён ${dateOf(s.updatedAt)}`,
    lines(s.text, a),
  ].join('\n');
}

// ---------------------------------------------------------------- схемы

const sizeOf = (s) => (s.size?.length ? s.size.join('×') : '?');

async function schematicsList(a) {
  let list = [...(await schematicsIndex())];
  const ws = words(a.query);
  if (ws.length)
    list = list.filter((s) =>
      has(`${s.id} ${s.name} ${s.fileName} ${(s.replace ?? []).map((x) => `${x.from} ${x.to}`).join(' ')}`, ws),
    );
  list.sort(byUpdated);
  return page(list, a, (s) => [
    `${s.id} — ${s.name} (${s.fileName}, ${sizeOf(s)}, ${s.blocks ?? '?'} блоков, замен ${(s.replace ?? []).length}; ${who(s)}, ${dateOf(s.updatedAt)})`,
  ]);
}

async function schematicGet(a) {
  const r = await resolve('schematics', schematicsIndex, a.id, (x) => x.name, 'схемы', [...SCHEM_MASK, 'shape']);
  if (r.error) return r.error;
  const s = r.doc;
  const out = [
    `${s.id} — ${s.name}`,
    `файл: ${s.fileName} (${kb(s.fileSize)}, files/${s.fileId}); габариты ${sizeOf(s)}; блоков ${s.blocks ?? '?'} (до удалений)`,
    `${who(s)}; изменена ${dateOf(s.updatedAt)}`,
  ];
  if (s.shape) {
    const sh = s.shape;
    out.push(
      `при скачивании: ${sh.crop ? 'обрезка, ' : ''}отступы по бокам ${sh.sides}, снизу ${sh.bottom}, сверху ${sh.top}` +
        `${sh.clearAir ? ', воздух очищает место' : ''}${
          sh.platform
            ? `; платформа ${sh.platformBlock ?? '?'} высотой ${sh.platformHeight ?? 1}${sh.platformHollow ? ' (полая)' : ''}`
            : ''
        }`,
    );
  }
  if (s.description) out.push('', 'Описание:', s.description);
  const rep = s.replace ?? [];
  out.push('', `Замены блоков (${rep.length}):`);
  for (const x of rep) out.push(`${named(x.from)} → ${x.to === '#remove' ? 'удалить' : named(x.to)}`);
  out.push('', 'Материалы в документе не хранятся: их считает сайт по файлу схемы (раздел «Схемы»).');
  const m = await mentions(s.name);
  if (m) out.push(m);
  return out.join('\n');
}

// ---------------------------------------------------------------- описание

const TASK_PROPS = {
  title: str('название (до 300 символов)'),
  description: str('описание, Markdown'),
  group: str('id или название группы (groups_list); "-" — без группы'),
  priority: {
    type: 'integer',
    enum: [0, 1, 2, 3],
    description: 'важность: 0 низкая, 1 обычная (по умолчанию), 2 высокая, 3 критическая',
  },
  status: {
    type: 'string',
    enum: ['todo', 'doing', 'done'],
    description: 'надо сделать (по умолчанию) / в работе / готово',
  },
  checklist: {
    type: 'array',
    description:
      'пункты: { text, done } — галочка; { itemId, qty, got, text? } — ресурс собрать (id предмета из items_search); можно просто строку',
    items: {
      type: ['object', 'string'],
      properties: {
        text: str('текст пункта'),
        done: { type: 'boolean', description: 'отмечен' },
        itemId: str('id предмета — пункт-ресурс'),
        qty: num('сколько нужно (1)'),
        got: num('сколько уже есть (0)'),
      },
    },
  },
  icon: str('значок задачи — id предмета; "-" — убрать'),
  assignee: str('кто делает (ник); "-" — никто'),
  place: {
    type: 'object',
    description: 'место в мире — показывается на карте',
    properties: { x: num('блок X'), z: num('блок Z'), label: str('подпись') },
  },
};

const install = { type: 'boolean', description: 'только отмеченные «ставить» (true) или только неотмеченные (false)' };

export const TOOLS = [
  {
    name: 'tasks_list',
    description:
      'Задачи сайта (Firestore tasks) и группы: поиск по словам (название, описание, чеклист), отбор по статусу, исполнителю, группе. Сначала незавершённые и важные. Только чтение; список кешируется на 3 мин.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('слова'),
        status: { type: 'string', enum: ['todo', 'doing', 'done'], description: 'надо сделать / в работе / готово' },
        assignee: str('ник исполнителя (часть); "-" — без исполнителя'),
        group: str('id или часть названия группы; "-" — без группы'),
        ...paging,
      },
    },
    handler: counted(tasksList),
  },
  {
    name: 'task_get',
    description:
      'Задача целиком: описание, чеклист (ресурсы с названиями), место, вложения (имя/размер/id, без содержимого) и привязанные документы. id — из tasks_list или слова названия.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('id задачи или слова названия'),
        doc_chars: num('сколько символов документа показать (4000)'),
      },
      required: ['id'],
    },
    handler: counted(taskGet),
  },
  {
    name: 'groups_list',
    description:
      'Группы задач сайта (Firestore groups): id, название, значок, порядок; поиск по словам — чтобы найти группу по имени («фиксы»). Число задач — если список задач уже в кеше.',
    inputSchema: { type: 'object', properties: { query: str('слова названия'), ...paging } },
    handler: counted(groupsList),
  },
  {
    name: 'task_create',
    description: `Создать задачу на сайте (**запись в общую базу**, автор Claude) — как кнопка «Новая задача»: рейтинг 1000, createdAt/updatedAt, completedAt при status=done. Вернёт id, ссылку и revision. Подробный план — отдельным документом: artifact_put task=<id>.`,
    inputSchema: {
      type: 'object',
      properties: TASK_PROPS,
      required: ['title'],
    },
    handler: counted(taskCreate),
  },
  {
    name: 'task_update',
    description:
      'Поменять поля задачи (**запись в общую базу**); переданные поля заменяются, остальные не трогаются. Отказ, если задачу изменили после чтения: baseRevision — revision из task_get. checklist заменяет весь чеклист (id прежних пунктов сохраняются по предмету/тексту), checklist_add — дописывает.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('id задачи (20 символов)'),
        baseRevision: str('revision из task_get'),
        ...TASK_PROPS,
        checklist_add: { ...TASK_PROPS.checklist, description: 'пункты, дописываемые в конец чеклиста' },
      },
      required: ['id', 'baseRevision'],
    },
    handler: counted(taskUpdate),
  },
  {
    name: 'artifacts_list',
    description:
      'Документы-планы сайта (Firestore artifacts, раздел «Документы» и планы в задачах): id, название, задача, автор. Поиск по словам названия; task — документы задачи ("-" — свободные). Текст — artifact_get.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('слова названия'),
        task: str('id или слова названия задачи; "-" — без задачи'),
        ...paging,
      },
    },
    handler: counted(artifactsList),
  },
  {
    name: 'artifact_get',
    description: 'Документ-план целиком (Markdown по строкам), его задача и revision для artifact_put.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('id документа или слова названия'),
        offset: num('с какой строки'),
        limit: num('сколько строк (300)'),
      },
      required: ['id'],
    },
    handler: counted(artifactGet),
  },
  {
    name: 'artifact_put',
    description:
      'Создать или поменять документ-план (**запись в общую базу**, подпись Claude). Без id — новый документ (название по умолчанию «План: <задача>»). С id — меняются только переданные title/content/task; нужен baseRevision из artifact_get, отказ, если документ изменили после чтения. content заменяет текст целиком.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('id документа; пусто — создать новый'),
        baseRevision: str('revision из artifact_get (для правки)'),
        title: str('название'),
        content: str('текст Markdown целиком'),
        task: str('id или слова названия задачи, к которой привязать; "-" — отвязать'),
      },
    },
    handler: counted(artifactPut),
  },
  {
    name: 'datapacks_list',
    description: 'Датапаки сайта (Firestore datapacks): имя, namespace, ставится ли в мир, автор. Только чтение.',
    inputSchema: { type: 'object', properties: { query: str('слова'), install, ...paging } },
    handler: counted(datapacksList),
  },
  {
    name: 'datapack_get',
    description:
      'Датапак: записи (вид, путь, тип рецепта, исходный рецепт), в каких задачах упомянут; path — один файл zip целиком (как собирает сайт, вкл. pack.mcmeta), по строкам.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('id или имя датапака'),
        path: str('путь файла в zip (можно конец пути)'),
        offset: num('с какой строки'),
        limit: num('сколько строк (300)'),
      },
      required: ['id'],
    },
    handler: counted(datapackGet),
  },
  {
    name: 'kubejs_site_list',
    description:
      'Скрипты KubeJS, добавленные на сайте (Firestore kubejsScripts, для server_scripts/): имя файла, ставится ли на сервер, автор. Скрипты самой сборки — не здесь.',
    inputSchema: { type: 'object', properties: { query: str('слова в имени файла'), install, ...paging } },
    handler: counted(kubejsSiteList),
  },
  {
    name: 'kubejs_site_get',
    description: 'Текст скрипта KubeJS с сайта по строкам.',
    inputSchema: {
      type: 'object',
      properties: { id: str('id или имя файла'), offset: num('с какой строки'), limit: num('сколько строк (300)') },
      required: ['id'],
    },
    handler: counted(kubejsSiteGet),
  },
  {
    name: 'schematics_list',
    description:
      'Схемы Create в библиотеке сайта (Firestore schematics): имя, файл, габариты, число блоков и замен. Поиск по словам, в т. ч. по id блоков в заменах.',
    inputSchema: { type: 'object', properties: { query: str('слова'), ...paging } },
    handler: counted(schematicsList),
  },
  {
    name: 'schematic_get',
    description:
      'Схема: файл, габариты, настройки скачивания (обрезка, платформа), описание, замены блоков с названиями. Материалы в базе не хранятся.',
    inputSchema: { type: 'object', properties: { id: str('id или имя схемы') }, required: ['id'] },
    handler: counted(schematicGet),
  },
];
