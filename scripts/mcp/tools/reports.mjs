/**
 * Инструменты MCP: отчёты игроков — логи и краш-репорты, загруженные `tfc report` (cli/lib/reports.mjs) на сервер
 * сборки (dev #360, lib/reports.mjs; раньше — Firestore files). reports_list — список, report_get — скачать в кеш
 * (~/.cache/tfc-plans/reports/<id>, файл с данным id не меняется), распаковать zip/gz и сразу разобрать главный файл
 * тем же log_analyze. Чтений Firestore нет: всё — GET /reports сервера сборки ключом tfc.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { packServer } from '../../pack-fetch.mjs';
import { dateOf, page, paging, str, words } from '../fmt.mjs';
import { logAnalyze } from './logs.mjs';

const SITE = 'https://tfc-plans-fd2c.web.app';
const CACHE = path.resolve(process.env.TFC_REPORTS_CACHE ?? path.join(os.homedir(), '.cache', 'tfc-plans', 'reports'));
const KIND = { crash: 'краш', log: 'лог' };
const TTL = 60_000;

const kb = (n) =>
  n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(1)} МБ`;

/** Запрос к /reports сервера сборки; 404 → null */
async function pack(p) {
  const srv = packServer();
  if (!srv) throw new Error('Нужен ключ сервера сборки: tfc login или TFC_PACK_URL/TFC_PACK_TOKEN');
  let res;
  try {
    res = await fetch(`${srv.url}/reports${p}`, {
      headers: { Authorization: `Bearer ${srv.token}` },
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error('Сервер сборки недоступен или не ответил');
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const out = await res.json().catch(() => ({}));
    throw new Error(`Сервер сборки: ${out.error ?? `${res.status} ${res.statusText}`}`);
  }
  return res;
}

/** Отчёты, свежие сверху; кеш на минуту */
let listCache = null;
async function reportDocs() {
  if (listCache && listCache.until > Date.now()) return listCache.value;
  const value = (await (await pack('')).json()).reports;
  listCache = { until: Date.now() + TTL, value };
  return value;
}

const line = (d) =>
  `${d.id} · ${KIND[d.report?.kind] ?? '?'} · ${d.report?.label || d.report?.type} · «${d.name}» ${kb(d.size)} · ${d.author}, ${dateOf(d.createdAt)}` +
  `${d.report?.files?.length > 1 ? ` · файлов: ${d.report.files.length}` : ''}${d.taskId ? ` · задача ${d.taskId}` : ''}` +
  `${d.report?.note ? `\n    «${d.report.note}»` : ''}`;

async function reportsList(a) {
  let list = await reportDocs();
  if (a.kind) list = list.filter((d) => d.report?.kind === a.kind);
  if (a.author) list = list.filter((d) => String(d.author).toLowerCase() === String(a.author).toLowerCase());
  if (a.query) {
    const ws = words(a.query);
    list = list.filter((d) => {
      const hay =
        `${d.name} ${d.report?.label} ${d.report?.type} ${d.report?.note} ${d.author} ${(d.report?.files ?? []).map((f) => f.name).join(' ')}`.toLowerCase();
      return ws.every((w) => hay.includes(w));
    });
  }
  return `${page(list, a, (d) => [line(d)])}\nСкачать и разобрать: report_get id=<id>.`;
}

/** id из «tfc-report:<id>», ссылки …/dev?report=<id> или голого id */
function reportId(key) {
  const k = String(key ?? '').trim();
  const m = k.match(/(?:tfc-report:|[?&]report=)([A-Za-z0-9]{20})\b/) ?? k.match(/^([A-Za-z0-9]{20})$/);
  return m?.[1] ?? null;
}

/** Метаданные + файл с сервера сборки → кеш; распаковка zip/gz рядом. { dir, meta, files: [{ rel, full, size }] } */
export async function fetchReport(id) {
  const dir = path.join(CACHE, id);
  const metaFile = path.join(dir, 'meta.json');
  let meta;
  if (fs.existsSync(metaFile)) meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  else {
    const r = await pack(`/${id}`);
    if (!r) throw new Error(`Нет отчёта ${id} на сервере сборки (удалён?).`);
    meta = (await r.json()).report;
    const c = await pack(`/${id}/content`);
    if (!c) throw new Error(`Нет отчёта ${id} на сервере сборки (удалён?).`);
    const bytes = Buffer.from(await c.arrayBuffer());
    if (bytes.length !== meta.size)
      throw new Error(`Отчёт ${id}: размер не сошёлся (${bytes.length} вместо ${meta.size}).`);
    if (createHash('sha256').update(bytes).digest('hex') !== meta.sha256)
      throw new Error(`Отчёт ${id}: хеш не сошёлся.`);
    const out = path.join(dir, 'files');
    fs.mkdirSync(out, { recursive: true });
    const safe = (rel) => {
      const p = path.resolve(out, rel);
      if (!p.startsWith(out + path.sep)) throw new Error(`Странный путь в архиве: ${rel}`);
      return p;
    };
    const write = (rel, data) => {
      const p = safe(rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, data);
    };
    if (/\.zip$/i.test(meta.name)) {
      for (const [rel, data] of Object.entries(unzipSync(new Uint8Array(bytes))))
        if (!rel.endsWith('/'))
          write(rel.endsWith('.gz') ? rel.slice(0, -3) : rel, rel.endsWith('.gz') ? zlib.gunzipSync(data) : data);
    } else if (/\.gz$/i.test(meta.name)) write(meta.name.slice(0, -3), zlib.gunzipSync(bytes));
    else write(meta.name, bytes);
    fs.writeFileSync(path.join(dir, meta.name.replace(/[/\\]/g, '_') + '.orig'), bytes);
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  }
  const root = path.join(dir, 'files');
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else files.push({ rel: path.relative(root, full).split(path.sep).join('/'), full, size: fs.statSync(full).size });
    }
  };
  walk(root);
  // Порядок, как при загрузке (свежие сверху), — по списку из метаданных
  const order = (meta.report?.files ?? []).map((f) => f.name.replace(/\.gz$/, ''));
  const rank = (f) => {
    const i = order.indexOf(f.rel);
    return i < 0 ? order.length : i;
  };
  files.sort((x, y) => rank(x) - rank(y) || x.rel.localeCompare(y.rel));
  return { dir, meta, files };
}

/** Главный файл: краш-репорт / hs_err, иначе первый (самый свежий) */
const mainFile = (files) => files.find((f) => /crash-.*\.txt$|hs_err_pid/.test(f.rel)) ?? files[0];

async function reportGet(a) {
  const id = reportId(a.id);
  if (!id) return 'Укажите id отчёта: «tfc-report:<id>», ссылку …/dev?report=<id> или 20-значный id (reports_list).';
  const { dir, meta, files } = await fetchReport(id);
  const r = meta.report ?? {};
  const head = [
    `Отчёт ${id}: ${KIND[r.kind] ?? 'файл'} · ${r.label || r.type || '—'} · «${meta.name}» ${kb(meta.size)} · ${meta.author}, ${dateOf(meta.createdAt)}`,
    ...(r.note ? [`Описание: «${r.note}»`] : []),
    ...(meta.taskId ? [`Задача: ${meta.taskId} (task_get)`] : []),
    `На сайте: ${SITE}/dev?report=${id}; локально: ${path.join(dir, 'files')}/<файл>`,
    `Файлы (${files.length}):`,
    ...files.map((f) => `  ${f.rel} — ${kb(f.size)}`),
  ];
  if (!files.length) return head.join('\n');
  let file = mainFile(files);
  if (a.file) {
    const low = String(a.file).toLowerCase();
    const hits = files.filter((f) => f.rel.toLowerCase() === low || f.rel.toLowerCase().includes(low));
    if (hits.length !== 1)
      return `${head.join('\n')}\n\nfile=«${a.file}»: ${hits.length ? 'подходит несколько' : 'нет такого'} — укажите имя из списка.`;
    file = hits[0];
  }
  const mode = String(a.mode ?? 'analyze');
  if (mode === 'none')
    return `${head.join('\n')}\n\nРазбор: report_get id=${id} file=<имя> или log_analyze path=<путь>.`;
  if (mode === 'text') {
    const all = fs.readFileSync(file.full, 'utf8').replace(/\r/g, '').split('\n');
    const offset = Math.max(0, Number(a.offset ?? 0) | 0);
    const limit = Math.max(1, Math.min(2000, Number(a.limit ?? 200) | 0));
    const end = Math.min(all.length, offset + limit);
    const q = a.query ? new RegExp(String(a.query), 'i') : null;
    const body = q
      ? all
          .map((l, i) => [i, l])
          .filter(([, l]) => q.test(l))
          .slice(offset, offset + limit)
          .map(([i, l]) => `${String(i + 1).padStart(6)}| ${l}`)
      : all.slice(offset, end).map((l, i) => `${String(offset + i + 1).padStart(6)}| ${l}`);
    const more = !q && end < all.length ? `\n… ещё ${all.length - end} строк; дальше: offset=${end}` : '';
    return `${head.join('\n')}\n\n${file.rel}${q ? ` — строки по «${a.query}»` : ''}:\n${body.join('\n')}${more}`;
  }
  return `${head.join('\n')}\n\n${logAnalyze({ path: file.full, level: a.level, query: a.query, limit: a.limit, offset: a.offset })}`;
}

export const TOOLS = [
  {
    name: 'reports_list',
    description:
      'Logs and crash reports players uploaded to the site with `tfc report` (site «Разработка» → «Краш-репорты»/«Логи»): id, type, files, author, note. Newest first; cached 1 min.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['crash', 'log'], description: 'only crash reports or only logs' },
        author: str('uploader nick'),
        query: str('words in name, type, note, file names'),
        ...paging,
      },
    },
    handler: reportsList,
  },
  {
    name: 'report_get',
    description:
      'Fetch an uploaded report (id, «tfc-report:<id>» or …/dev?report=<id> link) into a local cache, unzip, list files with local paths and analyse the main file (crash report / hs_err, else the newest log) like log_analyze. file= — another file of the archive; mode=text — raw lines (offset/limit, query = regex filter); mode=none — only the list.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('report id, «tfc-report:<id>» or site link'),
        file: str('file inside the report (name or part of it)'),
        mode: { type: 'string', enum: ['analyze', 'text', 'none'], description: 'analyze (default), text, none' },
        level: str('for analyze: error (default), warn, all, timeline — as log_analyze'),
        query: str('regex: analyze — filter messages; text — only matching lines'),
        ...paging,
      },
      required: ['id'],
    },
    handler: reportGet,
  },
];
