/**
 * Блокировка выкладки сайта, общая для всех ворктри одной копии репозитория (файл в git common dir). Второй запуск
 * не ждёт, а отказывается: дождавшись очереди, он выпустил бы сборку, собранную без изменений первого.
 * Между машинами не работает — там выручает сверка релиза в deploy-site.mjs.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Дольше выкладка не идёт: блокировка живого процесса старше этого считается зависшей (PID мог достаться другому) */
const STALE_MS = 30 * 60 * 1000;

const readOwner = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  try {
    return { text, ...JSON.parse(text) };
  } catch {
    return { text };
  }
};

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
};

/** Почему блокировка зависла, или null, если её держат */
function staleReason(file, owner) {
  if (Number.isInteger(owner.pid) && !pidAlive(owner.pid)) return `процесс ${owner.pid} завершился, не сняв её`;
  const age = Date.now() - (Date.parse(owner.startedAt) || fs.statSync(file).mtimeMs);
  return age > STALE_MS ? `ей больше ${STALE_MS / 60000} минут` : null;
}

/** Убрать зависшую блокировку. Переименование — чтобы из двух снимающих файл достался одному; чужую свежую возвращаем */
function removeStale(file, owner) {
  const moved = `${file}.stale-${process.pid}`;
  try {
    fs.renameSync(file, moved);
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  try {
    if (fs.readFileSync(moved, 'utf8') !== owner.text) fs.linkSync(moved, file);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  } finally {
    fs.rmSync(moved, { force: true });
  }
}

/** Взять блокировку или бросить ошибку с текстом, кто её держит. Возвращает функцию снятия. */
export function deployLock(root, log = console.log) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const file = path.join(common, 'deploy-site.lock');
  const id = randomUUID();
  const body = JSON.stringify({ id, pid: process.pid, root, startedAt: new Date().toISOString() });
  // Файл появляется сразу с содержимым (link), поэтому другой запуск не прочитает его пустым
  const tmp = `${file}.${id}`;
  fs.writeFileSync(tmp, body);
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.linkSync(tmp, file);
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let owner;
        try {
          owner = readOwner(file);
        } catch (err) {
          if (err.code === 'ENOENT') continue; // владелец только что снял
          throw err;
        }
        const stale = staleReason(file, owner);
        if (!stale) {
          throw new Error(
            `выкладку сайта уже ведёт процесс ${owner.pid ?? '?'} из ${owner.root ?? '?'}` +
              ` (начата ${owner.startedAt ?? 'неизвестно когда'}). Эта выкладка отменена, сайт не менялся.\n` +
              'Дождитесь её конца, обновите свою копию (в ней должен быть её коммит) и запустите снова. ' +
              `Блокировка: ${file}`,
          );
        }
        log(`снимаю зависшую блокировку: ${stale}`);
        removeStale(file, owner);
        continue;
      }
      const release = () => {
        try {
          if (readOwner(file).id === id) fs.rmSync(file, { force: true });
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
      };
      process.once('exit', release);
      return () => {
        process.removeListener('exit', release);
        release();
      };
    }
    throw new Error(`не удалось взять блокировку ${file}: её всё время кто-то занимает`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
