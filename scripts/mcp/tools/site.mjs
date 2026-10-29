/**
 * Инструменты MCP: контент сайта из Firestore — задачи и группы, документы-планы, датапаки, скрипты KubeJS с сайта,
 * схемы Create. Пишут только task_create / task_update / artifact_put / datapack_put (подпись — имя агента, правка — с
 * проверкой ревизии, как guide_put). Экономим чтения (50 тыс. в сутки на всех): списки — с mask (только нужные поля) и кешем на
 * несколько минут, документ целиком — отдельным GET по запросу, вложения задачи — запросом по taskId.
 * В конце каждого ответа — сколько чтений Firestore он стоил (0 — всё из кеша).
 */
import { DOCS, fromValue } from '../../firestore-rest.mjs';
import { datapackFiles, zipName } from '@tfc/core/datapackFiles';
import { itemName, readJson } from '../data.mjs';
import { checkDatapack, deploymentNote, makeEntry, saveDatapack } from '../datapack-write.mjs';
import { FirestoreError, api, cached, createDoc, listAll, patchDoc } from '../firestore.mjs';
import { resetSiteRecipes } from '../site-datapacks.mjs';
import { dateOf, nameOf, named, NICK, norm, num, page, paging, short, str, words } from '../fmt.mjs';

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
const usersIndex = cached(TTL, () => listCounted('users', ['nick', 'firstSeen', 'lastSeen']));
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

/** Документ целиком: id сайта — сразу GET (1 чтение), иначе поиск по кешированному списку и GET найденного */
async function resolve(coll, index, key, label, what, mask) {
  let k = String(key ?? '').trim();
  // Вставили ссылку или строку «Для агента» с сайта — берём id из ?task= / ?doc= или «id …»
  const ref = k.match(/(?:[?&](?:task|doc)=|\bid:?\s+)([A-Za-z0-9]{20})\b/);
  if (ref) k = ref[1];
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

// ---------------------------------------------------------------- участники

async function usersList(a) {
  let list = [...(await usersIndex())].sort((x, y) => (y.lastSeen ?? 0) - (x.lastSeen ?? 0));
  const ws = words(a.query);
  if (ws.length) list = list.filter((u) => has(u.id, ws));
  return page(list, a, (u) => {
    const first = u.firstSeen ? ', впервые ' + dateOf(u.firstSeen) : '';
    return [u.id + ' — заходил(а) ' + dateOf(u.lastSeen) + first];
  });
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

/** Как uid() в src/shared/lib/util.ts — id пункта чеклиста */
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

function deploymentMark(d) {
  const deployment = (readJson('kubejs.json', {}).datapacks ?? []).find((p) => p.id === d.id);
  return deployment
    ? `в сборке: ${deployment.path}, содержимое ${deployment.contentHash.slice(0, 12)}, подтвердил ${deployment.confirmedBy}${deployment.sourceUpdatedAt !== d.updatedAt ? '; карточка после подтверждения менялась' : ''}`
    : `${installMark(d)} в мир`;
}

async function datapacksList(a) {
  let list = [...(await datapacksIndex())];
  for (const d of readJson('kubejs.json', {}).datapacks ?? [])
    if (!list.some((p) => p.id === d.id))
      list.push({
        ...d,
        namespace: '—',
        author: d.confirmedBy,
        updatedAt: d.confirmedAt,
        install: false,
        description: 'Подтверждённый ZIP снимка без карточки сайта',
      });
  const ws = words(a.query);
  if (ws.length) list = list.filter((d) => has(`${d.id} ${d.name} ${d.namespace} ${d.description ?? ''}`, ws));
  if (a.install != null) list = list.filter((d) => Boolean(d.install) === a.install);
  list.sort(byUpdated);
  return page(list, a, (d) => [
    `${d.id} — ${d.name} [ns ${d.namespace}, ${deploymentMark(d)}; ${who(d)}, ${dateOf(d.updatedAt)}]${
      d.description ? `: ${short(d.description, 150)}` : ''
    }`,
  ]);
}

async function datapackGet(a) {
  const published = (readJson('kubejs.json', {}).datapacks ?? []).find(
    (d) => d.id === a.id || norm(d.name) === norm(a.id),
  );
  if (published?.snapshotSource)
    return `${published.id} — ${published.name}\nВ сборке: ${published.path}; ZIP ${published.sha256}; содержимое ${published.contentHash}; подтвердил ${published.confirmedBy}.\nКарточки сайта нет. Исходное имя: ${published.fileName}; файлы доступны в снимке сборки (tfc datapacks files).`;
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
    `namespace: ${d.namespace}; ${deploymentMark(d)} (программа tfc); ${who(d)}; изменён ${dateOf(d.updatedAt)}`,
    `revision: ${d.updateTime}   ← для datapack_put как baseRevision`,
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

const entryList = (v, what) => {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error(`${what} — массив`);
  return v;
};

async function datapackPut(a) {
  const key = String(a.id ?? '').trim();
  let cur = null;
  if (key) {
    const base = String(a.baseRevision ?? '').trim();
    if (!base) throw new Error('нужен baseRevision — revision из datapack_get');
    const r = await resolve('datapacks', datapacksIndex, key, (x) => x.name, 'датапака');
    if (r.error) return `Отказ: ${r.error}`;
    cur = r.doc;
    if (cur.updateTime !== base)
      return `Отказ: датапак изменили после чтения — ваша ревизия ${base}, сейчас ${cur.updateTime} (правил ${cur.updatedBy ?? '?'} ${dateOf(cur.updatedAt)}). Перечитайте datapack_get и перенесите правки; ничего не записано.`;
  } else if (a.name == null) throw new Error('новый датапак: нужен name (или id — для правки существующего)');

  const p = {};
  if (a.name != null) p.name = String(a.name).trim();
  if (a.namespace != null) p.namespace = String(a.namespace).trim();
  if (a.description != null) p.description = String(a.description);
  if (a.install != null) p.install = Boolean(a.install);
  const pack = { name: '', namespace: 'tfc_plans', description: '', install: false, ...cur, ...p };
  const before = cur?.entries ?? [];
  let entries = [...before];
  const ops = [];
  if (a.entries != null) {
    const prev = new Map(before.map((e) => [e.path, e]));
    entries = entryList(a.entries, 'entries').map((e) => makeEntry(e, prev.get(String(e.path ?? '').trim())));
    ops.push(`записи заменены целиком: было ${before.length}, стало ${entries.length}`);
  }
  for (const { from, to } of entryList(a.rename, 'rename')) {
    const e = entries.find((x) => x.path === from);
    if (!e) throw new Error(`rename: записи ${from} нет`);
    if (entries.some((x) => x.path === to)) throw new Error(`rename: путь ${to} уже занят`);
    entries = entries.map((x) => (x === e ? { ...x, path: String(to).trim() } : x));
    ops.push(`переименовано: ${from} → ${to}`);
  }
  for (const path of entryList(a.remove, 'remove')) {
    if (!entries.some((x) => x.path === path)) throw new Error(`remove: записи ${path} нет`);
    entries = entries.filter((x) => x.path !== path);
    ops.push(`удалено: ${path}`);
  }
  for (const input of entryList(a.upsert, 'upsert')) {
    const path = String(input.path ?? '').trim();
    const i = entries.findIndex((x) => x.path === path);
    const e = makeEntry(input, i >= 0 ? entries[i] : null);
    if (i >= 0) entries[i] = e;
    else entries.push(e);
    ops.push(`${i >= 0 ? 'заменено' : 'добавлено'}: ${e.kind} ${path}`);
  }
  pack.entries = entries;
  if (a.entries != null || ops.length) p.entries = entries;
  if (cur && !Object.keys(p).length)
    throw new Error(
      'нечего менять: передайте name, namespace, description, install, entries, upsert, remove или rename',
    );

  const { errors, warnings } = checkDatapack(pack);
  // Имя сверяем, только когда оно новое: список датапаков стоит чтение на документ
  const others =
    p.name != null && p.name !== cur?.name
      ? (await datapacksIndex()).filter((d) => d.id !== cur?.id && norm(d.name) === norm(pack.name))
      : [];
  if (others.length)
    warnings.push(`имя совпадает с датапаком ${others.map((d) => d.id).join(', ')} — в мире у них будет один zip`);
  const out = [];
  if (ops.length) out.push(...ops.map((o) => `• ${o}`));
  if (errors.length) {
    out.unshift(`Отказ: ${errors.length} ошибок, ничего не записано.`);
    out.push('', 'Ошибки:', ...errors.map((x) => `✗ ${x}`));
  } else if (a.dry_run) out.unshift(`Проверка без записи (dry_run): ${pack.name}, записей ${entries.length}.`);
  else {
    try {
      const { name, namespace, description, install } = pack;
      const fields = cur ? p : { name, namespace, description, install, entries };
      const r = await saveDatapack({ id: cur?.id, base: cur?.updateTime, fields, nick: NICK });
      datapacksIndex.reset();
      resetSiteRecipes();
      out.unshift(
        cur
          ? `Сохранено: ${r.id} — ${pack.name}; изменено: ${Object.keys(p).join(', ')}; записей ${entries.length}; подпись ${NICK}.`
          : `Создан датапак ${r.id} — ${pack.name} (ns ${pack.namespace}, ${pack.install ? 'предлагать в мир' : 'не ставится'}); записей ${entries.length}; автор ${NICK}.`,
        `revision: ${r.updateTime}   ← для следующего datapack_put как baseRevision`,
        `на сайте: ${SITE}/datapacks`,
      );
      const dep = deploymentNote(r.id);
      if (dep) out.push('', dep);
    } catch (e) {
      if (preconditionFailed(e))
        return 'Отказ: датапак изменили одновременно с записью. Перечитайте datapack_get; ничего не записано.';
      throw e;
    }
  }
  if (errors.length || a.dry_run) {
    const dep = deploymentNote(cur?.id);
    if (dep) out.push('', dep);
  }
  if (warnings.length) out.push('', `Предупреждения (${warnings.length}):`, ...warnings.map((x) => `⚠ ${x}`));
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
  title: str('title (up to 300 chars)'),
  description: str('description, Markdown'),
  group: str('group id or name (groups_list); "-" — no group'),
  priority: {
    type: 'integer',
    enum: [0, 1, 2, 3],
    description: 'priority: 0 low, 1 normal (default), 2 high, 3 critical',
  },
  status: {
    type: 'string',
    enum: ['todo', 'doing', 'done'],
    description: 'todo (default) / doing / done',
  },
  checklist: {
    type: 'array',
    description:
      'items: { text, done } — checkbox; { itemId, qty, got, text? } — resource to collect (item id from items_search); a plain string also works',
    items: {
      type: ['object', 'string'],
      properties: {
        text: str('item text'),
        done: { type: 'boolean', description: 'checked' },
        itemId: str('item id — resource item'),
        qty: num('how many needed (1)'),
        got: num('how many already collected (0)'),
      },
    },
  },
  icon: str('task icon — item id; "-" — remove'),
  assignee: str('who does it (nick); "-" — nobody'),
  place: {
    type: 'object',
    description: 'place in the world — shown on the map',
    properties: { x: num('block X'), z: num('block Z'), label: str('label') },
  },
};

const DP_ENTRY = {
  type: 'object',
  properties: {
    path: str('data/<ns>/recipe/….json, data/<ns>/tags/item/….json, …'),
    content: { description: 'file text, or a JSON object (saved pretty-printed)' },
    kind: { type: 'string', enum: ['add', 'replace', 'remove', 'file'], description: 'default inferred' },
    note: str('note for the site editor; "" — clear'),
    sourceRecipe: str('recipe id this was taken from (for change tracking)'),
  },
  required: ['path'],
};

const install = { type: 'boolean', description: 'only flagged «ставить» (true) or only unflagged (false)' };

export const TOOLS = [
  {
    name: 'tasks_list',
    description:
      'Site tasks (Firestore tasks) and groups: search by words (title, description, checklist), filter by status, assignee, group. Unfinished and important first. Read-only; list cached for 3 min.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('words'),
        status: { type: 'string', enum: ['todo', 'doing', 'done'], description: 'todo / doing / done' },
        assignee: str('assignee nick (part); "-" — unassigned'),
        group: str('group id or part of its name; "-" — no group'),
        ...paging,
      },
    },
    handler: counted(tasksList),
  },
  {
    name: 'task_get',
    description:
      'Whole task: description, checklist (resources with names), place, attachments (name/size/id, no content) and linked docs. id — from tasks_list or title words.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('task id or title words'),
        doc_chars: num('how many doc characters to show (4000)'),
      },
      required: ['id'],
    },
    handler: counted(taskGet),
  },
  {
    name: 'groups_list',
    description:
      'Site task groups (Firestore groups): id, name, icon, order; search by words to find a group by name («фиксы»). Task counts if the task list is already cached.',
    inputSchema: { type: 'object', properties: { query: str('name words'), ...paging } },
    handler: counted(groupsList),
  },
  {
    name: 'users_list',
    description:
      'Site members (Firestore users, the nick directory written on every visit): nick, first and last seen. Use to know who a task can be assigned to (task_update assignee=…).',
    inputSchema: { type: 'object', properties: { query: str('nick words'), ...paging } },
    handler: counted(usersList),
  },
  {
    name: 'task_create',
    description: `Create a site task (**write to the shared database**, author = agent nick) — like the «Новая задача» button: rating 1000, createdAt/updatedAt, completedAt when status=done. Returns id, link and revision. A detailed plan goes in a separate doc: artifact_put task=<id>.`,
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
      'Change task fields (**write to the shared database**); passed fields are replaced, others untouched. Refused if the task changed after reading: baseRevision — revision from task_get. checklist replaces the whole checklist (existing item ids kept by item/text), checklist_add appends.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('task id (20 chars)'),
        baseRevision: str('revision from task_get'),
        ...TASK_PROPS,
        checklist_add: { ...TASK_PROPS.checklist, description: 'items appended to the end of the checklist' },
      },
      required: ['id', 'baseRevision'],
    },
    handler: counted(taskUpdate),
  },
  {
    name: 'artifacts_list',
    description:
      'Site plan docs (Firestore artifacts, the «Документы» section and plans in tasks): id, title, task, author. Search by title words; task — docs of a task ("-" — unattached). Text — artifact_get.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('name words'),
        task: str('task id or title words; "-" — no task'),
        ...paging,
      },
    },
    handler: counted(artifactsList),
  },
  {
    name: 'artifact_get',
    description: 'Whole plan doc (Markdown by lines), its task and revision for artifact_put.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('doc id or title words'),
        offset: num('start line'),
        limit: num('how many lines (300)'),
      },
      required: ['id'],
    },
    handler: counted(artifactGet),
  },
  {
    name: 'artifact_put',
    description:
      'Create or change a plan doc (**write to the shared database**, signed with the agent nick). Without id — new doc (default title «План: <задача>»). With id — only the passed title/content/task change; needs baseRevision from artifact_get, refused if the doc changed after reading. content replaces the whole text.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('doc id; empty — create a new one'),
        baseRevision: str('revision from artifact_get (for edits)'),
        title: str('title'),
        content: str('whole Markdown text'),
        task: str('id or title words of the task to attach to; "-" — detach'),
      },
    },
    handler: counted(artifactPut),
  },
  {
    name: 'datapacks_list',
    description:
      'Site datapacks (Firestore datapacks): name, namespace, world opt-in and confirmed pack deployment from the published snapshot, author. Edit — datapack_put.',
    inputSchema: { type: 'object', properties: { query: str('words'), install, ...paging } },
    handler: counted(datapacksList),
  },
  {
    name: 'datapack_get',
    description:
      'Datapack: records (kind, path, recipe type, source recipe), tasks mentioning it, revision for datapack_put; path — one zip file in full (as the site builds it, incl. pack.mcmeta), by lines.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('datapack id or name'),
        path: str('file path in the zip (path ending is fine)'),
        offset: num('start line'),
        limit: num('how many lines (300)'),
      },
      required: ['id'],
    },
    handler: counted(datapackGet),
  },
  {
    name: 'datapack_put',
    description:
      'Create or change a site datapack (**write to the shared database**, signed with the agent nick) instead of ad-hoc scripts. Without id — new (name required, namespace default tfc_plans). With id — needs baseRevision from datapack_get; only passed fields change. Files: entries replaces all; upsert adds/replaces by path; remove deletes by path; rename moves a path. kind is inferred (non-recipe → file, neoforge:false stub → remove, recipe id already in the pack → replace, else add); sourceRecipe/sourceHash kept or computed. Refused on bad JSON, path not data/<ns>/…, duplicate paths, Firestore limits; warns like the site editor (missing items/tags, KubeJS removal, changed source recipe) and when the pack has a confirmed pinned version (editing the card does not change it). dry_run — check only.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('datapack id or exact name; empty — create'),
        baseRevision: str('revision from datapack_get (for edits)'),
        name: str('name (zip file name), ≤80'),
        namespace: str('namespace for new recipes'),
        description: str('description (pack.mcmeta)'),
        install: { type: 'boolean', description: 'offer to install into the world for testing (site checkbox)' },
        entries: { type: 'array', description: 'replace ALL files', items: DP_ENTRY },
        upsert: { type: 'array', description: 'add or replace files by path', items: DP_ENTRY },
        remove: { type: 'array', description: 'paths to delete', items: { type: 'string' } },
        rename: {
          type: 'array',
          description: 'path moves',
          items: {
            type: 'object',
            properties: { from: str('old path'), to: str('new path') },
            required: ['from', 'to'],
          },
        },
        dry_run: { type: 'boolean', description: 'only check and show the result, write nothing' },
      },
    },
    handler: counted(datapackPut),
  },
  {
    name: 'kubejs_site_list',
    description:
      "KubeJS scripts added on the site (Firestore kubejsScripts, for server_scripts/): file name, whether installed on the server, author. The pack's own scripts are not here.",
    inputSchema: { type: 'object', properties: { query: str('words in the file name'), install, ...paging } },
    handler: counted(kubejsSiteList),
  },
  {
    name: 'kubejs_site_get',
    description: 'Site KubeJS script text by lines.',
    inputSchema: {
      type: 'object',
      properties: { id: str('id or file name'), offset: num('start line'), limit: num('how many lines (300)') },
      required: ['id'],
    },
    handler: counted(kubejsSiteGet),
  },
  {
    name: 'schematics_list',
    description:
      'Create schematics in the site library (Firestore schematics): name, file, size, block and replacement counts. Search by words, incl. block ids in replacements.',
    inputSchema: { type: 'object', properties: { query: str('words'), ...paging } },
    handler: counted(schematicsList),
  },
  {
    name: 'schematic_get',
    description:
      'Schematic: file, size, download settings (crop, platform), description, block replacements with names. Materials are not stored in the database.',
    inputSchema: { type: 'object', properties: { id: str('schematic id or name') }, required: ['id'] },
    handler: counted(schematicGet),
  },
];
