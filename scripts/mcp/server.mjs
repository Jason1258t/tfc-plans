#!/usr/bin/env node
/**
 * MCP-сервер сборки для агента (stdio): точечные запросы к предметам, рецептам, тегам, справочнику, конфигам,
 * гайдам и jar вместо grep по большим JSON. Подключение — .mcp.json в корне проекта; инструменты — tools.mjs.
 *
 * Протокол MCP здесь свой, минимальный (JSON-RPC 2.0 построчно: initialize, tools/list, tools/call, ping), без
 * @modelcontextprotocol/sdk: инструментам нужны только эти методы, а сервер сборки (server/pack-server), куда
 * этот код переедет на этапе 4, — Node без зависимостей. Ответы — только в stdout, журнал — в stderr.
 */
import readline from 'node:readline';
import { INSTRUCTIONS, TOOLS } from './tools.mjs';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const byName = new Map(TOOLS.map((t) => [t.name, t]));

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

async function handle(req) {
  switch (req.method) {
    case 'initialize': {
      const asked = req.params?.protocolVersion;
      return {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'tfc-pack', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case 'tools/call': {
      const tool = byName.get(req.params?.name);
      if (!tool) throw Object.assign(new Error(`нет инструмента ${req.params?.name}`), { code: -32602 });
      const t0 = Date.now();
      try {
        // Ответ — текст или { text, images: [Buffer PNG] } (model_render, texture_get): картинки — MCP image
        const r = await tool.handler(req.params.arguments ?? {});
        const text = typeof r === 'string' ? r : String(r.text ?? '');
        const images = typeof r === 'string' ? [] : (r.images ?? []);
        console.error(`[tfc-pack] ${tool.name} ${Date.now() - t0} мс, ${text.length} симв., картинок ${images.length}`);
        return {
          content: [
            { type: 'text', text },
            ...images.map((b) => ({ type: 'image', data: b.toString('base64'), mimeType: 'image/png' })),
          ],
        };
      } catch (e) {
        console.error(`[tfc-pack] ${tool.name}: ${e.stack ?? e}`);
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
  // Уведомления (без id) — notifications/initialized, cancelled — ответа не ждут
  if (req.id === undefined || req.id === null) return;
  try {
    send({ id: req.id, result: await handle(req) });
  } catch (e) {
    send({ id: req.id, error: { code: e.code ?? -32603, message: e.message ?? String(e) } });
  }
});
rl.on('close', () => process.exit(0));
