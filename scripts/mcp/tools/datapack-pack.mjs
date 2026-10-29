/** Живой снимок и точный ZIP датапака — отдельно от редактируемой карточки Firestore. Только чтение. */
import { zipName } from '@tfc/core/datapackFiles';
import { createHash } from 'node:crypto';
import { datapackCatalog, resolveDatapacks } from '../../../cli/lib/datapacks.mjs';
import { inspectDatapack, isPackDatapackPath } from '../../../server/pack-server/lib/datapacks.mjs';
import { packServer } from '../../pack-fetch.mjs';
import { page, paging, str } from '../fmt.mjs';

function packApi() {
  const server = packServer();
  if (!server) throw new Error('Нужен ключ сервера сборки: tfc login или TFC_PACK_URL/TFC_PACK_TOKEN');
  async function request(url, raw = false) {
    let response;
    try {
      response = await fetch(server.url + url, {
        headers: { Authorization: `Bearer ${server.token}` },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error('Сервер сборки недоступен или не ответил за 15 секунд');
    }
    if (!response.ok) {
      const error = new Error(
        `Сервер сборки: HTTP ${response.status}${response.status === 401 ? ' — проверьте ключ tfc login' : ''}`,
      );
      error.status = response.status;
      throw error;
    }
    return raw ? Buffer.from(await response.arrayBuffer()) : response.json();
  }
  return {
    get: (url) => request(url),
    current: async () => {
      try {
        return await request('/pack/current');
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
    bytes: (url) => request(url, true),
  };
}

export async function datapacksInventory(args = {}) {
  const c = await datapackCatalog(packApi(), { refresh: args.refresh === true });
  const query = String(args.query ?? '').toLowerCase();
  const list = c.items.filter((d) =>
    `${d.id} ${d.name} ${d.fileName ?? zipName(d)} ${d.deployment?.fileName ?? ''} ${d.deployment?.path ?? d.sourcePath ?? ''}`
      .toLowerCase()
      .includes(query),
  );
  return [
    `Живой снимок: ${c.snapshot?.id ?? 'не опубликован'}. MCP: 0 прямых чтений Firestore (карточки читает сервер). Карточки: ${args.refresh ? 'перечитаны' : 'серверный кеш до 5 минут; refresh=true — перечитать'}.`,
    page(list, args, (d) => {
      const pin = d.deployment;
      return [
        `${d.id} — ${d.name}; ${pin ? `В СБОРКЕ: ${pin.path}; ZIP ${pin.sha256}; содержимое ${pin.contentHash}` : d.sourcePath ? `ZIP мира: ${d.sourcePath}; ZIP ${d.sha256}; содержимое ${d.contentHash ?? 'не прочитано'}` : `карточка сайта: ${d.install ? 'предлагать в мир' : 'тестовая'}; содержимое ${d.contentHash}`}`,
        `  ${d.sourceMissing ? 'Карточки сайта нет' : d.snapshotSource ? 'Источник — ZIP снимка, карточки сайта нет' : `Ревизия карточки в ответе сервера (для записи перечитайте datapack_get): ${d.revision}`}${pin && !d.sourceMissing && pin.contentHash !== d.contentHash ? '; есть новая неподтверждённая редакция' : ''}`,
        `  Догрузить: tfc datapacks pull ${d.id}`,
      ];
    }),
  ].join('\n');
}

export async function datapackPackGet(args) {
  const api = packApi();
  const c = await datapackCatalog(api);
  const [d] = await resolveDatapacks(api, c, c.items, [args.id]);
  let file = c.snapshot?.files.find((f) => f.path === (d.deployment?.path ?? d.sourcePath));
  if (!file) {
    // ZIP с ручным именем может соответствовать карточке по содержимому.
    for (const f of c.snapshot?.files ?? []) {
      if (!f.path.endsWith('.zip') || !(f.kind === 'world-datapack' || isPackDatapackPath(f.path))) continue;
      try {
        if (inspectDatapack(await api.bytes(`/blobs/${f.sha256}`)).contentHash === d.contentHash) {
          file = f;
          break;
        }
      } catch {
        /* Повреждённый ZIP не считаем совпадением. */
      }
    }
  }
  if (!file)
    throw new Error(
      'У этой карточки нет ZIP в снимке. Исходник — datapack_get; установить для проверки — tfc datapacks pull <id>',
    );
  const bytes = await api.bytes(`/blobs/${file.sha256}`);
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
    throw new Error('ZIP пришёл повреждённым: sha256 не совпал');
  const pack = inspectDatapack(bytes);
  const header = `${d.id} — ${d.name}\nСнимок ${c.snapshot.id}; ${d.deployment ? 'подтверждённая версия сборки' : 'ZIP уровня мира'}: ${file.path}\nZIP ${file.sha256}; содержимое ${pack.contentHash}\nMCP: 0 прямых чтений Firestore; карточки — серверный кеш до 5 минут.\nРевизии снимка/подтверждения не подходят для записи: текущую baseRevision берите из datapack_get.`;
  const paths = Object.keys(pack.files).sort();
  if (!args.path) return `${header}\n${page(paths, args, (p) => [`${p} (${pack.files[p].length} Б)`])}`;
  const matched = paths.filter((p) => p === args.path || p.endsWith(args.path));
  const target = paths.includes(args.path) ? args.path : matched.length === 1 ? matched[0] : null;
  if (!target)
    throw new Error(
      matched.length ? 'Несколько файлов с таким окончанием — укажите полный путь' : 'Нет такого файла в ZIP',
    );
  let decoded;
  try {
    decoded = new TextDecoder('utf8', { fatal: true }).decode(pack.files[target]);
  } catch {
    throw new Error('Это двоичный файл; доступен список путей и sha256 ZIP, чтение текста не поддерживается');
  }
  if (decoded.includes('\0')) throw new Error('Это двоичный файл, чтение текста не поддерживается');
  const lines = decoded.split('\n');
  return `${header}\n${target}\n${page(lines, args, (line, i) => [`${i + 1}: ${line}`], 100)}`;
}

export const TOOLS = [
  {
    name: 'datapacks_inventory',
    description:
      'Read-only live pack-server datapack inventory: site cards, world ZIPs and confirmed pack ZIPs, ids/hashes/paths and pull commands. Player key from tfc config or TFC_PACK_URL/TFC_PACK_TOKEN; refresh=true rereads source cards (Firestore reads on server). Published static data may lag this inventory.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('id, name or filename words'),
        refresh: { type: 'boolean', description: 'bypass the five-minute source-card cache' },
        ...paging,
      },
    },
    handler: datapacksInventory,
  },
  {
    name: 'datapack_pack_get',
    description:
      'Read exact files from a datapack ZIP in the current live snapshot, including confirmed ZIPs without site cards. Does not return the editable draft; use datapack_get for source/current baseRevision and datapack_put to edit. Read-only, requires pack-server player key.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('id, exact name or filename'),
        path: str('file within the ZIP; omitted lists files'),
        ...paging,
      },
      required: ['id'],
    },
    handler: datapackPackGet,
  },
];
