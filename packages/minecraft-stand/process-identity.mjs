/** Защита восстановления от PID reuse: Linux boot/start ticks, macOS — время старта процесса. */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
export function processIdentity(pid = process.pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Некорректный PID');
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return {
        pid,
        boot: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
        start: fields[19],
        zombie: fields[0] === 'Z',
      };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
      throw error;
    }
  }
  if (process.platform !== 'darwin') throw new Error('Очередь поддерживает Linux и macOS');
  let start;
  try {
    start = execFileSync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'stat='], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
    }).trim();
  } catch (error) {
    if (error.status === 1) return null;
    throw error;
  }
  if (!start) return null;
  return { pid, boot: 'darwin', start: start.slice(0, 24), zombie: start.slice(24).trim().startsWith('Z') };
}
export function processAlive(expected) {
  if (expected?.exited === true) return false;
  if (!expected || !Number.isSafeInteger(expected.pid)) throw new Error('Нет паспорта процесса для восстановления');
  let current;
  try {
    current = processIdentity(expected.pid);
  } catch (error) {
    if (process.platform === 'darwin' && error.status === 1) return false;
    throw error;
  }
  return Boolean(current && !current.zombie && current.boot === expected.boot && current.start === expected.start);
}

/** Атомарная запись identity до разрешения дочернему процессу выполнять задание. */
export function recordProcess(file, pid) {
  const identity = processIdentity(pid) ?? { pid, exited: true };
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(identity));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return identity;
}
