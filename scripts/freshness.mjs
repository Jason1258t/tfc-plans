#!/usr/bin/env node
/**
 * Свежесть сборки → public/pack-freshness.json: для каждого мода из pack-manifest.json — новейшая версия под
 * 1.21.1 NeoForge с Modrinth (по sha1), CurseForge (по отпечатку jar) или из релизов GitHub разработчиков сборки (по
 * имени jar) и цвет отставания. Расчёт —
 * src/lib/freshness.ts (тот же у сайта и MCP), план — docs/plans/mod-freshness.md.
 *
 *   npm run freshness                      — собрать отчёт и показать сводку
 *   … -- --if-older 6h --soft              — так зовёт prebuild: свежий отчёт не трогает, ошибки не роняют сборку
 *   … -- --manifest <файл> --out <файл>    — другой снимок / куда писать
 * Ключ CurseForge — CURSE_FORGE_API_KEY в окружении или .env.local (в worktree — и основной копии). Без ключа
 * CurseForge пропускается. GITHUB_TOKEN там же или вход gh CLI — необязателен (без него у GitHub 60 запросов в час
 * с адреса, гиту нужно ~10).
 * Отпечатков нет в старом снимке — считаются по jar сборки (npm run pack:fetch), если они есть.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, cfFingerprint, STATUS_LABEL, STATUS_ORDER } from '../src/lib/freshness.ts';
import { addonCards } from './addons-index.mjs';
import { PACK_MODS, mainCheckoutRoot } from './pack-cache.mjs';
import { SITE } from './firestore-rest.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const log = (...a) => console.log('[freshness]', ...a);

/** Корни, где искать .env.local и public/: эта копия, потом основная (в worktree) */
const roots = (root = ROOT) => [root, mainCheckoutRoot()].filter(Boolean);

/** Переменная name: окружение, потом .env.local */
function envKey(name, root = ROOT) {
  if (process.env[name]) return process.env[name];
  for (const r of roots(root)) {
    try {
      const m = new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`, 'm').exec(
        fs.readFileSync(path.join(r, '.env.local'), 'utf8'),
      );
      const key = m?.[1].replace(/^(['"])(.*)\1$/, '$2');
      if (key) return key;
    } catch {
      /* нет файла */
    }
  }
  return null;
}

/** CURSE_FORGE_API_KEY: окружение, потом .env.local */
export const curseforgeKey = (root = ROOT) => envKey('CURSE_FORGE_API_KEY', root);
/** GITHUB_TOKEN: окружение, .env.local, потом вход gh CLI, если он есть; без токена — 60 запросов в час */
let ghToken;
function githubToken(root = ROOT) {
  if (ghToken === undefined) {
    ghToken = envKey('GITHUB_TOKEN', root);
    if (!ghToken)
      try {
        ghToken =
          execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000, stdio: 'pipe' }).trim() || null;
      } catch {
        ghToken = null;
      }
  }
  return ghToken;
}

const firstExisting = (rel, root) =>
  roots(root)
    .map((r) => path.join(r, rel))
    .find((f) => fs.existsSync(f)) ?? null;

/** Отпечатки CurseForge для модов снимка без поля cf — по jar из первой папки модов, где он есть */
function fillFingerprints(mods, modsDirs) {
  let n = 0;
  for (const m of mods) {
    if (m.cf !== undefined) continue;
    const jar = modsDirs.map((d) => path.join(d, m.jar)).find((f) => fs.existsSync(f));
    if (!jar) continue;
    m.cf = cfFingerprint(fs.readFileSync(jar));
    n++;
  }
  return n;
}

/**
 * Отчёт по снимку сборки. manifest — объект pack-manifest.json; modsDirs — где взять jar для недостающих отпечатков;
 * ownIds — id наших аддонов. Возвращает FreshReport (src/lib/freshness.ts).
 */
export async function freshnessReport({ manifest, modsDirs = [PACK_MODS], key = curseforgeKey(), ownIds } = {}) {
  const mods = manifest.mods.map((m) => ({ ...m }));
  fillFingerprints(mods, modsDirs);
  let own = ownIds;
  if (!own) {
    try {
      own = addonCards().map((a) => a.id);
    } catch {
      own = [];
    }
  }
  return buildReport(mods, {
    curseforgeKey: key ?? undefined,
    githubToken: githubToken() ?? undefined,
    ownIds: own,
    userAgent: `tfc-plans/1.0 (${SITE})`,
    manifestBuiltAt: manifest.builtAt,
  });
}

const UA = { 'User-Agent': `tfc-plans/1.0 (${SITE})` };
const stripHtml = (html) =>
  html
    .replace(/<br\s*\/?>|<\/(?:p|li|h\d|div|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
/** Ченджлог Modrinth бывает сырым HTML (Serilum) — тогда в текст, как у CurseForge */
const toText = (s) => (/<\/?(?:p|br|li|ul|ol|h\d|div|span|a|b|strong|em)\b[^>]*>/i.test(s) ? stripHtml(s) : s.trim());

/** Обёртка над API CurseForge: get('/mods/…') → data */
function cfApi(key) {
  const H = { 'x-api-key': key, Accept: 'application/json' };
  return async (p) => {
    const r = await fetch(`https://api.curseforge.com/v1${p}`, { headers: H });
    if (!r.ok) throw new Error(`CurseForge ${r.status}`);
    return (await r.json()).data;
  };
}

const ghHeaders = () => {
  const token = githubToken();
  return { ...UA, Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

const CF_TYPE = { 1: 'release', 2: 'beta', 3: 'alpha' };

/**
 * Версии новее нашей, до новейшего релиза (beta — до новейшей версии вообще, с бетами), старые сверху.
 * Бета, которая сама и есть «новейший релиз» (релизов нет), остаётся. mod — запись отчёта (FreshMod).
 * Возвращает [{ version, type, date, text: () => Promise<string> }] — текст достаётся лениво (у CurseForge это запрос
 * на версию), чтобы листать страницами; null — источник не даёт ченджлогов.
 */
export async function modChangelog(mod, { beta = false, key = curseforgeKey() } = {}) {
  const target = beta ? (mod.beta ?? mod.latest) : mod.latest;
  if (!mod.current || !target || mod.status === 'ok') return null;
  const from = Date.parse(mod.current.date ?? 0);
  const to = Date.parse(target.date ?? 0);
  const keep = (type, id) => beta || type === 'release' || id === target.id;
  let list = [];
  if (mod.source === 'modrinth') {
    const q = `game_versions=${encodeURIComponent(JSON.stringify(['1.21.1']))}`;
    const r = await fetch(`https://api.modrinth.com/v2/project/${mod.project.id}/version?${q}`, { headers: UA });
    if (!r.ok) throw new Error(`Modrinth ${r.status}`);
    list = (await r.json())
      // Одна версия выходит отдельными файлами под каждый загрузчик — ченджлог берём один раз
      .filter((v, i, all) => {
        const d = Date.parse(v.date_published);
        return (
          d > from &&
          d <= to &&
          keep(v.version_type, v.id) &&
          all.findIndex((x) => x.version_number === v.version_number) === i
        );
      })
      .map((v) => ({
        version: v.version_number,
        type: v.version_type,
        date: v.date_published,
        text: async () => toText(v.changelog ?? ''),
      }));
  } else if (mod.source === 'curseforge') {
    if (!key) return null;
    const get = cfApi(key);
    const cur = Number(mod.current.id);
    const files = [];
    // Файлы идут новыми вперёд; листаем, пока не дойдём до нашего (не больше 10 страниц по 50)
    for (let index = 0; index < 500; index += 50) {
      const pg = await get(
        `/mods/${mod.project.id}/files?gameVersion=1.21.1&modLoaderType=6&pageSize=50&index=${index}`,
      );
      files.push(...pg);
      if (pg.length < 50 || pg.some((f) => f.id <= cur)) break;
    }
    list = files
      .filter((f) => f.id > cur && f.id <= Number(target.id) && keep(CF_TYPE[f.releaseType], String(f.id)))
      .filter((f, i, all) => all.findIndex((x) => x.id === f.id) === i)
      .map((f) => ({
        version: f.fileName,
        type: CF_TYPE[f.releaseType] ?? 'release',
        date: f.fileDate,
        text: async () => stripHtml(await get(`/mods/${mod.project.id}/files/${f.id}/changelog`)),
      }));
  } else if (mod.source === 'git') {
    const r = await fetch(`https://api.github.com/repos/${mod.project.id}/releases?per_page=100`, {
      headers: ghHeaders(),
    });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    list = (await r.json())
      .filter((x) => {
        const d = Date.parse(x.published_at ?? 0);
        return !x.draft && d > from && d <= to && keep(x.prerelease ? 'beta' : 'release', x.tag_name);
      })
      .map((x) => ({
        version: x.tag_name,
        type: x.prerelease ? 'beta' : 'release',
        date: x.published_at,
        text: async () => (x.body ?? '').trim(),
      }));
  } else return null;
  return list.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/**
 * Ссылка на jar версии v (обычно mod.latest) с её площадки: Modrinth — основной файл версии, CurseForge — downloadUrl
 * (если автор закрыл сторонние загрузки — прямой путь CDN), GitHub — файл релиза с тем же именем.
 */
export async function versionJarUrl(mod, v, key = curseforgeKey()) {
  if (mod.source === 'modrinth') {
    const r = await fetch(`https://api.modrinth.com/v2/version/${v.id}`, { headers: UA });
    if (!r.ok) throw new Error(`Modrinth ${r.status}`);
    const files = (await r.json()).files ?? [];
    return (files.find((f) => f.primary) ?? files[0])?.url ?? null;
  }
  if (mod.source === 'curseforge') {
    if (!key) throw new Error('нет ключа CurseForge (CURSE_FORGE_API_KEY)');
    const f = await cfApi(key)(`/mods/${mod.project.id}/files/${v.id}`);
    const id = Number(f.id);
    return (
      f.downloadUrl ??
      `https://mediafilez.forgecdn.net/files/${Math.floor(id / 1000)}/${id % 1000}/${encodeURIComponent(f.fileName)}`
    );
  }
  if (mod.source === 'git') {
    const r = await fetch(`https://api.github.com/repos/${mod.project.id}/releases/tags/${encodeURIComponent(v.id)}`, {
      headers: ghHeaders(),
    });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const assets = (await r.json()).assets ?? [];
    return (
      (assets.find((x) => x.name === v.file) ?? assets.find((x) => x.name.endsWith('.jar')))?.browser_download_url ??
      null
    );
  }
  return null;
}

/** Скачать jar версии v в dir (кеш по имени файла: версии на площадках не перезаливают) → путь к файлу */
export async function downloadVersionJar(mod, v, dir) {
  const name = `${mod.source}-${String(v.id ?? v.version).replace(/[^\w.-]+/g, '_')}-${(v.file ?? `${mod.id}.jar`).replace(/[^\w.+-]+/g, '_')}`;
  const file = path.join(dir, name);
  if (fs.existsSync(file)) return file;
  const url = await versionJarUrl(mod, v);
  if (!url) throw new Error(`у версии ${v.version} нет файла jar`);
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error(`скачивание ${url}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error(`скачанный файл ${url} — не jar`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${file}.part`, buf);
  fs.renameSync(`${file}.part`, file);
  return file;
}

/** Сводка для консоли и MCP: счётчики и состояние источников */
export function summary(report) {
  const counts = STATUS_ORDER.filter((s) => report.counts[s])
    .map((s) => `${STATUS_LABEL[s]} ${report.counts[s]}`)
    .join(', ');
  const src = Object.entries(report.sources)
    .map(([k, v]) => `${k}: ${v.state}${v.found !== undefined ? ` (${v.found})` : ''}${v.note ? ` — ${v.note}` : ''}`)
    .join('; ');
  return `модов ${report.mods.length}: ${counts}. Источники: ${src}`;
}

function parseAge(s) {
  const m = /^(\d+(?:\.\d+)?)\s*([hmd]?)$/.exec(s ?? '');
  if (!m) throw new Error(`--if-older: «${s}» — нужно число с h/m/d, например 6h`);
  return Number(m[1]) * { h: 3600e3, m: 60e3, d: 86400e3, '': 3600e3 }[m[2]];
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const soft = args.includes('--soft');
  const out = path.resolve(opt('--out') ?? path.join(ROOT, 'public/pack-freshness.json'));
  const manifestFile = opt('--manifest') ? path.resolve(opt('--manifest')) : firstExisting('public/pack-manifest.json');
  try {
    // Деплой сайта без данных сборки (TFC_SITE_ONLY): снимок — тот, что на сайте (его выложил сервер сборки), а не
    // public/ этой машины, который может отставать
    let manifest = null;
    if (process.env.TFC_SITE_ONLY && !opt('--manifest')) {
      const r = await fetch(`${SITE}/pack-manifest.json`, { cache: 'no-store' });
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json'))
        throw new Error(`снимок сборки с сайта не скачался: ${r.status}`);
      manifest = await r.json();
    }
    if (opt('--if-older') && fs.existsSync(out)) {
      const prev = JSON.parse(fs.readFileSync(out, 'utf8'));
      const age = Date.now() - prev.generatedAt;
      if (age < parseAge(opt('--if-older')) && (!manifest || prev.manifestBuiltAt === manifest.builtAt)) {
        log(`отчёт свежий (${Math.round(age / 60e3)} мин) — не пересобираю`);
        return;
      }
    }
    if (!manifest) {
      if (!manifestFile) throw new Error('нет public/pack-manifest.json (npm run mods)');
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    }
    if (!manifest.mods?.length) throw new Error(`в снимке ${manifestFile ?? 'с сайта'} нет модов`);
    const report = await freshnessReport({ manifest });
    if (report.sources.modrinth.state === 'error' && report.sources.curseforge.state !== 'ok')
      throw new Error(`источники недоступны: ${summary(report)}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report));
    log(`${path.relative(ROOT, out)}: ${summary(report)}`);
  } catch (e) {
    if (!soft) throw e;
    console.warn(`[freshness] пропускаю: ${e.message}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
