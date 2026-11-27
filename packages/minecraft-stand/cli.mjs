#!/usr/bin/env node
/** Самостоятельный вход: фиксация, перенос и исполнение без checkout и внешних npm-пакетов. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkJob } from './job.mjs';
import { digest } from './passport.mjs';
import { ArtifactStore } from './store.mjs';
import { freezeJob, transferJob } from './bundle.mjs';
import { installedIdentity } from './identity.mjs';
import { runJob } from './runner.mjs';
const help =
  'Команды: identity | validate <job.json> | freeze <spec.json> --store <dir> | transfer <sha256> --from <dir> --into <dir> | run <sha256> --store <dir> --work <dir> --out <dir> --worker <worker.json>';
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
  }[command];
  if (!required) throw new Error(help);
  const subject = command === 'identity' ? null : args.shift();
  if (command !== 'identity' && !subject) throw new Error(help);
  const flags = {};
  while (args.length) {
    const flag = args.shift(),
      value = args.shift();
    if (!required.includes(flag) || !value || flags[flag]) throw new Error(help);
    flags[flag] = value;
  }
  if (required.some((flag) => !flags[flag])) throw new Error(help);
  const load = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
  let result;
  if (command === 'identity') result = await installedIdentity();
  else if (command === 'validate') {
    const job = checkJob(await load(subject));
    result = { сообщение: 'Задание корректно', id: job.id, sha256: digest(job), шагов: job.steps.length };
  } else if (command === 'freeze') {
    result = await freezeJob(await load(subject), new ArtifactStore(flags['--store']), {
      base: path.dirname(path.resolve(subject)),
      signal: abort.signal,
    });
  } else if (command === 'transfer') {
    result = await transferJob(
      { sha256: subject },
      new ArtifactStore(flags['--from']),
      new ArtifactStore(flags['--into']),
      { signal: abort.signal },
    );
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
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
