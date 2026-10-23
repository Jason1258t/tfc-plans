/**
 * Firebase Hosting REST API (v1beta1) — частичная выкладка без firebase CLI: сервер сборки публикует данные сайта
 * сервисным ключом. Токен — тот же, что для Firestore (scripts/firestore-rest.mjs: сервисный ключ или firebase login).
 *
 * Хеш файла у Hosting — sha256 от gzip (уровень 9) содержимого, как у firebase CLI: проверено, что для всех 7574
 * файлов данных он совпадает с опубликованным. Поэтому одинаковые файлы видны без скачивания. Байт «ОС» в заголовке
 * gzip у Node зависит от системы (macOS — 19, Linux — 3; сжатые данные одинаковые — проверено на Node 22 и 24),
 * поэтому сравниваем со всеми вариантами заголовка (hashes).
 *
 * Выкладка данных (deploy): новая версия с настройками текущей (createVersion) → populateFiles (по 1000): файлы
 * текущей версии вне корней данных с их хешами + файлы данных → загрузка только тех, чьих хешей у Hosting нет →
 * сверка списка файлов новой версии → status FINALIZED → releases.create.
 * Выкладка сайта (scripts/deploy-site.mjs): новая версия с настройками из firebase.json (createVersion) → те же шаги.
 * versions:clone не используем: 2026-10-23 копия с exclude корней данных вышла без 47 файлов сайта (index-*.js,
 * favicon.svg, tfc/, addons/…), и сайт не открывался до следующего деплоя.
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

/** Настройки версии Hosting из блока hosting файла firebase.json (как их переводит firebase CLI) */
export function hostingConfig(hosting) {
  const config = {};
  if (hosting.headers?.length)
    config.headers = hosting.headers.map((h) => ({
      glob: h.source,
      headers: Object.fromEntries(h.headers.map((x) => [x.key, x.value])),
    }));
  if (hosting.rewrites?.length) {
    config.rewrites = hosting.rewrites.map((r) => {
      if (!r.destination) throw new Error(`rewrite ${r.source}: поддержан только destination`);
      return { glob: r.source, path: r.destination };
    });
  }
  for (const k of ['redirects', 'cleanUrls', 'trailingSlash', 'i18n'])
    if (hosting[k] !== undefined) throw new Error(`firebase.json hosting.${k}: перенос в версию не написан`);
  return config;
}

/** Новая пустая версия с настройками */
export async function createVersion({ config, site = SITE_ID }) {
  return (await call('POST', `sites/${site}/versions`, { config })).name;
}

/**
 * Выкладка данных. files — Map путь («/items.json») → { hash }; gzip тех, что придётся загрузить, отдаёт
 * getGz(путь, хеш). roots — корни данных: файлы sourceVersion вне них переносятся в новую версию с теми же хешами
 * (уже на Hosting, ничего не загружается), внутри них — только то, что в files.
 * Возвращает { version, release, uploaded, populated, kept }.
 */
export async function deploy({ sourceVersion, roots, files, getGz, message, site = SITE_ID, log = () => {} }) {
  const source = await call('GET', sourceVersion);
  const published = await versionFiles(sourceVersion);
  const re = new RegExp(rootsRegex(roots));
  const all = new Map();
  for (const [p, hash] of published) if (!re.test(p)) all.set(p, { hash });
  const kept = all.size;
  for (const [p, f] of files) {
    if (!re.test(p)) throw new Error(`файл данных ${p} вне корней данных`);
    all.set(p, f);
  }
  if (!kept) throw new Error(`в версии ${sourceVersion.split('/').pop()} нет файлов сайта — выкладывать не буду`);
  log(`из версии ${sourceVersion.split('/').pop()} переношу файлы сайта: ${kept}; данных сборки: ${files.size}`);
  const version = await createVersion({ config: source.config ?? {}, site });
  log(`новая версия ${version.split('/').pop()}`);
  const res = await release({
    version,
    files: all,
    getGz: (p, h) => {
      // тот же хеш может быть и у файла сайта, и у файла данных — загружаем файл данных
      const q = files.has(p) ? p : [...files].find(([, f]) => f.hash === h)?.[0];
      if (!q) throw new Error(`Hosting просит загрузить ${p} — это файл сайта, у сервера сборки его нет`);
      return getGz(q, h);
    },
    message,
    site,
    log,
  });
  return { ...res, kept };
}

/** Сверка: в версии есть все файлы с нужными хешами — иначе стоп до FINALIZED (версия остаётся неопубликованной) */
async function checkVersion(version, files) {
  const got = await versionFiles(version);
  const missing = [];
  for (const [p, f] of files) if (got.get(p) !== f.hash) missing.push(p);
  if (missing.length)
    throw new Error(
      `в новой версии ${version.split('/').pop()} нет ${missing.length} файлов из ${files.size} ` +
        `(или хеш другой): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''} — релиз не выпущен`,
    );
  return got.size;
}

/** Файлы в версию (populateFiles), загрузка недостающих хешей, FINALIZED, релиз */
export async function release({ version, files, getGz, message, site = SITE_ID, log = () => {} }) {
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

  const listed = await checkVersion(version, files);
  log(`сверка: все ${files.size} файлов на месте (в версии ${listed})`);
  await call('PATCH', `${version}?update_mask=status`, { status: 'FINALIZED' });
  const rel = await call('POST', `sites/${site}/releases?versionName=${encodeURIComponent(version)}`, {
    message: message ?? 'сервер сборки',
  });
  log(`выпущено: ${rel.name}`);
  return { version, release: rel.name, uploaded, populated: entries.length };
}
