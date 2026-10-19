#!/usr/bin/env node
/**
 * Переезд вложений между хранилищами с сохранением id, имён, дат и своих полей (taskId, author) —
 * ссылки из задач, схем и датапаков продолжают работать.
 *
 *   node scripts/files-migrate.mjs --from <хранилище> --to <хранилище> [--dry-run] [--overwrite] [--delete-source]
 *
 * Хранилища:
 *   firestore              — Firestore проекта (коллекция из src/lib/files.config.ts); доступ — от `firebase login`
 *   firestore:<коллекция>  — другая коллекция того же проекта (для опытов)
 *   https://files.example.com — сервер файлов (server/file-server); ключ — FILES_ADMIN_TOKEN
 *                            (или FILES_FROM_TOKEN / FILES_TO_TOKEN, если у серверов разные ключи)
 *   dir:<папка>            — папка в формате сервера (<папка>/files/<id>.json + .bin): бэкап или перенос через rsync
 *
 * Каждый файл читается, сверяется по размеру и sha256, пишется в цель и читается обратно для сверки.
 * Файл, который в цели уже есть с той же суммой, пропускается — повторный запуск безопасен (так догоняются
 * файлы, загруженные, пока сайт переключался). Другой файл с тем же id — конфликт: пропуск, или --overwrite.
 * --delete-source удаляет из источника только успешно сверенные файлы.
 */
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import filesConfig from '../src/lib/files.config.ts';
import { DOCS, fromValue, toValue, token } from './firestore-rest.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(name);
const dryRun = flag('--dry-run');
const overwrite = flag('--overwrite');
const deleteSource = flag('--delete-source');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const RESERVED = new Set(['id', 'name', 'size', 'type', 'createdAt', 'sha256', 'chunks', 'complete', 'uid']);
/** свои поля записи — всё, кроме служебных */
const metaOf = (rec) => Object.fromEntries(Object.entries(rec).filter(([k]) => !RESERVED.has(k)));

// ---------------------------------------------------------------- Firestore (как пакет firestore-files)

function firestoreDriver(collection = filesConfig.collection) {
  const col = `${DOCS}/${collection}`;
  const chunksCol = filesConfig.chunksCollection ?? 'chunks';
  const chunkSize = filesConfig.chunkSize;
  let headers;
  async function api(method, url, body) {
    headers ??= { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
    const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    if (r.status === 404 && method === 'GET') return null;
    if (!r.ok) throw new Error(`${method} ${url} → ${r.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }
  async function listAll(url) {
    const out = [];
    let pageToken = '';
    do {
      const res = await api('GET', `${url}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`);
      out.push(...(res?.documents ?? []));
      pageToken = res?.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }
  const toRec = (d) => ({ ...fromValue({ mapValue: { fields: d.fields } }), id: d.name.split('/').pop() });
  const deleteChunks = async (id, n) => {
    for (let i = 0; i < n; i++) await api('DELETE', `${col}/${id}/${chunksCol}/${i}`);
  };

  return {
    label: `Firestore (${collection})`,
    async list() {
      return (await listAll(col)).map(toRec).filter((r) => r.complete);
    },
    async read(rec) {
      const parts = (await listAll(`${col}/${rec.id}/${chunksCol}`))
        .map((c) => ({
          i: Number(c.fields.i.integerValue),
          data: Buffer.from(c.fields.data.bytesValue ?? '', 'base64'),
        }))
        .sort((a, b) => a.i - b.i);
      return Buffer.concat(parts.map((p) => p.data));
    },
    async write(rec, buf) {
      const old = await api('GET', `${col}/${rec.id}`);
      if (old) await deleteChunks(rec.id, Number(old.fields?.chunks?.integerValue ?? 0));
      const chunks = Math.max(1, Math.ceil(buf.length / chunkSize));
      const doc = {
        ...metaOf(rec),
        name: rec.name,
        size: buf.length,
        type: rec.type,
        createdAt: rec.createdAt,
        sha256: rec.sha256,
      };
      // Как пакет: сначала запись с complete=false (файл не виден), потом куски, потом complete=true
      const fields = toValue({ ...doc, chunks, complete: false }).mapValue.fields;
      await api('PATCH', `${col}/${rec.id}`, { fields });
      for (let i = 0; i < chunks; i++) {
        const part = buf.subarray(i * chunkSize, (i + 1) * chunkSize);
        await api('PATCH', `${col}/${rec.id}/${chunksCol}/${i}`, {
          fields: { i: { integerValue: String(i) }, data: { bytesValue: part.toString('base64') } },
        });
      }
      await api('PATCH', `${col}/${rec.id}?updateMask.fieldPaths=complete`, {
        fields: { complete: { booleanValue: true } },
      });
    },
    async remove(rec) {
      const d = await api('GET', `${col}/${rec.id}`);
      if (!d) return;
      await deleteChunks(rec.id, Number(d.fields?.chunks?.integerValue ?? 0));
      await api('DELETE', `${col}/${rec.id}`);
    },
  };
}

// ---------------------------------------------------------------- сервер файлов

function serverDriver(base, adminToken) {
  base = base.replace(/\/+$/, '');
  if (!adminToken)
    throw new Error(
      `Для ${base} нужен ключ администратора: FILES_ADMIN_TOKEN (на сервере — ADMIN_TOKEN в /etc/tfc-files.env)`,
    );
  const h = { 'X-Admin-Token': adminToken };
  async function req(method, p, init = {}) {
    const r = await fetch(`${base}${p}`, { method, ...init, headers: { ...h, ...init.headers } });
    if (!r.ok) throw new Error(`${method} ${base}${p} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r;
  }
  return {
    label: base,
    list: async () => (await req('GET', '/files')).json(),
    read: async (rec) => Buffer.from(await (await req('GET', `/files/${rec.id}/content`)).arrayBuffer()),
    async write(rec, buf) {
      await req('PUT', `/files/${rec.id}`, {
        body: buf,
        headers: {
          'Content-Type': rec.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(rec.name),
          'X-File-Meta': encodeURIComponent(JSON.stringify(metaOf(rec))),
          'X-File-Sha256': rec.sha256,
          'X-File-Created-At': String(rec.createdAt),
        },
      });
    },
    remove: async (rec) => void (await req('DELETE', `/files/${rec.id}`)),
  };
}

// ---------------------------------------------------------------- папка в формате сервера

function dirDriver(dir) {
  const files = path.join(path.resolve(dir), 'files');
  const atomic = async (file, data) => {
    await fsp.writeFile(`${file}.tmp`, data);
    await fsp.rename(`${file}.tmp`, file);
  };
  return {
    label: `папка ${files}`,
    async list() {
      const names = await fsp.readdir(files).catch(() => []);
      const out = [];
      for (const n of names)
        if (n.endsWith('.json')) out.push(JSON.parse(await fsp.readFile(path.join(files, n), 'utf8')));
      return out;
    },
    read: (rec) => fsp.readFile(path.join(files, `${rec.id}.bin`)),
    async write(rec, buf) {
      await fsp.mkdir(files, { recursive: true });
      const out = {
        ...metaOf(rec),
        name: rec.name,
        type: rec.type,
        id: rec.id,
        createdAt: rec.createdAt,
        size: buf.length,
        sha256: rec.sha256,
      };
      await atomic(path.join(files, `${rec.id}.bin`), buf);
      await atomic(path.join(files, `${rec.id}.json`), JSON.stringify(out));
    },
    async remove(rec) {
      await fsp.rm(path.join(files, `${rec.id}.json`), { force: true });
      await fsp.rm(path.join(files, `${rec.id}.bin`), { force: true });
    },
  };
}

function driver(spec, role) {
  if (!spec) throw new Error(`Не задано --${role}. Пример: --from firestore --to https://files.example.com`);
  if (spec === 'firestore') return firestoreDriver();
  if (spec.startsWith('firestore:')) return firestoreDriver(spec.slice(10));
  if (spec.startsWith('dir:')) return dirDriver(spec.slice(4));
  if (/^https?:\/\//.test(spec)) {
    const own = role === 'from' ? process.env.FILES_FROM_TOKEN : process.env.FILES_TO_TOKEN;
    return serverDriver(spec, own ?? process.env.FILES_ADMIN_TOKEN);
  }
  throw new Error(`Непонятное хранилище «${spec}»: firestore, https://… или dir:<папка>`);
}

// ---------------------------------------------------------------- переезд

async function main() {
  const from = driver(opt('--from'), 'from');
  const to = driver(opt('--to'), 'to');
  const [src, dst] = await Promise.all([from.list(), to.list()]);
  const have = new Map(dst.map((r) => [r.id, r]));
  console.log(
    `${from.label}: ${src.length} файлов → ${to.label}: ${dst.length} файлов${dryRun ? ' (пробный прогон)' : ''}`,
  );

  const stat = { copied: 0, same: 0, conflict: 0, failed: 0, removed: 0 };
  for (const rec of src.sort((a, b) => a.createdAt - b.createdAt)) {
    const label = `«${rec.name}» (${rec.id}, ${rec.size} Б)`;
    const exists = have.get(rec.id);
    try {
      if (exists && rec.sha256 && exists.sha256 === rec.sha256 && exists.size === rec.size) {
        stat.same++;
        if (deleteSource && !dryRun) {
          await from.remove(rec);
          stat.removed++;
        }
        continue;
      }
      if (exists && !overwrite) {
        stat.conflict++;
        console.warn(`! ${label}: в цели другой файл с тем же id — пропускаю (--overwrite, чтобы заменить)`);
        continue;
      }
      if (dryRun) {
        console.log(`· ${label}${exists ? ' — заменит' : ''}`);
        stat.copied++;
        continue;
      }
      const buf = await from.read(rec);
      const hash = sha256(buf);
      if (buf.length !== rec.size) throw new Error(`прочитано ${buf.length} Б вместо ${rec.size}`);
      if (rec.sha256 && rec.sha256 !== hash) throw new Error('содержимое не совпало с контрольной суммой источника');
      const full = {
        ...rec,
        sha256: hash,
        type: rec.type || 'application/octet-stream',
        createdAt: rec.createdAt ?? Date.now(),
      };
      await to.write(full, buf);
      const back = await to.read(full);
      if (sha256(back) !== hash) throw new Error('после записи в цель содержимое не совпало');
      stat.copied++;
      console.log(`✓ ${label}`);
      if (deleteSource) {
        await from.remove(rec);
        stat.removed++;
      }
    } catch (e) {
      stat.failed++;
      console.warn(`✗ ${label}: ${e.message}`);
    }
  }

  const extra = dst.filter((r) => !src.some((s) => s.id === r.id)).length;
  console.log(
    `${dryRun ? 'Будет перенесено' : 'Перенесено'}: ${stat.copied}, уже были: ${stat.same}, конфликтов: ${stat.conflict}, ошибок: ${stat.failed}` +
      (deleteSource ? `, удалено из источника: ${stat.removed}` : '') +
      (extra ? `. В цели ещё ${extra} файлов, которых нет в источнике (не трогаю)` : ''),
  );
  if (stat.failed || stat.conflict) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
