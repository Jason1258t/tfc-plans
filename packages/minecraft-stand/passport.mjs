/** Байты паспорта и отдельные идентификаторы инструмента и кандидата. */
import { createHash } from 'node:crypto';
import { canonicalJson, checkRunInputs, TOOL_VERSION } from './contract.mjs';
export const digest = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Адаптер старой очереди: явно помечает checkout вместо выдачи его за выпущенный worker. */
export function legacyPassport({ id, kind, args, snapshot, runtime, inputFiles, workerHead }) {
  return checkRunInputs({
    schemaVersion: 1,
    runId: id,
    kind,
    args,
    worker: { version: `legacy-checkout:${workerHead}`, sha256: digest({ workerHead, contract: TOOL_VERSION }) },
    runner: { version: `legacy-checkout:${runtime.head}`, sha256: runtime.sha256 },
    basePack: { id: snapshot.id, sha256: snapshot.sha256 },
    candidate: { sha256: digest({ args, files: inputFiles }), files: inputFiles },
    compatibility: 'legacy-args',
  });
}
