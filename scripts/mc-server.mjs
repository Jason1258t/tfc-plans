/**
 * Общее для тестовых серверов Minecraft (addon_devserver, стенды сборки pack-stand.mjs и client-stand.mjs): Java 21,
 * RCON-клиент, сводка ошибок лога, завершение дерева процессов. Без зависимостей, на любой ОС.
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

/** Сколько ждать ответа: первая команда в новом мире TFC идёт, пока сервер догоняет генерацию спавна */
const RCON_IDLE_MS = 180000;

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
        sock.setTimeout(0); // пауза не считается зависшим сервером
        sleep(Number(c.split(/\s+/)[1]) * 1000).then(() => {
          sock.setTimeout(RCON_IDLE_MS);
          next();
        });
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
    sock.setTimeout(RCON_IDLE_MS);
    sock.on('timeout', () => {
      sock.destroy();
      if (authed) resolve(replies.join('\n'));
      else reject(new Error('RCON: сервер не ответил на авторизацию'));
    });
  });
}

/** Строки ошибок без повторов: «×N» у повторяющихся, шум (noiseRes) отдельно счётчиком */
export function errorLines(text, re, limit, noiseRes = []) {
  const counts = new Map();
  let noise = 0;
  for (const l of text.split(/\r?\n/)) {
    if (!re.test(l)) continue;
    if (noiseRes.some((n) => n.test(l))) {
      noise++;
      continue;
    }
    // Без метки времени, JSON рецепта и id: однотипные ошибки (16 цветов цемента, таблицы добычи) — одна группа
    const msg = l.replace(/^\[[^\]]*\]\s*/, '').trim();
    const key = msg.replace(/ from json \{.*$/, ' from json …').replace(/[a-z0-9_.-]+:[a-z0-9_/.-]+/g, '<id>');
    const g = counts.get(key);
    if (g) g.n++;
    else counts.set(key, { n: 1, first: msg.length > 300 ? msg.slice(0, 300) + '…' : msg });
  }
  const lines = [...counts.values()].map(({ n, first }) => (n > 1 ? `${first} ×${n}` : first));
  return { lines: lines.slice(0, limit), more: Math.max(0, lines.length - limit), noise };
}

/** Серверы, которых надо погасить вместе с этим процессом */
const owned = new Set();
let exitHooked = false;

/**
 * Погасить сервер вместе с этим процессом. Сервер запущен отдельной группой (detached) и сам не умрёт: при обрыве
 * вызова MCP (закрытый stdin, SIGTERM) он остался бы работать и занимать папку и порты. После SIGKILL не сработает.
 */
export function stopWithProcess(child) {
  owned.add(child);
  child.once('exit', () => owned.delete(child));
  if (exitHooked) return;
  exitHooked = true;
  process.on('exit', () => {
    for (const c of owned) killTree(c.pid);
  });
  // Без обработчика сигнал завершает процесс мимо события exit
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'])
    process.once(signal, () => process.exit(128 + os.constants.signals[signal]));
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
