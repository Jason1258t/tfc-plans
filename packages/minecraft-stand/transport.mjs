/** Общая доставка client/server: локальный socket или SSH к установленному CLI, без git/копирования кода. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { workerRequest } from './queue-client.mjs';
import { jobClosure, transferJob } from './bundle.mjs';
import { ArtifactStore } from './store.mjs';
export const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
const SSH = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15'];
function sshSettings(target) {
  const match = /^(?:([^@]+)@)?(.*)$/.exec(target.host ?? '');
  const host = match[2].replace(/^\[|\]$/g, '');
  if (!host || host.startsWith('-') || /[\s'"`\\]/.test(host) || (match[1] && !/^[\w.-]+$/.test(match[1])))
    throw new Error('Неверный SSH host');
  const extra = target.sshOptions ?? [];
  if (!Array.isArray(extra) || extra.some((v) => typeof v !== 'string' || v.includes('\0')))
    throw new Error('sshOptions — массив строк');
  return ['ssh', ...SSH, ...extra, '-o', `HostName=${host}`, ...(match[1] ? ['-l', match[1]] : [])];
}
export function rsyncArgs(target, args) {
  return [
    '-a',
    '--checksum',
    '-e',
    sshSettings(target).map(quote).join(' '),
    ...args.map((arg) => (arg.startsWith('remote:') ? `minecraft-stand-transfer:${quote(arg.slice(7))}` : arg)),
  ];
}
function run(command, args, { input = null, signal, timeoutSeconds = 3600 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let out = '',
      err = '',
      failure = null,
      hard = null;
    const kill = (sig) => {
      try {
        if (process.platform === 'win32') child.kill(sig);
        else if (child.pid) process.kill(-child.pid, sig);
      } catch {
        /* Уже завершён. */
      }
    };
    const stop = () => {
      kill('SIGTERM');
      hard ??= setTimeout(() => kill('SIGKILL'), 2000);
    };
    const cancel = () => {
      failure = signal.reason ?? new DOMException('Запрос отменён', 'AbortError');
      stop();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (out.length + chunk.length > 16 * 1024 * 1024) {
        failure ??= new Error('Ответ транспорта слишком большой');
        stop();
        return;
      }
      if (!failure) out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      err = (err + chunk).slice(-65536);
    });
    child.stdin.on('error', () => {});
    const timer = setTimeout(() => {
      failure ??= new Error('Истёк timeout транспорта');
      stop();
    }, timeoutSeconds * 1000);
    child.once('error', (error) => {
      failure = error;
    });
    child.once('exit', () => kill('SIGKILL'));
    child.once('close', (code) => {
      clearTimeout(timer);
      if (hard) clearTimeout(hard);
      signal?.removeEventListener('abort', cancel);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${command}: ${err.trim() || `код ${code}`}`));
      else resolve(out);
    });
    child.stdin.end(input);
  });
}
export function checkTarget(target) {
  if (!['local', 'ssh'].includes(target?.kind)) throw new Error('Target kind: local | ssh');
  for (const name of ['socket', 'storeRoot'])
    if (typeof target[name] !== 'string' || !target[name].startsWith('/') || target[name].includes('\0'))
      throw new Error(`Target ${name}: нужен абсолютный путь`);
  if (target.kind === 'ssh') {
    sshSettings(target);
    for (const name of ['node', 'cli'])
      if (typeof target[name] !== 'string' || !target[name].startsWith('/') || target[name].includes('\0'))
        throw new Error(`Target ${name}: нужен абсолютный путь`);
  }
  return target;
}
export async function requestTarget(target, request, { signal } = {}) {
  checkTarget(target);
  signal?.throwIfAborted();
  if (target.kind === 'local') return workerRequest(target.socket, { ...request, signal });
  const ssh = sshSettings(target);
  const command = [target.node, target.cli, 'request', '--socket', target.socket].map(quote).join(' ');
  const answer = await run(ssh[0], [...ssh.slice(1), 'minecraft-stand-control', command], {
    input: JSON.stringify(request),
    signal,
    timeoutSeconds: (request.timeoutSeconds ?? 30) + 20,
  });
  return JSON.parse(answer.trim());
}
export async function submitTarget(ref, source, target, { key, note = '', by = '', signal } = {}) {
  checkTarget(target);
  const health = await requestTarget(target, { path: '/health' }, { signal });
  if (!health.ready || health.stopping) throw new Error('Worker ещё не готов');
  if (health.storeRoot !== target.storeRoot) throw new Error('storeRoot target не совпадает с worker');
  const job = await source.json(ref, { signal });
  if (job.runner.sha256 !== health.identity.sha256 || job.runner.version !== health.identity.version)
    throw new Error('Версия установленного runner не совпадает с заданием');
  if (target.kind === 'local') await transferJob(ref, source, new ArtifactStore(target.storeRoot), { signal });
  else {
    const closure = [ref, ...(await jobClosure(job, source, { signal }))];
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'minecraft-stand-send-'));
    try {
      const list = path.join(temp, 'files');
      await fs.writeFile(list, closure.map((entry) => `blobs/${entry.sha256}`).join('\n') + '\n');
      await run('rsync', rsyncArgs(target, ['--files-from', list, `${source.root}/`, `remote:${target.storeRoot}/`]), {
        signal,
      });
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }
  return requestTarget(target, { method: 'POST', path: '/jobs', body: { ref, key, note, by } }, { signal });
}
export async function waitTarget(target, id, { timeout = 600, since = 0, until = null, signal } = {}) {
  const query = new URLSearchParams({ timeout: String(timeout), since: String(since) });
  if (until) query.set('until', until);
  return requestTarget(
    target,
    { path: `/jobs/${encodeURIComponent(id)}/wait?${query}`, timeoutSeconds: timeout },
    { signal },
  );
}
export async function pullTarget(target, job, destination, { signal } = {}) {
  checkTarget(target);
  if (!['done', 'error', 'cancelled'].includes(job.state)) return null;
  await fs.mkdir(destination, { recursive: true });
  if (job.output && target.kind === 'local') await fs.cp(job.output, destination, { recursive: true });
  else if (job.output) await run('rsync', rsyncArgs(target, [`remote:${job.output}/`, `${destination}/`]), { signal });
  await fs.writeFile(path.join(destination, 'queue-job.json'), JSON.stringify(job, null, 2));
  return destination;
}
