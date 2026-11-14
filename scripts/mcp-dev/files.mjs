/**
 * Вложения dev-задач — на сервере сборки (dev #357; раньше — Firestore files с taskId = "dev:<id>"): метаданные
 * в SQLite трекера, содержимое — на диске сервера (server/pack-server/lib/dev-files.mjs). Чтение — в локальный кеш
 * со сверкой SHA256 (zip распаковывается рядом), запись — dev_file_put: файл как есть, папка — одним zip или
 * каждым файлом отдельно. Ни одного чтения Firestore.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import { NICK } from '../mcp/env.mjs';
import { packServer } from '../pack-fetch.mjs';
import { api } from './devtasks.mjs';

const CACHE = path.resolve(
  process.env.TFC_DEV_FILES_CACHE ?? path.join(os.homedir(), '.cache', 'tfc-plans', 'dev-files'),
);
/** Как DEV_FILE_MAX_BYTES сервера по умолчанию: проверяем до отправки */
const MAX = 50 * 1024 * 1024;
const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  zip: 'application/zip',
  gz: 'application/gzip',
  jar: 'application/java-archive',
  pdf: 'application/pdf',
};
const mimeOf = (name) => MIME[name.split('.').pop().toLowerCase()] ?? 'application/octet-stream';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const kb = (n) =>
  n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(1)} МБ`;

function server() {
  const srv = packServer();
  if (!srv) throw new Error('нет адреса сервера сборки: TFC_PACK_URL и TFC_PACK_TOKEN в .env.local или вход в tfc');
  return srv;
}

export async function taskFiles(task) {
  if (!Number.isSafeInteger(task) || task < 1) throw new Error('Нужен положительный номер dev-задачи');
  return (await api('GET', `tasks/${task}/files`)).files;
}

/** Строки «Вложения» для dev_get; files — из ответа задачи (старый сервер их не отдаёт) */
export function filesBlock(task, files) {
  if (!files?.length) return [];
  return [
    '',
    `Вложения (${files.length}):`,
    ...files.map(
      (f) => `- ${f.id} «${f.name}» (${f.type}, ${kb(f.size)}) — ${f.author}; dev_file_get task=${task} id=${f.id}`,
    ),
  ];
}

/** Скачать в кеш (~/.cache/tfc-plans/dev-files/<id>), сверить, zip/gz распаковать → { dir, meta, files: [{ rel, full, size }] } */
async function fetchFile(meta) {
  const dir = path.join(CACHE, meta.id);
  const orig = path.join(dir, meta.name.replace(/[/\\]/g, '_'));
  const out = path.join(dir, 'files');
  if (!fs.existsSync(orig) || sha256(fs.readFileSync(orig)) !== meta.sha256) {
    const srv = server();
    const res = await fetch(`${srv.url}/dev/files/${encodeURIComponent(meta.id)}/content`, {
      headers: { Authorization: `Bearer ${srv.token}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`вложение ${meta.id}: ${res.status} ${res.statusText}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length !== meta.size) throw new Error(`вложение ${meta.id}: ${bytes.length} байт вместо ${meta.size}`);
    if (sha256(bytes) !== meta.sha256) throw new Error(`вложение ${meta.id}: не совпала контрольная сумма`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(orig, bytes);
    const write = (rel, data) => {
      const p = path.resolve(out, rel);
      if (!p.startsWith(out + path.sep)) throw new Error(`Странный путь в архиве: ${rel}`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, data);
    };
    if (/\.zip$/i.test(meta.name))
      for (const [rel, data] of Object.entries(unzipSync(new Uint8Array(bytes)))) {
        if (!rel.endsWith('/')) write(rel, data);
      }
  }
  const files = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else files.push({ rel: path.relative(out, full).split(path.sep).join('/'), full, size: fs.statSync(full).size });
    }
  };
  walk(out);
  files.sort((x, y) => x.rel.localeCompare(y.rel));
  return { orig, files };
}

export async function devFileGet(a) {
  const { file: meta } = await api('GET', `files/${encodeURIComponent(a.id)}`);
  if (meta.task !== Number(a.task)) throw new Error(`Вложение ${a.id} — у задачи #${meta.task}, не у #${a.task}`);
  const { orig, files } = await fetchFile(meta);
  const images = [];
  // Изображения передаются без перекодирования (до 10 МБ и не больше 6 из архива); остальное — по локальному пути
  const isImg = (n) => /\.(png|jpe?g|webp|gif)$/i.test(n);
  const shown = (
    files.length ? files.filter((f) => isImg(f.rel)) : isImg(meta.name) ? [{ full: orig, rel: meta.name }] : []
  )
    .filter((f) => fs.statSync(f.full).size <= 10 * 1024 * 1024)
    .slice(0, 6);
  for (const f of shown) images.push({ data: fs.readFileSync(f.full).toString('base64'), mimeType: mimeOf(f.rel) });
  return {
    text: [
      `Вложение #${a.task}: «${meta.name}» ${kb(meta.size)} · ${meta.author}, ${new Date(meta.createdAt).toLocaleString('ru-RU')}`,
      `Файл: ${orig}`,
      ...(files.length
        ? [`Распаковано (${files.length}):`, ...files.map((f) => `  ${f.rel} (${kb(f.size)}): ${f.full}`)]
        : []),
      ...(images.length ? [`Картинки ниже: ${shown.map((f) => f.rel).join(', ')}`] : []),
    ].join('\n'),
    images,
  };
}

/** Один файл на сервер; тот же файл с тем же именем у задачи второй раз не сохраняется (existed) */
export async function uploadDevFile(task, name, bytes, by = NICK) {
  if (bytes.length > MAX) throw new Error(`«${name}» — ${kb(bytes.length)}, больше ${kb(MAX)}`);
  const srv = server();
  const res = await fetch(`${srv.url}/dev/tasks/${task}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${srv.token}`,
      'Content-Type': mimeOf(name),
      'X-File-Name': encodeURIComponent(name),
      'X-File-Sha256': sha256(bytes),
      'X-File-By': encodeURIComponent(by),
    },
    body: bytes,
    signal: AbortSignal.timeout(300_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`«${name}»: ${out.error ?? `${res.status} ${res.statusText}`}`);
  return out;
}

/** Файлы папки (без скрытых) → { rel: bytes } */
function readDir(dir) {
  const files = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) files[path.relative(dir, full).split(path.sep).join('/')] = fs.readFileSync(full);
    }
  };
  walk(dir);
  return files;
}

/**
 * Приложить файлы к задаче. paths — файлы и папки; папка уходит одним zip (имя — name или <папка>.zip),
 * с each=true — каждым файлом. Несколько путей с zip=true — тоже один архив.
 */
export async function devFilePut(a) {
  const task = Number(a.task);
  if (!Number.isSafeInteger(task) || task < 1) throw new Error('task — номер dev-задачи');
  const paths = (Array.isArray(a.path) ? a.path : [a.path]).filter(Boolean).map((p) => path.resolve(String(p)));
  if (!paths.length) throw new Error('path — файл или папка');
  for (const p of paths) if (!fs.existsSync(p)) throw new Error(`нет такого пути: ${p}`);

  /** [{ name, bytes }] к отправке */
  const items = [];
  if (a.zip || (paths.length === 1 && fs.statSync(paths[0]).isDirectory() && !a.each)) {
    const entries = {};
    for (const p of paths) {
      if (fs.statSync(p).isDirectory()) {
        const prefix = paths.length > 1 ? `${path.basename(p)}/` : '';
        for (const [rel, data] of Object.entries(readDir(p))) entries[prefix + rel] = data;
      } else entries[path.basename(p)] = fs.readFileSync(p);
    }
    if (!Object.keys(entries).length) throw new Error('папка пуста');
    // Метку времени не пишем — тот же комплект даёт тот же zip, повторная загрузка не плодит копий
    const zipped = zipSync(
      Object.fromEntries(
        Object.entries(entries)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([k, v]) => [k, [new Uint8Array(v), { mtime: new Date(1980, 0, 1) }]]),
      ),
      { level: 6 },
    );
    const base = a.name || `${path.basename(paths[0])}.zip`;
    items.push({ name: /\.zip$/i.test(base) ? base : `${base}.zip`, bytes: Buffer.from(zipped) });
  } else {
    for (const p of paths) {
      if (fs.statSync(p).isDirectory())
        for (const [rel, data] of Object.entries(readDir(p)))
          items.push({ name: rel.replaceAll('/', '_'), bytes: data });
      else items.push({ name: paths.length === 1 && a.name ? a.name : path.basename(p), bytes: fs.readFileSync(p) });
    }
  }
  if (items.length > 50) throw new Error(`файлов ${items.length} — больше 50; приложите папку одним zip (без each)`);

  const lines = [];
  for (const it of items) {
    const r = await uploadDevFile(task, it.name, it.bytes);
    lines.push(
      `${r.existed ? '= уже было' : '+'} ${r.file.id} «${r.file.name}» ${kb(r.file.size)} — dev_file_get task=${task} id=${r.file.id}`,
    );
  }
  return `Вложения #${task} (${items.length}):\n${lines.join('\n')}`;
}
