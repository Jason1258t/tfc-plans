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
 *   POST   /blobs/pack              — { sha256: [...] } → мелкие файлы одним gzip-потоком  player
 *   POST   /blobs/missing           — { sha256: [...] } → { missing }        admin
 *   PUT    /blobs/:sha256           — залить файл, тело — содержимое         admin
 *   POST   /pack/snapshots          — создать снимок                         admin
 *   POST   /pack/current            — { id } или { rollback: true }          admin
 *   GET    /auth/me                 — имя, id и роль текущего ключа         player
 *   GET    /admin/keys              — ключи (без самих ключей)               admin
 *   POST   /admin/keys              — { name, role } → { key, ... }          admin
 *   DELETE /admin/keys/:id          — отозвать ключ                          admin
 *   POST   /admin/rebuild           — собрать данные сайта (+ git pull, части)  admin
 *   POST   /admin/publish           — опубликовать собранное (по умолчанию пробно) admin
 *   GET    /jobs, GET /jobs/:id     — задания сборки: состояние и лог           admin
 *   GET    /data                    — собранные данные текущего снимка: список   player
 *   GET    /data/:snapshot/<путь>   — файл собранных данных                     player
 *   GET    /site/datapacks?name=…   — датапаки сайта «Ставить в мир» (+ названные)  player
 *   GET    /site/kubejs?name=…      — скрипты KubeJS «Ставить на сервер» (+ названные) player
 *   GET    /site/schematics         — схемы библиотеки (без превью)              player
 *   GET    /site/files/:id          — исходник схемы (.nbt из хранилища сайта)   player
 *   GET    /site/addons             — аддоны: карточка + версии с jar (Firestore addonVersions) player
 *   POST   /site/reports            — отчёт tfc report (лог, краш, zip пачки): тело — байты, X-Report — JSON
 *                                     { name, kind, type, label, note, files, taskId } → в хранилище сайта  player
 *   POST   /admin/addons            — { addon, version, file, sha256, size }: jar версии (блоб уже залит)
 *                                     → запись в addonVersions (новая — черновик)          admin
 *   GET    /admin/changes           — правки конфигов от агента (Firestore configChanges) admin
 *   POST   /admin/changes/:id       — { status: applied|rejected, results, updateTime } admin
 *   /dev/…                           — задачи разработки (SQLite, lib/dev.mjs): ключ любой роли или вход сайта
 *     GET|POST /dev/tasks, GET|PATCH|DELETE /dev/tasks/:id, POST /dev/tasks/:id/notes,
 *     GET|POST /dev/docs, GET|PATCH|DELETE /dev/docs/:id, GET /dev/meta, POST /dev/import (admin)
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { openDev } from './lib/dev.mjs';
import { verifyAppCheck, verifyIdToken } from './lib/firebase-auth.mjs';
import { openJobs, PUBLISH } from './lib/jobs.mjs';
import { deploymentsOf } from './lib/datapacks.mjs';
import { changeDatapacks, snapshotDatapacks } from './lib/datapack-deployment.mjs';
import { openKeys } from './lib/keys.mjs';
import { openSite } from './lib/site.mjs';
import { openStore } from './lib/store.mjs';
import { openUpdates } from './lib/updates.mjs';
import { HttpError, SHA256_RE } from './lib/util.mjs';

const env = process.env;
const config = {
  port: Number(env.PORT ?? 8788),
  host: env.HOST ?? '127.0.0.1',
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  maxBlobSize: Number(env.MAX_BLOB_SIZE ?? 1024 ** 3),
  maxTotalBytes: Number(env.MAX_TOTAL_BYTES ?? 50 * 1024 ** 3),
  minFreeBytes: Number(env.MIN_FREE_BYTES ?? 1024 ** 3),
  maxJsonBody: 32 * 1024 ** 2,
};

const store = await openStore(config.dataDir, config);
const keys = openKeys(config.dataDir);
const updates = await openUpdates(config.dataDir, store);
const dev = openDev(config.dataDir);
/** Страница «Разработка» сайта: откуда пускать (CORS) и чей вход принимать */
const devSite = {
  origins: (
    env.DEV_ORIGINS ??
    'https://tfc-plans-fd2c.web.app,https://tfc-plans-fd2c.firebaseapp.com,http://localhost:5173,http://localhost:5176,http://localhost:5177'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  projectId: env.FIREBASE_PROJECT_ID ?? 'tfc-plans-fd2c',
  /** номер проекта — задан, тогда со входом сайта обязателен и токен App Check */
  appCheckProject: env.APP_CHECK_PROJECT_NUMBER ?? '',
};

/**
 * Код разборщиков. Сервер запущен из репозитория (npm run dev) — берём его же, git pull не делаем (это рабочая
 * копия разработчика). Установлен в /opt/tfc-pack — своя копия в <DATA_DIR>/repo, её обновляет git pull.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const inRepo = fs.existsSync(path.join(here, '..', '..', 'scripts', 'pack.mjs'));
const repoDir = path.resolve(
  env.REPO_DIR ?? (inRepo ? path.join(here, '..', '..') : path.join(config.dataDir, 'repo')),
);
const jobs = openJobs(config.dataDir, {
  repoDir,
  managedRepo: env.REPO_MANAGED ? env.REPO_MANAGED === '1' : !inRepo && !env.REPO_DIR,
  repoUrl: env.REPO_URL ?? 'https://github.com/Jason1258t/tfc-plans.git',
  repoBranch: env.REPO_BRANCH ?? 'main',
  heapMb: Number(env.BUILD_HEAP_MB) || 0,
  timeoutMs: (Number(env.JOB_TIMEOUT_MIN) || 120) * 60_000,
});
const site = openSite(config.dataDir, {
  repoDir,
  ttlMs: Number(env.SITE_CACHE_SEC ?? 300) * 1000,
  docsUrl: env.SITE_DOCS_URL, // для проверки на заглушке Firestore
});
/** После смены текущего снимка: собрать (off — нет) и как публиковать (по умолчанию — только пробно) */
const autoBuild = env.AUTO_BUILD !== 'off';
const autoPublish = PUBLISH.includes(env.AUTO_PUBLISH) ? env.AUTO_PUBLISH : 'dry-run';
const dataRoot = path.join(config.dataDir, 'data');
const SNAP_RE = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const built = (id) => SNAP_RE.test(id ?? '') && fs.existsSync(path.join(dataRoot, id, '.build.json'));

// ---------------------------------------------------------------- доступ

/** Кто пришёл: { id, name, role } или 401/403 */
async function authorize(req, role) {
  const who = await keys.check(req.headers.authorization);
  if (!who) throw new HttpError(401, 'Нужен ключ: Authorization: Bearer <ключ>');
  if (role === 'admin' && who.role !== 'admin') throw new HttpError(403, 'Нужен ключ администратора');
  return who;
}

/**
 * Задачи разработки: ключ сервера сборки любой роли или ID-токен входа сайта (+ App Check) — как правила Firestore.
 * JWT отличаем по виду: три части через точку.
 */
async function authorizeDev(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (m && m[1].split('.').length === 3) {
    let uid;
    try {
      uid = await verifyIdToken(m[1], devSite.projectId);
      if (devSite.appCheckProject) await verifyAppCheck(req.headers['x-firebase-appcheck'], devSite.appCheckProject);
    } catch (e) {
      throw new HttpError(401, `Вход сайта не принят: ${e.message}`);
    }
    return { id: uid, name: 'сайт', role: 'site', via: 'site' };
  }
  return { ...(await authorize(req, 'player')), via: 'key' };
}

function devCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !devSite.origins.includes(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/** Сделать снимок текущим ({ id } или { rollback: true }) и поставить сборку данных сайта */
async function makeCurrent(body, by) {
  const r = await store.setCurrent(body, by);
  console.log(`★ текущий снимок ${r.previous ?? '—'} → ${r.current} — ${by}`);
  if (autoBuild) {
    // Уже собранный (откат) — только публикация; новый — сборка и публикация
    const kind = built(r.current) ? 'publish' : 'build';
    if (kind === 'build' || autoPublish !== 'none')
      // Живая выкладка — только свежим кодом разборщиков: старый код собрал бы неполные данные (2026-10-22)
      r.job = (
        await jobs.enqueue({
          kind,
          snapshot: r.current,
          publish: autoPublish,
          pull: kind === 'build' && autoPublish === 'live',
          by,
        })
      ).id;
  }
  return r;
}

// ---------------------------------------------------------------- HTTP

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Тело как есть (отчёт tfc report, до 25 МБ) */
async function readRawBody(req, max) {
  const len = Number(req.headers['content-length']);
  if (Number.isFinite(len) && len > max) throw new HttpError(413, 'Слишком большой файл');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new HttpError(413, 'Слишком большой файл');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
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

/** Пакет: сколько файлов и байт за раз и какой файл ещё считается мелким (крупные — /blobs/:sha256 с докачкой) */
const PACK_FILES = 5000;
const PACK_BYTES = 64 * 1024 ** 2;
const PACK_BLOB = 4 * 1024 ** 2;

/**
 * Мелкие файлы одним ответом: тысячи конфигов и скриптов KubeJS по запросу на каждый шли минутами. Тело — gzip
 * (сжимаем сами: Caddy не сжимает octet-stream) из записей «sha256 (64 символа) + размер (12 цифр) + содержимое».
 */
async function sendPack(res, list) {
  if (!Array.isArray(list) || !list.length || list.length > PACK_FILES)
    throw new HttpError(400, `sha256 — непустой массив до ${PACK_FILES}`);
  const shas = [...new Set(list)];
  let total = 0;
  for (const sha of shas) {
    if (!SHA256_RE.test(sha ?? '')) throw new HttpError(400, 'sha256 — 64 строчных шестнадцатеричных символа');
    if (!store.hasBlob(sha)) throw new HttpError(404, `Нет файла ${sha}`);
    const size = store.blobSize(sha);
    if (size > PACK_BLOB) throw new HttpError(400, `Файл ${sha} больше ${PACK_BLOB} Б — его качают отдельно`);
    total += size;
  }
  if (total > PACK_BYTES) throw new HttpError(413, `Пакет больше ${PACK_BYTES} Б — разбейте на части`);
  res.writeHead(200, { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store' });
  // Генератор в pipeline: клиент оборвал связь — чтение файлов прекращается, а не ждёт drain вечно
  await pipeline(
    async function* () {
      for (const sha of shas) {
        yield Buffer.from(`${sha}${String(store.blobSize(sha)).padStart(12, '0')}`);
        yield* fs.createReadStream(store.blobPath(sha));
      }
    },
    zlib.createGzip({ level: 6 }),
    res,
  );
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  const route = `${req.method} /${parts[0] ?? ''}${parts[1] ? `/${parts[1]}` : ''}`;

  if (req.method === 'GET' && url.pathname === '/health') {
    const s = store.stats();
    return json(res, 200, { ok: true, current: s.current, snapshots: s.snapshots, blobs: s.blobs, bytes: s.bytes });
  }

  if (req.method === 'GET' && url.pathname === '/auth/me') {
    return json(res, 200, await authorize(req, 'player'));
  }

  // --- задачи разработки
  if (parts[0] === 'dev') {
    devCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    const who = await authorizeDev(req);
    const body = req.method === 'POST' || req.method === 'PATCH' ? await readJsonBody(req) : null;
    const [status, out] = dev.route(req.method, parts.slice(1).map(decodeURIComponent), url.searchParams, body, who);
    if (req.method !== 'GET' && status < 300 && out?.task)
      console.log(`✎ dev #${out.task.id} ${req.method} ${out.task.status} — ${body?.by ?? who.name} (${who.name})`);
    return json(res, status, out);
  }

  // --- блобы
  if (parts[0] === 'blobs' && parts.length === 2) {
    const sha = parts[1];
    if (sha === 'missing' && req.method === 'POST') {
      await authorize(req, 'admin');
      const body = await readJsonBody(req);
      return json(res, 200, { missing: store.missing(body?.sha256) });
    }
    if (sha === 'pack' && req.method === 'POST') {
      await authorize(req, 'player');
      return sendPack(res, (await readJsonBody(req))?.sha256);
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
      return json(res, 200, await makeCurrent(await readJsonBody(req), who.name));
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

  // --- датапаки: административный перенос с проверкой ревизии и текущего снимка
  if (route === 'POST /admin/datapacks') {
    const who = await authorize(req, 'admin');
    const body = await readJsonBody(req);
    const snap = await changeDatapacks(store, site, body, who);
    return json(res, 201, { snapshot: snap.id, ...(await makeCurrent({ id: snap.id, base: body.base }, who.name)) });
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

  // --- версии аддонов: jar заливают блобом (PUT /blobs/:sha256), здесь — запись версии на сайте
  if (route === 'POST /admin/addons' && parts.length === 2) {
    const who = await authorize(req, 'admin');
    const body = (await readJsonBody(req)) ?? {};
    if (!SHA256_RE.test(body.sha256 ?? '')) throw new HttpError(400, 'sha256 — 64 строчных шестнадцатеричных символа');
    if (!store.hasBlob(body.sha256)) throw new HttpError(409, 'Сначала залейте jar (PUT /blobs/<sha256>)');
    const r = await site.registerAddonVersion(body, who.name);
    console.log(`${r.created ? '+' : '='} аддон ${r.id} ${body.sha256.slice(0, 12)}… — ${who.name}`);
    return json(res, r.created ? 201 : 200, r);
  }

  // --- правки конфигов от агента: хост применяет их у себя (tfc admin changes) и отмечает итог
  if (parts[0] === 'admin' && parts[1] === 'changes') {
    const who = await authorize(req, 'admin');
    if (parts.length === 2 && req.method === 'GET') return json(res, 200, { changes: await site.configChanges() });
    if (parts.length === 3 && req.method === 'POST') {
      const r = await site.setConfigChange(parts[2], (await readJsonBody(req)) ?? {}, who.name);
      console.log(`✎ правка конфигов ${r.id}: ${r.status} — ${who.name}`);
      return json(res, 200, r);
    }
  }

  // --- предложенные обновления сборки: автор выкладывает, хост забирает к себе и одобряет (tfc admin updates)
  if (parts[0] === 'admin' && parts[1] === 'updates') {
    const who = await authorize(req, 'admin');
    if (parts.length === 2 && req.method === 'GET') return json(res, 200, { updates: await updates.list() });
    if (parts.length === 2 && req.method === 'POST') {
      const u = await updates.create(await readJsonBody(req), who.name);
      console.log(`✎ обновление ${u.id}: ${u.files.length} файлов, убрать ${u.remove.length} — ${who.name}`);
      return json(res, 201, u);
    }
    if (parts.length === 3 && req.method === 'GET') {
      const u = await updates.get(parts[2]);
      return u ? json(res, 200, u) : json(res, 404, { error: 'Нет такого обновления' });
    }
    if (parts.length === 4 && req.method === 'POST' && parts[3] === 'approve') {
      const body = (await readJsonBody(req)) ?? {};
      const r = await updates.approve(parts[2], who.name, { force: body.force === true });
      console.log(`✔ обновление ${parts[2]} → снимок ${r.snapshot.id} — ${who.name}`);
      return json(res, 200, { ...r, ...(await makeCurrent({ id: r.snapshot.id }, who.name)) });
    }
    if (parts.length === 4 && req.method === 'POST' && parts[3] === 'reject') {
      const u = await updates.reject(parts[2], who.name, ((await readJsonBody(req)) ?? {}).reason);
      console.log(`✘ обновление ${u.id} отклонено — ${who.name}`);
      return json(res, 200, u);
    }
  }

  // --- сборка данных и публикация
  if (route === 'POST /admin/rebuild' || route === 'POST /admin/publish') {
    const who = await authorize(req, 'admin');
    const body = (await readJsonBody(req)) ?? {};
    const current = store.channels().current;
    const snapshot = body.snapshot ?? current;
    if (!snapshot || !(await store.getSnapshot(snapshot))) throw new HttpError(404, 'Нет такого снимка');
    const isPublish = parts[1] === 'publish';
    // Публикация по умолчанию — пробная: настоящая только явно (publish: 'live' / dryRun: false)
    const publish = isPublish ? (body.dryRun === false ? 'live' : 'dry-run') : (body.publish ?? autoPublish);
    if (publish === 'live' && snapshot !== current)
      throw new HttpError(409, 'Публиковать можно только текущий снимок — сначала POST /pack/current');
    if (isPublish && !built(snapshot)) throw new HttpError(409, 'Снимок ещё не собран — POST /admin/rebuild');
    const j = await jobs.enqueue({
      kind: isPublish ? 'publish' : 'build',
      snapshot,
      parts: isPublish ? [] : (body.parts ?? []),
      pull: !isPublish && !!body.pull,
      publish,
      allowRemovals: !!body.allowRemovals,
      by: who.name,
    });
    console.log(`+ задание ${j.id} (${j.kind}, ${snapshot}, публикация ${publish}) — ${who.name}`);
    return json(res, 202, j);
  }
  if (parts[0] === 'jobs' && req.method === 'GET') {
    await authorize(req, 'admin');
    if (parts.length === 1) return json(res, 200, { ...jobs.busy(), jobs: jobs.list() });
    if (parts.length === 2) {
      const j = await jobs.get(parts[1], Number(url.searchParams.get('from')) || 0);
      return j ? json(res, 200, j) : json(res, 404, { error: 'Нет такого задания' });
    }
  }

  // --- собранные данные (для npm run pack:fetch и деплоя сайта без jar)
  if (parts[0] === 'data' && (req.method === 'GET' || req.method === 'HEAD')) {
    await authorize(req, 'player');
    if (parts.length === 1) {
      const id = url.searchParams.get('snapshot') ?? store.channels().current;
      if (!built(id)) throw new HttpError(404, 'Данные этого снимка ещё не собраны');
      const dir = path.join(dataRoot, id);
      const build = JSON.parse(await fs.promises.readFile(path.join(dir, '.build.json'), 'utf8'));
      const index = JSON.parse(await fs.promises.readFile(path.join(dir, '.index.json'), 'utf8'));
      return json(res, 200, { snapshot: id, current: id === store.channels().current, build, files: index.files });
    }
    const rel = parts.slice(2).map(decodeURIComponent);
    if (!built(parts[1]) || rel.some((s) => s.startsWith('.') || s.includes('/') || s.includes('\\')))
      throw new HttpError(404, 'Нет такого файла');
    const file = path.join(dataRoot, parts[1], ...rel);
    const st = await fs.promises.stat(file).catch(() => null);
    if (!st?.isFile()) throw new HttpError(404, 'Нет такого файла');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'private, no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    return fs
      .createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  }

  // Публикация исходника схемы: роль и ревизия проверяются на сервере.
  if (route === 'POST /site/schematics' && parts.length === 2) {
    const who = await authorize(req, 'player');
    let meta;
    try {
      meta = JSON.parse(decodeURIComponent(String(req.headers['x-schematic'] ?? '')));
    } catch {
      throw new HttpError(400, 'X-Schematic — JSON с описанием схемы');
    }
    return json(res, 201, await site.publishSchematic(await readRawBody(req, 10 * 1024 ** 2), meta, who));
  }

  // --- отчёты tfc report → хранилище файлов сайта
  if (route === 'POST /site/reports' && parts.length === 2) {
    const who = await authorize(req, 'player');
    let meta;
    try {
      meta = JSON.parse(decodeURIComponent(String(req.headers['x-report'] ?? '')));
    } catch {
      throw new HttpError(400, 'X-Report — JSON с описанием отчёта (encodeURIComponent)');
    }
    const r = await site.uploadReport(await readRawBody(req, 26 * 1024 ** 2), meta, who.name);
    console.log(`+ отчёт ${r.id} ${r.type} ${r.name} ${r.size} Б — ${who.name}`);
    return json(res, 201, r);
  }

  // --- контент сайта для tfc pull (Firestore — сервисным ключом, с кешем)
  if (parts[0] === 'site' && req.method === 'GET') {
    await authorize(req, 'player');
    const names = url.searchParams.getAll('name');
    if (url.pathname === '/site/datapacks') {
      const current = await store.getCurrent();
      const deployed = deploymentsOf(current);
      const inventory = url.searchParams.get('all') === 'true';
      const result = await site.datapacks(names, { all: inventory, fresh: url.searchParams.get('fresh') === 'true' });
      let snapshotItems = [];
      if (url.searchParams.get('v') === '2') {
        const cards = inventory ? result.items : (await site.datapacks([], { all: true })).items;
        snapshotItems = await snapshotDatapacks(store, site, current, cards);
        const match = (d, n) =>
          [d.id, d.name, d.fileName, d.path?.split('/').at(-1)].some((x) => x?.toLowerCase() === n.toLowerCase());
        if (names.length) snapshotItems = snapshotItems.filter((d) => names.some((n) => match(d, n)));
        result.unknown = (result.unknown ?? []).filter(
          (n) => !snapshotItems.some((d) => match(d, n)) && !deployed.some((d) => match(d, n)),
        );
      }
      // И старому CLI не отдаём подтверждённые пакеты для повторной установки в мир.
      const omitted = result.items.filter((d) => deployed.some((p) => p.id === d.id));
      if (!inventory) result.items = result.items.filter((d) => !deployed.some((p) => p.id === d.id));
      return json(res, 200, {
        ...result,
        snapshotItems,
        deployed,
        omitted: omitted.map((d) => ({ id: d.id, name: d.name })),
        snapshot: current?.id ?? null,
      });
    }
    if (url.pathname === '/site/kubejs') return json(res, 200, await site.kubejs(names));
    if (url.pathname === '/site/schematics') return json(res, 200, await site.schematics());
    if (url.pathname === '/site/addons') return json(res, 200, await site.addons());
    if (parts[1] === 'files' && parts.length === 3) {
      const file = await site.filePath(parts[2]);
      const st = await fs.promises.stat(file);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'private, max-age=31536000, immutable',
      });
      return fs
        .createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res);
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
  console.log(
    `Сборка данных: код — ${repoDir}${inRepo ? ' (репозиторий, без git pull)' : ''}; после смены текущего — ` +
      `${autoBuild ? `сборка, публикация ${autoPublish}` : 'ничего (AUTO_BUILD=off)'}`,
  );
  if (!(await keys.list()).some((k) => k.role === 'admin'))
    console.warn(
      'Нет ни одного ключа администратора. Создайте: node cli.mjs key add <имя> --role admin (локально — npm run key -- add host --role admin)',
    );
});

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    console.log('Остановка: ожидаю завершения очереди заданий', jobs.busy());
    const drained = jobs.drain();
    const closed = new Promise((resolve) => server.close(resolve));
    await drained;
    console.log('Все задания завершены; останавливаю сервер');
    await closed;
    process.exit(0);
  });
