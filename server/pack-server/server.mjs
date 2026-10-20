#!/usr/bin/env node
/**
 * Сервер сборки «TFC Планы»: хранит сборку (моды, конфиги, KubeJS, ресурспаки, данные мира) снимками и раздаёт
 * её программе tfc. План — docs/plans/pack-cli.md. Без зависимостей, Node 22+. Настройки — переменные окружения
 * (см. .env.example), установка — README.md. Вход — ключ: Authorization: Bearer <ключ>.
 *
 *   GET    /health                  — жив ли (без ключа)
 *   GET    /pack/current            — текущий снимок                         player
 *   GET    /pack/snapshots          — история (сводки) и текущий             player
 *   GET    /pack/snapshots/:id      — снимок целиком                         player
 *   GET    /blobs/:sha256           — файл (Range — докачка)                 player
 *   POST   /blobs/missing           — { sha256: [...] } → { missing }        admin
 *   PUT    /blobs/:sha256           — залить файл, тело — содержимое         admin
 *   POST   /pack/snapshots          — создать снимок                         admin
 *   POST   /pack/current            — { id } или { rollback: true }          admin
 *   GET    /admin/keys              — ключи (без самих ключей)               admin
 *   POST   /admin/keys              — { name, role } → { key, ... }          admin
 *   DELETE /admin/keys/:id          — отозвать ключ                          admin
 */
import fs from 'node:fs';
import http from 'node:http';
import { openKeys } from './lib/keys.mjs';
import { openStore } from './lib/store.mjs';
import { HttpError, SHA256_RE } from './lib/util.mjs';

const env = process.env;
const config = {
  port: Number(env.PORT ?? 8788),
  host: env.HOST ?? '127.0.0.1',
  dataDir: env.DATA_DIR ?? './data',
  maxBlobSize: Number(env.MAX_BLOB_SIZE ?? 1024 ** 3),
  maxTotalBytes: Number(env.MAX_TOTAL_BYTES ?? 50 * 1024 ** 3),
  minFreeBytes: Number(env.MIN_FREE_BYTES ?? 1024 ** 3),
  maxJsonBody: 32 * 1024 ** 2,
};

const store = await openStore(config.dataDir, config);
const keys = openKeys(config.dataDir);

// ---------------------------------------------------------------- доступ

/** Кто пришёл: { id, name, role } или 401/403 */
async function authorize(req, role) {
  const who = await keys.check(req.headers.authorization);
  if (!who) throw new HttpError(401, 'Нужен ключ: Authorization: Bearer <ключ>');
  if (role === 'admin' && who.role !== 'admin') throw new HttpError(403, 'Нужен ключ администратора');
  return who;
}

// ---------------------------------------------------------------- HTTP

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const len = Number(req.headers['content-length']);
  if (Number.isFinite(len) && len > config.maxJsonBody) throw new HttpError(413, 'Слишком большой запрос');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > config.maxJsonBody) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    throw new HttpError(400, 'Тело запроса — не JSON');
  }
}

/** Отдача файла; один диапазон Range — чтобы оборванная закачка большого jar продолжалась, а не шла заново */
function sendBlob(req, res, sha) {
  const size = store.blobSize(sha);
  const etag = `"${sha}"`;
  const headers = {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else start = Math.max(0, size - Number(range[2])); // bytes=-N — последние N байт
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = size ? end - start + 1 : 0;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || !size) return res.end();
  fs.createReadStream(store.blobPath(sha), { start, end })
    .on('error', () => res.destroy())
    .pipe(res);
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  const route = `${req.method} /${parts[0] ?? ''}${parts[1] ? `/${parts[1]}` : ''}`;

  if (req.method === 'GET' && url.pathname === '/health') {
    const s = store.stats();
    return json(res, 200, { ok: true, current: s.current, snapshots: s.snapshots, blobs: s.blobs, bytes: s.bytes });
  }

  // --- блобы
  if (parts[0] === 'blobs' && parts.length === 2) {
    const sha = parts[1];
    if (sha === 'missing' && req.method === 'POST') {
      await authorize(req, 'admin');
      const body = await readJsonBody(req);
      return json(res, 200, { missing: store.missing(body?.sha256) });
    }
    if (!SHA256_RE.test(sha)) throw new HttpError(400, 'sha256 — 64 строчных шестнадцатеричных символа');
    if (req.method === 'GET' || req.method === 'HEAD') {
      await authorize(req, 'player');
      if (!store.hasBlob(sha)) throw new HttpError(404, 'Нет такого файла');
      return sendBlob(req, res, sha);
    }
    if (req.method === 'PUT') {
      const who = await authorize(req, 'admin');
      const len = req.headers['content-length'] === undefined ? NaN : Number(req.headers['content-length']);
      const r = await store.putBlob(sha, req, len);
      if (!r.existed) console.log(`+ blob ${sha.slice(0, 12)}… ${r.size} Б — ${who.name}`);
      return json(res, r.existed ? 200 : 201, r);
    }
    throw new HttpError(405, 'Метод не поддерживается');
  }

  // --- снимки
  if (parts[0] === 'pack') {
    if (route === 'GET /pack/current' && parts.length === 2) {
      await authorize(req, 'player');
      const snap = await store.getCurrent();
      return snap ? json(res, 200, snap) : json(res, 404, { error: 'Текущего снимка ещё нет' });
    }
    if (route === 'POST /pack/current' && parts.length === 2) {
      const who = await authorize(req, 'admin');
      const r = await store.setCurrent(await readJsonBody(req), who.name);
      console.log(`★ текущий снимок ${r.previous ?? '—'} → ${r.current} — ${who.name}`);
      return json(res, 200, r);
    }
    if (parts[1] === 'snapshots' && parts.length === 2) {
      if (req.method === 'GET') {
        await authorize(req, 'player');
        return json(res, 200, { current: store.channels().current, snapshots: store.listSnapshots() });
      }
      if (req.method === 'POST') {
        const who = await authorize(req, 'admin');
        const snap = await store.createSnapshot(await readJsonBody(req), who.name);
        console.log(`+ снимок ${snap.id}: ${snap.fileCount} файлов, ${snap.totalSize} Б — ${who.name}`);
        return json(res, 201, snap);
      }
    }
    if (parts[1] === 'snapshots' && parts.length === 3 && req.method === 'GET') {
      await authorize(req, 'player');
      const snap = await store.getSnapshot(parts[2]);
      return snap ? json(res, 200, snap) : json(res, 404, { error: 'Нет такого снимка' });
    }
  }

  // --- ключи
  if (parts[0] === 'admin' && parts[1] === 'keys') {
    const who = await authorize(req, 'admin');
    if (parts.length === 2 && req.method === 'GET') return json(res, 200, await keys.list());
    if (parts.length === 2 && req.method === 'POST') {
      const body = await readJsonBody(req);
      const k = await keys.add(body?.name, body?.role ?? 'player', who.name);
      console.log(`+ ключ ${k.id} «${k.name}» (${k.role}) — ${who.name}`);
      return json(res, 201, k);
    }
    if (parts.length === 3 && req.method === 'DELETE') {
      const k = await keys.revoke(parts[2]);
      console.log(`− ключ ${k.id} «${k.name}» (${k.role}) — ${who.name}`);
      return json(res, 200, { ok: true, revoked: k });
    }
  }

  throw new HttpError(404, 'Нет такого адреса');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (res.headersSent) return res.destroy();
    // Тело недочитано (отказ до приёма файла) — закрываем соединение, чтобы клиент не слал дальше
    if (!req.complete) res.setHeader('Connection', 'close');
    json(res, status, { error: status === 500 ? 'Внутренняя ошибка сервера' : e.message, ...e.extra });
  });
});
server.requestTimeout = 60 * 60_000; // заливка jar на сотни МБ по медленному каналу
server.listen(config.port, config.host, async () => {
  const s = store.stats();
  console.log(
    `Сервер сборки: http://${config.host}:${config.port}, данные — ${config.dataDir}, ` +
      `снимков ${s.snapshots}, файлов ${s.blobs}, текущий — ${s.current ?? 'нет'}`,
  );
  if (!(await keys.list()).some((k) => k.role === 'admin'))
    console.warn(
      'Нет ни одного ключа администратора. Создайте: node cli.mjs key add <имя> --role admin (локально — npm run key -- add host --role admin)',
    );
});

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
