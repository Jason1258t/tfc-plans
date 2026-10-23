#!/usr/bin/env node
/**
 * MCP-сервер tfc-plans-dev (stdio): git/workflow — ворктри, ветки, коммит, сдача (merge → push → cleanup).
 * Отдельный от tfc-pack (scripts/mcp) пакет: только операции над репозиторием проекта, без данных пака.
 * Протокол — тот же минимальный JSON-RPC построчно, без зависимостей. Ответы — в stdout, журнал — в stderr.
 */
import readline from 'node:readline';
import { INSTRUCTIONS, TOOLS } from './tools.mjs';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const byName = new Map(TOOLS.map((t) => [t.name, t]));

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

async function handle(req) {
  switch (req.method) {
    case 'initialize':
      return {
        protocolVersion: VERSIONS.includes(req.params?.protocolVersion) ? req.params.protocolVersion : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'tfc-plans-dev', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case 'tools/call': {
      const tool = byName.get(req.params?.name);
      if (!tool) throw Object.assign(new Error(`нет инструмента ${req.params?.name}`), { code: -32602 });
      const t0 = Date.now();
      try {
        const r = await tool.handler(req.params.arguments ?? {});
        const text = typeof r === 'string' ? r : String(r.text ?? '');
        console.error(`[tfc-plans-dev] ${tool.name} ${Date.now() - t0} мс`);
        return { content: [{ type: 'text', text }] };
      } catch (e) {
        console.error(`[tfc-plans-dev] ${tool.name}: ${e.stack ?? e}`);
        return { content: [{ type: 'text', text: `Ошибка: ${e.message ?? e}` }], isError: true };
      }
    }
    default:
      throw Object.assign(new Error(`метод ${req.method} не поддерживается`), { code: -32601 });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    send({ id: null, error: { code: -32700, message: 'не JSON' } });
    return;
  }
  if (req.id === undefined || req.id === null) return;
  try {
    send({ id: req.id, result: await handle(req) });
  } catch (e) {
    send({ id: req.id, error: { code: e.code ?? -32603, message: e.message ?? String(e) } });
  }
});
rl.on('close', () => process.exit(0));
