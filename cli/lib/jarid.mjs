/**
 * id модов в jar — из META-INF/neoforge.mods.toml (или mods.toml). Нужен, чтобы после обновления мода не осталось
 * старого jar с тем же id под другим именем: два jar одного мода — игра не запустится.
 * Читает из zip только оглавление и один файл, а не весь jar.
 */
import fs from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const NAMES = ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml'];
const FABRIC = ['fabric.mod.json'];

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n);
}

/** Содержимое файла из zip или null; из нескольких имён — первое по порядку wanted, а не по порядку в архиве */
export function readZipEntry(file, wanted) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = readAt(fd, size - tailLen, tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) return null;
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = readAt(fd, cdOffset, cdSize);
    const found = new Map();
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
      const method = cd.readUInt16LE(p + 10);
      const compSize = cd.readUInt32LE(p + 20);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const local = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      p += 46 + nameLen + extraLen + commentLen;
      if (wanted.includes(name)) found.set(name, { method, compSize, local });
    }
    for (const name of wanted) {
      const e = found.get(name);
      if (!e) continue;
      const { method, compSize, local } = e;
      const lh = readAt(fd, local, 30);
      const dataStart = local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const data = readAt(fd, dataStart, compSize);
      return method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** id модов из jar: ['tfc'] или [] (не мод или не прочитался). Только разделы [[mods]], не [[dependencies.*]] */
export function modIdsOf(file) {
  try {
    const toml = readZipEntry(file, NAMES)?.toString('utf8');
    if (toml) {
      const ids = [];
      let inMods = false;
      for (const line of toml.split(/\r?\n/)) {
        const head = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?/.exec(line);
        if (head) inMods = head[1] === 'mods';
        const m = inMods && /^\s*modId\s*=\s*["']([a-z0-9_.-]+)["']/i.exec(line);
        if (m) ids.push(m[1]);
      }
      return ids;
    }
    // Мод Fabric через Sinytra Connector
    const fabric = readZipEntry(file, FABRIC)?.toString('utf8');
    const id = fabric && JSON.parse(fabric).id;
    return typeof id === 'string' ? [id] : [];
  } catch {
    return [];
  }
}
