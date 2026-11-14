#!/usr/bin/env node
/**
 * Разовый перенос вложений задач разработки из Firestore (files, taskId = "dev:<id>" или id старой задачи групп
 * «Разработка»/«Фиксы», перенесённой в трекер с полем legacy) на сервер сборки (dev #357). id, автор и время
 * загрузки сохраняются; содержимое сверяется по размеру и SHA256 до отправки и после.
 *
 *   node scripts/dev-files-migrate.mjs           — пробно: что будет перенесено (Firestore — только метаданные)
 *   node scripts/dev-files-migrate.mjs --apply   — перенести и сверить (повтор безопасен: перенесённое — «уже есть»)
 *
 * Firestore — сервисный ключ (GOOGLE_APPLICATION_CREDENTIALS / TFC_FIRESTORE_KEY) или firebase login.
 * Сервер сборки — ключ администратора (TFC_PACK_URL / TFC_PACK_TOKEN, .env.local или вход в tfc): только он может
 * задать прежний id и время. Firestore-копии не удаляются — сайт и MCP их больше не читают.
 */
import { createHash } from 'node:crypto';
import { DOCS, fromValue } from './firestore-rest.mjs';
import { api } from './mcp/firestore.mjs';
import { packServer } from './pack-fetch.mjs';

const apply = process.argv.includes('--apply');
const fields = (d) => Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, fromValue(v)]));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

const srv = packServer();
if (!srv) throw new Error('нет адреса сервера сборки (TFC_PACK_URL / TFC_PACK_TOKEN или вход в tfc)');
async function dev(path, init = {}) {
  const res = await fetch(`${srv.url}/dev/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${srv.token}`, ...init.headers },
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`/dev/${path}: ${out.error ?? res.status}`);
  return out;
}

async function query(where) {
  const r = await api(`${DOCS}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'files' }], where } }),
  });
  return r.filter((x) => x.document).map((x) => ({ id: x.document.name.split('/').pop(), ...fields(x.document) }));
}

// Задачи трекера: номер по «dev:<n>» и по legacy (id задачи сайта до переезда трекера)
const { tasks } = await dev('tasks');
const byLegacy = new Map(tasks.filter((t) => t.legacy).map((t) => [t.legacy, t.id]));
const known = new Set(tasks.map((t) => t.id));

const devFiles = await query({
  compositeFilter: {
    op: 'AND',
    filters: [
      { fieldFilter: { field: { fieldPath: 'taskId' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: 'dev:' } } },
      { fieldFilter: { field: { fieldPath: 'taskId' }, op: 'LESS_THAN', value: { stringValue: 'dev;' } } },
    ],
  },
});
const legacyIds = [...byLegacy.keys()];
const legacyFiles = [];
for (let i = 0; i < legacyIds.length; i += 30)
  legacyFiles.push(
    ...(await query({
      fieldFilter: {
        field: { fieldPath: 'taskId' },
        op: 'IN',
        value: { arrayValue: { values: legacyIds.slice(i, i + 30).map((v) => ({ stringValue: v })) } },
      },
    })),
  );

const plan = [];
for (const f of [...devFiles, ...legacyFiles]) {
  const task = f.taskId.startsWith('dev:') ? Number(f.taskId.slice(4)) : byLegacy.get(f.taskId);
  const skip = !f.complete ? 'не загружен до конца' : !known.has(task) ? `нет задачи #${task} в трекере` : null;
  plan.push({ f, task, skip });
}
plan.sort((a, b) => a.task - b.task || a.f.createdAt - b.f.createdAt);

console.log(`Вложений в Firestore: dev:<id> — ${devFiles.length}, у старых задач (legacy) — ${legacyFiles.length}`);
for (const { f, task, skip } of plan)
  console.log(
    `  #${task} ${f.id} «${f.name}» ${f.size} Б ${f.author} (${f.taskId})${skip ? ` — пропуск: ${skip}` : ''}`,
  );
if (!apply) {
  console.log('\nПробный прогон. Перенести: --apply');
  process.exit(0);
}

let moved = 0;
let existed = 0;
const failed = [];
for (const { f, task, skip } of plan) {
  if (skip) continue;
  try {
    // Содержимое — частями из files/{id}/chunks
    const parts = [];
    let pageToken = '';
    do {
      const r = await api(`${DOCS}/files/${f.id}/chunks?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`);
      for (const c of r.documents ?? []) {
        const x = fields(c);
        parts.push({ i: Number(x.i ?? c.name.split('/').pop()), data: x.data });
      }
      pageToken = r.nextPageToken ?? '';
    } while (pageToken);
    parts.sort((x, y) => x.i - y.i);
    if (parts.length !== f.chunks) throw new Error(`частей ${parts.length} из ${f.chunks}`);
    const bytes = Buffer.concat(parts.map((p) => p.data));
    if (bytes.length !== f.size) throw new Error(`размер ${bytes.length} вместо ${f.size}`);
    const sha = sha256(bytes);
    if (f.sha256 && sha !== f.sha256) throw new Error('хеш в Firestore не сходится с содержимым');
    const r = await dev(`tasks/${task}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': f.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(f.name),
        'X-File-Sha256': sha,
        'X-File-By': encodeURIComponent(f.author || 'перенос'),
        'X-File-Id': f.id,
        'X-File-Created': String(f.createdAt ?? Date.now()),
      },
      body: bytes,
    });
    if (r.existed) existed++;
    else moved++;
    console.log(`${r.existed ? '=' : '+'} #${task} ${f.id} «${f.name}»`);
  } catch (e) {
    failed.push(`${f.id} «${f.name}»: ${e.message}`);
    console.error(`✗ #${task} ${f.id} «${f.name}»: ${e.message}`);
  }
}

// Сверка: каждое вложение — на сервере у своей задачи, с тем же размером и хешем
const mismatch = [];
for (const task of new Set(plan.filter((p) => !p.skip).map((p) => p.task))) {
  const { files } = await dev(`tasks/${task}/files`);
  for (const { f } of plan.filter((p) => p.task === task && !p.skip)) {
    const s = files.find((x) => x.id === f.id);
    if (!s || s.size !== f.size || (f.sha256 && s.sha256 !== f.sha256)) mismatch.push(`#${task} ${f.id} «${f.name}»`);
  }
}
const total = plan.filter((p) => !p.skip).length;
console.log(
  `\nПеренесено ${moved}, уже было ${existed}, ошибок ${failed.length}; сверка: ${total - mismatch.length} из ${total} совпали` +
    (mismatch.length ? `, расхождения: ${mismatch.join(', ')}` : ''),
);
if (failed.length || mismatch.length) process.exit(1);
