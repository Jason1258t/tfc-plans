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
 *     jobs/<id>/logs/       — журналы серверного прогона (его папка в /dev/shm удаляется), rcon.txt / rcon.json —
 *                             полный протокол RCON, world/ — мир после прогона с --save-world
 *     jobs/<id>/cancel      — просьба отменить (кладёт cancel)
 *     inputs/<метка>/       — свои jar, оверлей, мир задания (заливает Mac, удаляются после прогона)
 *     current.json          — что идёт сейчас: задание или проверка печати
 *
 *   node scripts/stand-queue.mjs serve                 — исполнитель (cron: scripts/stand-queue.sh)
 *   node scripts/stand-queue.mjs add < job.json        — { kind: server|client, args, by, note, inputs, after, chain }
 *                                                         → { id, position }
 *
 * Цепочка (dev #356): задание с after=<id> ждёт, пока то кончится, и идёт только если оно прошло (done и код 0);
 * иначе снимается с пометкой. Флаг --world-job <id> в args заменяется на --world <мир, сохранённый тем заданием>
 * (серверное с --save-world — logs/world, клиентское — results/<id>/world): так шаг «рестарт» и клиент получают мир
 * прошлого шага без поездки через Mac.
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

import { installCode, freezeCode, describeInputs, verifyCode } from './stand-code.mjs';
import { selectSnapshot, verifySnapshot } from './stand-snapshot.mjs';
import { runtimeStatus, requireCurrentRuntime } from './stand-runtime.mjs';

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

/** Сводка в ответе wait — не больше стольких символов (начало + конец): с шапкой влезает в ответ MCP (fmt.mjs MAX) */
const SUMMARY_MAX = 14_000;
const SUMMARY_HEAD = 4_000;

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

/** SHA процесса исполнителя отдельно от HEAD checkout: git pull сам по себе код процесса не меняет. */
const LOADED_RUNTIME = runtimeStatus(path.dirname(HERE));
function queueRuntime(refresh = false) {
  const status = runtimeStatus(path.dirname(HERE), { refresh });
  const worker = readJson(path.join(QUEUE, 'worker.json'));
  let alive = false;
  if (worker?.pid) {
    try {
      process.kill(worker.pid, 0);
      alive = true;
    } catch {
      /* Исполнитель уже вышел. */
    }
  }
  status.worker = alive ? worker : null;
  if (alive && worker.head !== status.head) status.ok = false;
  return status;
}

// ---------------------------------------------------------------- команды для Mac

async function add(spec) {
  const runtime = requireCurrentRuntime(queueRuntime(true));
  if (!['server', 'client'].includes(spec?.kind)) throw new Error('kind: server | client');
  if (!Array.isArray(spec.args)) throw new Error('args — массив флагов стенда');
  const refs = [
    spec.after,
    spec.retryOf,
    ...spec.args.flatMap((a, i) => (a === '--world-job' ? [spec.args[i + 1]] : [])),
  ]
    .filter(Boolean)
    .map((id) => {
      const job = readJob(String(id));
      if (!job) throw new Error(`Нет исходного задания ${id}`);
      return job;
    });
  const snapshot = await selectSnapshot(refs, spec.snapshot);
  if (spec.retryOf) {
    const old = readJob(String(spec.retryOf));
    if (!old || !(old.state === 'error' || old.state === 'cancelled' || (old.state === 'done' && old.ok === false)))
      throw new Error('Повтор: исходное задание не является окончательно проваленным/отменённым');
    const existing = allJobs().find((j) => j.retryOf === old.id);
    if (existing)
      return {
        id: existing.id,
        position: positionOf(existing.id),
        current: readJson(CURRENT),
        runtime,
        snapshot: snapshot.id,
      };
    // mkdir атомарен между SSH-процессами; повторная доставка запроса не создаёт дубликат.
    fs.mkdirSync(path.join(jobDir(old.id), 'retry-claimed'));
  }
  fs.mkdirSync(JOBS, { recursive: true });
  const t = now().slice(0, 19).replace(/\D/g, '');
  const id = `${t.slice(0, 8)}-${t.slice(8)}-${randomBytes(2).toString('hex')}`;
  fs.mkdirSync(path.join(JOBS, id));
  const inputs = spec.inputs ? path.resolve(QUEUE, 'inputs', path.basename(String(spec.inputs))) : null;
  const after = spec.after ? String(spec.after) : null;
  if (after && !readJob(after)) throw new Error(`after: нет задания ${after}`);
  let savedRuntime;
  if (spec.code) {
    const code = fs.realpathSync(spec.code);
    if (!inputs || !code.startsWith(`${fs.realpathSync(inputs)}/`)) throw new Error('Runtime вне входов задания');
    savedRuntime = installCode(code, path.join(jobDir(id), 'runtime'), path.dirname(HERE));
  } else {
    const source = spec.retryOf ? readJob(String(spec.retryOf)) : after ? readJob(after) : null;
    if (source?.runtime?.sha256) {
      savedRuntime = installCode(
        path.join(jobDir(source.id), 'runtime'),
        path.join(jobDir(id), 'runtime'),
        path.dirname(HERE),
      );
      savedRuntime.source = source.runtime.source;
    } else {
      const frozen = freezeCode(path.dirname(HERE));
      try {
        savedRuntime = installCode(frozen.dir, path.join(jobDir(id), 'runtime'), path.dirname(HERE));
      } finally {
        fs.rmSync(frozen.dir, { recursive: true, force: true });
      }
      savedRuntime.source = 'main';
    }
  }
  const saved = updateJob(id, {
    id,
    snapshot,
    runtime: savedRuntime,
    kind: spec.kind,
    args: spec.args.map(String),
    inputFiles: describeInputs(spec.args.map(String)),
    by: String(spec.by ?? '?').slice(0, 60),
    note: String(spec.note ?? '').slice(0, 300),
    inputs,
    after,
    retryOf: spec.retryOf ?? null,
    chain: spec.chain ? String(spec.chain).slice(0, 120) : null,
    state: 'queued',
    createdAt: now(),
    seq: 0,
  });
  writeJson(path.join(jobDir(id), 'run-inputs.json'), {
    snapshot,
    runtime: savedRuntime,
    args: saved.args,
    inputFiles: saved.inputFiles,
  });
  return { id, position: positionOf(id), current: readJson(CURRENT), runtime: savedRuntime, snapshot: snapshot.id };
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

function safeLogFile(file, roots) {
  if (!fs.existsSync(file)) return null;
  const real = fs.realpathSync(file);
  if (
    !roots.some((root) => {
      const rel = path.relative(fs.realpathSync(root), real);
      return rel && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel);
    })
  )
    throw new Error('журнал находится вне папки стенда');
  if (!fs.statSync(real).isFile()) throw new Error('журнал не является файлом');
  return real;
}

function jobLog(id, { grep = null, tail = 80, source = 'wrapper' }) {
  const job = readJob(id);
  if (!job) throw new Error(`нет задания ${id}`);
  if (!['wrapper', 'client', 'latest'].includes(source)) throw new Error('источник: wrapper | client | latest');
  if (!Number.isFinite(tail)) throw new Error('tail должен быть числом');
  if (grep && grep.length > 300) throw new Error('grep: не больше 300 символов');
  const roots = [jobDir(id)];
  let file = path.join(jobDir(id), 'output.log');
  if (source !== 'wrapper') {
    const name = source === 'client' ? 'client.log' : 'latest.log';
    if (job.kind !== 'client' && source === 'client') throw new Error('client.log доступен только клиентскому заданию');
    if (job.kind === 'client') {
      const stand = path.resolve(
        process.env.TFC_CLIENT_STAND ?? path.join(os.homedir(), '.cache', 'tfc-plans', 'client-stand'),
      );
      for (const dir of ['runs', 'results'])
        if (fs.existsSync(path.join(stand, dir))) roots.push(path.join(stand, dir));
      if (FINAL.has(job.state)) file = job.result ? path.join(job.result, name) : null;
      else {
        // Только прогон с меткой этого задания; соседние и старые прогоны не подходят.
        const dirs = fs.existsSync(path.join(stand, 'runs'))
          ? fs
              .readdirSync(path.join(stand, 'runs'))
              .filter((n) => ID_RE.test(n))
              .map((n) => path.join(stand, 'runs', n))
          : [];
        if (fs.existsSync('/dev/shm')) {
          for (const n of fs.readdirSync('/dev/shm').filter((n) => /^tfc-client-\d{8}-\d{6}-[0-9a-f]{4}$/.test(n))) {
            const dir = path.join('/dev/shm', n);
            if (fs.lstatSync(dir).isDirectory()) {
              dirs.push(dir);
              roots.push(dir);
            }
          }
        }
        const run = dirs.find((dir) => readJson(path.join(dir, 'stand.json'))?.queueJob === id);
        file = run ? path.join(run, source === 'client' ? 'client.log' : 'game/logs/latest.log') : null;
        // Клиент уже собрал результат, но оболочка очереди ещё не завершилась.
        if (run && !fs.existsSync(file)) {
          const out = readJson(path.join(run, 'stand.json'))?.out;
          if (out) file = path.join(out, name);
        }
      }
    } else {
      file = FINAL.has(job.state)
        ? path.join(jobDir(id), 'logs', name)
        : job.minecraftRun
          ? path.join(job.minecraftRun, 'logs', name)
          : null;
      if (job.minecraftRun && fs.existsSync(job.minecraftRun)) roots.push(job.minecraftRun);
    }
  }
  const checked = file && safeLogFile(file, roots);
  if (!checked) return { source, available: false, total: 0, lines: [] };
  // Читаем ограниченный хвост, а не многогигабайтный журнал целиком.
  const fd = fs.openSync(checked, 'r');
  let text, truncated;
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - 2 * 1024 * 1024);
    const buf = Buffer.alloc(size - start);
    const bytes = fs.readSync(fd, buf, 0, buf.length, start);
    text = buf.subarray(0, bytes).toString('utf8');
    truncated = start > 0;
    if (truncated) text = text.slice(text.indexOf('\n') + 1);
  } finally {
    fs.closeSync(fd);
  }
  let rows = text.split('\n');
  if (rows.at(-1) === '') rows.pop();
  if (grep) {
    const re = new RegExp(grep, 'i');
    rows = rows.filter((l) => re.test(l));
  }
  const n = Math.min(400, Math.max(1, Math.trunc(tail)));
  return { source, available: true, truncated, total: rows.length, lines: rows.slice(-n).map((l) => l.slice(0, 400)) };
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

/** Кеш только для этого manifest; переиспользуем его лишь после полной проверки байтов. */
async function ensurePack(id, snapshot) {
  if (!snapshot) throw new Error('Нет закреплённого снимка: поставьте новый прогон');
  const base = path.join(QUEUE, 'packs');
  const dir = path.join(base, snapshot.sha256);
  if (verifySnapshot(dir, snapshot)) return dir;
  fs.mkdirSync(base, { recursive: true });
  const staging = fs.mkdtempSync(path.join(base, '.fetch-'));
  try {
    event(id, `подтягиваю закреплённый снимок ${snapshot.id}`);
    const { fetchPack } = await import('./pack-fetch.mjs');
    const { PACK_CACHE } = await import('./pack-cache.mjs');
    await fetchPack({
      into: staging,
      snapshot: snapshot.id,
      manifest: snapshot.manifest,
      seedRoot: PACK_CACHE,
      copySeeds: true,
      onLog: (...parts) => event(id, parts.join(' ')),
    });
    if (!verifySnapshot(staging, snapshot)) throw new Error('Байты сборки не совпали с закреплённым manifest');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(staging, dir);
    return dir;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
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

/** Шаг прошёл: кончился штатно с кодом 0 */
const passed = (j) => j?.state === 'done' && j.ok !== false;

/**
 * Следующее задание к запуску: первое в очереди, чей предыдущий шаг (after) кончился. Шаг после провала снимается.
 */
function nextJob() {
  for (const j of queued()) {
    if (!j.after) return j;
    const prev = readJob(j.after);
    if (prev && !FINAL.has(prev.state)) continue;
    if (passed(prev)) return j;
    seqCache.set(j.id, j.seq ?? 0);
    const why = prev
      ? `предыдущий шаг ${prev.id} не прошёл (${prev.state}${prev.ok === false ? `, код ${prev.code}` : ''}${prev.error ? `: ${prev.error}` : ''})`
      : `предыдущего шага ${j.after} нет`;
    event(j.id, `снято: ${why}`);
    finishJob(j.id, { state: 'cancelled', error: why });
  }
  return null;
}

/** --world-job <id> → --world <мир того задания> */
function resolveArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--world-job') {
      out.push(args[i]);
      continue;
    }
    const id = args[++i];
    const prev = readJob(id);
    if (!prev?.world || !fs.existsSync(path.join(prev.world, 'level.dat')))
      throw new Error(`--world-job ${id}: у задания нет сохранённого мира (нужен --save-world)`);
    out.push('--world', prev.world);
  }
  return out;
}

/** Мир прогона → dest без session.lock */
function copyWorld(from, dest) {
  fs.cpSync(from, dest, { recursive: true });
  fs.rmSync(path.join(dest, 'session.lock'), { force: true });
  return dest;
}

/** Сколько секунд прогон может идти: его --timeout + запас на загрузку, снимки и выход */
function hardLimit(args) {
  const i = args.lastIndexOf('--timeout');
  const t = i >= 0 ? Number(args[i + 1]) || 900 : 900;
  const u = args.lastIndexOf('--until-timeout');
  return t + (u >= 0 ? Number(args[u + 1]) || 0 : 0) + 1200;
}

async function runServer(id, job, cache) {
  const { stageShm } = await import('./stand-shm.mjs');
  const staged = stageShm(SERVER_STAND, { prefix: 'tfc-queue.', cache });
  const codeRoot = job.runtime?.sha256 ? path.join(jobDir(id), 'runtime/scripts') : HERE;
  let summary = '';
  updateJob(id, { minecraftRun: path.join(staged.stand, 'run') });
  try {
    if (staged.stand !== SERVER_STAND) event(id, 'снимок и NeoForge скопированы в /dev/shm');
    const code = await runChild(id, [path.join(codeRoot, 'pack-stand.mjs'), ...resolveArgs(job.args)], {
      env: { TFC_PACK_CACHE: staged.pack, TFC_STAND_DIR: staged.stand },
      hardSec: hardLimit(job.args),
      onStdout: (l) => (summary += `${l}\n`),
    });
    // Журналы из /dev/shm — в папку задания, пока их не убрали
    const run = path.join(staged.stand, 'run');
    const keep = path.join(jobDir(id), 'logs');
    const rels = ['logs/latest.log', 'logs/debug.log', 'logs/kubejs', 'crash-reports', 'scenario.json'];
    for (const rel of [...rels, 'rcon.txt', 'rcon.json'])
      if (fs.existsSync(path.join(run, rel)))
        fs.cpSync(path.join(run, rel), path.join(keep, path.basename(rel)), { recursive: true });
    // Мир — артефакт задания: из него следующий шаг цепочки (--world-job), его же забирает Mac
    let world = null;
    // Только мир, который стенд сам признал сохранённым: у упавшего сервера в run/world — входной мир
    if (job.args.includes('--save-world') && /^мир сохранён: /m.test(summary)) {
      world = copyWorld(path.join(run, 'world'), path.join(keep, 'world'));
      event(id, 'мир прогона сохранён в задании');
    }
    summary = summary.replaceAll(path.join(run, 'world'), path.join(keep, 'world')).replaceAll(run, '<прогон>');
    return { code, summary, result: fs.existsSync(keep) ? keep : null, world };
  } finally {
    staged.clean();
  }
}

async function runClientJob(id, job, cache) {
  let summary = '';
  let result = null;
  const codeRoot = job.runtime?.sha256 ? path.join(jobDir(id), 'runtime/scripts') : HERE;
  const code = await runChild(
    id,
    [path.join(codeRoot, 'client-stand.mjs'), 'run', ...resolveArgs(job.args), '--stdin-watch'],
    {
      stdinWatch: true,
      env: { TFC_STAND_QUEUE_JOB: id, TFC_PACK_CACHE: cache },
      hardSec: hardLimit(job.args),
      onStdout: (l) => {
        const m = /^RESULT (.+)$/.exec(l);
        if (m) result = m[1].trim();
        else summary += `${l}\n`;
      },
    },
  );
  const world = result && fs.existsSync(path.join(result, 'world', 'level.dat')) ? path.join(result, 'world') : null;
  return { code, summary, result, world };
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
    if (JSON.stringify(describeInputs(job.args)) !== JSON.stringify(job.inputFiles))
      throw new Error('Входы задания изменились после постановки');
    verifyCode(path.join(jobDir(id), 'runtime'), job.runtime, path.dirname(HERE));
    const cache = await ensurePack(id, job.snapshot);
    writeJson(path.join(jobDir(id), 'run-inputs.json'), {
      snapshot: job.snapshot,
      runtime: job.runtime,
      args: job.args,
      inputFiles: job.inputFiles,
    });
    event(id, `запускаю ${job.kind === 'server' ? 'серверный' : 'клиентский'} стенд`);
    const r = job.kind === 'server' ? await runServer(id, job, cache) : await runClientJob(id, job, cache);
    if (r.result) fs.copyFileSync(path.join(jobDir(id), 'run-inputs.json'), path.join(r.result, 'run-inputs.json'));
    const summary = `Закреплённый снимок: ${job.snapshot.id}; manifest SHA256 ${job.snapshot.sha256}; runtime ${job.runtime?.head} (${job.runtime?.source}, SHA256 ${job.runtime?.sha256 ?? LOADED_RUNTIME.head})\n${r.summary.trim()}`;
    fs.writeFileSync(path.join(jobDir(id), 'summary.txt'), `${summary}\n`);
    const state = r.code === 'cancelled' ? 'cancelled' : r.summary.trim() ? 'done' : 'error';
    finishJob(id, {
      state,
      code: r.code,
      ok: r.code === 0,
      result: r.result,
      world: r.world ?? null,
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
  const packs = path.join(QUEUE, 'packs');
  const usedPacks = new Set(allJobs().map((j) => j.snapshot?.sha256));
  if (fs.existsSync(packs))
    for (const name of fs.readdirSync(packs))
      if (!usedPacks.has(name)) fs.rmSync(path.join(packs, name), { recursive: true, force: true });
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
  writeJson(path.join(QUEUE, 'worker.json'), { pid: process.pid, head: LOADED_RUNTIME.head, startedAt: now() });
  log(`исполнитель запущен (${QUEUE})`);
  let lastPrint = 0;
  let lastPull = Date.now();
  for (;;) {
    const runtime = noPull ? null : runtimeStatus(path.dirname(HERE));
    if (runtime && (!runtime.ok || runtime.head !== LOADED_RUNTIME.head)) {
      log('checkout обновлён — выхожу перед следующим заданием');
      return;
    }
    const next = nextJob();
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
    runtime: async () => out(queueRuntime(true)),
    add: async () => out(await add(JSON.parse(fs.readFileSync(0, 'utf8')))),
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
        runtime: queueRuntime(true),
        jobs: allJobs()
          .slice(-20)
          .map((j) => ({ ...j, position: positionOf(j.id) })),
      }),
    log: async () =>
      out(
        jobLog(argv[0], {
          grep: one('--grep') ?? null,
          tail: Number(one('--tail') ?? 80),
          source: one('--source') ?? 'wrapper',
        }),
      ),
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
