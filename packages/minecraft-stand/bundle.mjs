/** Фиксация локальных входов и перенос только транзитивного замыкания байтов задания. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkJob } from './job.mjs';
import { checkRef } from './contract.mjs';
import { installedIdentity } from './identity.mjs';

function slots(job) {
  return [
    [job, 'basePack', true],
    [job, 'candidate', true],
    ...['minecraft', 'loader', 'java'].map((name) => [job.environment[name], 'distribution', true]),
    ...job.steps.flatMap((step) => [
      ...(step.scenario ? [[step, 'scenario', false]] : []),
      ...(step.world?.input ? [[step.world, 'input', true]] : []),
    ]),
  ];
}
export async function freezeJob(spec, store, { base = process.cwd(), signal } = {}) {
  const job = structuredClone(spec);
  job.runner ??= await installedIdentity();
  for (const [owner, key, tree] of slots(job)) {
    const ref = owner[key];
    if (tree && ref?.directory) owner[key] = await store.captureTree(path.resolve(base, ref.directory), { signal });
    else if (!tree && ref?.file) owner[key] = await store.putFile(path.resolve(base, ref.file), { signal });
    else if (!tree && Object.hasOwn(ref ?? {}, 'inline')) owner[key] = await store.putJSON(ref.inline);
    else checkRef(ref, key);
  }
  checkJob(job);
  const ref = await store.putJSON(job);
  await jobClosure(job, store, { signal });
  return { job, ref };
}
export async function jobClosure(job, store, { signal } = {}) {
  checkJob(job);
  const refs = new Map();
  for (const [owner, key, tree] of slots(job)) {
    const ref = owner[key];
    refs.set(ref.sha256, ref);
    if (tree) {
      const manifest = await store.tree(ref, { signal });
      for (const file of manifest.files) refs.set(file.sha256, { sha256: file.sha256, size: file.size });
    }
  }
  // Проверяем потоковым копированием при передаче; здесь проверяем наличие без чтения больших JAR в память.
  for (const ref of refs.values()) {
    signal?.throwIfAborted();
    const st = await fs.lstat(store.file(ref));
    if (!st.isFile() || (ref.size !== undefined && st.size !== ref.size))
      throw new Error(`Нет байтов входа ${ref.sha256}`);
  }
  return [...refs.values()];
}
export async function transferJob(ref, from, to, { signal } = {}) {
  const job = checkJob(await from.json(ref, { signal }));
  const closure = [ref, ...(await jobClosure(job, from, { signal }))];
  for (const input of closure) {
    const copied = await to.putFile(from.file(input), { signal });
    if (copied.sha256 !== input.sha256 || (input.size !== undefined && copied.size !== input.size))
      throw new Error(`Изменились байты входа ${input.sha256}`);
  }
  return { job, ref };
}
