#!/usr/bin/env node
/**
 * Запись об обновлении сборки. Запускается при деплое хостинга (predeploy в firebase.json) после сборки:
 * сравнивает локальный public/pack-manifest.json с опубликованным на сайте и, если сборка изменилась,
 * пишет в Firestore packUpdates/{id}: моды (добавлены/убраны/обновлены), предметы, рецепты,
 * новые типы рецептов и ченджлоги модов с Modrinth. Патчноут от модели сайт составит сам при открытии.
 *
 * Авторизация — от имени залогиненного firebase CLI. Повторный деплой той же сборки ничего не пишет.
 *   SKIP_PACK_RELEASE=1 firebase deploy   — пропустить (например, если Firestore недоступен)
 *   node scripts/pack-release.mjs --dry-run — показать разницу, ничего не записывая
 *   … --prev <файл>                         — сравнить с локальным снимком вместо опубликованного
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default;
const SITE = `https://${PROJECT}.web.app`;
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const dryRun = process.argv.includes('--dry-run');
const LIST_CAP = 3000;
const CHANGELOG_CAP = 3000;
const CHANGELOGS_TOTAL_CAP = 300_000;
const log = (...a) => console.log('[pack-release]', ...a);

if (process.env.SKIP_PACK_RELEASE) {
  log('пропущено (SKIP_PACK_RELEASE)');
  process.exit(0);
}

// ---------------------------------------------------------------- разница снимков

const cap = (list) => list.slice(0, LIST_CAP);

function diff(prev, next) {
  const prevMods = new Map(prev.mods.map((m) => [m.id, m]));
  const nextMods = new Map(next.mods.map((m) => [m.id, m]));
  const mods = { added: [], removed: [], updated: [] };
  for (const [id, m] of nextMods) {
    const p = prevMods.get(id);
    if (!p) mods.added.push(m);
    else if (p.sha1 !== m.sha1) mods.updated.push({ ...m, from: p.version, fromSha1: p.sha1 });
  }
  for (const [id, m] of prevMods) if (!nextMods.has(id)) mods.removed.push(m);

  const prevItems = new Set(prev.items);
  const nextItems = new Set(next.items);
  const itemsAdded = next.items.filter((i) => !prevItems.has(i));
  const itemsRemoved = prev.items.filter((i) => !nextItems.has(i));

  const recipesAdded = [];
  const recipesChanged = [];
  for (const [id, h] of Object.entries(next.recipes)) {
    const p = prev.recipes[id];
    if (p === undefined) recipesAdded.push(id);
    else if (p !== h) recipesChanged.push(id);
  }
  const recipesRemoved = Object.keys(prev.recipes).filter((id) => !(id in next.recipes));
  const prevTypes = new Set(prev.recipeTypes);

  return {
    mods,
    items: { added: cap(itemsAdded), removed: cap(itemsRemoved) },
    recipes: { added: cap(recipesAdded), removed: cap(recipesRemoved), changed: cap(recipesChanged) },
    totals: {
      itemsAdded: itemsAdded.length,
      itemsRemoved: itemsRemoved.length,
      recipesAdded: recipesAdded.length,
      recipesRemoved: recipesRemoved.length,
      recipesChanged: recipesChanged.length,
    },
    counts: {
      mods: [prev.mods.length, next.mods.length],
      items: [prev.items.length, next.items.length],
      recipes: [Object.keys(prev.recipes).length, Object.keys(next.recipes).length],
    },
    newRecipeTypes: next.recipeTypes.filter((t) => !prevTypes.has(t)),
  };
}

const isEmpty = (d) =>
  !d.mods.added.length &&
  !d.mods.removed.length &&
  !d.mods.updated.length &&
  !d.totals.itemsAdded &&
  !d.totals.itemsRemoved &&
  !d.totals.recipesAdded &&
  !d.totals.recipesRemoved &&
  !d.totals.recipesChanged;

// ---------------------------------------------------------------- Modrinth

const MODRINTH = 'https://api.modrinth.com/v2';
const UA = { 'User-Agent': `tfc-plans/1.0 (${SITE})` };

async function modrinthJson(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`Modrinth ${r.status} ${url}`);
  return r.json();
}

/**
 * Ченджлоги для добавленных и обновлённых модов. Для обновлённых — все версии между старой и новой
 * (по дате публикации), для добавленных — только текущая. Моды не с Modrinth пропускаются.
 */
async function changelogs(mods) {
  const want = [...mods.added, ...mods.updated];
  if (!want.length) return {};
  const hashes = [...new Set(want.flatMap((m) => [m.sha1, m.fromSha1].filter(Boolean)))];
  const byHash = await modrinthJson(`${MODRINTH}/version_files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes, algorithm: 'sha1' }),
  });
  const out = {};
  let total = 0;
  for (const m of want) {
    const cur = byHash[m.sha1];
    if (!cur) continue;
    let text = '';
    const old = m.fromSha1 ? byHash[m.fromSha1] : null;
    if (old && old.project_id === cur.project_id) {
      try {
        const versions = await modrinthJson(`${MODRINTH}/project/${cur.project_id}/version`);
        const from = Date.parse(old.date_published);
        const to = Date.parse(cur.date_published);
        text = versions
          .filter((v) => {
            const d = Date.parse(v.date_published);
            return d > from && d <= to && v.loaders?.some((l) => cur.loaders?.includes(l));
          })
          .sort((a, b) => Date.parse(b.date_published) - Date.parse(a.date_published))
          .map((v) => `### ${v.version_number}\n${(v.changelog ?? '').trim()}`)
          .join('\n\n');
      } catch (e) {
        log(`ченджлоги ${m.id}: ${e.message}`);
      }
    }
    if (!text) text = `### ${cur.version_number}\n${(cur.changelog ?? '').trim()}`;
    text = text.length > CHANGELOG_CAP ? `${text.slice(0, CHANGELOG_CAP)}\n…` : text;
    if (total + text.length > CHANGELOGS_TOTAL_CAP) break;
    total += text.length;
    out[m.id] = text;
  }
  return out;
}

// ---------------------------------------------------------------- Firestore REST

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
}

async function token() {
  const require = createRequire(import.meta.url);
  const fbRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  const auth = require(path.join(fbRoot, 'firebase-tools/lib/auth'));
  const acc = auth.getGlobalDefaultAccount();
  if (!acc) throw new Error('Нужно выполнить firebase login');
  const { access_token } = await auth.getAccessToken(acc.tokens.refresh_token, [
    'https://www.googleapis.com/auth/cloud-platform',
  ]);
  return access_token;
}

function deployer() {
  if (process.env.TFC_NICK) return process.env.TFC_NICK;
  try {
    return execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim() || 'deploy';
  } catch {
    return 'deploy';
  }
}

// ---------------------------------------------------------------- main

const strip = (m) => ({ id: m.id, name: m.name, version: m.version, ...(m.from ? { from: m.from } : {}) });

async function main() {
  const localFile = path.join(ROOT, 'public', 'pack-manifest.json');
  if (!fs.existsSync(localFile)) throw new Error('нет public/pack-manifest.json — сначала npm run items');
  const next = JSON.parse(fs.readFileSync(localFile, 'utf8'));

  let prev = null;
  const prevArg = process.argv.indexOf('--prev');
  if (prevArg > 0) prev = JSON.parse(fs.readFileSync(process.argv[prevArg + 1], 'utf8'));
  else {
    const res = await fetch(`${SITE}/pack-manifest.json`, { cache: 'no-store' });
    const type = res.headers.get('content-type') ?? '';
    // Пока снимка нет, хостинг отдаёт index.html (rewrite) — это «первый деплой»
    if (res.ok && type.includes('json')) prev = await res.json();
    else if (res.status !== 404 && !type.includes('html'))
      throw new Error(`не удалось скачать опубликованный снимок: ${res.status}`);
  }

  // id записи — отпечаток новой сборки: тот же набор jar не создаст вторую запись
  const id = createHash('sha1')
    .update(next.mods.map((m) => m.sha1).join(','))
    .digest('hex')
    .slice(0, 20);

  let record;
  if (!prev) {
    log('опубликованного снимка нет — запись «начало истории»');
    record = {
      baseline: true,
      mods: { added: next.mods.map(strip), removed: [], updated: [] },
      counts: {
        mods: [0, next.mods.length],
        items: [0, next.items.length],
        recipes: [0, Object.keys(next.recipes).length],
      },
    };
  } else {
    const d = diff(prev, next);
    if (isEmpty(d)) {
      log('сборка не изменилась');
      return;
    }
    log(
      `моды +${d.mods.added.length} −${d.mods.removed.length} ~${d.mods.updated.length}; ` +
        `предметы +${d.totals.itemsAdded} −${d.totals.itemsRemoved}; ` +
        `рецепты +${d.totals.recipesAdded} −${d.totals.recipesRemoved} ~${d.totals.recipesChanged}`,
    );
    let logs = {};
    try {
      logs = await changelogs(d.mods);
      log(`ченджлоги с Modrinth: ${Object.keys(logs).length}`);
    } catch (e) {
      log(`ченджлоги недоступны: ${e.message}`);
    }
    record = {
      baseline: false,
      ...d,
      mods: { added: d.mods.added.map(strip), removed: d.mods.removed.map(strip), updated: d.mods.updated.map(strip) },
      changelogs: logs,
    };
  }
  record = { ...record, createdAt: Date.now(), deployedBy: deployer() };

  if (dryRun) {
    log('--dry-run, ничего не записываю');
    console.log(JSON.stringify(record, null, 2).slice(0, 4000));
    return;
  }

  const headers = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
  const body = { fields: toValue(record).mapValue.fields };
  if (JSON.stringify(body).length > 1_000_000) throw new Error('запись больше 1 МБ — урежьте LIST_CAP');
  // Создать, только если такой записи ещё нет (повторный деплой той же сборки)
  const r = await fetch(`${DOCS}/packUpdates?documentId=${id}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (r.status === 409) log(`запись ${id} уже есть`);
  else if (!r.ok) throw new Error(`Firestore ${r.status}: ${(await r.text()).slice(0, 300)}`);
  else log(`записано обновление ${id}`);
}

main().catch((e) => {
  console.error('[pack-release]', e.message ?? e);
  console.error('[pack-release] деплой остановлен, чтобы обновление не потерялось. Пропустить: SKIP_PACK_RELEASE=1');
  process.exit(1);
});
