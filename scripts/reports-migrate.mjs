#!/usr/bin/env node
/**
 * Разовый перенос отчётов игроков `tfc report` из Firestore (files/{id} с полем report, части — files/{id}/chunks) на
 * сервер сборки (dev #360). id, автор, время, задача и описание сохраняются; содержимое сверяется по размеру и SHA256
 * до отправки, на сервере и после.
 *
 *   node scripts/reports-migrate.mjs           — пробно: что будет перенесено (Firestore — только метаданные)
 *   node scripts/reports-migrate.mjs --apply   — перенести и сверить (повтор безопасен: перенесённое — «уже есть»)
 *   node scripts/reports-migrate.mjs --apply --purge — и после успешной сверки удалить Firestore-копии
 *        (документ и части) — иначе страница «Документы» продолжает читать их в общей подписке на files
 *
 * Firestore — сервисный ключ (GOOGLE_APPLICATION_CREDENTIALS / TFC_FIRESTORE_KEY) или firebase login.
 * Сервер сборки — ключ администратора (TFC_PACK_URL / TFC_PACK_TOKEN, .env.local или вход в tfc): только он может
 * задать прежний id, автора и время.
 */
import { createHash } from 'node:crypto';
import { DOCS, fromValue } from './firestore-rest.mjs';
import { api } from './mcp/firestore.mjs';
import { packServer } from './pack-fetch.mjs';

const apply = process.argv.includes('--apply');
const purge = process.argv.includes('--purge');
if (purge && !apply) throw new Error('--purge — только вместе с --apply');
const fields = (d) => Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, fromValue(v)]));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

const srv = packServer();
if (!srv) throw new Error('нет адреса сервера сборки (TFC_PACK_URL / TFC_PACK_TOKEN или вход в tfc)');
async function pack(path, init = {}) {
  const res = await fetch(`${srv.url}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${srv.token}`, ...init.headers },
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${out.error ?? res.status}`);
  return out;
}

const me = await pack('/auth/me');
if (apply && me.role !== 'admin') throw new Error(`нужен ключ администратора, а у «${me.name}» — ${me.role}`);

const r = await api(`${DOCS}:runQuery`, {
  method: 'POST',
  body: JSON.stringify({
    structuredQuery: {
      from: [{ collectionId: 'files' }],
      where: { fieldFilter: { field: { fieldPath: 'report.source' }, op: 'EQUAL', value: { stringValue: 'tfc' } } },
    },
  }),
});
const docs = r
  .filter((x) => x.document)
  .map((x) => ({ id: x.document.name.split('/').pop(), ...fields(x.document) }))
  .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
const plan = docs.map((f) => ({ f, skip: f.complete ? null : 'не загружен до конца' }));

const { reports: onServer } = await pack('/reports');
const there = new Map(onServer.map((x) => [x.id, x]));
console.log(`Отчётов в Firestore: ${docs.length}; на сервере сборки уже: ${onServer.length}`);
for (const { f, skip } of plan)
  console.log(
    `  ${f.id} ${f.report?.kind} «${f.name}» ${f.size} Б ${f.author}${there.has(f.id) ? ' — уже на сервере' : ''}${skip ? ` — пропуск: ${skip}` : ''}`,
  );
if (!apply) {
  console.log('\nПробный прогон. Перенести: --apply (и удалить Firestore-копии после сверки: --apply --purge)');
  process.exit(0);
}

async function chunksOf(id) {
  const parts = [];
  let pageToken = '';
  do {
    const r = await api(`${DOCS}/files/${id}/chunks?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`);
    for (const c of r.documents ?? []) {
      const x = fields(c);
      parts.push({ i: Number(x.i ?? c.name.split('/').pop()), data: x.data, name: c.name.split('/').pop() });
    }
    pageToken = r.nextPageToken ?? '';
  } while (pageToken);
  return parts.sort((x, y) => x.i - y.i);
}

let moved = 0;
let existed = 0;
const failed = [];
for (const { f, skip } of plan) {
  if (skip) continue;
  try {
    const parts = await chunksOf(f.id);
    if (parts.length !== f.chunks) throw new Error(`частей ${parts.length} из ${f.chunks}`);
    const bytes = Buffer.concat(parts.map((p) => p.data));
    if (bytes.length !== f.size) throw new Error(`размер ${bytes.length} вместо ${f.size}`);
    const sha = sha256(bytes);
    if (f.sha256 && sha !== f.sha256) throw new Error('хеш в Firestore не сходится с содержимым');
    const meta = {
      id: f.id,
      createdAt: f.createdAt ?? Date.now(),
      author: f.author || 'перенос',
      sha256: sha,
      taskId: f.taskId ?? null,
      name: f.name,
      kind: f.report.kind,
      type: f.report.type,
      label: f.report.label ?? '',
      note: f.report.note ?? '',
      files: f.report.files ?? [],
    };
    const out = await pack('/site/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Report': encodeURIComponent(JSON.stringify(meta)) },
      body: bytes,
    });
    if (out.existed) existed++;
    else moved++;
    console.log(`${out.existed ? '=' : '+'} ${f.id} «${f.name}»`);
  } catch (e) {
    failed.push(`${f.id} «${f.name}»: ${e.message}`);
    console.error(`✗ ${f.id} «${f.name}»: ${e.message}`);
  }
}

// Сверка: каждый отчёт — на сервере с тем же размером, хешем, автором, временем и видом
const { reports: after } = await pack('/reports');
const byId = new Map(after.map((x) => [x.id, x]));
const ok = [];
const mismatch = [];
for (const { f, skip } of plan) {
  if (skip) continue;
  const s = byId.get(f.id);
  const good =
    s &&
    s.size === f.size &&
    (!f.sha256 || s.sha256 === f.sha256) &&
    s.createdAt === f.createdAt &&
    s.author === String(f.author || 'перенос').slice(0, 24) &&
    s.report.kind === f.report.kind &&
    (s.taskId ?? null) === (f.taskId ?? null);
  (good ? ok : mismatch).push(f);
}
const total = plan.filter((p) => !p.skip).length;
console.log(
  `\nПеренесено ${moved}, уже было ${existed}, ошибок ${failed.length}; сверка: ${ok.length} из ${total} совпали` +
    (mismatch.length ? `, расхождения: ${mismatch.map((f) => `${f.id} «${f.name}»`).join(', ')}` : ''),
);

if (purge) {
  if (failed.length || mismatch.length) {
    console.log('Firestore-копии не удаляю: есть ошибки или расхождения.');
  } else {
    // Только сверенные; недогруженные (complete: false) тоже — их никто не покажет и не перенесёт
    let removed = 0;
    for (const f of [...ok, ...plan.filter((p) => p.skip).map((p) => p.f)]) {
      for (const c of await chunksOf(f.id)) await api(`${DOCS}/files/${f.id}/chunks/${c.name}`, { method: 'DELETE' });
      await api(`${DOCS}/files/${f.id}`, { method: 'DELETE' });
      removed++;
    }
    console.log(`Удалено из Firestore: ${removed}`);
  }
}
if (failed.length || mismatch.length) process.exit(1);
