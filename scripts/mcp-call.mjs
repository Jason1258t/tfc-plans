#!/usr/bin/env node
/**
 * Разовый вызов инструмента локального MCP-сервера из командной строки: для агентов, у которых сервер не подключён
 * или тайм-аут вызова короче стенда. Серверы — из .mcp.json; протокол — тот же JSON-RPC построчно (scripts/mcp/server.mjs).
 *
 *   node scripts/mcp-call.mjs                                  серверы
 *   node scripts/mcp-call.mjs tfc-pack                         инструменты сервера
 *   node scripts/mcp-call.mjs tfc-pack item_get --schema       параметры инструмента
 *   node scripts/mcp-call.mjs tfc-pack item_get '{"id":"tfc:powder/flux"}'
 *   node scripts/mcp-call.mjs tfc-pack pack_devserver @args.json --timeout 1200
 *
 * Аргументы: JSON в строке, @файл или «-» (stdin). Флаги: --timeout <с> (300, 0 — без предела), --out <папка> для
 * картинок (иначе временная), --json (ответ сервера как есть), --verbose (журнал сервера в stderr).
 * Выход: 0 — успех, 1 — ошибка инструмента или сервера, 2 — неверный вызов, 124 — истёк тайм-аут.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TIMEOUT = 300;

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { positional: [], timeout: DEFAULT_TIMEOUT, out: null, json: false, verbose: false, schema: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--timeout') {
      opts.timeout = Number(argv[++i]);
      if (!Number.isFinite(opts.timeout) || opts.timeout < 0) throw new UsageError('--timeout: нужно число секунд');
    } else if (a === '--out') {
      opts.out = argv[++i];
      if (!opts.out) throw new UsageError('--out: нужна папка');
    } else if (a === '--json') opts.json = true;
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--schema') opts.schema = true;
    else if (a.startsWith('--')) throw new UsageError(`неизвестный флаг ${a}`);
    else opts.positional.push(a);
  }
  if (opts.positional.length > 3) throw new UsageError('лишние аргументы: JSON нужно передать одной строкой');
  return opts;
}

function readToolArgs(raw) {
  if (raw === undefined) return {};
  let text = raw;
  if (raw === '-') text = fs.readFileSync(0, 'utf8');
  else if (raw.startsWith('@')) text = fs.readFileSync(raw.slice(1), 'utf8');
  let args;
  try {
    args = JSON.parse(text);
  } catch (e) {
    throw new UsageError(`аргументы — не JSON: ${e.message}`);
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args))
    throw new UsageError('аргументы — должен быть JSON-объект');
  return args;
}

/** Сеанс с сервером: запрос → ответ по id; поток ошибок копится для сообщения о падении */
function connect(server, { timeout, verbose }) {
  // Своя переменная важнее записи ${VAR:-default} из .mcp.json; `node` — этот же, в GUI-агенте PATH может быть другим
  const child = spawn(server.command === 'node' ? process.execPath : server.command, server.args ?? [], {
    cwd: ROOT,
    env: { ...server.env, ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let stderr = '';
  let failure = null;
  const fail = (e) => {
    failure ??= e;
    for (const { reject } of pending.values()) reject(failure);
    pending.clear();
  };
  child.stderr.on('data', (chunk) => {
    if (verbose) process.stderr.write(chunk);
    stderr = (stderr + chunk).slice(-4000);
  });
  child.on('error', (e) => fail(new Error(`сервер не запустился: ${e.message}`)));
  child.on('exit', (code, signal) => {
    const log = stderr.trim();
    fail(new Error(`сервер завершился (${signal ?? code}) до ответа${log && !verbose ? `:\n${log}` : ''}`));
  });
  child.stdin.on('error', () => {}); // сервер упал — причину сообщит exit
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // не протокол: сервер пишет журнал только в stderr, но чужой вывод не должен ронять вызов
    }
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message));
    else waiter.resolve(msg.result);
  });
  const timer = timeout
    ? setTimeout(() => {
        fail(Object.assign(new Error(`нет ответа за ${timeout} с — увеличь --timeout`), { code: 'TIMEOUT' }));
        child.kill();
      }, timeout * 1000)
    : null;

  let nextId = 1;
  return {
    request(method, params) {
      if (failure) return Promise.reject(failure);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify(method) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    },
    close() {
      clearTimeout(timer);
      child.removeAllListeners('exit');
      child.stdin.end(); // конец stdin завершает сервер; его долгоживущие потомки вызов не держат
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    },
  };
}

function saveImage(item, dir, tool, index) {
  fs.mkdirSync(dir, { recursive: true });
  const ext = item.mimeType?.split('/')[1] ?? 'png';
  const file = path.join(dir, `${tool}-${Date.now()}-${index}.${ext}`);
  fs.writeFileSync(file, Buffer.from(item.data, 'base64'));
  return file;
}

function printResult(result, tool, opts) {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const dir = opts.out ?? fs.mkdtempSync(path.join(os.tmpdir(), 'tfc-mcp-'));
  const out = result.isError ? process.stderr : process.stdout;
  (result.content ?? []).forEach((item, i) => {
    if (item.type === 'text') out.write(`${item.text}\n`);
    else if (item.type === 'image') out.write(`Картинка: ${saveImage(item, dir, tool, i)}\n`);
    else out.write(`[${item.type}]\n`);
  });
  if (!opts.out && !fs.readdirSync(dir).length) fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { mcpServers } = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  const [serverName, tool, rawArgs] = opts.positional;
  if (!serverName) {
    console.log(`Серверы: ${Object.keys(mcpServers).join(', ')}`);
    return;
  }
  const server = mcpServers[serverName];
  if (!server) throw new UsageError(`нет сервера ${serverName}. Есть: ${Object.keys(mcpServers).join(', ')}`);
  const args = tool && !opts.schema ? readToolArgs(rawArgs) : {};

  const conn = connect(server, opts);
  try {
    await conn.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'tfc-mcp-call', version: '1.0.0' },
    });
    conn.notify('notifications/initialized');

    if (!tool || opts.schema) {
      const { tools } = await conn.request('tools/list', {});
      if (!tool) {
        for (const t of tools) console.log(`${t.name} — ${t.description.split(/(?<=\.)\s/)[0]}`);
        return;
      }
      const found = tools.find((t) => t.name === tool);
      if (!found) throw new UsageError(`нет инструмента ${tool} на сервере ${serverName}`);
      console.log(`${found.description}\n${JSON.stringify(found.inputSchema, null, 2)}`);
      return;
    }

    const result = await conn.request('tools/call', { name: tool, arguments: args });
    printResult(result, tool, opts);
    if (result.isError) process.exitCode = 1;
  } finally {
    conn.close();
  }
}

main().catch((e) => {
  console.error(`Ошибка: ${e.message}`);
  process.exitCode = e instanceof UsageError ? 2 : e.code === 'TIMEOUT' ? 124 : 1;
});
