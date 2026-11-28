/** Общий процесс client/server: ограниченный журнал, отмена и завершение всей группы. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { recordProcess } from './process-identity.mjs';

export async function runProcess({
  executable,
  args,
  cwd,
  env,
  signal,
  output,
  scenario = {},
  maxOutputBytes = 64 * 1024 * 1024,
}) {
  signal?.throwIfAborted();
  fs.mkdirSync(output, { recursive: true });
  const out = fs.openSync(path.join(output, 'stdout.log'), 'wx');
  let err;
  try {
    err = fs.openSync(path.join(output, 'stderr.log'), 'wx');
  } catch (error) {
    fs.closeSync(out);
    throw error;
  }
  let child;
  try {
    child = spawn(executable, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
  } catch (error) {
    fs.closeSync(out);
    fs.closeSync(err);
    throw error;
  }
  let stopped = false,
    bytes = 0,
    aborted = false,
    ready = false,
    failure = null,
    abortReason = null;
  const tails = new Map([
    [out, ''],
    [err, ''],
  ]);
  const decoders = new Map([
    [out, new StringDecoder('utf8')],
    [err, new StringDecoder('utf8')],
  ]);
  const timers = new Set();
  const later = (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timers.add(timer);
    return timer;
  };
  const kill = (sig) => {
    try {
      if (process.platform === 'win32') child.kill(sig);
      else process.kill(-child.pid, sig);
    } catch {
      /* Группа уже завершена. */
    }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (scenario.stopCommand && child.stdin.writable) child.stdin.write(`${scenario.stopCommand}\n`);
    else kill('SIGTERM');
    later(() => kill('SIGKILL'), 5000);
  };
  try {
    if (!Number.isSafeInteger(child.pid)) throw new Error('Не удалось создать процесс');
    recordProcess(path.join(output, 'process.json'), child.pid);
  } catch (error) {
    failure = error.message;
    stop();
  }
  const onAbort = () => {
    aborted = true;
    abortReason = signal.reason;
    stop();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  child.stdin.on('error', () => {
    /* Закрытие stdin при выходе процесса ожидаемо. */
  });
  const feed = (fd) => (data) => {
    bytes += data.length;
    const remaining = maxOutputBytes - (bytes - data.length);
    try {
      if (remaining > 0) fs.writeSync(fd, data.subarray(0, remaining));
    } catch (error) {
      failure ??= `Не удалось сохранить журнал: ${error.message}`;
      stop();
      return;
    }
    if (bytes > maxOutputBytes) {
      failure ??= 'Превышен размер журнала';
      stop();
      return;
    }
    const tail = (tails.get(fd) + decoders.get(fd).write(data)).slice(-65536);
    tails.set(fd, tail);
    if (!stopped && !ready && scenario.readyText && tail.includes(scenario.readyText)) {
      ready = true;
      for (const command of scenario.commands ?? []) child.stdin.write(`${command}\n`);
      if (scenario.stopCommand || scenario.stopAfterReady) later(stop, (scenario.holdSeconds ?? 0) * 1000);
    }
  };
  child.stdout.on('data', feed(out));
  child.stderr.on('data', feed(err));
  // Потомки могут держать унаследованные pipe после выхода лидера: ждать close перед kill нельзя.
  child.once('exit', () => kill('SIGKILL'));
  return new Promise((resolve) => {
    child.on('error', (error) => {
      failure = error.message;
    });
    child.on('close', (code, sig) => {
      for (const timer of timers) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // Лидер мог оставить дочерний Xvfb/Java: среда не должна пережить шаг.
      kill('SIGKILL');
      fs.closeSync(out);
      fs.closeSync(err);
      const status = aborted
        ? abortReason?.name === 'TimeoutError'
          ? 'timeout'
          : 'cancelled'
        : failure || sig
          ? 'error'
          : 'exited';
      resolve({
        process: { status, exitCode: code, signal: sig },
        checks: scenario.readyText ? [{ name: 'Готовность процесса', status: ready ? 'passed' : 'failed' }] : [],
        error: failure,
      });
    });
  });
}
