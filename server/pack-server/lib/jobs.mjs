/**
 * Задания сборки данных сайта и публикации. Очередь, один запуск за раз; каждое задание — отдельный процесс
 * (worker.mjs из копии репозитория): сборке модов нужно под гигабайт памяти, и если её убьёт OOM, сервер
 * продолжит отвечать. Раскладка <DATA_DIR>:
 *   jobs/<id>.json         — задание: { id, kind, snapshot, parts, pull, publish, by, state, … }
 *   jobs/<id>.log          — вывод сборки
 *   jobs/<id>.result.json  — итог от процесса (что собрано, отчёт публикации)
 *   repo/                  — своя копия репозитория (код разборщиков), если сервер не запущен из репозитория
 *   work/, cache/, data/   — их ведёт worker.mjs
 * kind: build — собрать (и, если publish не none, опубликовать), publish — только опубликовать собранное.
 * publish: none | dry-run | live.
 */
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { HttpError, readJson, writeJsonAtomic } from './util.mjs';

const JOB_ID_RE = /^j\d{8}-\d{6}-[0-9a-f]{4}$/;
export const PARTS = ['mods', 'kubejs', 'config', 'world'];
export const PUBLISH = ['none', 'dry-run', 'live'];

export function openJobs(dataDir, { repoDir, managedRepo, repoUrl, repoBranch, heapMb, timeoutMs }) {
  const jobsDir = path.join(dataDir, 'jobs');
  fs.mkdirSync(jobsDir, { recursive: true });
  const file = (id, ext) => path.join(jobsDir, `${id}${ext}`);

  /** id → задание; старые читаются с диска при старте */
  const jobs = new Map();
  for (const n of fs.readdirSync(jobsDir)) {
    if (!/^j.*\.json$/.test(n) || n.endsWith('.result.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(jobsDir, n), 'utf8'));
      if (j.state === 'running' || j.state === 'queued') {
        // Сервер перезапустили посреди сборки — задание не доделано, повторять молча не будем
        j.state = 'failed';
        j.error = 'прервано перезапуском сервера';
        j.finishedAt = new Date().toISOString();
        fs.writeFileSync(path.join(jobsDir, n), JSON.stringify(j, null, 1));
      }
      jobs.set(j.id, j);
    } catch (e) {
      console.warn(`Пропускаю повреждённое задание ${n}: ${e.message}`);
    }
  }

  const queue = [];
  let running = null;

  const save = (j) => writeJsonAtomic(file(j.id, '.json'), j);
  const appendLog = (j, text) => fs.appendFileSync(file(j.id, '.log'), text);

  function newId() {
    const d = new Date().toISOString().replace(/\D/g, '');
    for (;;) {
      const id = `j${d.slice(0, 8)}-${d.slice(8, 14)}-${randomBytes(2).toString('hex')}`;
      if (!jobs.has(id)) return id;
    }
  }

  /** Команда с выводом в лог задания; отказ — исключение */
  function run(j, cmd, args, opts = {}) {
    appendLog(j, `$ ${cmd} ${args.join(' ')}\n`);
    return new Promise((ok, fail) => {
      const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
      p.stdout.on('data', (c) => appendLog(j, c));
      p.stderr.on('data', (c) => appendLog(j, c));
      p.on('error', fail);
      p.on('close', (code, sig) => (code === 0 ? ok() : fail(new Error(`${cmd}: код ${code ?? sig}`))));
    });
  }
  const output = (cmd, args, cwd) =>
    new Promise((ok, fail) =>
      execFile(cmd, args, { cwd, encoding: 'utf8' }, (e, out) => (e ? fail(e) : ok(out.trim()))),
    );

  /** Код разборщиков: git pull своей копии и npm ci, если поменялся package-lock.json */
  async function prepareRepo(j) {
    const hasRepo = fs.existsSync(path.join(repoDir, 'scripts', 'pack.mjs'));
    if (!managedRepo) {
      if (!hasRepo) throw new Error(`в ${repoDir} нет scripts/pack.mjs — укажите REPO_DIR`);
      if (j.pull) appendLog(j, `git pull пропущен: ${repoDir} — рабочая копия разработчика, а не копия сервера\n`);
    } else {
      if (!fs.existsSync(path.join(repoDir, '.git'))) {
        await fsp.rm(repoDir, { recursive: true, force: true });
        await run(j, 'git', ['clone', '--depth', '1', '--branch', repoBranch, repoUrl, repoDir]);
      } else if (j.pull) {
        await run(j, 'git', ['-C', repoDir, 'fetch', '--depth', '1', 'origin', repoBranch]);
        await run(j, 'git', ['-C', repoDir, 'reset', '--hard', 'FETCH_HEAD']);
      }
      const lock = path.join(repoDir, 'package-lock.json');
      const stamp = path.join(repoDir, 'node_modules', '.tfc-lock-sha');
      const sha = createHash('sha256').update(fs.readFileSync(lock)).digest('hex');
      if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== sha) {
        await run(j, 'npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: repoDir });
        fs.writeFileSync(stamp, sha);
      }
    }
    j.commit = await output('git', ['-C', repoDir, 'log', '-1', '--format=%h %s']).catch(() => null);
    if (j.commit) appendLog(j, `код: ${j.commit}\n`);
  }

  /** Сам процесс сборки/публикации: worker.mjs из копии репозитория */
  async function runWorker(j) {
    const worker = path.join(repoDir, 'server', 'pack-server', 'worker.mjs');
    if (!fs.existsSync(worker)) throw new Error(`нет ${worker} — код в REPO_DIR старее сервера (нужен git pull)`);
    const spec = file(j.id, '.spec.json');
    await writeJsonAtomic(spec, { ...j, dataDir });
    const args = [...(heapMb ? [`--max-old-space-size=${heapMb}`] : []), worker, spec];
    const resultFile = file(j.id, '.result.json');
    try {
      await new Promise((ok, fail) => {
        appendLog(j, `$ node ${args.join(' ')}\n`);
        const p = spawn(process.execPath, args, {
          cwd: repoDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, TFC_NICK: `${j.by} (сервер сборки)`, NODE_NO_WARNINGS: '1' },
        });
        const timer = setTimeout(() => {
          appendLog(j, `\nзадание идёт дольше ${Math.round(timeoutMs / 60000)} мин — останавливаю\n`);
          p.kill('SIGKILL');
        }, timeoutMs);
        p.stdout.on('data', (c) => appendLog(j, c));
        p.stderr.on('data', (c) => appendLog(j, c));
        p.on('error', fail);
        p.on('close', (code, sig) => {
          clearTimeout(timer);
          if (code === 0) return ok();
          // SIGKILL без нашего таймера — почти всегда OOM killer
          const why = sig === 'SIGKILL' ? 'процесс убит (не хватило памяти? см. dmesg)' : `код ${code ?? sig}`;
          fail(new Error(`сборка: ${why}`));
        });
      });
      return await readJson(resultFile, null);
    } finally {
      await fsp.rm(spec, { force: true });
    }
  }

  async function pump() {
    if (running || !queue.length) return;
    const j = queue.shift();
    running = j;
    j.state = 'running';
    j.startedAt = new Date().toISOString();
    await save(j);
    console.log(`▶ задание ${j.id} (${j.kind}, снимок ${j.snapshot}, публикация ${j.publish})`);
    try {
      await prepareRepo(j);
      j.result = await runWorker(j);
      j.state = 'done';
    } catch (e) {
      j.state = 'failed';
      j.error = e.message;
      appendLog(j, `\nОШИБКА: ${e.message}\n`);
    }
    j.finishedAt = new Date().toISOString();
    await save(j);
    console.log(`${j.state === 'done' ? '✓' : '✗'} задание ${j.id}: ${j.state}${j.error ? ` — ${j.error}` : ''}`);
    running = null;
    setImmediate(pump);
  }

  return {
    /** Поставить задание в очередь; повтор такого же, ещё не начатого, не дублируется */
    async enqueue({ kind, snapshot, parts = [], pull = false, publish = 'none', by }) {
      if (!['build', 'publish'].includes(kind)) throw new HttpError(400, 'kind — build или publish');
      if (!Array.isArray(parts) || parts.some((p) => !PARTS.includes(p)))
        throw new HttpError(400, `parts — из ${PARTS.join(', ')}`);
      if (!PUBLISH.includes(publish)) throw new HttpError(400, `publish — ${PUBLISH.join(' | ')}`);
      const same = queue.find(
        (q) =>
          q.kind === kind &&
          q.snapshot === snapshot &&
          q.publish === publish &&
          q.pull === !!pull &&
          q.parts.join() === [...parts].sort().join(),
      );
      if (same) return same;
      const j = {
        id: newId(),
        kind,
        snapshot,
        parts: [...parts].sort(),
        pull: !!pull,
        publish,
        by,
        state: 'queued',
        createdAt: new Date().toISOString(),
      };
      jobs.set(j.id, j);
      await save(j);
      queue.push(j);
      setImmediate(pump);
      return j;
    },

    list: () =>
      [...jobs.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100)
        .map(({ result: _r, ...j }) => j),

    /** Задание с итогом и логом; from — с какого байта лога (для «дочитать новое») */
    async get(id, from = 0) {
      if (!JOB_ID_RE.test(id ?? '') || !jobs.has(id)) return null;
      const j = jobs.get(id);
      let log = '';
      let size = 0;
      try {
        const fh = await fsp.open(file(id, '.log'));
        try {
          size = (await fh.stat()).size;
          const start = Math.min(Math.max(0, from), size);
          const len = Math.min(size - start, 4 * 1024 * 1024);
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, size - len > start ? size - len : start);
          log = buf.toString('utf8');
        } finally {
          await fh.close();
        }
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      return { ...j, result: j.result ?? null, log, logSize: size };
    },

    busy: () => ({ running: running?.id ?? null, queued: queue.map((q) => q.id) }),
  };
}
