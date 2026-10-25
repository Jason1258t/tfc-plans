#!/usr/bin/env node
/**
 * Сервер файлов для сайта «TFC Планы» — замена Firestore-хранилищу вложений (src/entities/file/fileStorage/server.ts).
 * Без зависимостей, Node 22+. Настройки — переменные окружения (см. .env.example), установка — README.md.
 *
 *   GET    /health                 — жив ли, сколько файлов (без авторизации)
 *   GET    /files                  — список записей
 *   GET    /files/events           — SSE: snapshot / put / delete
 *   GET    /files/:id              — запись
 *   GET    /files/:id/content      — содержимое
 *   POST   /files                  — загрузка (тело — файл; X-File-Name, X-File-Meta, X-File-Sha256)
 *   PUT    /files/:id              — импорт с заданным id и датой (только X-Admin-Token; для files-migrate)
 *   DELETE /files/:id
 */
import fs from 'node:fs';
import http from 'node:http';
import { sameSecret, verifyAppCheck, verifyIdToken } from './lib/auth.mjs';
import { HttpError, ID_RE, openStorage } from './lib/storage.mjs';

const env = process.env;
const config = {
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? '127.0.0.1',
  dataDir: env.DATA_DIR ?? './data',
  maxFileSize: Number(env.MAX_FILE_SIZE ?? 25 * 1024 * 1024),
  maxTotalBytes: Number(env.MAX_TOTAL_BYTES ?? 20 * 1024 ** 3),
  origins: (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** firebase — нужен ID-токен анонимного входа; none — без проверки (только для опытов на своей машине) */
  auth: env.AUTH ?? 'firebase',
  projectId: env.FIREBASE_PROJECT_ID ?? '',
  /** номер проекта (Project settings → Project number); задан — обязателен и токен App Check */
  appCheckProject: env.APP_CHECK_PROJECT_NUMBER ?? '',
  adminToken: env.ADMIN_TOKEN ?? '',
  /** за обратным прокси (Caddy/nginx) — брать IP из X-Forwarded-For */
  trustProxy: env.TRUST_PROXY === '1',
  /** сколько загрузок/удалений в минуту с одного пользователя */
  writesPerMinute: Number(env.WRITES_PER_MINUTE ?? 30),
};
if (config.auth === 'firebase' && !config.projectId) {
  console.error('AUTH=firebase: задайте FIREBASE_PROJECT_ID (или AUTH=none для опытов)');
  process.exit(1);
}
if (config.auth !== 'firebase' && config.auth !== 'none') {
  console.error(`AUTH=${config.auth}: допустимо firebase или none`);
  process.exit(1);
}

const storage = await openStorage(config.dataDir);

// ---------------------------------------------------------------- поля записи

const RESERVED = new Set(['id', 'name', 'size', 'type', 'createdAt', 'sha256', 'chunks', 'complete', 'uid']);
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;

/** Свои поля записи: плоский объект из строк/чисел/булевых/null, как у Firestore-хранилища */
function checkMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new HttpError(400, 'X-File-Meta: нужен объект');
  const keys = Object.keys(meta);
  if (keys.length > 20) throw new HttpError(400, 'X-File-Meta: слишком много полей');
  for (const k of keys) {
    const v = meta[k];
    if (!FIELD_RE.test(k) || RESERVED.has(k)) throw new HttpError(400, `X-File-Meta: недопустимое поле «${k}»`);
    const ok = v === null || typeof v === 'boolean' || Number.isFinite(v) || (typeof v === 'string' && v.length <= 500);
    if (!ok) throw new HttpError(400, `X-File-Meta: недопустимое значение поля «${k}»`);
  }
  return meta;
}

/** Правила сайта — те же, что у блока files в firestore.rules */
function checkSiteRules(meta) {
  if (typeof meta.author !== 'string' || meta.author.length < 2 || meta.author.length > 24)
    throw new HttpError(400, 'Нужен ник автора (2–24 символа)');
  if (meta.taskId !== null && meta.taskId !== undefined && typeof meta.taskId !== 'string')
    throw new HttpError(400, 'taskId — строка или null');
}

const decodeHeader = (v, what) => {
  try {
    return decodeURIComponent(String(v ?? ''));
  } catch {
    throw new HttpError(400, `${what}: не удалось раскодировать`);
  }
};

function cleanName(raw) {
  // eslint-disable-next-line no-control-regex
  const name = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255);
  return name || 'file';
}

// ---------------------------------------------------------------- доступ

const writes = new Map(); // кто → отметки времени записей за минуту

function rateLimit(who) {
  const now = Date.now();
  const recent = (writes.get(who) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= config.writesPerMinute)
    throw new HttpError(429, 'Слишком много загрузок подряд — подождите минуту');
  recent.push(now);
  writes.set(who, recent);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of writes) if (!v.some((t) => now - t < 60_000)) writes.delete(k);
}, 60_000).unref();

/** { admin, uid } или 401/403 */
async function authorize(req) {
  if (sameSecret(req.headers['x-admin-token'], config.adminToken)) return { admin: true, uid: 'admin' };
  if (config.auth === 'none') return { admin: false, uid: clientIp(req) };
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!m) throw new HttpError(401, 'Нет токена входа');
  let uid;
  try {
    uid = await verifyIdToken(m[1], config.projectId);
  } catch (e) {
    throw new HttpError(401, `Токен входа не принят: ${e.message}`);
  }
  if (config.appCheckProject) {
    try {
      await verifyAppCheck(req.headers['x-firebase-appcheck'], config.appCheckProject);
    } catch (e) {
      throw new HttpError(403, `App Check не пройден: ${e.message}`);
    }
  }
  return { admin: false, uid };
}

function clientIp(req) {
  const fwd = config.trustProxy
    ? String(req.headers['x-forwarded-for'] ?? '')
        .split(',')[0]
        .trim()
    : '';
  return fwd || req.socket.remoteAddress || '?';
}

// ---------------------------------------------------------------- HTTP

const ALLOW_HEADERS =
  'Authorization, Content-Type, X-File-Name, X-File-Meta, X-File-Sha256, X-File-Created-At, X-Firebase-AppCheck, X-Admin-Token';

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (config.origins.includes(origin) || config.origins.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const sseClients = new Set();
storage.onChange((event, data) => {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
});
setInterval(() => {
  for (const res of sseClients) res.write(': ping\n\n');
}, 25_000).unref();

function events(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: snapshot\ndata: ${JSON.stringify(storage.list())}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

function sendContent(req, res, rec) {
  const etag = `"${rec.sha256}"`;
  const headers = {
    'Content-Type': rec.type || 'application/octet-stream',
    'Content-Length': rec.size,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(rec.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=31536000, immutable',
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  fs.createReadStream(storage.contentPath(rec.id))
    .on('error', () => res.destroy())
    .pipe(res);
}

async function upload(req, res, who, id) {
  const len = Number(req.headers['content-length']);
  if (Number.isFinite(len) && len > config.maxFileSize) throw new HttpError(413, 'Файл больше допустимого размера');
  if (storage.totalBytes() + (len || 0) > config.maxTotalBytes) throw new HttpError(507, 'Хранилище заполнено');
  const meta = checkMeta(JSON.parse(decodeHeader(req.headers['x-file-meta'] || '%7B%7D', 'X-File-Meta')));
  if (!who.admin) checkSiteRules(meta);
  const fields = {
    ...meta,
    name: cleanName(decodeHeader(req.headers['x-file-name'], 'X-File-Name')),
    type: String(req.headers['content-type'] || 'application/octet-stream').slice(0, 200),
  };
  if (id) {
    fields.id = id;
    const at = Number(req.headers['x-file-created-at']);
    if (Number.isFinite(at) && at > 0) fields.createdAt = at;
  }
  const sha256 = req.headers['x-file-sha256'];
  const rec = await storage.put(req, {
    ...fields,
    sha256: sha256 ? String(sha256) : undefined,
    maxSize: config.maxFileSize,
  });
  console.log(`+ ${rec.id} «${rec.name}» ${rec.size} Б — ${who.admin ? 'импорт' : (meta.author ?? who.uid)}`);
  json(res, id ? 200 : 201, rec);
}

async function handle(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url ?? '/', 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/health')
    return json(res, 200, {
      ok: true,
      files: storage.list().length,
      bytes: storage.totalBytes(),
      maxFileSize: config.maxFileSize,
    });
  if (parts[0] !== 'files' || parts.length > 3) throw new HttpError(404, 'Нет такого адреса');

  const who = await authorize(req);
  const id = parts[1];
  if (id && id !== 'events' && !ID_RE.test(id)) throw new HttpError(400, 'Недопустимый id');

  if (parts.length === 1) {
    if (req.method === 'GET') return json(res, 200, storage.list());
    if (req.method === 'POST') {
      rateLimit(who.uid);
      return upload(req, res, who, null);
    }
  }
  if (parts.length === 2 && id === 'events' && req.method === 'GET') return events(req, res);
  if (parts.length === 2) {
    if (req.method === 'GET') {
      const rec = storage.get(id);
      return rec ? json(res, 200, rec) : json(res, 404, { error: 'Файл не найден' });
    }
    if (req.method === 'PUT') {
      if (!who.admin) throw new HttpError(403, 'Импорт с заданным id — только с X-Admin-Token');
      return upload(req, res, who, id);
    }
    if (req.method === 'DELETE') {
      if (!who.admin) rateLimit(who.uid);
      const rec = storage.get(id);
      if (!(await storage.remove(id))) return json(res, 404, { error: 'Файл не найден' });
      console.log(`− ${id} «${rec.name}» — ${who.admin ? 'админ' : who.uid}`);
      return json(res, 200, { ok: true });
    }
  }
  if (parts.length === 3 && parts[2] === 'content' && req.method === 'GET') {
    const rec = storage.get(id);
    return rec ? sendContent(req, res, rec) : json(res, 404, { error: 'Файл не найден' });
  }
  throw new HttpError(405, 'Метод не поддерживается');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    const status = e instanceof HttpError ? e.status : e instanceof SyntaxError ? 400 : 500;
    if (status === 500) console.error(e);
    if (res.headersSent) return res.destroy();
    // Тело недочитано (отказ до приёма файла) — закрываем соединение, чтобы клиент не слал дальше
    if (!req.complete) res.setHeader('Connection', 'close');
    json(res, status, { error: status === 500 ? 'Внутренняя ошибка сервера' : e.message });
  });
});
server.requestTimeout = 10 * 60_000; // медленная загрузка 25 МБ
server.listen(config.port, config.host, () => {
  console.log(
    `Сервер файлов: http://${config.host}:${config.port}, данные — ${config.dataDir}, файлов ${storage.list().length}, ` +
      `вход — ${config.auth}${config.appCheckProject ? ' + App Check' : ''}, сайты — ${config.origins.join(' ') || 'не заданы (CORS закрыт)'}`,
  );
});

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    for (const res of sseClients) res.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
