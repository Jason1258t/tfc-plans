/** Проверки приёмки общие для client/server, исход процесса хранится отдельно. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { relativeFile } from './files.mjs';
export function validateCheck(check) {
  if (!['process-exit', 'log-contains', 'log-absent', 'file-exists'].includes(check.type))
    throw new Error(`Неизвестная проверка: ${check.type}`);
  if (['log-contains', 'log-absent'].includes(check.type) && (typeof check.text !== 'string' || !check.text))
    throw new Error(`Проверка ${check.id}: нужен text`);
  if (check.type === 'file-exists') relativeFile(check.path);
  if (check.type === 'process-exit' && check.code !== undefined && !Number.isInteger(check.code))
    throw new Error('Ожидаемый код — целое число');
}
export async function evaluateChecks(checks, { game, output, outcome }) {
  let logs = null;
  const result = [];
  for (const check of checks) {
    validateCheck(check);
    let passed;
    if (check.type === 'process-exit') passed = outcome.status === 'exited' && outcome.exitCode === (check.code ?? 0);
    else if (check.type === 'file-exists') {
      let current = game;
      passed = true;
      for (const part of check.path.split('/')) {
        current = path.join(current, part);
        const stat = await fs.lstat(current).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        });
        if (!stat || stat.isSymbolicLink()) {
          passed = false;
          break;
        }
      }
      if (passed) passed = (await fs.lstat(current)).isFile();
    } else {
      logs ??= (
        await Promise.all(['stdout.log', 'stderr.log'].map((name) => fs.readFile(path.join(output, name), 'utf8')))
      ).join('\n');
      passed = logs.includes(check.text) === (check.type === 'log-contains');
    }
    result.push({ name: check.id, status: passed ? 'passed' : 'failed' });
  }
  return result;
}
