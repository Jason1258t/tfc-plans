/** Самостоятельная последовательная очередь. Только служба меняет состояние; Unix socket — единый control API. */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ArtifactStore } from './store.mjs';
import { jobClosure } from './bundle.mjs';
import { checkJob } from './job.mjs';
import { digest } from './passport.mjs';
import { installedIdentity } from './identity.mjs';
import { processIdentity, processAlive, recordProcess } from './process-identity.mjs';
import { workerRequest } from './queue-client.mjs';

export const QUEUE_ID = /^stand-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TERMINAL = new Set(['done', 'error', 'cancelled']);
const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const now = () => new Date().toISOString();
const readJSON = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
async function saveJSON(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
async function bodyJSON(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error('Запрос worker слишком большой');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function existing(file) {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function serveQueue({ root, worker, socket = path.join(root, 'worker.sock'), signal }) {
  root = path.resolve(root);
  socket = path.resolve(socket);
  if (Buffer.byteLength(socket) > 100) throw new Error('Путь Unix socket должен быть короче 101 байта');
  if (
    !Number.isSafeInteger(worker?.memoryMiB) ||
    worker.memoryMiB < 1 ||
    !Array.isArray(worker.capabilities) ||
    worker.capabilities.some((c) => typeof c !== 'string')
  )
    throw new Error('Некорректная конфигурация ресурсов worker');
  const jobsRoot = path.join(root, 'jobs');
  await fs.mkdir(jobsRoot, { recursive: true, mode: 0o700 });
  const store = new ArtifactStore(path.join(root, 'store'));
  await store.init();
  const identity = await installedIdentity();
  worker = { ...worker, identity: { ...identity, protocolVersion: 1 } };
  const jobs = new Map(),
    keys = new Map();
  const changes = new EventEmitter();
  changes.setMaxListeners(0);
  let serialWork = Promise.resolve(),
    active = null,
    pumping = null,
    stopping = false,
    ready = false,
    wakeStop = null,
    lastNumber = 0;
  const serial = (fn) => {
    const task = serialWork.then(fn);
    serialWork = task.catch(() => {});
    return task;
  };
  const dir = (id) => {
    if (!QUEUE_ID.test(id)) throw new Error('Некорректный id задания');
    return path.join(jobsRoot, id);
  };
  const get = (id) => {
    const job = jobs.get(id);
    if (!job) throw new Error(`Нет задания ${id}`);
    return job;
  };
  const persist = (job) => saveJSON(path.join(dir(job.id), 'job.json'), job);
  const notify = () => changes.emit('change');
  const response = (reply, value, status = 200) => {
    if (!reply.destroyed && !reply.writableEnded) {
      reply.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      reply.end(JSON.stringify(value));
    }
  };
  const view = async (job, since = 0) => ({
    job: { ...job },
    events: (job.events ?? []).filter((e) => e.seq > since),
    seq: job.seq ?? 0,
    position:
      job.state === 'queued'
        ? [...jobs.values()].filter((j) => j.state === 'queued').findIndex((j) => j.id === job.id) + 1
        : 0,
  });
  const recordOutput = (job, runId) => {
    if (typeof runId !== 'string' || !runId.startsWith(`${job.name}-`) || /[/\\]/.test(runId) || runId.includes('..'))
      throw new Error('Неверный runId исполнителя');
    job.runId = runId;
    job.output = path.join(dir(job.id), 'results', runId);
  };
  const childRun = (job) =>
    new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          CLI,
          'run',
          job.ref.sha256,
          '--store',
          store.root,
          '--work',
          path.join(dir(job.id), 'work'),
          '--out',
          path.join(dir(job.id), 'results'),
          '--worker',
          path.join(root, 'worker.json'),
          '--watch-stdin',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      active = { job, child };
      // Сохраняем identity до обработки следующего управляющего запроса.
      try {
        if (!Number.isSafeInteger(child.pid)) throw new Error('Не удалось создать процесс исполнителя');
        recordProcess(path.join(dir(job.id), 'runner.json'), child.pid);
      } catch (error) {
        child.stdin.end();
        job.launchError = error.message;
      }
      if (job.cancelRequested || stopping || job.launchError) child.stdin.end();
      else child.stdin.write('START\n');
      child.stdin.on('error', () => {});
      let stdout = '',
        stderr = '',
        pending = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
        if (stdout.length > 16 * 1024 * 1024) {
          job.launchError = 'Слишком большой ответ исполнителя';
          stdout = '';
          child.stdin.end();
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-65536);
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop().slice(-65536);
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (!Number.isSafeInteger(event.seq) || !event.stage) continue;
            recordOutput(job, event.runId);
            job.seq = event.seq;
            job.stage = event.stage;
            job.events = [...(job.events ?? []), event].slice(-100);
            notify();
          } catch {
            /* Диагностика, не событие. */
          }
        }
      });
      child.on('error', (error) => {
        job.launchError = error.message;
      });
      child.on('close', (code, sig) => {
        let result = null;
        try {
          result = JSON.parse(stdout.trim());
        } catch {
          /* Ошибка до создания результата. */
        }
        resolve({
          code,
          signal: sig,
          result,
          error: job.launchError ?? (result ? null : stderr.trim() || `Исполнитель завершён: ${code ?? sig}`),
        });
      });
    });
  const pump = async () => {
    while (!stopping) {
      const job = await serial(async () => {
        const next = [...jobs.values()].find((j) => j.state === 'queued');
        if (!next) return null;
        const patch = { state: 'running', startedAt: now() };
        await persist({ ...next, ...patch });
        Object.assign(next, patch);
        notify();
        return next;
      });
      if (!job) return;
      const outcome = await childRun(job);
      await serial(async () => {
        if (outcome.result?.result && outcome.result.output) {
          recordOutput(job, outcome.result.result.runId);
          job.verdict = outcome.result.result.verdict;
          job.resultFile = path.join(job.output, 'result.json');
        }
        const patch = {
          state: job.cancelRequested || stopping ? 'cancelled' : outcome.error ? 'error' : 'done',
          error: outcome.error,
          finishedAt: now(),
          code: outcome.code,
          signal: outcome.signal,
          verdict: job.cancelRequested || stopping || outcome.error ? 'failed' : (job.verdict ?? 'unknown'),
        };
        await persist({ ...job, ...patch });
        Object.assign(job, patch);
        active = null;
        notify();
      });
    }
  };
  const kick = () => {
    if (pumping || stopping) return;
    pumping = pump()
      .catch((error) => {
        stopping = true;
        process.stderr.write(`Ошибка очереди: ${error.message}\n`);
        notify();
        wakeStop?.();
      })
      .finally(() => {
        pumping = null;
        if (!stopping && [...jobs.values()].some((j) => j.state === 'queued')) kick();
      });
  };
  const submit = async (spec, retryOf = null) =>
    serial(async () => {
      if (stopping) throw new Error('Worker останавливается');
      if (typeof spec.key !== 'string' || !spec.key.trim() || spec.key.length > 200)
        throw new Error('Нужен ключ запроса длиной 1…200 символов');
      const ref = retryOf ? get(retryOf).ref : spec.ref;
      const requestHash = digest({
        ref,
        retryOf,
        note: String(spec.note ?? '').slice(0, 300),
        by: String(spec.by ?? '').slice(0, 60),
      });
      const previous = keys.get(spec.key);
      if (previous) {
        if (previous.requestHash !== requestHash) throw new Error('Ключ запроса уже связан с другими входами');
        return view(previous);
      }
      if (
        retryOf &&
        (!TERMINAL.has(get(retryOf).state) || (get(retryOf).state === 'done' && get(retryOf).verdict === 'passed'))
      )
        throw new Error('Повтор разрешён только для окончательно проваленного или отменённого задания');
      const declaration = checkJob(await store.json(ref));
      if (declaration.runner.sha256 !== identity.sha256 || declaration.runner.version !== identity.version)
        throw new Error('Нужна другая установленная версия runner');
      await jobClosure(declaration, store);
      const job = {
        schemaVersion: 1,
        worker: identity,
        id: `stand-${randomUUID()}`,
        number: ++lastNumber,
        name: declaration.id,
        ref,
        key: spec.key,
        requestHash,
        retryOf,
        note: String(spec.note ?? '').slice(0, 300),
        by: String(spec.by ?? '').slice(0, 60),
        steps: declaration.steps.map((s) => ({ id: s.id, kind: s.kind })),
        state: 'queued',
        createdAt: now(),
        seq: 0,
        events: [],
      };
      await fs.mkdir(dir(job.id));
      await persist(job);
      jobs.set(job.id, job);
      keys.set(job.key, job);
      kick();
      notify();
      return view(job);
    });
  const cancel = (id) =>
    serial(async () => {
      const job = get(id);
      if (TERMINAL.has(job.state)) return view(job);
      const patch = {
        cancelRequested: true,
        ...(job.state === 'queued'
          ? { state: 'cancelled', verdict: 'failed', error: 'Отменено до запуска', finishedAt: now() }
          : {}),
      };
      await persist({ ...job, ...patch });
      Object.assign(job, patch);
      if (active?.job.id === id) active.child.stdin.end();
      notify();
      return view(job);
    });
  const wait = async (job, query, reply) => {
    const since = Number(query.get('since') ?? 0),
      seconds = Number(query.get('timeout') ?? 600);
    if (!Number.isSafeInteger(since) || since < 0 || !Number.isFinite(seconds) || seconds < 0 || seconds > 3600)
      throw new Error('Некорректные параметры ожидания');
    const until = query.get('until');
    if (until && until.length > 300) throw new Error('until: не больше 300 символов');
    const regex = until ? new RegExp(until) : null;
    await new Promise((resolve) => {
      let timer,
        finished = false;
      const finish = async (reason) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        changes.off('change', check);
        reply.off('close', disconnect);
        response(reply, { ...(await view(job, since)), reason });
        resolve();
      };
      const check = () => {
        if (TERMINAL.has(job.state)) void finish('final');
        else if (stopping) void finish('shutdown');
        else if (regex && (job.events ?? []).some((e) => e.seq > since && regex.test(JSON.stringify(e))))
          void finish('until');
      };
      const disconnect = () => {
        finished = true;
        clearTimeout(timer);
        changes.off('change', check);
        resolve();
      };
      changes.on('change', check);
      reply.once('close', disconnect);
      timer = setTimeout(() => void finish('timeout'), seconds * 1000);
      check();
    });
  };
  const log = async (job, query) => {
    const stream = query.get('stream') ?? 'events',
      step = query.get('step'),
      tail = Number(query.get('tail') ?? 80);
    if (
      !['stdout', 'stderr', 'events', 'latest'].includes(stream) ||
      !Number.isSafeInteger(tail) ||
      tail < 1 ||
      tail > 400
    )
      throw new Error('Некорректный источник или размер журнала');
    if (stream !== 'events' && !job.steps.some((s) => s.id === step)) throw new Error('Нужен step из задания');
    if (!job.output) return { available: false, lines: [] };
    const file =
      stream === 'events'
        ? path.join(job.output, 'events.jsonl')
        : path.join(job.output, step, stream === 'latest' ? 'logs/latest.log' : `${stream}.log`);
    if (!(await existing(file))) return { available: false, lines: [] };
    const real = await fs.realpath(file),
      relative = path.relative(await fs.realpath(dir(job.id)), real);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Журнал вне задания');
    const handle = await fs.open(real, 'r');
    try {
      const size = (await handle.stat()).size,
        start = Math.max(0, size - 2 * 1024 * 1024);
      const buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.length, start);
      let text = buffer.toString('utf8');
      if (start) text = text.slice(text.indexOf('\n') + 1);
      const lines = text.trimEnd().split('\n');
      return { available: true, truncated: start > 0, lines: lines.slice(-tail).map((line) => line.slice(0, 1000)) };
    } finally {
      await handle.close();
    }
  };
  const server = http.createServer((request, reply) => {
    void (async () => {
      const url = new URL(request.url, 'http://worker');
      if (url.pathname === '/health' && request.method === 'GET')
        return response(reply, {
          protocolVersion: 1,
          root,
          storeRoot: store.root,
          socket,
          identity,
          process: processIdentity(),
          ready,
          stopping,
          current: active?.job.id ?? null,
        });
      if (!ready) throw new Error('Worker ещё инициализируется');
      if (url.pathname === '/jobs' && request.method === 'GET')
        return response(reply, { jobs: [...jobs.values()].slice(-100), current: active?.job.id ?? null, identity });
      if (url.pathname === '/jobs' && request.method === 'POST')
        return response(reply, await submit(await bodyJSON(request)));
      const match = /^\/jobs\/(stand-[a-f0-9-]+)(?:\/(wait|cancel|retry|log))?$/.exec(url.pathname);
      if (!match) throw new Error('Неизвестный запрос worker');
      const job = get(match[1]),
        action = match[2];
      if (!action && request.method === 'GET') return response(reply, await view(job));
      if (action === 'wait' && request.method === 'GET') return wait(job, url.searchParams, reply);
      if (action === 'log' && request.method === 'GET') return response(reply, await log(job, url.searchParams));
      if (action === 'cancel' && request.method === 'POST') return response(reply, await cancel(job.id));
      if (action === 'retry' && request.method === 'POST')
        return response(reply, await submit(await bodyJSON(request), job.id));
      throw new Error('Неизвестная команда worker');
    })().catch((error) => response(reply, { error: error.message }, 400));
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1000;
  const startup = path.join(root, 'startup.lock');
  await fs.mkdir(startup);
  let listening = false,
    startupHeld = true;
  try {
    await saveJSON(path.join(startup, 'owner.json'), processIdentity());
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socket, resolve);
    });
    listening = true;
    await fs.chmod(socket, 0o600);
    const loaded = [];
    for (const id of (await fs.readdir(jobsRoot)).filter((name) => QUEUE_ID.test(name)).sort()) {
      const job = await readJSON(path.join(dir(id), 'job.json'));
      if (job.id !== id || !job.key || !job.ref) throw new Error(`Повреждено задание ${id}`);
      if (job.state === 'running') {
        const runnerFile = path.join(dir(id), 'runner.json');
        const owner = (await existing(runnerFile)) ? await readJSON(runnerFile) : null;
        // Без записи runner gate START ещё не мог быть отправлен: JVM не запускалась.
        if (owner && processAlive(owner))
          throw new Error(`Предыдущий исполнитель ${id} ещё работает; дождитесь его остановки`);
        const resultsRoot = path.join(dir(id), 'results');
        if (await existing(resultsRoot))
          for (const name of await fs.readdir(resultsRoot)) {
            const passportFile = path.join(resultsRoot, name, 'passport.json');
            if (await existing(passportFile)) {
              recordOutput(job, (await readJSON(passportFile)).runId);
              const resultFile = path.join(job.output, 'result.json');
              if (await existing(resultFile)) {
                job.resultFile = resultFile;
                job.verdict = (await readJSON(resultFile)).verdict;
              }
            }
          }
        // Потомки JVM отдельно записаны самим runner.
        const inspect = async (base) => {
          if (!(await existing(base))) return;
          for (const entry of await fs.readdir(base, { withFileTypes: true })) {
            const file = path.join(base, entry.name);
            if (entry.isDirectory()) await inspect(file);
            else if (entry.name === 'process.json' && processAlive(await readJSON(file)))
              throw new Error(`Процесс задания ${id} ещё работает`);
          }
        };
        await inspect(path.join(dir(id), 'results'));
        job.state = 'error';
        job.verdict = 'failed';
        job.error = 'Worker прервался; повтор использует те же входы';
        job.finishedAt = now();
        await fs.rm(path.join(dir(id), 'work'), { recursive: true, force: true });
        await persist(job);
      }
      loaded.push(job);
    }
    for (const job of loaded.sort(
      (a, b) => (a.number ?? 0) - (b.number ?? 0) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )) {
      jobs.set(job.id, job);
      keys.set(job.key, job);
      lastNumber = Math.max(lastNumber, job.number ?? 0);
    }
    await saveJSON(path.join(root, 'worker.json'), worker);
    await saveJSON(path.join(root, 'owner.json'), processIdentity());
    ready = true;
    await fs.rm(startup, { recursive: true });
    startupHeld = false;
    kick();
    await new Promise((resolve) => {
      wakeStop = resolve;
      const stop = () => {
        stopping = true;
        active?.child.stdin.end();
        notify();
        resolve();
      };
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      server.once('close', resolve);
    });
    if (pumping) await pumping;
    await serialWork;
  } finally {
    stopping = true;
    active?.child.stdin.end();
    notify();
    if (listening) {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    }
    if (startupHeld) await fs.rm(startup, { recursive: true, force: true });
  }
}

/** Явное удаление аварийного socket только после проверки старого владельца; живые задания проверит serve. */
export async function recoverSocket(root, socket = path.join(root, 'worker.sock')) {
  root = path.resolve(root);
  socket = path.resolve(socket);
  const lock = path.join(root, 'recovery.lock');
  await fs.mkdir(lock);
  await saveJSON(path.join(lock, 'owner.json'), processIdentity());
  const startup = path.join(root, 'startup.lock');
  let acquired = false,
    verifiedStartupOwner = false;
  try {
    if (await existing(startup)) {
      if (processAlive(await readJSON(path.join(startup, 'owner.json')))) throw new Error('Worker ещё запускается');
      verifiedStartupOwner = true;
      await fs.rm(startup, { recursive: true });
    }
    await fs.mkdir(startup);
    acquired = true;
    await saveJSON(path.join(startup, 'owner.json'), processIdentity());
    try {
      await workerRequest(socket, { timeoutSeconds: 0 });
      throw new Error('Socket обслуживает живой worker');
    } catch (error) {
      if (!['ECONNREFUSED', 'ENOENT'].includes(error.code)) throw error;
    }
    const ownerFile = path.join(root, 'owner.json');
    if (await existing(ownerFile)) {
      if (processAlive(await readJSON(ownerFile))) throw new Error('Предыдущий worker ещё жив');
    } else if (!verifiedStartupOwner) throw new Error('Нет подтверждённого владельца аварийного socket');
    const st = await existing(socket);
    if (st && !st.isSocket()) throw new Error('Вместо socket находится другой файл');
    if (st) await fs.unlink(socket);
    return { сообщение: 'Аварийный socket убран; запустите worker' };
  } finally {
    if (acquired) await fs.rm(startup, { recursive: true, force: true });
    await fs.rm(lock, { recursive: true });
  }
}
