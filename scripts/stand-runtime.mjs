/** Состояние checkout очереди: никакого reset или автоматической потери локальных коммитов. */
import { execFileSync } from 'node:child_process';

export function runtimeStatus(repo, { refresh = false } = {}) {
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    if (refresh) git('fetch', '-q', 'origin', 'main');
    const head = git('rev-parse', 'HEAD');
    const upstream = git('rev-parse', 'origin/main');
    const branch = git('branch', '--show-current');
    const dirty = Boolean(git('status', '--porcelain', '--untracked-files=normal'));
    const [ahead, behind] = git('rev-list', '--left-right', '--count', 'HEAD...origin/main').split(/\s+/).map(Number);
    return {
      ok: head === upstream && branch === 'main' && !dirty,
      head,
      upstream,
      branch,
      dirty,
      ahead,
      behind,
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      ok: false,
      error: `Не удалось проверить runtime очереди: ${e.message}`,
      checkedAt: new Date().toISOString(),
    };
  }
}

export function requireCurrentRuntime(status) {
  if (!status.ok)
    throw new Error(
      `Runtime очереди не актуален: ${JSON.stringify(status)}. Восстановление с сохранением локальных коммитов — docs/state/infra.md, «Восстановление checkout очереди».`,
    );
  return status;
}
