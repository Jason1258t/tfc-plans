#!/usr/bin/env node
/**
 * Сборка с сервера сборки (server/pack-server) в проект — чтобы собирать и проверять на любой машине и в worktree,
 * без ПК с Minecraft. Одинаковые файлы не качаются (сверка sha256).
 *
 *   npm run pack:fetch                 — текущий снимок → кеш вне репозитория (~/.cache/tfc-plans/pack или
 *                                        TFC_PACK_CACHE, папка версии как есть: jar в mods/) — для MCP, npm run mods, аддонов
 *   npm run pack:fetch -- --kubejs     — ещё и kubejs/ снимка → слой KubeJS pack (instance/kubejs/pack/)
 *   npm run pack:fetch -- --data       — ещё и собранные сервером данные модов → public/ (без npm run mods)
 *   npm run pack:fetch -- --data-only  — только данные
 *
 * Адрес и ключ — TFC_PACK_URL и TFC_PACK_TOKEN (ключ игрока подходит) в окружении или в .env.local, иначе — из
 * настроек программы tfc: macOS и Linux ~/.config/tfc/config.json, Windows %APPDATA%\tfc\config.json
 * (configDir() в cli/lib/config.mjs); появляются после входа в tfc.
 * Кеш — точная копия снимка: файлы, которых в снимке нет, удаляются. Jar, уже лежащие в старой папке mods/
 * репозитория (основной копии), не качаются, а копируются оттуда (жёсткой ссылкой, если можно).
 *
 * Из кода: fetchData({ outDir }) — данные модов (это зовёт ensure-mods.mjs перед npm run dev),
 * fetchPack({ into, kubejs }).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@tfc/cli/config';
import { ROOT } from './firestore-rest.mjs';
import { MODS_OUTPUTS } from './data-roots.mjs';
import { PACK_CACHE, mainCheckoutRoot } from './pack-cache.mjs';

const log = (...a) => console.log('[pack:fetch]', ...a);

/** TFC_PACK_URL / TFC_PACK_TOKEN: окружение, потом .env.local проекта, потом настройки программы tfc */
export function packServer() {
  const read = (file) => {
    try {
      return Object.fromEntries(
        fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .map((l) => /^\s*(TFC_PACK_URL|TFC_PACK_TOKEN)\s*=\s*(.*?)\s*$/.exec(l))
          .filter(Boolean)
          .map((m) => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]),
      );
    } catch {
      return {};
    }
  };
  const env = { ...read(path.join(ROOT, '.env.local')), ...pickEnv() };
  if (!env.TFC_PACK_URL || !env.TFC_PACK_TOKEN) {
    const cfg = loadConfig();
    if (!cfg.token) return null;
    return { url: cfg.server.replace(/\/+$/, ''), token: cfg.token };
  }
  return { url: env.TFC_PACK_URL.replace(/\/+$/, ''), token: env.TFC_PACK_TOKEN };
}
const pickEnv = () =>
  Object.fromEntries(['TFC_PACK_URL', 'TFC_PACK_TOKEN'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));

/**
 * Запрос к серверу сборки. signal обязателен для вызывающих с таймаутом: без него fetch висит на мёртвой сети
 * (и, например, npm run dev из ворктри не стартует — см. ensure-mods.mjs).
 */
async function api(srv, p, { raw = false, signal } = {}) {
  const r = await fetch(`${srv.url}${p}`, { headers: { Authorization: `Bearer ${srv.token}` }, signal });
  if (!r.ok) {
    const t = await r.text();
    let msg = t;
    try {
      msg = JSON.parse(t).error ?? t;
    } catch {
      /* не JSON */
    }
    throw new Error(`сервер сборки ${p}: ${r.status} ${msg.slice(0, 200)}`);
  }
  return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Тот же файл (размер и sha256) в одной из папок seeds — по имени файла */
function seedFile(seeds, f) {
  for (const d of seeds) {
    const p = path.join(d, path.basename(f.path));
    try {
      if (fs.statSync(p).size === f.size && sha256(fs.readFileSync(p)) === f.sha256) return p;
    } catch {
      /* нет */
    }
  }
  return null;
}

/**
 * Кладёт файлы [{ path, sha256, size }] в dir; качает только те, что отличаются. url(f) — откуда качать;
 * seeds — папки, где такой файл уже может лежать (берётся оттуда без скачивания).
 * options.compare — папка, с которой сверяются уже лежащие файлы (по умолчанию dir; fetchData пишет в промежуточную
 * папку и сверяется с итоговой); options.signal — отмена загрузки (таймаут вызывающего).
 */
async function sync(srv, dir, files, url, seeds = [], { signal, compare = dir } = {}) {
  const want = [];
  for (const f of files) {
    const local = path.join(compare, ...f.path.split('/'));
    let same = false;
    try {
      const st = fs.statSync(local);
      same = st.size === f.size && sha256(fs.readFileSync(local)) === f.sha256;
    } catch {
      /* файла нет */
    }
    if (!same) want.push(f);
  }
  let bytes = 0;
  let seeded = 0;
  const written = [];
  const queue = [...want];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      if (signal?.aborted) return; // не начинать новые загрузки после отмены
      const local = path.join(dir, ...f.path.split('/'));
      fs.mkdirSync(path.dirname(local), { recursive: true });
      const seed = seeds.length ? seedFile(seeds, f) : null;
      if (seed) {
        fs.rmSync(local, { force: true });
        try {
          fs.linkSync(seed, local);
        } catch {
          fs.copyFileSync(seed, local);
        }
        seeded++;
        written.push(f.path);
        continue;
      }
      const buf = await api(srv, url(f), { raw: true, signal });
      if (sha256(buf) !== f.sha256) throw new Error(`${f.path}: контрольная сумма не сошлась`);
      // Через временный файл: файл мог быть жёсткой ссылкой (на старую mods/ репозитория) — не пишем в чужой
      const tmp = `${local}.tfc-tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, local);
      bytes += buf.length;
      written.push(f.path);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  signal?.throwIfAborted();
  return { total: files.length, fetched: want.length - seeded, seeded, bytes, written };
}

/** Файлы под корнями, которых нет в списке, — убрать (данные модов на сервере их уже не содержат) */
function prune(dir, roots, keep) {
  let removed = 0;
  const walk = (rel) => {
    const full = path.join(dir, rel);
    if (!fs.existsSync(full)) return;
    if (fs.statSync(full).isDirectory()) {
      for (const n of fs.readdirSync(full)) walk(`${rel}/${n}`);
    } else if (!keep.has(rel)) {
      fs.rmSync(full);
      removed++;
    }
  };
  for (const r of roots) walk(r);
  return removed;
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} МБ`;

/**
 * Данные модов, собранные сервером для текущего снимка → outDir (public/).
 * Качаем во временную папку рядом и переносим на место только когда всё скачалось: таймаут или ошибка сети
 * (signal) оставляют прежние данные как есть, а не половину нового снимка.
 */
export async function fetchData({ outDir = path.join(ROOT, 'public'), srv = packServer(), signal } = {}) {
  if (!srv) throw new Error('нет TFC_PACK_URL / TFC_PACK_TOKEN (окружение или .env.local) и входа в программу tfc');
  const idx = await api(srv, '/data', { signal });
  // Только то, что собирает npm run mods (scripts/data-roots.mjs)
  const files = idx.files.filter((f) => MODS_OUTPUTS.includes(f.path.split('/')[0]));
  if (!files.some((f) => f.path === 'items.json')) throw new Error(`в данных снимка ${idx.snapshot} нет данных модов`);
  const stage = path.join(outDir, '.tfc-data-new');
  fs.rmSync(stage, { recursive: true, force: true });
  let r;
  try {
    r = await sync(
      srv,
      stage,
      files,
      (f) => `/data/${idx.snapshot}/${f.path.split('/').map(encodeURIComponent).join('/')}`,
      [],
      { signal, compare: outDir },
    );
    // Одинаковые файлы не качались и в промежуточной папке их нет — их не трогаем вовсе
    for (const rel of r.written) {
      const dst = path.join(outDir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(path.join(stage, ...rel.split('/')), dst);
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  const roots = [...new Set(files.map((f) => f.path.split('/')[0]))];
  const removed = prune(outDir, roots, new Set(files.map((f) => f.path)));
  log(
    `данные модов снимка ${idx.snapshot} (собраны ${idx.build.builtAt}, код ${idx.build.commit ?? '?'}): ` +
      `файлов ${r.total}, скачано ${r.fetched} (${mb(r.bytes)}), убрано лишних ${removed}`,
  );
  return { snapshot: idx.snapshot, ...r, removed };
}

/** Текущий снимок → into/ (папка версии: jar в into/mods); kubejs — ещё и слой KubeJS pack */
export async function fetchPack({ into = PACK_CACHE, kubejs = false, srv = packServer() } = {}) {
  if (!srv) throw new Error('нет TFC_PACK_URL / TFC_PACK_TOKEN (окружение или .env.local) и входа в программу tfc');
  const snap = await api(srv, '/pack/current');
  log(
    `снимок ${snap.id} от ${snap.createdAt} (${snap.author}${snap.note ? `: ${snap.note}` : ''}), файлов ${snap.files.length}`,
  );
  // Старая папка mods/ репозитория (до переезда jar в кеш): одинаковые jar не качаем заново
  const seeds = [ROOT, mainCheckoutRoot()]
    .filter(Boolean)
    .map((r) => path.join(r, 'mods'))
    .filter((d) => fs.existsSync(d));
  const r = await sync(srv, into, snap.files, (f) => `/blobs/${f.sha256}`, seeds);
  const removed = prune(
    into,
    [...new Set(snap.files.map((f) => f.path.split('/')[0]))],
    new Set(snap.files.map((f) => f.path)),
  );
  const jars = snap.files.filter((f) => f.kind === 'mod').length;
  log(
    `→ ${into}: jar ${jars}, скачано ${r.fetched} (${mb(r.bytes)})${r.seeded ? `, взято из старой mods/ ${r.seeded}` : ''}, ` +
      `убрано лишних ${removed}`,
  );
  fs.writeFileSync(
    path.join(into, '.tfc-fetch.json'),
    JSON.stringify({ snapshot: snap.id, mc: snap.mc, loader: snap.loader, at: new Date().toISOString() }),
  );

  if (kubejs) {
    const dir = path.join(into, 'kubejs');
    if (!fs.existsSync(dir)) log('в снимке нет kubejs/ — слой не обновляю');
    else {
      const { importKubejsLayer } = await import('./kubejs.mjs');
      importKubejsLayer(dir, 'pack');
    }
  }
  return { snapshot: snap.id, ...r, removed, jars };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const flag = (f) => argv.includes(f);
  (async () => {
    if (!flag('--data-only')) await fetchPack({ kubejs: flag('--kubejs') });
    if (flag('--data') || flag('--data-only')) await fetchData();
    if (!flag('--data-only'))
      log(`jar сборки — в ${path.join(PACK_CACHE, 'mods')}: их читают MCP, npm run mods и аддоны (tools/*/libs.sh)`);
  })().catch((e) => {
    console.error('[pack:fetch]', e.message ?? e);
    process.exit(1);
  });
}
