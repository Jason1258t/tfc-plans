#!/usr/bin/env node
/**
 * Очередь стенда на test1a с Mac (dev #310): поставить прогон серверного или клиентского стенда, дождаться итога одним
 * вызовом, прочитать журнал точечно, снять задание. Исполнитель на хосте — scripts/stand-queue.mjs (cron), он же
 * в простое гоняет проверку печати схем. Снимок хост подтягивает с сервера сборки сам; свои jar, оверлей и мир
 * задания заливаются отсюда по rsync.
 *
 *   npm run stand-queue -- submit server [--cmd …]… [--mod <jar>]… [--overlay <папка>] [--until <re>] … [--note …]
 *   npm run stand-queue -- submit client [--world new] [--mod <jar>]… [--overlay <папка>] … [--note …]
 *   npm run stand-queue -- wait <id> [--timeout 600] [--until <re>]  |  list  |  log <id> [--grep re] [--tail N]
 *   npm run stand-queue -- cancel <id>
 *
 * Флаги прогона — как у pack-stand.mjs (server) и client-stand.mjs run (client). Код стенда на хосте — main
 * (клон ~/tfc-stand/print-worker/repo); проверить правку самого стенда — прямой прогон npm run client-stand.
 * Результаты — в ~/.cache/tfc-plans/stand-queue/<id> на Mac. Библиотека для MCP (stand_*): в stdout не пишет.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST, OPT, SSH, q, rsync, ssh, worldKeyword } from './client-stand-remote.mjs';

const REPO = process.env.TFC_QUEUE_REPO ?? '~/tfc-stand/print-worker/repo';
/** Папка очереди на хосте относительно ~ (как TFC_STAND_QUEUE у stand-queue.mjs) */
const REMOTE_QUEUE = process.env.TFC_QUEUE_DIR ?? 'tfc-stand/queue';
const LOCAL = path.join(os.homedir(), '.cache', 'tfc-plans', 'stand-queue');
const KIND_RU = { server: 'серверный', client: 'клиентский' };
const STATE_RU = {
  queued: 'в очереди',
  running: 'идёт',
  done: 'готово',
  error: 'сбой',
  cancelled: 'отменено',
};

const hostCmd = (args) =>
  `export PATH=${OPT}/node/bin:$PATH TFC_STAND_QUEUE=~/${REMOTE_QUEUE} && cd ${REPO} && exec node scripts/stand-queue.mjs ${args.map(q).join(' ')}`;

/** Команда stand-queue.mjs на хосте без блокировки процесса (MCP-сервер в это время отвечает другим) → JSON */
function hostAsync(args, { timeoutSec = 120 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ssh',
      [...SSH, '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30', HOST, hostCmd(args)],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => child.kill('SIGTERM'), timeoutSec * 1000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0)
        return reject(new Error(`stand-queue ${args[0]} на ${HOST}: ${(err || out).trim() || `код ${code}`}`));
      try {
        resolve(JSON.parse(out.trim().split('\n').at(-1)));
      } catch {
        reject(
          new Error(
            `stand-queue ${args[0]}: непонятный ответ хоста (${out.length} байт): ${out.slice(0, 200)} … ${out.slice(-200)}`,
          ),
        );
      }
    });
  });
}

/** Флаги, за которыми идёт локальный путь: заливаем в inputs/<метка> на хосте и подменяем путь */
function pathFlag(kind, argv, i) {
  const a = argv[i];
  if (a === '--mod' || a === '--overlay') return true;
  return kind === 'client' && a === '--world' && !worldKeyword(argv[i + 1]);
}

function pushInputs(kind, argv) {
  const tag = `${Date.now()}-${randomBytes(2).toString('hex')}`;
  const base = `${REMOTE_QUEUE}/inputs/${tag}`;
  let home = null;
  const out = [];
  let n = 0;
  for (let i = 0; i < argv.length; i++) {
    if (pathFlag(kind, argv, i) && argv[i + 1]) {
      const local = path.resolve(argv[++i]);
      if (!fs.existsSync(local)) throw new Error(`нет ${local}`);
      home ??= ssh(`mkdir -p ~/${base} && printf %s "$HOME"`);
      // Своя подпапка на каждый вход: имя jar остаётся прежним
      ssh(`mkdir -p ~/${base}/${n}`);
      const name = `${n++}/${path.basename(local)}`;
      rsync([fs.statSync(local).isDirectory() ? `${local}/` : local, `${HOST}:${base}/${name}`]);
      out.push(argv[i - 1], `${home}/${base}/${name}`);
    } else out.push(argv[i]);
  }
  return { args: out, inputs: home ? tag : null };
}

/** Поставить прогон: kind server|client, argv — флаги стенда с локальными путями. → { id, position, current } */
export async function submit(
  kind,
  argv,
  { note = '', by = process.env.TFC_AGENT_NICK || os.userInfo().username } = {},
) {
  if (!KIND_RU[kind]) throw new Error('вид прогона: server | client');
  const { args, inputs } = pushInputs(kind, argv);
  const spec = JSON.stringify({ kind, args, by, note, inputs });
  const out = ssh(`${hostCmd(['add'])} <<'TFC_JOB_EOF'\n${spec}\nTFC_JOB_EOF\n`);
  return JSON.parse(out.trim().split('\n').at(-1));
}

/** Результаты задания (журналы, PNG) → ~/.cache/tfc-plans/stand-queue/<id> */
function pull(view) {
  const { job } = view;
  // Урезанную в ответе сводку — целиком в ту же папку
  const summary = view.summaryCut && view.summaryFile ? path.join(LOCAL, job.id, 'summary.txt') : null;
  if (!job.result && !summary) return { local: null, pngs: [], gameShots: [] };
  const local = path.join(LOCAL, job.id);
  fs.mkdirSync(local, { recursive: true });
  if (job.result) rsync([`${HOST}:${job.result}/`, `${local}/`]);
  if (summary) rsync([`${HOST}:${view.summaryFile}`, summary]);
  const png = (dir) =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith('.png'))
          .sort()
          .map((f) => path.join(dir, f))
      : [];
  return { local, pngs: png(local), gameShots: png(path.join(local, 'screenshots')) };
}

/**
 * Ждать задание на хосте до конца (или до события по until) не дольше timeout с. → { view, local, pngs, gameShots }
 * view: { job, position, current, events, skipped, seq, summary, reason: final|until|timeout }
 */
export async function waitJob(id, { timeout = 600, since = 0, until = null } = {}) {
  const t = Math.min(3600, Math.max(0, Number(timeout) | 0));
  const view = await hostAsync(
    ['wait', id, '--timeout', String(t), '--since', String(since), ...(until ? ['--until', until] : [])],
    { timeoutSec: t + 120 },
  );
  const got = view.reason === 'final' ? pull(view) : { local: null, pngs: [], gameShots: [] };
  return { view, ...got };
}

export const listJobs = () => hostAsync(['list']);
export const jobLog = (id, { grep = null, tail = 80 } = {}) =>
  hostAsync(['log', id, ...(grep ? ['--grep', grep] : []), '--tail', String(tail)]);
export const cancelJob = (id) => hostAsync(['cancel', id]);

const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s} с` : `${Math.round(s / 60)} мин`;
};

/** Что сейчас занимает стенд — строкой */
export function currentText(cur) {
  if (!cur) return 'стенд свободен';
  if (cur.kind === 'print') return `идёт фоновая проверка печати схем (${ago(cur.since)}), задания агентов — следом`;
  return `идёт задание ${cur.id} (${KIND_RU[cur.jobKind] ?? cur.jobKind}, ${cur.by}, ${ago(cur.since)})`;
}

/** Ответ ожидания — текстом для агента */
export function viewText(r) {
  const { view } = r;
  const j = view.job;
  const head = `Задание ${j.id} (${KIND_RU[j.kind]} стенд, ${j.by}${j.note ? `: ${j.note}` : ''}) — ${STATE_RU[j.state] ?? j.state}`;
  const out = [head];
  if (j.state === 'queued') out.push(`место в очереди: ${view.position}; ${currentText(view.current)}`);
  if (j.state === 'running') out.push(`идёт ${ago(j.startedAt)}; этап: ${j.stage ?? '—'}`);
  if (view.events.length && view.reason !== 'final') {
    out.push(`ход (новое${view.skipped ? `, ранние ${view.skipped} пропущены` : ''}):`);
    out.push(...view.events.map((e) => `  ${e.text}`));
  }
  if (view.reason === 'timeout') out.push('Ожидание вышло, задание ещё не кончилось.');
  if (view.reason === 'until') out.push('Дождался события по until.');
  if (view.reason !== 'final')
    out.push(`Ждать дальше: stand_wait id=${j.id} since=${view.seq}; журнал: stand_log id=${j.id}`);
  if (view.reason === 'final') {
    if (j.error) out.push(`причина: ${j.error}`);
    // «готово» — только что прогон кончился; приёмку даёт код выхода стенда
    if (j.state === 'done' && j.ok === false)
      out.push(`итог: не пройдено (код ${j.code}: сервер не поднялся, краш или провал сценария — см. сводку)`);
    if (j.startedAt && j.endedAt)
      out.push(`прогон ${Math.round((Date.parse(j.endedAt) - Date.parse(j.startedAt)) / 1000)} с`);
    if (view.summary?.trim()) out.push('', view.summary.trim());
    if (view.summaryCut)
      out.push(
        '',
        `Сводка длинная, выше — начало и конец; целиком: ${r.local ? path.join(r.local, 'summary.txt') : view.summaryFile}`,
      );
    if (r.local) {
      const all = [...r.pngs, ...r.gameShots];
      out.push(
        '',
        `На Mac: ${r.local}${all.length ? ` (PNG: ${r.pngs.length}${r.gameShots.length ? ` + игровых ${r.gameShots.length}` : ''})` : ''}`,
      );
      const latest = path.join(r.local, 'latest.log');
      if (fs.existsSync(latest)) out.push(`Журнал: log_analyze path=${latest}`);
      const scenario = path.join(r.local, 'scenario.json');
      if (fs.existsSync(scenario)) out.push(`Итог сценария: ${scenario}`);
    }
    out.push(`Весь вывод прогона: stand_log id=${j.id}`);
  }
  return out.join('\n');
}

export function listText(r) {
  const rows = [currentText(r.current)];
  const jobs = r.jobs.slice().reverse();
  if (!jobs.length) rows.push('заданий нет');
  for (const j of jobs)
    rows.push(
      `${j.id}  ${STATE_RU[j.state] ?? j.state}${j.position ? ` #${j.position}` : ''}  ${KIND_RU[j.kind]}  ${j.by}` +
        `${j.note ? ` — ${j.note}` : ''}${j.state === 'running' && j.stage ? `  [${j.stage}]` : ''}`,
    );
  return rows.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, ...argv] = process.argv.slice(2);
  const one = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const without = (list, flags) => list.filter((a, i) => !flags.includes(a) && !flags.includes(list[i - 1]));
  const run = async () => {
    if (cmd === 'submit') {
      const [kind, ...rest] = argv;
      const r = await submit(kind, without(rest, ['--note']), { note: one('--note') ?? '' });
      return `Задание ${r.id} в очереди, место ${r.position}; ${currentText(r.current)}\nЖдать: npm run stand-queue -- wait ${r.id}`;
    }
    if (cmd === 'wait')
      return viewText(
        await waitJob(argv[0], {
          timeout: Number(one('--timeout') ?? 600),
          since: Number(one('--since') ?? 0),
          until: one('--until') ?? null,
        }),
      );
    if (cmd === 'list') return listText(await listJobs());
    if (cmd === 'log') {
      const r = await jobLog(argv[0], { grep: one('--grep') ?? null, tail: Number(one('--tail') ?? 80) });
      return [`строк: ${r.total}`, ...r.lines].join('\n');
    }
    if (cmd === 'cancel') return JSON.stringify(await cancelJob(argv[0]));
    throw new Error('команда: submit server|client … | wait <id> | list | log <id> | cancel <id>');
  };
  run().then(
    (t) => console.log(t),
    (e) => {
      console.error(e.message);
      process.exitCode = 1;
    },
  );
}
