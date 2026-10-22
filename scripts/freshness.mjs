#!/usr/bin/env node
/**
 * Свежесть сборки → public/pack-freshness.json: для каждого мода из pack-manifest.json — новейшая версия под
 * 1.21.1 NeoForge с Modrinth (по sha1) или CurseForge (по отпечатку jar) и цвет отставания. Расчёт —
 * src/lib/freshness.ts (тот же у сайта и MCP), план — docs/plans/mod-freshness.md.
 *
 *   npm run freshness                      — собрать отчёт и показать сводку
 *   … -- --if-older 6h --soft              — так зовёт prebuild: свежий отчёт не трогает, ошибки не роняют сборку
 *   … -- --manifest <файл> --out <файл>    — другой снимок / куда писать
 * Ключ CurseForge — CURSE_FORGE_API_KEY в окружении или .env.local (в worktree — и основной копии). Без ключа
 * CurseForge пропускается. Отпечатков нет в старом снимке — считаются по jar из mods/, если они есть.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, cfFingerprint, STATUS_LABEL, STATUS_ORDER } from '../src/lib/freshness.ts';
import { addonCards } from './addons-index.mjs';
import { mainCheckoutRoot } from './mods.mjs';
import { SITE } from './firestore-rest.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const log = (...a) => console.log('[freshness]', ...a);

/** Корни, где искать .env.local, public/ и mods/: эта копия, потом основная (в worktree) */
const roots = (root = ROOT) => [root, mainCheckoutRoot()].filter(Boolean);

/** CURSE_FORGE_API_KEY: окружение, потом .env.local */
export function curseforgeKey(root = ROOT) {
  if (process.env.CURSE_FORGE_API_KEY) return process.env.CURSE_FORGE_API_KEY;
  for (const r of roots(root)) {
    try {
      const m = /^\s*CURSE_FORGE_API_KEY\s*=\s*(.*?)\s*$/m.exec(fs.readFileSync(path.join(r, '.env.local'), 'utf8'));
      const key = m?.[1].replace(/^(['"])(.*)\1$/, '$2');
      if (key) return key;
    } catch {
      /* нет файла */
    }
  }
  return null;
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
export async function freshnessReport({
  manifest,
  modsDirs = roots().map((r) => path.join(r, 'mods')),
  key = curseforgeKey(),
  ownIds,
} = {}) {
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
    ownIds: own,
    userAgent: `tfc-plans/1.0 (${SITE})`,
    manifestBuiltAt: manifest.builtAt,
  });
}

const CHANGELOG_CAP = 8000;
const UA = { 'User-Agent': `tfc-plans/1.0 (${SITE})` };
const stripHtml = (html) =>
  html
    .replace(/<br\s*\/?>|<\/(?:p|li|h\d|div)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Ченджлоги версий новее нашей, до новейшей (релиза, а если есть бета новее — до неё), новые сверху.
 * mod — запись отчёта (FreshMod). Текст обрезается до CHANGELOG_CAP; null — источник не даёт ченджлогов.
 */
export async function modChangelog(mod, key = curseforgeKey()) {
  const target = mod.beta ?? mod.latest;
  if (!mod.current || !target || mod.status === 'ok') return null;
  const from = Date.parse(mod.current.date ?? 0);
  const to = Date.parse(target.date ?? 0);
  let parts = [];
  if (mod.source === 'modrinth') {
    const q = `game_versions=${encodeURIComponent(JSON.stringify(['1.21.1']))}`;
    const r = await fetch(`https://api.modrinth.com/v2/project/${mod.project.id}/version?${q}`, { headers: UA });
    if (!r.ok) throw new Error(`Modrinth ${r.status}`);
    parts = (await r.json())
      // Одна версия выходит отдельными файлами под каждый загрузчик — ченджлог берём один раз
      .filter((v, i, all) => {
        const d = Date.parse(v.date_published);
        return d > from && d <= to && all.findIndex((x) => x.version_number === v.version_number) === i;
      })
      .map(
        (v) =>
          `### ${v.version_number} (${v.version_type}, ${v.date_published.slice(0, 10)})\n${(v.changelog ?? '').trim()}`,
      );
  } else if (mod.source === 'curseforge') {
    if (!key) return null;
    const H = { 'x-api-key': key, Accept: 'application/json' };
    const get = async (p) => {
      const r = await fetch(`https://api.curseforge.com/v1${p}`, { headers: H });
      if (!r.ok) throw new Error(`CurseForge ${r.status}`);
      return (await r.json()).data;
    };
    const files = (await get(`/mods/${mod.project.id}/files?gameVersion=1.21.1&modLoaderType=6&pageSize=50`))
      .filter((f) => f.id > Number(mod.current.id) && f.id <= Number(target.id))
      .sort((a, b) => b.id - a.id)
      .slice(0, 12);
    for (const f of files)
      parts.push(
        `### ${f.fileName} (${f.fileDate.slice(0, 10)})\n${stripHtml(await get(`/mods/${mod.project.id}/files/${f.id}/changelog`))}`,
      );
  } else return null;
  const text = parts.join('\n\n');
  return text.length > CHANGELOG_CAP ? `${text.slice(0, CHANGELOG_CAP)}\n…` : text;
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
    if (opt('--if-older') && fs.existsSync(out)) {
      const age = Date.now() - JSON.parse(fs.readFileSync(out, 'utf8')).generatedAt;
      if (age < parseAge(opt('--if-older'))) {
        log(`отчёт свежий (${Math.round(age / 60e3)} мин) — не пересобираю`);
        return;
      }
    }
    if (!manifestFile) throw new Error('нет public/pack-manifest.json (npm run mods)');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (!manifest.mods?.length) throw new Error(`в ${manifestFile} нет модов`);
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
