/**
 * Firebase Hosting REST API (v1beta1) — частичная выкладка без firebase CLI: сервер сборки публикует данные сайта
 * сервисным ключом. Токен — тот же, что для Firestore (scripts/firestore-rest.mjs: сервисный ключ или firebase login).
 *
 * Хеш файла у Hosting — sha256 от gzip (уровень 9) содержимого, как у firebase CLI: проверено, что для всех 7574
 * файлов данных он совпадает с опубликованным. Поэтому одинаковые файлы видны без скачивания. Байт «ОС» в заголовке
 * gzip у Node зависит от системы (macOS — 19, Linux — 3; сжатые данные одинаковые — проверено на Node 22 и 24),
 * поэтому сравниваем со всеми вариантами заголовка (hashes).
 *
 * Выкладка: versions:clone текущего релиза без папок данных → populateFiles (все файлы данных, по 1000) →
 * загрузка только тех, чьих хешей у Hosting нет → status FINALIZED → releases.create.
 */
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { PROJECT, token } from './firestore-rest.mjs';

export const HOSTING_API = process.env.TFC_HOSTING_API ?? 'https://firebasehosting.googleapis.com/v1beta1';
export const SITE_ID = process.env.TFC_HOSTING_SITE ?? PROJECT;

const OS_BYTES = [3, 19, 0, 7, 11, 255]; // Unix, macOS, FAT, старый Mac, NTFS, неизвестно

/** gzip как у firebase CLI и sha256 от него; hashes — хеш при каждом варианте байта ОС → этот байт */
export function hostingFile(buf) {
  const gz = zlib.gzipSync(buf, { level: 9 });
  const hash = createHash('sha256').update(gz).digest('hex');
  const hashes = new Map([[hash, gz[9]]]);
  for (const os of OS_BYTES) {
    if (os === gz[9]) continue;
    const v = Buffer.from(gz);
    v[9] = os;
    hashes.set(createHash('sha256').update(v).digest('hex'), os);
  }
  return { gz, hash, hashes };
}

/** gzip с нужным хешем (вариант байта ОС) — если Hosting попросит загрузить уже опубликованный вариант */
export function gzipWithHash(buf, want) {
  const { gz, hashes } = hostingFile(buf);
  if (!hashes.has(want)) return gz;
  const v = Buffer.from(gz);
  v[9] = hashes.get(want);
  return v;
}

async function call(method, url, body, { raw = false } = {}) {
  const headers = { Authorization: `Bearer ${await token()}` };
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = 'application/octet-stream';
  const r = await fetch(url.startsWith('http') ? url : `${HOSTING_API}/${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Hosting ${method} ${url.replace(HOSTING_API, '')}: ${r.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

/** Текущий релиз сайта: { name, version: { name, status, config, … } } или null */
export async function currentRelease(site = SITE_ID) {
  const j = await call('GET', `sites/${site}/releases?pageSize=1`);
  return j.releases?.[0] ?? null;
}

/** Файлы версии: Map путь → хеш */
export async function versionFiles(versionName) {
  const out = new Map();
  let page = '';
  do {
    const j = await call(
      'GET',
      `${versionName}/files?pageSize=2000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`,
    );
    for (const f of j.files ?? []) out.set(f.path, f.hash);
    page = j.nextPageToken ?? '';
  } while (page);
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Регулярка для exclude: корни данных — файлы (точно) и папки (всё внутри) */
export function rootsRegex(roots) {
  const alts = roots.map((r) => (r.dir ? `${escapeRe(r.name)}/` : `${escapeRe(r.name)}$`));
  return `^/(${alts.join('|')})`;
}

async function waitOperation(op, log) {
  let cur = op;
  for (let i = 0; !cur.done; i++) {
    if (i > 300) throw new Error(`Hosting: операция ${op.name} не завершилась за 10 минут`);
    await new Promise((ok) => setTimeout(ok, 2000));
    cur = await call('GET', op.name);
    if (i % 10 === 9) log?.(`жду копию версии… (${(i + 1) * 2} с)`);
  }
  if (cur.error) throw new Error(`Hosting: копия версии не удалась: ${JSON.stringify(cur.error).slice(0, 400)}`);
  return cur.response;
}

/**
 * Выкладка. files — Map путь («/items.json») → { hash }; gzip тех, что придётся загрузить, отдаёт getGz(путь, хеш).
 * roots — что выкинуть из копии текущей версии.
 * Возвращает { version, release, uploaded, populated }.
 */
export async function deploy({ sourceVersion, roots, files, getGz, message, site = SITE_ID, log = () => {} }) {
  log(`копирую версию ${sourceVersion.split('/').pop()} без данных сборки`);
  const op = await call('POST', `sites/${site}/versions:clone`, {
    sourceVersion,
    finalize: false,
    exclude: { regexes: [rootsRegex(roots)] },
  });
  const version = (await waitOperation(op, log)).name;
  log(`новая версия ${version.split('/').pop()}`);

  const entries = [...files.entries()];
  const required = new Set();
  let uploadUrl = null;
  for (let i = 0; i < entries.length; i += 1000) {
    const batch = Object.fromEntries(entries.slice(i, i + 1000).map(([p, f]) => [p, f.hash]));
    const r = await call('POST', `${version}:populateFiles`, { files: batch });
    for (const h of r.uploadRequiredHashes ?? []) required.add(h);
    uploadUrl = r.uploadUrl ?? uploadUrl;
  }
  log(`файлов в версии: ${entries.length}, загрузить: ${required.size}`);

  const byHash = new Map(entries.map(([p, f]) => [f.hash, p]));
  let uploaded = 0;
  const queue = [...required];
  const worker = async () => {
    for (let h = queue.shift(); h; h = queue.shift()) {
      const p = byHash.get(h);
      if (!p) throw new Error(`Hosting просит хеш ${h}, которого нет среди файлов`);
      await call('POST', `${uploadUrl}/${h}`, await getGz(p, h), { raw: true });
      uploaded++;
      if (uploaded % 200 === 0) log(`загружено ${uploaded} из ${required.size}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  await call('PATCH', `${version}?update_mask=status`, { status: 'FINALIZED' });
  const release = await call('POST', `sites/${site}/releases?versionName=${encodeURIComponent(version)}`, {
    message: message ?? 'сервер сборки',
  });
  log(`выпущено: ${release.name}`);
  return { version, release: release.name, uploaded, populated: entries.length };
}
