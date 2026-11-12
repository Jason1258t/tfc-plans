#!/usr/bin/env node
/**
 * Очередь стенда на test1a (dev #310): агенты ставят прогоны серверного и клиентского стенда в очередь, исполнитель
 * гоняет их по одному и сам пишет ход и итог, агент ждёт одним вызовом (stand_wait) — без опроса журнала.
 * В простое исполнитель берёт фоновую проверку печати схем (print-worker.mjs --once): задания агентов идут первыми.
 * С Mac сюда ходит stand-queue-remote.mjs (MCP stand_submit / stand_wait / stand_log / stand_jobs) по ssh.
 *
 *   TFC_STAND_QUEUE — папка очереди (по умолчанию ~/tfc-stand/queue):
 *     jobs/<id>/job.json    — задание и его состояние: queued → running → done | error | cancelled
 *     jobs/<id>/events.jsonl — ход прогона: строки стенда о себе (не сырой журнал игры), по номерам seq
 *     jobs/<id>/output.log  — весь вывод прогона (stand_log)
 *     jobs/<id>/summary.txt — сводка стенда
 *     jobs/<id>/logs/       — журналы серверного прогона (его папка в /dev/shm удаляется)
 *     jobs/<id>/cancel      — просьба отменить (кладёт cancel)
 *     inputs/<метка>/       — свои jar, оверлей, мир задания (заливает Mac, удаляются после прогона)
 *     current.json          — что идёт сейчас: задание или проверка печати
 *
 *   node scripts/stand-queue.mjs serve                 — исполнитель (cron: scripts/stand-queue.sh)
 *   node scripts/stand-queue.mjs add < job.json        — { kind: server|client, args, by, note, inputs } → { id, position }
 *   node scripts/stand-queue.mjs wait <id> [--since N] [--timeout 600] [--until <regex>]
 *   node scripts/stand-queue.mjs list | log <id> [--grep re] [--tail 80] | cancel <id>
 *
 * Только встроенные модули Node: сами стенды (pack-stand.mjs, client-stand.mjs) — отдельными процессами.
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const QUEUE = path.resolve(process.env.TFC_STAND_QUEUE ?? path.join(os.homedir(), 'tfc-stand', 'queue'));
const JOBS = path.join(QUEUE, 'jobs');
const CURRENT = path.join(QUEUE, 'current.json');
/** Проверка печати — не чаще; между ними исполнитель свободен для заданий агентов */
const PRINT_EVERY = 10 * 60_000;
/** Сверка кода с origin/main в простое: изменился — выходим, cron поднимет исполнителя на новом коде */
const PULL_EVERY = 10 * 60_000;
const KEEP_JOBS = 40;
const FINAL = new Set(['done', 'error', 'cancelled']);
const ID_RE = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
/** Папка серверного стенда, как у pack-stand.mjs: там установленный NeoForge */
const SERVER_STAND = path.resolve(process.env.TFC_STAND_DIR ?? path.join(os.homedir(), '.cache', 'tfc-plans', 'stand'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = (...a) => console.log(`[stand-queue ${now().slice(11, 19)}]`, ...a);

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, v) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 1));
  fs.renameSync(tmp, file);
}

const jobDir = (id) => {
  if (!ID_RE.test(id ?? '')) throw new Error(`нет задания «${id}»`);
  return path.join(JOBS, id);
};
const readJob = (id) => readJson(path.join(jobDir(id), 'job.json'));
function updateJob(id, patch) {
  const j = { ...readJob(id), ...patch };
  writeJson(path.join(jobDir(id), 'job.json'), j);
  return j;
}

/** Все задания, старые первыми (id начинается с времени) */
function allJobs() {
  if (!fs.existsSync(JOBS)) return [];
  return fs
    .readdirSync(JOBS)
    .filter((d) => ID_RE.test(d))
    .sort()
    .map((d) => readJob(d))
    .filter(Boolean);
}
const queued = () => allJobs().filter((j) => j.state === 'queued');

/** Сводка в ответе wait — не больше стольких символов (начало + конец) */
const SUMMARY_MAX = 24_000;
const SUMMARY_HEAD = 6_000;

/** Место в очереди: 1 — следующее; 0 — уже идёт или кончилось */
function positionOf(id) {
  const i = queued().findIndex((j) => j.id === id);
  return i < 0 ? 0 : i + 1;
}

function events(id, since = 0) {
  const file = path.join(jobDir(id), 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.seq > since);
}

// ---------------------------------------------------------------- команды для Mac

function add(spec) {
  if (!['server', 'client'].includes(spec?.kind)) throw new Error('kind: server | client');
  if (!Array.isArray(spec.args)) throw new Error('args — массив флагов стенда');
  fs.mkdirSync(JOBS, { recursive: true });
  const t = now().slice(0, 19).replace(/\D/g, '');
  const id = `${t.slice(0, 8)}-${t.slice(8)}-${randomBytes(2).toString('hex')}`;
  fs.mkdirSync(path.join(JOBS, id));
  const inputs = spec.inputs ? path.resolve(QUEUE, 'inputs', path.basename(String(spec.inputs))) : null;
  updateJob(id, {
    id,
    kind: spec.kind,
    args: spec.args.map(String),
    by: String(spec.by ?? '?').slice(0, 60),
    note: String(spec.note ?? '').slice(0, 300),
    inputs,
    state: 'queued',
    createdAt: now(),
    seq: 0,
  });
  return { id, position: positionOf(id), current: readJson(CURRENT) };
}

/** Что отдать ожидающему: задание, место, что идёт сейчас, новые события и сводка по окончании */
function view(id, since) {
  const job = readJob(id);
  if (!job) throw new Error(`нет задания ${id}`);
  const evs = events(id, since);
  const full = FINAL.has(job.state) ? readText(path.join(jobDir(id), 'summary.txt')) : null;
  // Длинную сводку (сотни команд) — началом и концом; целиком её забирает Mac (summaryFile)
  const cut = full && full.length > SUMMARY_MAX;
  const summary = cut
    ? `${full.slice(0, SUMMARY_HEAD)}\n… пропущено ${full.length - SUMMARY_MAX} симв. …\n${full.slice(-(SUMMARY_MAX - SUMMARY_HEAD))}`
    : full;
  return {
    job,
    position: positionOf(id),
    current: job.state === 'queued' ? readJson(CURRENT) : null,
    events: evs.slice(-25),
    skipped: Math.max(0, evs.length - 25),
    seq: job.seq ?? 0,
    summary,
    summaryCut: Boolean(cut),
    summaryFile: full ? path.join(jobDir(id), 'summary.txt') : null,
  };
}

/** Ждать конца задания (или события по until) не дольше timeout с */
async function wait(id, { since = 0, timeout = 600, until = null }) {
  const re = until ? new RegExp(until) : null;
  const t0 = Date.now();
  for (;;) {
    const job = readJob(id);
    if (!job) throw new Error(`нет задания ${id}`);
    const hit = re && events(id, since).some((e) => re.test(e.text));
    if (FINAL.has(job.state) || hit || Date.now() - t0 >= timeout * 1000)
      return { ...view(id, since), reason: FINAL.has(job.state) ? 'final' : hit ? 'until' : 'timeout' };
    await sleep(1000);
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function jobLog(id, { grep = null, tail = 80 }) {
  const text = readText(path.join(jobDir(id), 'output.log'));
  let rows = text.split('\n');
  if (grep) {
    const re = new RegExp(grep, 'i');
    rows = rows.filter((l) => re.test(l));
  }
  const n = Math.min(400, Math.max(1, tail));
  return { total: rows.length, lines: rows.slice(-n).map((l) => l.slice(0, 400)) };
}

function cancel(id) {
  const job = readJob(id);
  if (!job) throw new Error(`нет задания ${id}`);
  if (FINAL.has(job.state)) return { state: job.state };
  if (job.state === 'queued') {
    finishJob(id, { state: 'cancelled', error: 'отменено до запуска' });
    return { state: 'cancelled' };
  }
  fs.writeFileSync(path.join(jobDir(id), 'cancel'), now());
  return { state: 'cancelling' };
}

// ---------------------------------------------------------------- исполнитель

const seqCache = new Map();
function event(id, text) {
  const seq = (seqCache.get(id) ?? 0) + 1;
  seqCache.set(id, seq);
  fs.appendFileSync(path.join(jobDir(id), 'events.jsonl'), JSON.stringify({ seq, t: now(), text }) + '\n');
  updateJob(id, { seq, stage: text.slice(0, 200) });
}

function finishJob(id, patch) {
  const j = updateJob(id, { ...patch, endedAt: now() });
  if (j.inputs?.startsWith(path.join(QUEUE, 'inputs'))) fs.rmSync(j.inputs, { recursive: true, force: true });
  return j;
}

/** Текущий снимок сервера сборки; отличается от кеша — подтянуть (pack-fetch.mjs) */
async function ensurePack(id) {
  const url = process.env.TFC_PACK_URL;
  const token = process.env.TFC_PACK_TOKEN;
  if (!url || !token) return;
  const res = await fetch(`${url.replace(/\/$/, '')}/pack/current`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`сервер сборки: ${res.status}`);
  const cur = (await res.json()).id;
  const { packMeta } = await import('./stand-shm.mjs');
  if (packMeta().snapshot === cur) return;
  event(id, `подтягиваю снимок ${cur}`);
  const code = await runChild(id, [path.join(HERE, 'pack-fetch.mjs')], {
    onStdout: (l) => l.trim() && event(id, l.replace(/^\[pack:fetch\]\s*/, '').slice(0, 300)),
  });
  if (code !== 0) throw new Error(`снимок не подтянулся (код ${code})`);
}

/** Строки, которые стенд пишет о себе: этапы прогона — в события, остальное — только в output.log */
const STAGE_RE = /^\[client-stand\]\s*/;

/**
 * Процесс прогона: stdout копится в сводку, stderr (журнал стенда о себе) — в события; весь вывод — в output.log.
 * cancel — по файлу cancel: клиенту закрываем stdin (выходит штатно), серверу — SIGTERM; не вышел — SIGKILL.
 */
function runChild(id, args, { env = {}, stdinWatch = false, hardSec = 0, onStdout = null } = {}) {
  const dir = jobDir(id);
  const out = fs.openSync(path.join(dir, 'output.log'), 'a');
  const child = spawn(process.execPath, args, {
    cwd: path.dirname(HERE),
    env: { ...process.env, ...env },
    stdio: [stdinWatch ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let last = '';
  const lineBuf = { out: '', err: '' };
  const feed = (kind) => (d) => {
    fs.writeSync(out, d);
    lineBuf[kind] += d;
    const rows = lineBuf[kind].split('\n');
    lineBuf[kind] = rows.pop();
    for (const raw of rows) {
      if (kind === 'out') onStdout?.(raw);
      else {
        const l = raw.replace(STAGE_RE, '').trim();
        if (l && l !== last) {
          last = l;
          event(id, l.slice(0, 300));
        }
      }
    }
  };
  child.stdout.on('data', feed('out'));
  child.stderr.on('data', feed('err'));
  const killAll = (sig) => {
    try {
      process.kill(-child.pid, sig);
    } catch {
      /* уже вышел */
    }
  };
  let asked = 0;
  const watch = setInterval(() => {
    if (!asked && fs.existsSync(path.join(dir, 'cancel'))) {
      asked = Date.now();
      event(id, 'отмена: останавливаю прогон');
      if (stdinWatch) child.stdin.end();
      else killAll('SIGTERM');
    } else if (asked && Date.now() - asked > 120_000) killAll('SIGKILL');
  }, 2000);
  const hard = hardSec
    ? setTimeout(() => {
        event(id, `не уложился в ${hardSec} с — убиваю`);
        killAll('SIGKILL');
      }, hardSec * 1000)
    : null;
  return new Promise((resolve) => {
    child.on('close', (code, sig) => {
      clearInterval(watch);
      if (hard) clearTimeout(hard);
      fs.closeSync(out);
      resolve(asked ? 'cancelled' : (sig ?? code));
    });
  });
}

/** Сколько секунд прогон может идти: его --timeout + запас на загрузку, снимки и выход */
function hardLimit(args) {
  const i = args.lastIndexOf('--timeout');
  const t = i >= 0 ? Number(args[i + 1]) || 900 : 900;
  const u = args.lastIndexOf('--until-timeout');
  return t + (u >= 0 ? Number(args[u + 1]) || 0 : 0) + 1200;
}

async function runServer(id, job) {
  const { stageShm } = await import('./stand-shm.mjs');
  const staged = stageShm(SERVER_STAND, { prefix: 'tfc-queue.' });
  let summary = '';
  try {
    if (staged.stand !== SERVER_STAND) event(id, 'снимок и NeoForge скопированы в /dev/shm');
    const code = await runChild(id, [path.join(HERE, 'pack-stand.mjs'), ...job.args], {
      env: { TFC_PACK_CACHE: staged.pack, TFC_STAND_DIR: staged.stand },
      hardSec: hardLimit(job.args),
      onStdout: (l) => (summary += `${l}\n`),
    });
    // Журналы из /dev/shm — в папку задания, пока их не убрали
    const run = path.join(staged.stand, 'run');
    const keep = path.join(jobDir(id), 'logs');
    for (const rel of ['logs/latest.log', 'logs/debug.log', 'logs/kubejs', 'crash-reports', 'scenario.json'])
      if (fs.existsSync(path.join(run, rel)))
        fs.cpSync(path.join(run, rel), path.join(keep, path.basename(rel)), { recursive: true });
    summary = summary.replaceAll(run, '<прогон>');
    return { code, summary, result: fs.existsSync(keep) ? keep : null };
  } finally {
    staged.clean();
  }
}

async function runClientJob(id, job) {
  let summary = '';
  let result = null;
  const code = await runChild(id, [path.join(HERE, 'client-stand.mjs'), 'run', ...job.args, '--stdin-watch'], {
    stdinWatch: true,
    hardSec: hardLimit(job.args),
    onStdout: (l) => {
      const m = /^RESULT (.+)$/.exec(l);
      if (m) result = m[1].trim();
      else summary += `${l}\n`;
    },
  });
  return { code, summary, result };
}

async function runJob(job) {
  const { id } = job;
  // Могли отменить, пока задание ждало
  if (readJob(id)?.state !== 'queued') return;
  seqCache.set(id, job.seq ?? 0);
  writeJson(CURRENT, { kind: 'job', id, jobKind: job.kind, by: job.by, since: now() });
  updateJob(id, { state: 'running', startedAt: now() });
  log(`задание ${id} (${job.kind}, ${job.by}${job.note ? `: ${job.note}` : ''})`);
  try {
    await ensurePack(id);
    event(id, `запускаю ${job.kind === 'server' ? 'серверный' : 'клиентский'} стенд`);
    const r = job.kind === 'server' ? await runServer(id, job) : await runClientJob(id, job);
    const summary = r.summary.trim();
    fs.writeFileSync(path.join(jobDir(id), 'summary.txt'), `${summary}\n`);
    const state = r.code === 'cancelled' ? 'cancelled' : summary ? 'done' : 'error';
    finishJob(id, {
      state,
      code: r.code,
      ok: r.code === 0,
      result: r.result,
      ...(state === 'error' ? { error: `прогон не дал сводки (код ${r.code})` } : {}),
    });
    log(`задание ${id}: ${state} (код ${r.code})`);
  } catch (e) {
    event(id, `ошибка исполнителя: ${e.message}`);
    finishJob(id, { state: 'error', error: e.message });
    log(`задание ${id}: ошибка ${e.stack ?? e}`);
  } finally {
    writeJson(CURRENT, null);
  }
}

/** Фоновая проверка печати — одна пачка, если есть (свой процесс со своими журналами) */
async function runPrint() {
  const worker = path.join(HERE, 'print-worker.mjs');
  if (!fs.existsSync(worker) || !process.env.TFC_PACK_TOKEN) return;
  writeJson(CURRENT, { kind: 'print', since: now() });
  try {
    await new Promise((resolve) => {
      const child = spawn(process.execPath, [worker, '--once'], { cwd: path.dirname(HERE), stdio: 'inherit' });
      child.on('close', resolve);
    });
  } finally {
    writeJson(CURRENT, null);
  }
}

/** Старые задания сверх KEEP_JOBS и брошенные входы */
function prune() {
  const done = allJobs().filter((j) => FINAL.has(j.state));
  for (const j of done.slice(0, Math.max(0, done.length - KEEP_JOBS)))
    fs.rmSync(path.join(JOBS, j.id), { recursive: true, force: true });
  const inputs = path.join(QUEUE, 'inputs');
  if (!fs.existsSync(inputs)) return;
  const used = new Set(allJobs().map((j) => j.inputs));
  for (const d of fs.readdirSync(inputs)) {
    const p = path.join(inputs, d);
    if (!used.has(p) && Date.now() - fs.statSync(p).mtimeMs > 3600_000) fs.rmSync(p, { recursive: true, force: true });
  }
}

function codeChanged() {
  try {
    const repo = path.dirname(HERE);
    execFileSync('git', ['-C', repo, 'fetch', '-q', 'origin', 'main'], { stdio: 'ignore', timeout: 60_000 });
    const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const up = execFileSync('git', ['-C', repo, 'rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
    return head !== up;
  } catch {
    return false;
  }
}

async function serve({ noPrint = false, noPull = false }) {
  fs.mkdirSync(JOBS, { recursive: true });
  // Прошлый исполнитель упал посреди прогона (cron держит одного, flock) — задание не завершится само
  for (const j of allJobs().filter((x) => x.state === 'running')) {
    seqCache.set(j.id, j.seq ?? 0);
    event(j.id, 'исполнитель перезапустился посреди прогона');
    finishJob(j.id, { state: 'error', error: 'исполнитель перезапустился посреди прогона — поставьте заново' });
  }
  writeJson(CURRENT, null);
  log(`исполнитель запущен (${QUEUE})`);
  let lastPrint = 0;
  let lastPull = Date.now();
  for (;;) {
    const next = queued()[0];
    if (next) {
      await runJob(next);
      prune();
      continue;
    }
    if (!noPrint && Date.now() - lastPrint > PRINT_EVERY) {
      lastPrint = Date.now();
      await runPrint();
      continue;
    }
    if (!noPull && Date.now() - lastPull > PULL_EVERY) {
      lastPull = Date.now();
      if (codeChanged()) {
        log('в origin/main новый код — выхожу, cron поднимет заново');
        return;
      }
    }
    await sleep(2000);
  }
}

// ---------------------------------------------------------------- CLI

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, ...argv] = process.argv.slice(2);
  const one = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const out = (v) => process.stdout.write(JSON.stringify(v) + '\n');
  const run = {
    serve: () => serve({ noPrint: argv.includes('--no-print'), noPull: argv.includes('--no-pull') }),
    add: async () => out(add(JSON.parse(fs.readFileSync(0, 'utf8')))),
    wait: async () =>
      out(
        await wait(argv[0], {
          since: Number(one('--since') ?? 0),
          timeout: Math.min(3600, Math.max(0, Number(one('--timeout') ?? 600))),
          until: one('--until') ?? null,
        }),
      ),
    list: async () =>
      out({
        current: readJson(CURRENT),
        jobs: allJobs()
          .slice(-20)
          .map((j) => ({ ...j, position: positionOf(j.id) })),
      }),
    log: async () => out(jobLog(argv[0], { grep: one('--grep') ?? null, tail: Number(one('--tail') ?? 80) })),
    cancel: async () => out(cancel(argv[0])),
  }[cmd];
  if (!run) {
    console.error('команда: serve | add | wait <id> | list | log <id> | cancel <id> (см. начало файла)');
    process.exit(2);
  }
  run().then(
    // process.exit сразу после write в канал (ssh) рвёт ответ на 64 КБ: выходим, когда stdout сброшен
    () => process.stdout.write('', () => process.exit(0)),
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
