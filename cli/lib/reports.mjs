/**
 * tfc report — логи и краш-репорты из папки игры (и сервера хоста) на сайт: «Документы» → «Краш-репорты» / «Логи».
 * Один файл — как есть (больше 1 МБ — в zip), несколько — одним zip. Адреса игроков (/1.2.3.4:5678) вырезаются
 * до загрузки: файлы на сайте видны всем. После загрузки — id для агента: tfc-report:<id> → MCP report_get.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { zipSync } from 'fflate';
import { ask, bold, cyan, date, dim, green, interactive, mb, red, withSpinner, yellow } from './ui.mjs';
import { SITE } from './update.mjs';

/** Как на сайте (src/lib/files.config.ts) */
const MAX_SIZE = 25 * 1024 * 1024;
/** Один файл больше этого — в zip: логи сжимаются в 10–20 раз, а каждая часть по 700 КБ — чтение Firestore */
const ZIP_OVER = 1024 * 1024;
const MAX_FILES = 100;

/**
 * Виды отчётов: где искать (папки относительно папки игры или сервера) и какие файлы. Свежий — первый по времени
 * изменения. side: server — только если в профиле есть папка сервера (хост).
 */
export const REPORT_TYPES = [
  {
    id: 'game-log',
    kind: 'log',
    label: 'Лог игры (latest.log и прошлые)',
    dirs: ['logs'],
    re: /^(latest\.log|\d{4}-\d{2}-\d{2}-\d+\.log\.gz)$/,
  },
  { id: 'crash-report', kind: 'crash', label: 'Краш-репорт игры', dirs: ['crash-reports'], re: /^crash-.*\.txt$/ },
  { id: 'debug-log', kind: 'log', label: 'Debug-лог (подробный)', dirs: ['logs'], re: /^debug(-\d+)?\.log(\.gz)?$/ },
  {
    id: 'kubejs-log',
    kind: 'log',
    label: 'Логи KubeJS (startup, server, client)',
    dirs: ['logs/kubejs'],
    re: /\.log$/,
  },
  { id: 'jvm-crash', kind: 'crash', label: 'Падение Java (hs_err_pid)', dirs: ['.'], re: /^hs_err_pid\d+\.log$/ },
  {
    id: 'server-log',
    kind: 'log',
    side: 'server',
    label: 'Лог сервера (latest.log и прошлые)',
    dirs: ['logs'],
    re: /^(latest\.log|\d{4}-\d{2}-\d{2}-\d+\.log\.gz)$/,
  },
  {
    id: 'server-crash',
    kind: 'crash',
    side: 'server',
    label: 'Краш-репорт сервера',
    dirs: ['crash-reports'],
    re: /^crash-.*\.txt$/,
  },
];

/** Короткие имена для командной строки: tfc report crash, tfc report log 3 */
const ALIASES = {
  log: 'game-log',
  logs: 'game-log',
  latest: 'game-log',
  crash: 'crash-report',
  crashes: 'crash-report',
  debug: 'debug-log',
  kubejs: 'kubejs-log',
  jvm: 'jvm-crash',
  hs_err: 'jvm-crash',
  server: 'server-log',
  'server-crashes': 'server-crash',
};

export const typeById = (id) => REPORT_TYPES.find((t) => t.id === (ALIASES[id] ?? id));

/** Файлы вида: [{ name, rel, full, size, mtime }], свежие сверху */
export function findReports(type, roots) {
  const root = type.side === 'server' ? roots.server : roots.game;
  if (!root) return [];
  const out = [];
  for (const d of type.dirs) {
    const dir = path.join(root, d);
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!type.re.test(name)) continue;
      const full = path.join(dir, name);
      const st = fs.statSync(full, { throwIfNoEntry: false });
      if (!st?.isFile() || !st.size) continue;
      out.push({
        name,
        rel: path.posix.join(...d.split('/').filter((x) => x !== '.'), name),
        full,
        size: st.size,
        mtime: st.mtimeMs,
      });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Что взять: '' — последний, число — столько последних, иначе — имена через запятую (точное имя или часть,
 * подходящая одному файлу).
 */
export function pickReports(files, answer) {
  const a = String(answer ?? '').trim();
  if (!a) return files.slice(0, 1);
  if (/^\d+$/.test(a)) {
    const n = Number(a);
    if (n < 1) throw new Error('число — сколько последних файлов взять (1 и больше)');
    if (n > MAX_FILES) throw new Error(`не больше ${MAX_FILES} файлов за раз`);
    return files.slice(0, n);
  }
  const out = [];
  for (const want of a
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const low = want.toLowerCase();
    const exact = files.find((f) => f.name.toLowerCase() === low || f.rel.toLowerCase() === low);
    const hits = exact ? [exact] : files.filter((f) => f.name.toLowerCase().includes(low));
    if (!hits.length) throw new Error(`нет файла «${want}»`);
    if (hits.length > 1)
      throw new Error(
        `«${want}» подходит к ${hits.length} файлам: ${hits
          .slice(0, 5)
          .map((f) => f.name)
          .join(', ')}…`,
      );
    if (!out.includes(hits[0])) out.push(hits[0]);
  }
  return out;
}

/** Адреса игроков в логах сервера и клиента: «/1.2.3.4:5678» → «/<ip>» */
const maskIp = (s) => s.replace(/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/g, '/<ip>');

/** Содержимое для загрузки: .gz распаковываем (чтобы вырезать адреса), текст — без адресов игроков */
function readClean(f) {
  let buf = fs.readFileSync(f.full);
  let rel = f.rel;
  if (rel.endsWith('.gz')) {
    buf = zlib.gunzipSync(buf);
    rel = rel.slice(0, -3);
  }
  return { rel, bytes: Buffer.from(maskIp(buf.toString('utf8')), 'utf8') };
}

const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

/** Один файл или zip: { name, bytes } */
export function packReports(type, picked) {
  const clean = picked.map(readClean);
  if (clean.length === 1 && clean[0].bytes.length <= ZIP_OVER)
    return { name: path.posix.basename(clean[0].rel), bytes: clean[0].bytes };
  const entries = Object.fromEntries(
    clean.map((c, i) => [c.rel, [new Uint8Array(c.bytes), { level: 9, mtime: new Date(picked[i].mtime) }]]),
  );
  const name =
    clean.length === 1
      ? `${path.posix.basename(clean[0].rel)}.zip`
      : `${type.id}-${clean.length}-${stamp(picked[0].mtime)}.zip`;
  return { name, bytes: Buffer.from(zipSync(entries)) };
}

function printFiles(files, limit = 10) {
  files
    .slice(0, limit)
    .forEach((f, i) =>
      console.log(`  ${dim(String(i + 1).padStart(2))}  ${f.rel}  ${dim(`${mb(f.size)}, ${date(f.mtime)}`)}`),
    );
  if (files.length > limit) console.log(dim(`  … и ещё ${files.length - limit} (по имени можно взять любой)`));
}

/** Строка для агента: её же копирует кнопка на сайте */
export const agentLine = (r) => `Отчёт «${r.name}» — tfc-report:${r.id} — ${SITE}/docs?report=${r.id}`;

/**
 * tfc report [вид] [выбор]: без вида — список видов с числом файлов; без выбора — список файлов и вопрос
 * «Enter — последний, число — несколько последних, имя — конкретный».
 */
export async function cmdReport(api, roots, args, { note, task, yes, dryRun }) {
  const [typeArg, ...rest] = args;
  const available = REPORT_TYPES.filter((t) => t.side !== 'server' || roots.server);
  let type;
  if (typeArg) {
    type = typeById(typeArg);
    if (!type)
      throw new Error(
        `нет вида «${typeArg}» — ${available.map((t) => t.id).join(', ')} (коротко: log, crash, debug, kubejs, jvm${roots.server ? ', server' : ''})`,
      );
    if (type.side === 'server' && !roots.server)
      throw new Error('у профиля нет папки сервера — tfc init --server-dir <папка>');
  } else {
    if (!interactive()) throw new Error('tfc report <вид> [число | имя] — без терминала вид нужно назвать');
    const counts = available.map((t) => ({ t, files: findReports(t, roots) }));
    console.log(bold('Что загрузить на сайт:'));
    counts.forEach(({ t, files }, i) =>
      console.log(
        `  ${cyan(i + 1)}. ${files.length ? t.label : dim(t.label)} ${dim(
          files.length ? `— ${files.length}, последний ${date(files[0].mtime)}` : '— нет файлов',
        )}`,
      ),
    );
    const def = String(counts.findIndex((c) => c.files.length) + 1 || 1);
    for (;;) {
      const n = Number(await ask('Номер', def));
      if (Number.isInteger(n) && counts[n - 1]) {
        type = counts[n - 1].t;
        break;
      }
      console.log(red('  нет такого варианта'));
    }
  }

  const root = type.side === 'server' ? roots.server : roots.game;
  const files = findReports(type, roots);
  if (!files.length) throw new Error(`${type.label}: в ${path.join(root, type.dirs[0])} нет файлов`);

  let answer = rest.join(' ');
  if (!rest.length && interactive() && !yes) {
    console.log(`\n${bold(type.label)} ${dim(`— ${root}`)}`);
    printFiles(files);
    answer = await ask('Enter — последний, число — сколько последних, имя — конкретный (через запятую — несколько)');
  }
  const picked = pickReports(files, answer);
  if (!note && interactive() && !yes) note = await ask('Что случилось (Enter — без описания)');

  const { name, bytes } = packReports(type, picked);
  console.log(
    `${picked.length === 1 ? picked[0].rel : `файлов: ${picked.length}`} → ${bold(name)} ${dim(mb(bytes.length))}`,
  );
  if (bytes.length > MAX_SIZE)
    throw new Error(`получилось ${mb(bytes.length)}, на сайт — до ${mb(MAX_SIZE)}: возьмите меньше файлов`);
  if (dryRun) return console.log(yellow('Пробно (--dry-run): ничего не загружал.'));

  const r = await withSpinner('Загружаю на сайт', () =>
    api.uploadReport(bytes, {
      name,
      kind: type.kind,
      type: type.id,
      label: type.label,
      note: note ?? '',
      taskId: task ?? null,
      files: picked.map((f) => ({ name: f.rel, size: f.size, mtime: Math.round(f.mtime) })),
    }),
  );
  console.log(`${green('Загружено')} — «Документы» → ${type.kind === 'crash' ? '«Краш-репорты»' : '«Логи»'}.`);
  console.log(dim('Адреса игроков в тексте заменены на /<ip>.'));
  console.log(`\nДля агента (скопируйте в чат):\n  ${bold(agentLine(r))}`);
}
