#!/usr/bin/env node
/** Самостоятельный вход: фиксация, доставка и исполнение без checkout. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkJob } from './job.mjs';
import { digest } from './passport.mjs';
import { ArtifactStore } from './store.mjs';
import { freezeJob, transferJob } from './bundle.mjs';
import { installedIdentity } from './identity.mjs';
import { runJob } from './runner.mjs';
import { serveQueue, recoverSocket } from './queue.mjs';
import { workerRequest } from './queue-client.mjs';
import { submitTarget, waitTarget, pullTarget } from './transport.mjs';
const help =
  'Команды: identity | validate <job.json> | freeze <spec.json> --store <dir> | transfer <sha256> --from <dir> --into <dir> | run <sha256> --store <dir> --work <dir> --out <dir> --worker <file> | serve --root <dir> --worker <file> [--socket <path>] | request --socket <path> < request.json | recover --root <dir> [--socket <path>] | submit <sha256> --store <dir> --target <target.json> --key <key> | wait <id> --target <target.json> [--timeout <sec>] [--out <dir>]';
const abort = new AbortController();
for (const event of ['SIGINT', 'SIGTERM'])
  process.on(event, () => abort.abort(new DOMException('Прогон отменён', 'AbortError')));
try {
  const [command, ...args] = process.argv.slice(2);
  const required = {
    identity: [],
    validate: [],
    freeze: ['--store'],
    transfer: ['--from', '--into'],
    run: ['--store', '--work', '--out', '--worker'],
    serve: ['--root', '--worker'],
    request: ['--socket'],
    recover: ['--root'],
    submit: ['--store', '--target', '--key'],
    wait: ['--target'],
  }[command];
  if (!required) throw new Error(help);
  const noSubject = ['identity', 'serve', 'request', 'recover'].includes(command);
  const subject = noSubject ? null : args.shift();
  if (!noSubject && !subject) throw new Error(help);
  const allowed = [
    ...required,
    ...(['serve', 'recover'].includes(command) ? ['--socket'] : []),
    ...(command === 'run' ? ['--watch-stdin'] : []),
    ...(command === 'wait' ? ['--timeout', '--since', '--until', '--out'] : []),
  ];
  const flags = {};
  while (args.length) {
    const flag = args.shift();
    if (!allowed.includes(flag) || flags[flag] !== undefined) throw new Error(help);
    if (flag === '--watch-stdin') {
      flags[flag] = true;
      continue;
    }
    const value = args.shift();
    if (!value) throw new Error(help);
    flags[flag] = value;
  }
  if (required.some((flag) => !flags[flag])) throw new Error(help);
  if (flags['--watch-stdin']) {
    await new Promise((resolve, reject) => {
      let received = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        received += chunk;
        if (received.length > 4096) reject(new Error('Неверное разрешение старта'));
        if (received.includes('\n')) {
          if (received.split('\n')[0] === 'START') resolve();
          else reject(new Error('Неверное разрешение старта'));
        }
      });
      process.stdin.once('end', () => {
        abort.abort(new DOMException('Управляющий процесс отключился', 'AbortError'));
        reject(abort.signal.reason);
      });
      abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true });
      process.stdin.resume();
    });
    abort.signal.throwIfAborted();
  }
  const load = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
  let result;
  if (command === 'identity') result = await installedIdentity();
  else if (command === 'validate') {
    const job = checkJob(await load(subject));
    result = { сообщение: 'Задание корректно', id: job.id, sha256: digest(job), шагов: job.steps.length };
  } else if (command === 'freeze')
    result = await freezeJob(await load(subject), new ArtifactStore(flags['--store']), {
      base: path.dirname(path.resolve(subject)),
      signal: abort.signal,
    });
  else if (command === 'transfer')
    result = await transferJob(
      { sha256: subject },
      new ArtifactStore(flags['--from']),
      new ArtifactStore(flags['--into']),
      { signal: abort.signal },
    );
  else if (command === 'serve') {
    await serveQueue({
      root: flags['--root'],
      socket: flags['--socket'],
      worker: await load(flags['--worker']),
      signal: abort.signal,
    });
    result = { сообщение: 'Worker остановлен' };
  } else if (command === 'recover') result = await recoverSocket(flags['--root'], flags['--socket']);
  else if (command === 'submit') {
    result = await submitTarget(
      { sha256: subject },
      new ArtifactStore(flags['--store']),
      await load(flags['--target']),
      { key: flags['--key'], signal: abort.signal },
    );
  } else if (command === 'wait') {
    const target = await load(flags['--target']);
    result = await waitTarget(target, subject, {
      timeout: Number(flags['--timeout'] ?? 600),
      since: Number(flags['--since'] ?? 0),
      until: flags['--until'] ?? null,
      signal: abort.signal,
    });
    if (result.reason === 'final' && flags['--out'])
      result.local = await pullTarget(target, result.job, flags['--out'], { signal: abort.signal });
  } else if (command === 'request') {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 1024 * 1024) throw new Error('Запрос слишком большой');
    }
    result = await workerRequest(flags['--socket'], { ...JSON.parse(input), signal: abort.signal });
  } else {
    result = await runJob(
      { sha256: subject },
      {
        store: new ArtifactStore(flags['--store']),
        workRoot: flags['--work'],
        outputRoot: flags['--out'],
        worker: await load(flags['--worker']),
        signal: abort.signal,
        onEvent: (event) => process.stderr.write(`${JSON.stringify(event)}\n`),
      },
    );
    if (result.result.verdict !== 'passed') process.exitCode = 1;
  }
  console.log(JSON.stringify(result));
  if (flags['--watch-stdin']) process.stdin.pause();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  process.stdin.pause();
}
