#!/usr/bin/env node
/**
 * Разовый перенос задач разработки из Firestore на сервер сборки (SQLite, /dev/…) — docs/plans/dev-tracker.md.
 *
 *   node scripts/dev-migrate.mjs                 — пробно: что будет перенесено (только чтения Firestore)
 *   node scripts/dev-migrate.mjs --import        — перенести (повтор безопасен: уже перенесённые пропускаются)
 *   node scripts/dev-migrate.mjs --delete        — удалить перенесённое из Firestore (задачи, их планы, пустые группы);
 *                                                  сначала сверяет, что на сервере есть всё; задачи с вложениями
 *                                                  не трогает — их список печатает
 *   --group <имя или id>  (можно несколько)      — какие группы (по умолчанию «Разработка» и «Фиксы»)
 *
 * Firestore — от имени сервисного ключа (GOOGLE_APPLICATION_CREDENTIALS / TFC_FIRESTORE_KEY) или firebase login.
 * Сервер сборки — ключ администратора: TFC_PACK_URL / TFC_PACK_TOKEN, .env.local или вход в tfc.
 * Чтений Firestore: группы + все задачи + планы и вложения перенесённых задач — один раз.
 */
import { DOCS, fromValue } from './firestore-rest.mjs';
import { api, listAll } from './mcp/firestore.mjs';
import { packServer } from './pack-fetch.mjs';

const argv = process.argv.slice(2);
const mode = argv.includes('--delete') ? 'delete' : argv.includes('--import') ? 'import' : 'dry';
const wanted = argv.flatMap((a, i) => (argv[i - 1] === '--group' ? [a] : []));
const GROUPS = wanted.length ? wanted : ['Разработка', 'Фиксы'];
const norm = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase();

/** Документы коллекции, где field ∈ values (по 30 значений за запрос) */
async function queryIn(coll, field, values, mask) {
  const out = [];
  for (let i = 0; i < values.length; i += 30) {
    const structuredQuery = {
      from: [{ collectionId: coll }],
      where: {
        fieldFilter: {
          field: { fieldPath: field },
          op: 'IN',
          value: { arrayValue: { values: values.slice(i, i + 30).map((v) => ({ stringValue: v })) } },
        },
      },
      ...(mask && { select: { fields: mask.map((fieldPath) => ({ fieldPath })) } }),
    };
    const r = await api(`${DOCS}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery }) });
    for (const x of r) {
      if (!x.document) continue;
      const f = Object.fromEntries(Object.entries(x.document.fields ?? {}).map(([k, v]) => [k, fromValue(v)]));
      out.push({ id: x.document.name.split('/').pop(), ...f });
    }
  }
  return out;
}

async function dev(method, path, body) {
  const srv = packServer();
  if (!srv) throw new Error('нет адреса сервера сборки (TFC_PACK_URL / TFC_PACK_TOKEN или вход в tfc)');
  const res = await fetch(`${srv.url}/dev/${path}`, {
    method,
    headers: { Authorization: `Bearer ${srv.token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`/dev/${path}: ${out.error ?? res.status}`);
  return out;
}

/** Пункт чек-листа сайта → { text, done }; ресурс — «id × количество» */
function check(c) {
  if (c.itemId) return { text: `${c.itemId} × ${c.qty ?? 1}`, done: (c.got ?? 0) >= (c.qty ?? 1) };
  return { text: String(c.text ?? '').slice(0, 500) || '—', done: c.done === true };
}

const STATUS = { todo: 'todo', doing: 'doing', done: 'done' };

const groups = await listAll('groups', ['name']);
const picked = groups.filter((g) => GROUPS.some((w) => g.id === w || norm(g.name) === norm(w)));
if (!picked.length) throw new Error(`нет групп ${GROUPS.join(', ')}; есть: ${groups.map((g) => g.name).join(', ')}`);
const kindOf = new Map(picked.map((g) => [g.id, /фикс|fix/i.test(g.name) ? 'fix' : 'feature']));

const all = await listAll('tasks');
const tasks = all.filter((t) => kindOf.has(t.groupId));
const ids = tasks.map((t) => t.id);
const docs = ids.length ? await queryIn('artifacts', 'taskId', ids) : [];
const files = ids.length ? await queryIn('files', 'taskId', ids, ['taskId', 'name']) : [];
const withFiles = new Set(files.map((f) => f.taskId));

const payload = {
  tasks: tasks.map((t) => ({
    legacy: t.id,
    title: String(t.title ?? '').slice(0, 300) || '(без названия)',
    body: t.description ?? '',
    kind: kindOf.get(t.groupId),
    status: STATUS[t.status] ?? 'todo',
    priority: [0, 1, 2, 3].includes(t.priority) ? t.priority : 1,
    assignee: t.assignee || null,
    checklist: (t.checklist ?? []).map(check),
    by: t.author || 'неизвестно',
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    doneAt: t.completedAt ?? null,
    notes: withFiles.has(t.id)
      ? [
          {
            author: 'перенос',
            text: `Вложения остались в Firestore у задачи ${t.id}: ${files
              .filter((f) => f.taskId === t.id)
              .map((f) => f.name)
              .join(', ')}`,
            createdAt: Date.now(),
          },
        ]
      : [],
  })),
  docs: docs.map((d) => ({
    legacy: d.id,
    title: String(d.title ?? '').slice(0, 300) || 'План',
    content: d.content ?? '',
    task: d.taskId,
    by: d.author || d.updatedBy || 'неизвестно',
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  })),
};

const byStatus = Object.groupBy(tasks, (t) => t.status ?? 'todo');
console.log(
  `Группы: ${picked.map((g) => `${g.name} (${g.id})`).join(', ')}\n` +
    `Задач: ${tasks.length} (${Object.entries(byStatus)
      .map(([s, l]) => `${s} ${l.length}`)
      .join(', ')}), планов: ${docs.length}, задач с вложениями: ${withFiles.size}`,
);

if (mode === 'dry') {
  for (const t of payload.tasks.slice(0, 15)) console.log(`  ${t.legacy} [${t.status}/${t.kind}] ${t.title}`);
  if (tasks.length > 15) console.log(`  … и ещё ${tasks.length - 15}`);
  console.log('Пробно. Перенести — --import, потом проверить на сайте и удалить из Firestore — --delete.');
  process.exit(0);
}

const r = await dev('POST', 'import', payload);
console.log(`Сервер: перенесено задач ${r.tasks}, планов ${r.docs}, уже были ${r.skipped}`);
if (mode === 'import') process.exit(0);

// --delete: удаляем, только если на сервере уже было всё (повторный перенос ничего не добавил)
if (r.tasks || r.docs || r.skipped !== payload.tasks.length + payload.docs.length)
  throw new Error('на сервере было не всё — сначала --import и проверка на сайте, потом --delete');
let gone = 0;
for (const d of docs) {
  await api(`${DOCS}/artifacts/${d.id}`, { method: 'DELETE' });
  gone++;
}
const kept = [];
for (const t of tasks) {
  if (withFiles.has(t.id)) {
    kept.push(t);
    continue;
  }
  await api(`${DOCS}/tasks/${t.id}`, { method: 'DELETE' });
  gone++;
}
const left = new Set(kept.map((t) => t.groupId));
for (const g of picked)
  if (!left.has(g.id)) {
    await api(`${DOCS}/groups/${g.id}`, { method: 'DELETE' });
    console.log(`Группа «${g.name}» удалена`);
  }
console.log(`Удалено из Firestore: ${gone} документов.`);
if (kept.length) console.log(`Оставлены (есть вложения): ${kept.map((t) => `${t.id} «${t.title}»`).join('; ')}`);
