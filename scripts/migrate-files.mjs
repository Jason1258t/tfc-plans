#!/usr/bin/env node
/**
 * Перезаливает вложения, загруженные до перехода на пакет firestore-files: каждый файл собирается
 * из кусков, проверяется, записывается заново под новым id с контрольной суммой sha256
 * (с теми же именем, задачей, автором и датой), читается обратно для сверки, и только потом
 * старый файл удаляется. Файлы, у которых sha256 уже есть, пропускаются — повторный запуск безопасен.
 * Авторизация — от имени залогиненного firebase CLI (`firebase login`), правила Firestore не мешают.
 *
 *   node scripts/migrate-files.mjs --dry-run   — только показать, что будет сделано
 *   node scripts/migrate-files.mjs             — перезалить
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default;
const COLLECTION = 'files';
const CHUNKS = 'chunks';
const CHUNK_SIZE = 700 * 1024; // как в src/lib/files.config.ts
const dryRun = process.argv.includes('--dry-run');

const require = createRequire(import.meta.url);
const fbRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const auth = require(path.join(fbRoot, 'firebase-tools/lib/auth'));

const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
let headers;

async function api(method, url, body) {
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function listAll(url) {
  const out = [];
  let token = '';
  do {
    const res = await api('GET', `${url}?pageSize=300${token ? `&pageToken=${token}` : ''}`);
    out.push(...(res.documents ?? []));
    token = res.nextPageToken ?? '';
  } while (token);
  return out;
}

const idOf = (doc) => doc.name.split('/').pop();
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function readContent(id) {
  const chunks = await listAll(`${DOCS}/${COLLECTION}/${id}/${CHUNKS}`);
  const parts = chunks
    .map((c) => ({ i: Number(c.fields.i.integerValue), data: Buffer.from(c.fields.data.bytesValue ?? '', 'base64') }))
    .sort((a, b) => a.i - b.i);
  return { count: parts.length, buf: Buffer.concat(parts.map((p) => p.data)) };
}

async function main() {
  const acc = auth.getGlobalDefaultAccount();
  if (!acc) throw new Error('Нужно выполнить firebase login');
  const { access_token } = await auth.getAccessToken(acc.tokens.refresh_token, [
    'https://www.googleapis.com/auth/cloud-platform',
  ]);
  headers = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };

  const files = await listAll(`${DOCS}/${COLLECTION}`);
  const todo = files.filter((d) => !d.fields.sha256 && d.fields.complete?.booleanValue);
  const incomplete = files.filter((d) => !d.fields.complete?.booleanValue);
  console.log(
    `Файлов: ${files.length}, к перезаливке: ${todo.length}, незавершённых (не трогаю): ${incomplete.length}`,
  );

  let ok = 0;
  for (const old of todo) {
    const f = old.fields;
    const oldId = idOf(old);
    const name = f.name.stringValue;
    const size = Number(f.size.integerValue);
    const { count, buf } = await readContent(oldId);
    if (count !== Number(f.chunks.integerValue) || buf.length !== size) {
      console.warn(
        `✗ ${name} (${oldId}): ${count} кусков / ${buf.length} байт вместо ${f.chunks.integerValue} / ${size} — пропускаю`,
      );
      continue;
    }
    const hash = sha256(buf);
    const chunks = Math.max(1, Math.ceil(size / CHUNK_SIZE));
    if (dryRun) {
      console.log(`· ${name} (${oldId}) → новый id, ${chunks} кусков, sha256 ${hash.slice(0, 12)}…`);
      continue;
    }

    // Новый документ: те же поля + sha256, complete=false до записи кусков
    const fields = {
      ...f,
      chunks: { integerValue: String(chunks) },
      complete: { booleanValue: false },
      sha256: { stringValue: hash },
    };
    const created = await api('POST', `${DOCS}/${COLLECTION}`, { fields });
    const newId = idOf(created);
    try {
      for (let i = 0; i < chunks; i++) {
        const part = buf.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        await api('PATCH', `${DOCS}/${COLLECTION}/${newId}/${CHUNKS}/${i}`, {
          fields: { i: { integerValue: String(i) }, data: { bytesValue: part.toString('base64') } },
        });
      }
      await api('PATCH', `${DOCS}/${COLLECTION}/${newId}?updateMask.fieldPaths=complete`, {
        fields: { complete: { booleanValue: true } },
      });
      const back = await readContent(newId);
      if (sha256(back.buf) !== hash) throw new Error('содержимое после записи не совпало');
    } catch (e) {
      // Откат: новый файл убираем, старый остаётся как был
      for (let i = 0; i < chunks; i++)
        await api('DELETE', `${DOCS}/${COLLECTION}/${newId}/${CHUNKS}/${i}`).catch(() => {});
      await api('DELETE', `${DOCS}/${COLLECTION}/${newId}`).catch(() => {});
      console.warn(`✗ ${name} (${oldId}): ${e.message} — старый файл не тронут`);
      continue;
    }

    for (let i = 0; i < count; i++) await api('DELETE', `${DOCS}/${COLLECTION}/${oldId}/${CHUNKS}/${i}`);
    await api('DELETE', `${DOCS}/${COLLECTION}/${oldId}`);
    ok++;
    console.log(`✓ ${name}: ${oldId} → ${newId}`);
  }
  if (!dryRun) console.log(`Готово: перезалито ${ok} из ${todo.length}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
