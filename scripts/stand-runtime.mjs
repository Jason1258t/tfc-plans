/** Состояние checkout очереди: никакого reset или автоматической потери локальных коммитов. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    const indexLock = indexLockStatus(repo);
    return {
      indexLock,
      ok: !indexLock && head === upstream && branch === 'main' && !dirty,
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
      indexLock: indexLockStatus(repo),
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

/** Отсутствие владельца не доказывает безопасность: возраст, git-процессы и flock проверяются отдельно. */
export function indexLockStatus(repo) {
  try {
    const file = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-path', 'index.lock'], {
      encoding: 'utf8',
    }).trim();
    if (!fs.existsSync(file)) return null;
    const st = fs.lstatSync(file);
    // comm не содержит аргументов с ключами и работает на Linux и macOS.
    const gitProcesses = execFileSync('ps', ['-eo', 'pid=,comm='], { encoding: 'utf8', timeout: 5000 })
      .split('\n')
      .flatMap((line) => {
        const match = /^\s*(\d+)\s+(.+)$/.exec(line);
        return match && path.basename(match[2]) === 'git' ? [{ pid: Number(match[1]), command: match[2] }] : [];
      });
    return {
      file,
      ageSeconds: Math.floor((Date.now() - st.mtimeMs) / 1000),
      uid: st.uid,
      size: st.size,
      regular: st.isFile(),
      gitProcesses,
      recovery:
        'Остановите свободного исполнителя; вызовите node scripts/stand-runtime.mjs --recover (сам берёт flock очереди). Файл будет сохранён, локальные изменения и коммиты не сбрасываются.',
    };
  } catch (e) {
    return { error: e.message };
  }
}

/** Вызывается только под flock очереди; подозрительную или занятую блокировку не трогаем. */
export function recoverIndexLock(repo, queue) {
  const status = runtimeStatus(repo, { refresh: true });
  const lock = status.indexLock;
  if (!lock || lock.error || !lock.regular || lock.size !== 0 || lock.ageSeconds < 3600 || lock.gitProcesses.length)
    throw new Error(`Блокировка не признана старой и свободной: ${JSON.stringify(lock)}`);
  if (status.dirty || status.branch !== 'main' || status.ahead !== 0 || !Number.isInteger(status.behind))
    throw new Error('Восстановление запрещено: checkout dirty, diverged или неизвестен');
  const current = JSON.parse(fs.readFileSync(path.join(queue, 'current.json'), 'utf8'));
  if (current) throw new Error('Очередь занята');
  try {
    const worker = JSON.parse(fs.readFileSync(path.join(queue, 'worker.json'), 'utf8'));
    let alive = false;
    try {
      process.kill(worker.pid, 0);
      alive = true;
    } catch {
      /* Уже вышел. */
    }
    if (alive) throw new Error('Исполнитель ещё работает');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const backup = path.join(queue, `stale-index-lock-${Date.now()}`);
  fs.renameSync(lock.file, backup);
  execFileSync('git', ['-C', repo, 'merge', '--ff-only', 'origin/main'], { encoding: 'utf8' });
  return { backup, runtime: requireCurrentRuntime(runtimeStatus(repo)) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const repo = process.cwd();
    const queue = process.env.TFC_STAND_QUEUE ?? path.join(process.env.HOME, 'tfc-stand/queue');
    if (process.argv.includes('--recover')) {
      execFileSync(
        'flock',
        ['-n', path.join(queue, 'lock'), process.execPath, fileURLToPath(import.meta.url), '--recover-locked'],
        { stdio: 'inherit' },
      );
    } else if (process.argv.includes('--recover-locked')) {
      console.log(JSON.stringify(recoverIndexLock(repo, queue)));
    } else console.log(JSON.stringify(runtimeStatus(repo, { refresh: true })));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
