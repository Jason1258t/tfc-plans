/** Проверенные датапаки сборки: одинаковое содержимое ZIP имеет один хеш независимо от сжатия и дат. */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const isPackDatapackPath = (p) => /^kubejs\/data\/[^/]+\.zip$/.test(p);
export const PACK_DATAPACK_RE = /^kubejs\/data\/tfc-plans-([A-Za-z0-9]{1,64})\.zip$/;
export const packDatapackPath = (id) => `kubejs/data/tfc-plans-${id}.zip`;
export const worldDatapackPath = (id) => `world/datapacks/tfc-plans-${id}.zip`;

export function datapackContentHash(files) {
  const hash = createHash('sha256');
  for (const name of Object.keys(files).sort()) {
    const bytes = Buffer.from(files[name]);
    hash.update(JSON.stringify([name, bytes.length]));
    hash.update(bytes);
  }
  return hash.digest('hex');
}

/** Ограниченный ZIP reader без зависимостей: серверу не нужно распаковывать пользовательские пути на диск. */
export function inspectDatapack(input) {
  const bytes = Buffer.from(input);
  if (bytes.length > 32 * 1024 ** 2) throw new Error('Датапак больше 32 МБ');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
      end = i;
      break;
    }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    throw new Error('Нужен обычный ZIP без разделения на тома');
  const count = bytes.readUInt16LE(end + 10);
  let pos = bytes.readUInt32LE(end + 16);
  const stop = pos + bytes.readUInt32LE(end + 12);
  if (count > 10000 || stop > end) throw new Error('Слишком большое оглавление ZIP');
  const files = Object.create(null);
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > stop || bytes.readUInt32LE(pos) !== 0x02014b50) throw new Error('Повреждён ZIP');
    const flags = bytes.readUInt16LE(pos + 8);
    const method = bytes.readUInt16LE(pos + 10);
    const compressed = bytes.readUInt32LE(pos + 20);
    const size = bytes.readUInt32LE(pos + 24);
    const nameLen = bytes.readUInt16LE(pos + 28);
    const offset = bytes.readUInt32LE(pos + 42);
    const next = pos + 46 + nameLen + bytes.readUInt16LE(pos + 30) + bytes.readUInt16LE(pos + 32);
    if (next > stop || flags & 1 || ![0, 8].includes(method)) throw new Error('Неподдерживаемый ZIP');
    const name = bytes.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos = next;
    if (name.endsWith('/')) continue;
    if (name.length > 400 || /[\\\0]/.test(name) || name.split('/').some((p) => !p || p === '.' || p === '..'))
      throw new Error('Недопустимый путь в ZIP');
    if (Object.hasOwn(files, name)) throw new Error(`Повтор пути ${name}`);
    total += size;
    if (total > 32 * 1024 ** 2 || offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50)
      throw new Error('Повреждённый или слишком большой ZIP');
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    if (start + compressed > stop) throw new Error('Оборван ZIP');
    const raw = bytes.subarray(start, start + compressed);
    const data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.max(1, size) });
    if (data.length !== size) throw new Error('Неверный размер файла в ZIP');
    files[name] = data;
  }
  if (!files['pack.mcmeta']) throw new Error('В корне ZIP нет pack.mcmeta');
  const meta = JSON.parse(files['pack.mcmeta'].toString('utf8'));
  if (!meta.pack || !Number.isInteger(meta.pack.pack_format)) throw new Error('Неверный pack.mcmeta');
  return { files, contentHash: datapackContentHash(files), description: meta.pack.description };
}

/** Источник истины — текущий снимок, а не отметка карточки или локальный state.json. */
export function deploymentsOf(snapshot) {
  return (snapshot?.datapacks ?? []).filter((d) =>
    snapshot.files.some((f) => f.path === d.path && f.sha256 === d.sha256),
  );
}
