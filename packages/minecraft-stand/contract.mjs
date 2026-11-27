/** Версионированный паспорт прогона: worker, runner, сборка и кандидат независимы. */
export const SCHEMA_VERSION = 1;
export const TOOL_VERSION = '0.2.0';
const SHA = /^[a-f0-9]{64}$/;
const fail = (message) => {
  throw new Error(`Контракт стенда: ${message}`);
};
const text = (v, label) => {
  if (typeof v !== 'string' || !v.trim()) fail(`${label} — непустая строка`);
};
export function checkRef(ref, label) {
  if (!ref || typeof ref.sha256 !== 'string' || !SHA.test(ref.sha256)) fail(`${label}: нужен SHA256`);
  return ref;
}
export function checkIdentity(identity, label) {
  text(identity?.version, `${label}.version`);
  checkRef(identity, label);
  return identity;
}

/** JSON с устойчивым порядком ключей; хеш не зависит от форматирования задания. */
export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  fail('допустимы только JSON-значения');
}

export function checkRunInputs(value) {
  if (value?.schemaVersion !== SCHEMA_VERSION) fail('неподдерживаемая версия паспорта');
  text(value.runId, 'runId');
  checkIdentity(value.worker, 'worker');
  checkIdentity(value.runner, 'runner');
  checkRef(value.basePack, 'basePack');
  checkRef(value.candidate, 'candidate');
  if (!['server', 'client'].includes(value.kind)) fail('kind: server | client');
  if (!Array.isArray(value.args) || value.args.some((v) => typeof v !== 'string')) fail('args — массив строк');
  canonicalJson(value);
  return value;
}

/** Процесс может завершиться успешно, а проверки — провалиться или отсутствовать. */
export function createResult({ runId, inputs, process: outcome, checks = [], artifacts = [], error = null }) {
  text(runId, 'runId');
  checkRef(inputs, 'inputs');
  if (!outcome || !['exited', 'cancelled', 'error', 'timeout'].includes(outcome.status))
    fail('неизвестный исход процесса');
  if (outcome.status === 'exited' && !Number.isInteger(outcome.exitCode)) fail('нужен код завершения');
  for (const check of checks) {
    text(check.name, 'check.name');
    if (!['passed', 'failed', 'unknown'].includes(check.status)) fail('неизвестный исход проверки');
  }
  for (const artifact of artifacts) {
    text(artifact.name, 'artifact.name');
    text(artifact.path, 'artifact.path');
  }
  const verdict =
    outcome.status !== 'exited' || outcome.exitCode !== 0 || checks.some((c) => c.status === 'failed')
      ? 'failed'
      : !checks.length || checks.some((c) => c.status === 'unknown')
        ? 'unknown'
        : 'passed';
  const result = { schemaVersion: SCHEMA_VERSION, runId, inputs, process: outcome, checks, verdict, artifacts, error };
  canonicalJson(result);
  return result;
}
