#!/usr/bin/env node
/**
 * Сборка с сервера сборки (server/pack-server) в проект — чтобы собирать и проверять на любой машине и в worktree,
 * без ПК с Minecraft. Одинаковые файлы не качаются (сверка sha256).
 *
 *   npm run pack:fetch                 — текущий снимок → instance/pack/ (папка версии как есть), jar → mods/
 *   npm run pack:fetch -- --kubejs     — ещё и kubejs/ снимка → слой KubeJS pack (instance/kubejs/pack/)
 *   npm run pack:fetch -- --data       — ещё и собранные сервером данные модов → public/ (без npm run mods)
 *   npm run pack:fetch -- --data-only  — только данные
 *
 * Адрес и ключ — TFC_PACK_URL и TFC_PACK_TOKEN (ключ игрока подходит) в окружении или в .env.local.
 * В mods/ удаляются только jar, которые сама команда клала раньше и которых нет в снимке; чужие — только список.
 *
 * Из кода: fetchData({ outDir }) — данные модов (это зовёт ensure-mods.mjs при сборке сайта без jar),
 * fetchPack({ into, modsDir, kubejs }).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './firestore-rest.mjs';

const log = (...a) => console.log('[pack:fetch]', ...a);

/** Что в public/ собирает npm run mods — только это берём из данных сервера (как MODS_OUTPUTS в ensure-mods) */
export const MODS_OUTPUTS = [
  'items.json',
  'icons',
  'recipes.json',
  'reference.json',
  'pack-manifest.json',
  'geo.json',
  'geo',
  'tags.json',
  'botany.json',
  'config-defaults.json',
  'meals.json',
  'power.json',
  'multiblocks.json',
  'multiblocks',
];

/** TFC_PACK_URL / TFC_PACK_TOKEN: окружение, потом .env.local проекта (в worktree — и основной копии) */
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
  if (!env.TFC_PACK_URL || !env.TFC_PACK_TOKEN) return null;
  return { url: env.TFC_PACK_URL.replace(/\/+$/, ''), token: env.TFC_PACK_TOKEN };
}
const pickEnv = () =>
  Object.fromEntries(['TFC_PACK_URL', 'TFC_PACK_TOKEN'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));

async function api(srv, p, { raw = false } = {}) {
  const r = await fetch(`${srv.url}${p}`, { headers: { Authorization: `Bearer ${srv.token}` } });
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

/** Кладёт файлы [{ path, sha256, size }] в dir; качает только те, что отличаются. url(f) — откуда качать */
async function sync(srv, dir, files, url) {
  const want = [];
  for (const f of files) {
    const local = path.join(dir, ...f.path.split('/'));
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
  const queue = [...want];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const buf = await api(srv, url(f), { raw: true });
      if (sha256(buf) !== f.sha256) throw new Error(`${f.path}: контрольная сумма не сошлась`);
      const local = path.join(dir, ...f.path.split('/'));
      fs.mkdirSync(path.dirname(local), { recursive: true });
      // Через временный файл: файл мог быть жёсткой ссылкой (mods/ ↔ instance/pack/mods/) — не пишем в чужой
      const tmp = `${local}.tfc-tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, local);
      bytes += buf.length;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { total: files.length, fetched: want.length, bytes };
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

/** Данные модов, собранные сервером для текущего снимка → outDir (public/) */
export async function fetchData({ outDir = path.join(ROOT, 'public'), srv = packServer() } = {}) {
  if (!srv) throw new Error('нет TFC_PACK_URL / TFC_PACK_TOKEN (окружение или .env.local)');
  const idx = await api(srv, '/data');
  const files = idx.files.filter((f) => MODS_OUTPUTS.includes(f.path.split('/')[0]));
  if (!files.some((f) => f.path === 'items.json')) throw new Error(`в данных снимка ${idx.snapshot} нет данных модов`);
  const r = await sync(
    srv,
    outDir,
    files,
    (f) => `/data/${idx.snapshot}/${f.path.split('/').map(encodeURIComponent).join('/')}`,
  );
  const roots = [...new Set(files.map((f) => f.path.split('/')[0]))];
  const removed = prune(outDir, roots, new Set(files.map((f) => f.path)));
  log(
    `данные модов снимка ${idx.snapshot} (собраны ${idx.build.builtAt}, код ${idx.build.commit ?? '?'}): ` +
      `файлов ${r.total}, скачано ${r.fetched} (${mb(r.bytes)}), убрано лишних ${removed}`,
  );
  return { snapshot: idx.snapshot, ...r, removed };
}

/** Текущий снимок → into/ (папка версии), jar — ещё и в modsDir; kubejs — слой pack */
export async function fetchPack({
  into = path.join(ROOT, 'instance', 'pack'),
  modsDir = path.join(ROOT, 'mods'),
  kubejs = false,
  srv = packServer(),
} = {}) {
  if (!srv) throw new Error('нет TFC_PACK_URL / TFC_PACK_TOKEN (окружение или .env.local)');
  const snap = await api(srv, '/pack/current');
  log(
    `снимок ${snap.id} от ${snap.createdAt} (${snap.author}${snap.note ? `: ${snap.note}` : ''}), файлов ${snap.files.length}`,
  );
  const r = await sync(srv, into, snap.files, (f) => `/blobs/${f.sha256}`);
  const removed = prune(
    into,
    [...new Set(snap.files.map((f) => f.path.split('/')[0]))],
    new Set(snap.files.map((f) => f.path)),
  );
  log(
    `→ ${into.startsWith(ROOT + path.sep) ? path.relative(ROOT, into) : into}: скачано ${r.fetched} (${mb(r.bytes)}), убрано лишних ${removed}`,
  );

  // mods/: жёсткие ссылки на скачанное (место не удваивается); убираем только свои прошлые
  const stateFile = path.join(into, '.tfc-fetch.json');
  let state = { mods: [] };
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    /* первый раз */
  }
  const jars = snap.files.filter((f) => f.kind === 'mod').map((f) => path.basename(f.path));
  fs.mkdirSync(modsDir, { recursive: true });
  let placed = 0;
  for (const j of jars) {
    const src = path.join(into, 'mods', j);
    const dst = path.join(modsDir, j);
    try {
      const a = fs.statSync(src);
      const b = fs.statSync(dst);
      if (a.ino === b.ino || (a.size === b.size && sha256(fs.readFileSync(src)) === sha256(fs.readFileSync(dst))))
        continue;
    } catch {
      /* нет в mods/ */
    }
    fs.rmSync(dst, { force: true });
    try {
      fs.linkSync(src, dst);
    } catch {
      fs.copyFileSync(src, dst);
    }
    placed++;
  }
  const now = new Set(jars);
  let dropped = 0;
  for (const j of state.mods ?? [])
    if (!now.has(j) && fs.existsSync(path.join(modsDir, j))) {
      fs.rmSync(path.join(modsDir, j));
      dropped++;
    }
  const foreign = fs
    .readdirSync(modsDir)
    .filter((f) => f.endsWith('.jar') && !now.has(f) && !(state.mods ?? []).includes(f));
  fs.writeFileSync(stateFile, JSON.stringify({ snapshot: snap.id, mods: jars }, null, 1));
  log(`mods/: jar ${jars.length}, обновлено ${placed}, убрано своих прошлых ${dropped}`);
  if (foreign.length)
    log(
      `в mods/ есть jar не из снимка (не трогаю): ${foreign.slice(0, 10).join(', ')}${foreign.length > 10 ? '…' : ''}`,
    );

  if (kubejs) {
    const dir = path.join(into, 'kubejs');
    if (!fs.existsSync(dir)) log('в снимке нет kubejs/ — слой не обновляю');
    else {
      const { importKubejsLayer } = await import('./kubejs.mjs');
      importKubejsLayer(dir, 'pack');
    }
  }
  return { snapshot: snap.id, ...r, removed, jars: jars.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const flag = (f) => argv.includes(f);
  (async () => {
    if (!flag('--data-only')) await fetchPack({ kubejs: flag('--kubejs') });
    if (flag('--data') || flag('--data-only')) await fetchData();
    if (!flag('--data-only'))
      log(
        'дальше — как с локальными jar: npm run mods / npm run kubejs / npm run dev (или npm run pack -- instance/pack)',
      );
  })().catch((e) => {
    console.error('[pack:fetch]', e.message ?? e);
    process.exit(1);
  });
}
