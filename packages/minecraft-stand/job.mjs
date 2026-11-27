/** Декларация проверки: закреплённые входы и граф шагов, без путей checkout. */
import { checkIdentity, checkRef, canonicalJson, SCHEMA_VERSION } from './contract.mjs';
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const invalid = (message) => {
  throw new Error(`Задание стенда: ${message}`);
};
const id = (value, label) => {
  if (typeof value !== 'string' || !identifier.test(value)) invalid(`${label}: недопустимое имя`);
};
const positive = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) invalid(`${label}: нужно положительное целое`);
};
const strings = (values, label) => {
  if (!Array.isArray(values) || values.some((v) => typeof v !== 'string' || !v))
    invalid(`${label}: нужен массив строк`);
};
export function checkJob(job) {
  if (job?.schemaVersion !== SCHEMA_VERSION) invalid('неподдерживаемая версия');
  id(job.id, 'id');
  checkIdentity(job.runner, 'runner');
  checkRef(job.basePack, 'basePack');
  checkRef(job.candidate, 'candidate');
  for (const name of ['minecraft', 'loader', 'java']) {
    const component = job.environment?.[name];
    if (typeof component?.version !== 'string' || !component.version) invalid(`environment.${name}.version`);
    checkRef(component.distribution, `environment.${name}.distribution`);
  }
  positive(job.limits?.prepareSeconds, 'limits.prepareSeconds');
  positive(job.limits?.totalSeconds, 'limits.totalSeconds');
  if (job.limits.archiveSeconds !== undefined) positive(job.limits.archiveSeconds, 'limits.archiveSeconds');
  positive(job.resources?.memoryMiB, 'resources.memoryMiB');
  strings(job.resources?.capabilities, 'resources.capabilities');
  if (!Array.isArray(job.steps) || !job.steps.length) invalid('нужен хотя бы один шаг');
  const seen = new Set();
  const outputs = new Map();
  for (const step of job.steps) {
    id(step.id, 'step.id');
    if (seen.has(step.id)) invalid(`повтор шага ${step.id}`);
    if (!['client', 'server'].includes(step.kind)) invalid(`шаг ${step.id}: kind`);
    id(step.backend, 'step.backend');
    strings(step.after, 'step.after');
    if (new Set(step.after).size !== step.after.length || step.after.some((ref) => !seen.has(ref)))
      invalid(`шаг ${step.id}: зависимости должны ссылаться на предыдущие шаги`);
    if (step.world?.fromStep && !step.after.includes(step.world.fromStep))
      invalid(`шаг ${step.id}: мир без зависимости`);
    if (step.world?.fromStep && !outputs.get(step.world.fromStep)?.includes('world'))
      invalid(`шаг ${step.id}: исходный шаг не сохраняет мир`);
    if (step.world?.input) checkRef(step.world.input, 'world.input');
    if (step.world?.fromStep && step.world?.input) invalid(`шаг ${step.id}: два источника мира`);
    if (step.scenario) checkRef(step.scenario, 'scenario');
    positive(step.timeoutSeconds, 'step.timeoutSeconds');
    if (!Array.isArray(step.checks) || !step.checks.length) invalid(`шаг ${step.id}: нужны проверки`);
    const checks = new Set();
    for (const check of step.checks) {
      id(check.id, 'check.id');
      id(check.type, 'check.type');
      if (checks.has(check.id)) invalid(`повтор проверки ${check.id}`);
      checks.add(check.id);
    }
    strings(step.artifacts, 'step.artifacts');
    seen.add(step.id);
    outputs.set(step.id, step.artifacts);
  }
  canonicalJson(job);
  return job;
}
