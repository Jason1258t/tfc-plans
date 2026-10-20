/**
 * Jar сборки (mods/): оглавление, чтение файла, javap. Оглавление читается из центрального каталога zip
 * (без распаковки и без зависимостей) и держится в памяти, пока jar не поменялся.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MODS, mods } from './data.mjs';

/** Записи zip: { name, method, csize, size, off } */
export function zipEntries(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw new Error(`${path.basename(file)}: не zip`);
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOff = tail.readUInt32LE(eocd + 16);
    if ((cdOff === 0xffffffff || count === 0xffff) && eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
      const z = Buffer.alloc(56);
      fs.readSync(fd, z, 0, 56, Number(tail.readBigUInt64LE(eocd - 20 + 8)));
      count = Number(z.readBigUInt64LE(32));
      cdSize = Number(z.readBigUInt64LE(40));
      cdOff = Number(z.readBigUInt64LE(48));
    }
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const out = [];
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const e = {
        name: cd.toString('utf8', p + 46, p + 46 + nameLen),
        method: cd.readUInt16LE(p + 10),
        csize: cd.readUInt32LE(p + 20),
        size: cd.readUInt32LE(p + 24),
        off: cd.readUInt32LE(p + 42),
      };
      // ZIP64: настоящие размеры и смещение — в доп. поле 0x0001, по порядку, только у полей с 0xffffffff
      for (let x = p + 46 + nameLen; x + 4 <= p + 46 + nameLen + extraLen;) {
        const id = cd.readUInt16LE(x);
        const len = cd.readUInt16LE(x + 2);
        if (id === 1) {
          let q = x + 4;
          for (const k of ['size', 'csize', 'off'])
            if (e[k] === 0xffffffff) {
              e[k] = Number(cd.readBigUInt64LE(q));
              q += 8;
            }
        }
        x += 4 + len;
      }
      if (!e.name.endsWith('/')) out.push(e);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

export function zipRead(file, e) {
  const fd = fs.openSync(file, 'r');
  try {
    const h = Buffer.alloc(30);
    fs.readSync(fd, h, 0, 30, e.off);
    const start = e.off + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
    const data = Buffer.alloc(e.csize);
    fs.readSync(fd, data, 0, e.csize, start);
    if (e.method === 0) return data;
    if (e.method === 8) return zlib.inflateRawSync(data);
    throw new Error(`сжатие ${e.method} не поддерживается`);
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------- оглавление всех jar

const tocCache = new Map();
export function jarList() {
  if (!fs.existsSync(MODS)) throw new Error(`нет папки модов ${MODS}`);
  const files = fs
    .readdirSync(MODS)
    .filter((f) => f.endsWith('.jar'))
    .sort();
  if (!files.length) throw new Error(`в ${MODS} нет jar`);
  return files;
}

export function jarToc(jar) {
  const file = path.join(MODS, jar);
  const mtime = fs.statSync(file).mtimeMs;
  const c = tocCache.get(jar);
  if (c && c.mtime === mtime) return c.entries;
  const entries = zipEntries(file);
  tocCache.set(jar, { mtime, entries, byName: new Map(entries.map((e) => [e.name, e])) });
  return entries;
}

/** jar по имени файла, имени без .jar, id мода из манифеста или однозначной части имени */
export function resolveJar(q) {
  const files = jarList();
  const s = String(q ?? '').trim();
  if (!s) throw new Error('не указан jar');
  if (files.includes(s)) return s;
  if (files.includes(`${s}.jar`)) return `${s}.jar`;
  const m = mods().get(s);
  if (m && files.includes(m.jar)) return m.jar;
  const low = s.toLowerCase();
  const hits = files.filter((f) => f.toLowerCase().includes(low));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`jar «${s}» не найден (имя файла, его часть или id мода)`);
  throw new Error(`«${s}» подходит к нескольким jar: ${hits.slice(0, 15).join(', ')}${hits.length > 15 ? ' …' : ''}`);
}

/** Шаблон: со * / ? — glob (** — через «/»; без «/» — по имени файла), иначе часть пути или имени класса через точки */
export function pathMatcher(pattern) {
  const p = String(pattern ?? '').trim();
  if (!p) throw new Error('пустой шаблон');
  if (/[*?]/.test(p)) {
    const re = new RegExp(
      `^${p
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '§§')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/§§/g, '.*')}$`,
      'i',
    );
    return p.includes('/') ? (name) => re.test(name) : (name) => re.test(name.slice(name.lastIndexOf('/') + 1));
  }
  const low = p.toLowerCase();
  return (name) => {
    const n = name.toLowerCase();
    return n.includes(low) || n.replaceAll('/', '.').includes(low);
  };
}

export function readEntry(jar, name) {
  jarToc(jar);
  const e = tocCache.get(jar).byName.get(name.replace(/^\/+/, ''));
  if (!e) return null;
  return { entry: e, data: zipRead(path.join(MODS, jar), e) };
}

/** javap -c -p по классу внутри jar (имя через точки или путь .class) */
export function javap(jar, cls) {
  const name = cls.replace(/\.class$/, '').replaceAll('/', '.');
  return new Promise((resolve, reject) =>
    execFile(
      'javap',
      ['-c', '-p', '-constants', '-cp', path.join(MODS, jar), name],
      { maxBuffer: 64 << 20, timeout: 60000 },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve(stdout)),
    ),
  );
}
