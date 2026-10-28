/** Общая очередь выкладок всех ворктри одного репозитория. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

export async function deployLock(root, log = console.log) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const file = path.join(common, 'deploy-site.lock');
  let waiting = false;
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, root, startedAt: new Date().toISOString() }));
      fs.closeSync(fd);
      const release = () => {
        fs.rmSync(file, { force: true });
      };
      process.once('exit', release);
      return () => {
        process.removeListener('exit', release);
        release();
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (!waiting) {
        log(`другая выкладка заняла блокировку ${file}; ожидаю завершения…`);
        waiting = true;
      }
      // После аварийного убийства не удаляем чужую блокировку автоматически: PID мог быть переиспользован.
      try {
        const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
        try {
          process.kill(owner.pid, 0);
        } catch (err) {
          if (err.code === 'ESRCH')
            throw new Error(`Процесс ${owner.pid} завершён аварийно. Проверьте отсутствие выкладки и удалите ${file}`);
        }
      } catch (err) {
        if (!['ENOENT'].includes(err.code) && !(err instanceof SyntaxError)) throw err;
      }
      await setTimeout(1000);
    }
  }
}
