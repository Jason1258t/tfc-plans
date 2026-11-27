/** Один lifecycle для локального/очередного client/server: immutable inputs → отдельные среды → результаты → уборка. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkJob } from './job.mjs';
import { checkIdentity, createResult } from './contract.mjs';
import { installedIdentity } from './identity.mjs';
import { validateCheck, evaluateChecks } from './checks.mjs';
import { jobClosure } from './bundle.mjs';
import { BACKENDS } from './backends.mjs';

const combine = (...signals) => AbortSignal.any(signals.filter(Boolean));
const checkDuration = (seconds) => {
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 2147483)
    throw new Error('Лимит времени вне диапазона 1…2147483 с');
  return seconds;
};
const timed = (seconds) => AbortSignal.timeout(checkDuration(seconds) * 1000);
const outcomeError = (error, signal) => ({
  status: signal.aborted ? (signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled') : 'error',
  exitCode: null,
  signal: null,
});
async function saveJSON(file, value) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

export async function runJob(ref, { store, outputRoot, workRoot, worker, signal, onEvent = () => {} }) {
  const job = checkJob(await store.json(ref, { signal }));
  const identity = await installedIdentity();
  checkIdentity(worker?.identity ?? identity, 'worker');
  if (job.runner.version !== identity.version || job.runner.sha256 !== identity.sha256)
    throw new Error('Задание требует другую установленную версию runner');
  if (!Number.isSafeInteger(worker?.memoryMiB) || job.resources.memoryMiB > worker.memoryMiB)
    throw new Error('Недостаточно объявленной памяти worker');
  if (
    !Array.isArray(worker.capabilities) ||
    job.resources.capabilities.some((name) => !worker.capabilities.includes(name))
  )
    throw new Error('Worker не предоставляет требуемые возможности');
  for (const step of job.steps) {
    const backend = BACKENDS[step.backend];
    if (!backend?.kinds?.includes(step.kind)) throw new Error(`Backend ${step.backend} не поддерживает ${step.kind}`);
    backend.validate(step);
    for (const check of step.checks) validateCheck(check);
    for (const name of step.artifacts)
      if (!Object.hasOwn(backend.artifacts, name))
        throw new Error(`Backend ${step.backend}: неизвестный артефакт ${name}`);
  }
  for (const limit of [
    job.limits.totalSeconds,
    job.limits.prepareSeconds,
    job.limits.archiveSeconds ?? 60,
    ...job.steps.map((step) => step.timeoutSeconds),
  ])
    checkDuration(limit);
  const runId = `${job.id}-${randomUUID()}`;
  const output = path.resolve(outputRoot, runId);
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(workRoot, { recursive: true });
  let workspace = null;
  const overall = combine(signal, timed(job.limits.totalSeconds));
  const passport = {
    schemaVersion: 1,
    runId,
    job: ref,
    worker: worker.identity ?? identity,
    runner: identity,
    basePack: job.basePack,
    candidate: job.candidate,
    environment: job.environment,
  };
  const passportRef = await store.putJSON(passport);
  const results = [];
  let sequence = 0,
    error = null,
    cleanupError = null;
  const event = async (stage, detail = {}) => {
    const record = { seq: ++sequence, time: new Date().toISOString(), stage, ...detail };
    await fs.appendFile(path.join(output, 'events.jsonl'), `${JSON.stringify(record)}\n`);
    try {
      Promise.resolve(onEvent(record)).catch(() => {});
    } catch {
      /* Потеря наблюдателя не должна оборвать исполнение или уборку. */
    }
  };
  await saveJSON(path.join(output, 'passport.json'), passport);
  try {
    workspace = await fs.mkdtemp(path.join(path.resolve(workRoot), `${runId}-`));
    await event('validate');
    await jobClosure(job, store, { signal: overall });
    for (const step of job.steps) {
      overall.throwIfAborted();
      const backend = BACKENDS[step.backend];
      const resultDir = path.join(output, step.id);
      await fs.mkdir(resultDir);
      const dependencyFailed = step.after.some((id) => results.find((r) => r.step === id)?.result.verdict !== 'passed');
      if (dependencyFailed) {
        const result = createResult({
          runId,
          inputs: passportRef,
          process: { status: 'cancelled', exitCode: null, signal: null },
          error: 'Предыдущий шаг не прошёл приёмку',
        });
        results.push({ step: step.id, result, outputs: {} });
        await saveJSON(path.join(resultDir, 'result.json'), result);
        await event('skipped', { step: step.id });
        continue;
      }
      const stepRoot = path.join(workspace, step.id);
      const game = path.join(stepRoot, 'game');
      const java = path.join(stepRoot, 'java');
      await fs.mkdir(stepRoot);
      const context = {
        step,
        job,
        game,
        java,
        output: resultDir,
        signal: overall,
        resources: job.resources,
        scenario: null,
      };
      let activeSignal = overall;
      let outcome = null,
        checks = [],
        stepError = null;
      const outputs = {};
      try {
        await event('prepare', { step: step.id });
        const preparing = combine(overall, timed(job.limits.prepareSeconds));
        activeSignal = preparing;
        await store.materialize(job.environment.java.distribution, java, { signal: preparing });
        for (const input of [
          job.environment.minecraft.distribution,
          job.environment.loader.distribution,
          job.basePack,
          job.candidate,
        ])
          await store.materialize(input, game, { signal: preparing, overlay: true });
        const world =
          step.world?.input ??
          (step.world?.fromStep ? results.find((r) => r.step === step.world.fromStep)?.outputs.world : null);
        if (step.world?.fromStep && !world) throw new Error('Исходный шаг не сохранил мир');
        if (world) {
          await fs.rm(path.join(game, 'world'), { recursive: true, force: true });
          await store.materialize(world, path.join(game, 'world'), { signal: preparing });
          await fs.rm(path.join(game, 'world', 'session.lock'), { force: true });
        }
        if (step.scenario) context.scenario = await store.json(step.scenario, { signal: preparing });
        await backend.prepare?.({ ...context, signal: preparing });
        preparing.throwIfAborted();
        await event('execute', { step: step.id });
        const executing = combine(overall, timed(step.timeoutSeconds));
        activeSignal = executing;
        const backendResult = await backend.run({ ...context, signal: executing });
        outcome = backendResult.process;
        stepError = backendResult.error ?? null;
        await event('check', { step: step.id });
        checks = [
          ...(backendResult.checks ?? []),
          ...(await evaluateChecks(step.checks, { game, output: resultDir, outcome })),
        ];
      } catch (caught) {
        stepError = caught.message;
        // AbortError при подготовке должен сохранять исходный TimeoutError, а не маскировать его отменой.
        outcome ??= outcomeError(caught, activeSignal);
        if (caught.name === 'TimeoutError') outcome.status = 'timeout';

        checks.push({ name: 'Выполнение шага', status: 'failed' });
      }
      await event('archive', { step: step.id });
      // Отмена выполнения не должна уничтожить диагностику: сохранение имеет собственный ограниченный бюджет.
      const archiving = timed(job.limits.archiveSeconds ?? 60);
      for (const name of step.artifacts) {
        const from = path.join(game, backend.artifacts[name]);
        try {
          const exists = await fs.lstat(from).catch((caught) => {
            if (caught.code !== 'ENOENT') throw caught;
            return null;
          });
          if (!exists) {
            checks.push({ name: `Артефакт ${name}`, status: 'failed' });
            continue;
          }
          const archived = await store.captureTree(from, { signal: archiving });
          await store.materialize(archived, path.join(resultDir, name), { signal: archiving });
          outputs[name] = archived;
        } catch (caught) {
          checks.push({ name: `Артефакт ${name}: ${caught.message}`, status: 'failed' });
        }
      }
      const result = createResult({
        runId,
        inputs: passportRef,
        process: outcome,
        checks,
        artifacts: Object.entries(outputs).map(([name, artifact]) => ({
          name,
          path: `${step.id}/${name}`,
          ...artifact,
        })),
        error: stepError,
      });
      results.push({ step: step.id, result, outputs });
      await saveJSON(path.join(resultDir, 'result.json'), result);
      await fs.rm(stepRoot, { recursive: true, force: true });
      await event('step-finished', { step: step.id, verdict: result.verdict });
    }
  } catch (caught) {
    error = { message: caught.message, ...outcomeError(caught, overall) };
    await event('error', { error: caught.message });
  } finally {
    try {
      await event('cleanup');
    } finally {
      try {
        if (workspace) await fs.rm(workspace, { recursive: true, force: true });
      } catch (caught) {
        cleanupError = caught.message;
      }
    }
  }
  if (overall.aborted && !error)
    error = { message: overall.reason?.message ?? 'Прогон отменён', ...outcomeError(overall.reason, overall) };
  const verdict =
    error || cleanupError || results.length !== job.steps.length || results.some((r) => r.result.verdict === 'failed')
      ? 'failed'
      : results.some((r) => r.result.verdict === 'unknown')
        ? 'unknown'
        : 'passed';
  const result = {
    schemaVersion: 1,
    runId,
    job: ref,
    inputs: passportRef,
    verdict,
    steps: results,
    error,
    cleanupError,
  };
  await saveJSON(path.join(output, 'result.json'), result);
  await event('finished', { verdict });
  return { result, output };
}
