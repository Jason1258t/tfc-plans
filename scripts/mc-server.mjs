/**
 * Общее для тестовых серверов Minecraft (addon_devserver, стенд сборки pack-stand.mjs): Java 21, RCON-клиент,
 * завершение дерева процессов. Без зависимостей, на любой ОС.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const isWin = process.platform === 'win32';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** JAVA_HOME тестового сервера: ~/.gradle/local-tools/jdk21 (macOS — Contents/Home, Windows/Linux — корень) */
export function javaHome() {
  const base = path.join(os.homedir(), '.gradle', 'local-tools', 'jdk21');
  for (const p of [path.join(base, 'Contents', 'Home'), base]) {
    const j = isWin ? path.join(p, 'bin', 'java.exe') : path.join(p, 'bin', 'java');
    if (fs.existsSync(j)) return p;
  }
  return process.env.JAVA_HOME ?? '';
}

/** Пакет RCON: [len][id][type][body][0][0] */
function rconPacket(id, type, body) {
  const data = Buffer.alloc(8 + Buffer.byteLength(body) + 2);
  data.writeInt32LE(id, 0);
  data.writeInt32LE(type, 4);
  data.write(body, 8);
  const out = Buffer.alloc(4 + data.length);
  out.writeInt32LE(data.length, 0);
  data.copy(out, 4);
  return out;
}

/** RCON-клиент: авторизация, команды по очереди («sleep N» — пауза), ответы текстом */
export function runRcon(port, password, commands) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const replies = [];
    let buf = Buffer.alloc(0);
    let authed = false;
    let idx = 0;
    let waiting = null;
    const next = () => {
      if (idx >= commands.length) {
        sock.end();
        resolve(replies.join('\n'));
        return;
      }
      const c = commands[idx++];
      if (/^sleep\s/.test(c)) {
        sleep(Number(c.split(/\s+/)[1]) * 1000).then(next);
        return;
      }
      waiting = c;
      sock.write(rconPacket(2, 2, c));
    };
    sock.on('connect', () => sock.write(rconPacket(1, 3, password)));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const len = buf.readInt32LE(0);
        if (buf.length < 4 + len) break;
        const pkt = buf.slice(0, 4 + len);
        buf = buf.slice(4 + len);
        const body = pkt.slice(12, 4 + len - 2).toString('utf8');
        if (!authed) {
          authed = true;
          next();
        } else {
          replies.push('> ' + waiting + '\n' + body);
          waiting = null;
          next();
        }
      }
    });
    sock.on('error', (e) => reject(e));
    sock.setTimeout(10000, () => {
      sock.destroy();
      if (authed) resolve(replies.join('\n'));
      else reject(new Error('RCON: сервер не ответил на авторизацию'));
    });
  });
}

/** Завершить дерево процессов gradlew */
export function killTree(pid) {
  if (isWin) execFile('taskkill', ['/F', '/T', '/PID', String(pid)], () => {});
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* уже умер */
      }
    }
  }
}
