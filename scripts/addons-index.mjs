#!/usr/bin/env node
/**
 * Аддоны на сайт: карточки tools/<мод>/addon.json → текущий jar и иконки (tools/<мод>/icons/) в public/addons/ +
 * список для программы tfc без ключа (`tfc pull addons`, sha256 и размер jar) → public/addons/index.json.
 * Запускается перед dev/build. На сайте без ключа — только текущие версии: прочие jar из public/addons убираются.
 * Все версии — на сервере сборки (Firestore addonVersions + блобы, packages/core/src/addonVersions.ts).
 *
 * jar в git не хранятся. Откуда берётся текущий (sha256 — из карточки): tools/<мод>/<jar> (только что собран),
 * кеш .cache/addons/<sha256>.jar, сервер сборки (/blobs/<sha256>, TFC_PACK_URL и TFC_PACK_TOKEN — как у
 * pack:fetch), иначе — сайт (/addons/<jar>, он там уже лежит); хеш сверяется. Нет jar — аддон в список не попадает
 * (предупреждение), сборка сайта не останавливается. Так же не попадают повтор id, имя jar, которое tfc не примет,
 * и unlisted (jar на сайте есть, но всем его не ставить).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = path.join(ROOT, 'public/addons');
const SITE = 'https://tfc-plans-fd2c.web.app';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** Карточки аддонов из tools/<мод>/addon.json; source — папка от корня репозитория, dir — полный путь */
export function addonCards(root = ROOT) {
  const tools = path.join(root, 'tools');
  return fs
    .readdirSync(tools, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(tools, d.name, 'addon.json')))
    .map((d) => {
      const dir = path.join(tools, d.name);
      const card = JSON.parse(fs.readFileSync(path.join(dir, 'addon.json'), 'utf8'));
      return { ...card, source: `tools/${d.name}`, dir };
    })
    .sort((a, b) => a.order - b.order);
}

/**
 * Текущий jar аддона (см. шапку): Buffer или null; note — откуда взят или почему нет.
 * cacheDir — кеш скачанных, srv — сервер сборки ({ url, token }) или null.
 */
export async function addonJar(a, { cacheDir, srv }) {
  const local = path.join(a.dir, a.jar);
  if (fs.existsSync(local)) {
    const b = fs.readFileSync(local);
    const note = a.sha256 && sha256(b) !== a.sha256 ? `${a.source}/${a.jar} не совпадает с sha256 карточки` : null;
    return { bytes: b, note };
  }
  if (!a.sha256) return { bytes: null, note: `нет ${a.source}/${a.jar} и sha256 в карточке` };
  const cached = path.join(cacheDir, `${a.sha256}.jar`);
  if (fs.existsSync(cached)) {
    const b = fs.readFileSync(cached);
    if (sha256(b) === a.sha256) return { bytes: b, note: null };
  }
  const tries = [
    ...(srv ? [{ url: `${srv.url}/blobs/${a.sha256}`, headers: { Authorization: `Bearer ${srv.token}` } }] : []),
    { url: `${SITE}/addons/${a.jar}`, headers: {} },
  ];
  const fails = [];
  for (const t of tries) {
    try {
      const r = await fetch(t.url, { headers: t.headers, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(String(r.status));
      const b = Buffer.from(await r.arrayBuffer());
      if (sha256(b) !== a.sha256) throw new Error('хеш не сошёлся');
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cached, b);
      return { bytes: b, note: null };
    } catch (e) {
      fails.push(`${new URL(t.url).host}: ${e.message}`);
    }
  }
  return { bytes: null, note: `${a.jar}: не скачался (${fails.join('; ')})` };
}

export async function addonsIndex(
  root = ROOT,
  dir = DIR,
  { cacheDir = path.join(root, '.cache', 'addons'), srv = null } = {},
) {
  const addons = [];
  const missing = [];
  const warnings = [];
  const ids = new Set();
  const current = new Set();
  for (const a of addonCards(root)) {
    // Те же требования, что у tfc (cli/lib/pull.mjs wantedAddons): иначе программа аддон молча пропустит
    if (!/^[\w.+-]+\.jar$/.test(a.jar ?? '')) {
      warnings.push(`${a.source}: jar «${a.jar}» — имя без пробелов и папок, на .jar`);
      continue;
    }
    if (ids.has(a.id)) {
      warnings.push(`${a.source}: id ${a.id} уже есть у другого аддона — пропущен`);
      continue;
    }
    ids.add(a.id);
    if (!a.jar.includes(a.version)) warnings.push(`${a.source}: в имени ${a.jar} нет версии ${a.version}`);
    const icons = path.join(a.dir, 'icons');
    if (fs.existsSync(icons)) fs.cpSync(icons, path.join(dir, 'icons', a.id), { recursive: true });
    const { bytes, note } = await addonJar(a, { cacheDir, srv });
    if (note) warnings.push(note);
    if (!bytes) {
      missing.push(`${a.source}/${a.jar}`);
      continue;
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, a.jar), bytes);
    current.add(a.jar);
    if (a.unlisted) continue;
    addons.push({
      id: a.id,
      name: a.name,
      version: a.version,
      file: a.jar,
      url: `/addons/${a.jar}`,
      size: bytes.length,
      sha256: sha256(bytes),
      side: a.side,
      hostOnly: a.hostOnly === true,
      needs: a.needs,
      replaces: a.replaces ?? [],
    });
  }
  // Без ключа с сайта — только текущие версии; прежние — на сервере сборки (tfc pull addons <мод>@<версия>)
  if (fs.existsSync(dir))
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.jar') && !current.has(f)) fs.rmSync(path.join(dir, f));
  return { addons, missing, warnings };
}

/**
 * Аддоны — submodule tools/ (репозиторий tfc-addons). В свежем ворктри он пуст: подтянуть, а если не вышло —
 * остановиться: пустой список карточек убрал бы аддоны с сайта при выкладке.
 */
function ensureAddons(root) {
  const tools = path.join(root, 'tools');
  const has = () =>
    fs.existsSync(tools) && fs.readdirSync(tools).some((d) => fs.existsSync(path.join(tools, d, 'addon.json')));
  if (has() || !fs.existsSync(path.join(root, '.gitmodules'))) return;
  console.log('[addons] tools/ пуст — git submodule update --init tools');
  try {
    execFileSync('git', ['submodule', 'update', '--init', 'tools'], { cwd: root, stdio: 'inherit' });
  } catch {
    // ниже — понятная ошибка
  }
  if (!has()) {
    console.error('[addons] нет карточек аддонов в tools/ (submodule tfc-addons): git submodule update --init tools');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureAddons(ROOT);
  const { packServer } = await import('./pack-fetch.mjs');
  const { addons, missing, warnings } = await addonsIndex(ROOT, DIR, { srv: packServer() });
  for (const w of warnings) console.warn(`[addons] ${w}`);
  if (missing.length) console.warn(`[addons] нет jar: ${missing.join(', ')} — в index.json их не будет`);
  if (fs.existsSync(DIR) || addons.length) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'index.json'), `${JSON.stringify({ addons }, null, 1)}\n`);
    console.log(
      `[addons] public/addons/index.json: ${addons.map((a) => `${a.id} ${a.version}`).join(', ') || 'пусто'}`,
    );
  }
}
