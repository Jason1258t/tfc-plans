/**
 * Jar сборки (mods/): оглавление, чтение файла, javap. Оглавление читается из центрального каталога zip
 * (без распаковки и без зависимостей) и держится в памяти, пока jar не поменялся.
 *
 * Кроме jar из mods/ есть ещё два вида архивов (для кода: классы, миксины, декомпиляция):
 *   - вложенные библиотеки jar-in-jar: id «<jar>!META-INF/jarjar/<lib>.jar» (по metadata.json, как у загрузчика);
 *   - Minecraft + NeoForge с именами Mojang (platform): классы и исходники из кеша сборки аддонов
 *     (tools/<мод>/build/moddev/artifacts) или TFC_PLATFORM_JAR / TFC_PLATFORM_SOURCES.
 * jarList() — только jar из mods/, как раньше; jarToc/readEntry/resolveJar понимают все виды.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MODS, mods } from './data.mjs';

/** Источник байтов zip: файл на диске или буфер (вложенный jar) */
function source(src) {
  if (Buffer.isBuffer(src))
    return { size: src.length, read: (buf, pos) => src.copy(buf, 0, pos, pos + buf.length), close() {} };
  const fd = fs.openSync(src, 'r');
  return {
    size: fs.fstatSync(fd).size,
    read: (buf, pos) => fs.readSync(fd, buf, 0, buf.length, pos),
    close: () => fs.closeSync(fd),
  };
}

/** Записи zip: { name, method, csize, size, off }; file — путь или Buffer */
export function zipEntries(file) {
  const src = source(file);
  const fd = { read: (buf, pos) => src.read(buf, pos) };
  try {
    const size = src.size;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fd.read(tail, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw new Error(`${Buffer.isBuffer(file) ? 'вложенный jar' : path.basename(file)}: не zip`);
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOff = tail.readUInt32LE(eocd + 16);
    if ((cdOff === 0xffffffff || count === 0xffff) && eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
      const z = Buffer.alloc(56);
      fd.read(z, Number(tail.readBigUInt64LE(eocd - 20 + 8)));
      count = Number(z.readBigUInt64LE(32));
      cdSize = Number(z.readBigUInt64LE(40));
      cdOff = Number(z.readBigUInt64LE(48));
    }
    const cd = Buffer.alloc(cdSize);
    fd.read(cd, cdOff);
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
    src.close();
  }
}

/** Содержимое записи zip; file — путь или Buffer */
export function zipRead(file, e) {
  const src = source(file);
  try {
    const h = Buffer.alloc(30);
    src.read(h, e.off);
    const start = e.off + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
    const data = Buffer.alloc(e.csize);
    src.read(data, start);
    if (e.method === 0) return data;
    if (e.method === 8) return zlib.inflateRawSync(data);
    throw new Error(`сжатие ${e.method} не поддерживается`);
  } finally {
    src.close();
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

// ---------------------------------------------------------------- Minecraft + NeoForge (platform)

/** Последняя версия NeoForge в кеше сборки аддонов: { classes, sources, version } или null */
function findPlatform() {
  if (process.env.TFC_PLATFORM_JAR) {
    const classes = process.env.TFC_PLATFORM_JAR;
    const sources = process.env.TFC_PLATFORM_SOURCES ?? classes.replace(/\.jar$/, '-sources.jar');
    const version = path.basename(classes).match(/\d+\.\d+\.\d+/)?.[0] ?? '?';
    return { classes, sources: fs.existsSync(sources) ? sources : null, version };
  }
  const found = [];
  const tools = path.join(PLATFORM_ROOT, 'tools');
  // tools/<мод>/build/… и на уровень глубже (tools/<мод>/devserver/build/… — тестовый сервер аддона)
  const dirs = [];
  for (const mod of fs.existsSync(tools) ? fs.readdirSync(tools) : []) {
    const base = path.join(tools, mod);
    if (!fs.statSync(base).isDirectory()) continue;
    dirs.push(path.join(base, 'build/moddev/artifacts'));
    for (const sub of fs.readdirSync(base))
      if (!['build', 'src', 'node_modules', '.gradle'].includes(sub))
        dirs.push(path.join(base, sub, 'build/moddev/artifacts'));
  }
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^neoforge-(\d+)\.(\d+)\.(\d+)\.jar$/);
      // Без исходников версия хуже: decompile Minecraft берёт их из -sources.jar
      if (m)
        found.push({
          dir,
          f,
          v: m.slice(1).map(Number),
          src: fs.existsSync(path.join(dir, f.replace(/\.jar$/, '-sources.jar'))),
        });
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => a.src - b.src || a.v[0] - b.v[0] || a.v[1] - b.v[1] || a.v[2] - b.v[2]);
  const { dir, f, v } = found.at(-1);
  const sources = path.join(dir, f.replace(/\.jar$/, '-sources.jar'));
  return { classes: path.join(dir, f), sources: fs.existsSync(sources) ? sources : null, version: v.join('.') };
}

/** Корень основной копии (рядом с mods/): там лежит tools/ с кешем NeoForge */
const PLATFORM_ROOT = process.env.TFC_PACK_ROOT ?? path.dirname(MODS);
let platformCache;
export function platform() {
  if (platformCache === undefined) platformCache = findPlatform();
  return platformCache;
}

/**
 * Запасные ресурсы платформы, когда NeoForge platform нет (сервер сборки): client.jar Minecraft (классы в нём
 * обфусцированы, поэтому рядом — карта имён Mojang), universal jar NeoForge. Ставит scripts/mods/platform-assets.mjs.
 */
let assetJars = { minecraft: null, neoforge: null, mappings: null };
export function setPlatformAssets(jars) {
  assetJars = { ...assetJars, ...jars };
}
export const platformAssets = () => assetJars;
/** id архива Minecraft + NeoForge в ответах */
export const PLATFORM = 'minecraft';
export const PLATFORM_SOURCES = 'minecraft-sources';

// ---------------------------------------------------------------- архивы: jar модов, вложенные, platform

const NESTED = /^META-INF\/jarjar\/[^/]+\.jar$/;
const nestedBufs = new Map(); // id → { sig, buf }; последние 12

/** Признак изменения архива без чтения: время файла (у вложенного — внешнего jar) */
function archiveSig(id) {
  if (id === PLATFORM || id === PLATFORM_SOURCES) {
    const p = platform();
    const file = id === PLATFORM ? p?.classes : p?.sources;
    if (!file)
      throw new Error(`нет ${id}: NeoForge с именами Mojang не найден (соберите аддон из tools/ или TFC_PLATFORM_JAR)`);
    return { file, sig: fs.statSync(file).mtimeMs };
  }
  // У вложенного признак — время внешнего jar из mods/: внутренние без него не меняются
  const bang = id.indexOf('!');
  const file = path.join(MODS, bang < 0 ? id : id.slice(0, bang));
  return { file: bang < 0 ? file : null, sig: fs.statSync(file).mtimeMs };
}

/** Байты архива для zipEntries/zipRead: путь к файлу или Buffer вложенного jar */
function archive(id) {
  const { file, sig } = archiveSig(id);
  if (file) return { src: file, sig };
  const c = nestedBufs.get(id);
  if (c && c.sig === sig) {
    nestedBufs.delete(id);
    nestedBufs.set(id, c);
    return { src: c.buf, sig };
  }
  // Родитель — всё до последнего «!» (сам может быть вложенным)
  const bang = id.lastIndexOf('!');
  const r = readEntry(id.slice(0, bang), id.slice(bang + 1));
  if (!r) throw new Error(`в ${id.slice(0, bang)} нет ${id.slice(bang + 1)}`);
  nestedBufs.set(id, { sig, buf: r.data });
  while (nestedBufs.size > 12) nestedBufs.delete(nestedBufs.keys().next().value);
  return { src: r.data, sig };
}

export function jarToc(jar) {
  const { sig } = archiveSig(jar);
  const c = tocCache.get(jar);
  if (c && c.sig === sig) return c.entries;
  const entries = zipEntries(archive(jar).src);
  tocCache.set(jar, { sig, entries, byName: new Map(entries.map((e) => [e.name, e])) });
  return entries;
}

const nestedCache = new Map(); // архив → { toc, list }
/** Вложенные jar одного архива по META-INF/jarjar/metadata.json (как у загрузчика: путь бывает и META-INF/jars/;
 *  без metadata.json вложенные jar не грузятся) */
function nestedOf(id) {
  const toc = jarToc(id);
  const c = nestedCache.get(id);
  if (c && c.toc === toc) return c.list;
  let list = [];
  const r = readEntry(id, 'META-INF/jarjar/metadata.json');
  if (r)
    try {
      list = (JSON.parse(r.data.toString('utf8')).jars ?? []).map((j) => j.path).filter((p) => typeof p === 'string');
    } catch {
      list = toc.filter((e) => NESTED.test(e.name)).map((e) => e.name);
    }
  const names = tocCache.get(id).byName;
  list = list.filter((p) => names.has(p)).map((p) => `${id}!${p}`);
  nestedCache.set(id, { toc, list });
  return list;
}

/** Все вложенные jar (jar-in-jar, и вложенные во вложенные): id «<jar>!<путь>[!<путь>]» */
export function nestedJars() {
  const out = [];
  const walk = (id, depth) => {
    for (const n of nestedOf(id)) {
      out.push(n);
      if (depth < 3) walk(n, depth + 1);
    }
  };
  for (const jar of jarList()) walk(jar, 1);
  return out;
}

/** Все архивы с кодом: jar модов, вложенные, Minecraft + NeoForge (если есть) */
export function allJars() {
  return [...jarList(), ...nestedJars(), ...(platform() ? [PLATFORM] : [])];
}

/** Файл архива на диске (для javap и декомпилятора): вложенный jar кладётся в кеш */
export function jarFile(jar) {
  if (jar === PLATFORM) return platform().classes;
  if (!jar.includes('!')) return path.join(MODS, jar);
  const { src, sig } = archive(jar);
  const dir = path.join(path.dirname(MODS), '.cache', 'mcp', 'nested');
  const file = path.join(dir, `${jar.replace(/[^\w.-]+/g, '_')}`);
  const stamp = `${file}.sig`;
  if (!fs.existsSync(file) || (fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8') : '') !== String(sig)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, src);
    fs.writeFileSync(stamp, String(sig));
  }
  return file;
}

/** jar по имени файла, имени без .jar, id мода из манифеста или однозначной части имени;
 *  all — ещё вложенные jar и Minecraft + NeoForge («minecraft», «neoforge») */
export function resolveJar(q, all = false) {
  const files = jarList();
  const s = String(q ?? '').trim();
  if (!s) throw new Error('не указан jar');
  if (files.includes(s)) return s;
  if (files.includes(`${s}.jar`)) return `${s}.jar`;
  const m = mods().get(s);
  if (m && files.includes(m.jar)) return m.jar;
  if (all && /^(minecraft|neoforge|mc|platform)$/i.test(s) && platform()) return PLATFORM;
  const low = s.toLowerCase();
  const hits = files.filter((f) => f.toLowerCase().includes(low));
  if (hits.length === 1) return hits[0];
  if (all && !hits.length) {
    const nested = nestedJars();
    if (nested.includes(s)) return s;
    const nh = nested.filter((f) =>
      f
        .slice(f.lastIndexOf('/') + 1)
        .toLowerCase()
        .includes(low),
    );
    if (nh.length > 1) {
      const exact = nh.filter((f) => f.slice(f.lastIndexOf('/') + 1).toLowerCase() === low);
      if (exact.length === 1) return exact[0];
    }
    if (nh.length === 1) return nh[0];
    if (nh.length) hits.push(...nh);
  }
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
  return { entry: e, data: zipRead(archive(jar).src, e) };
}

/** javap -c -p по классу внутри jar (имя через точки или путь .class) */
export function javap(jar, cls) {
  const name = cls.replace(/\.class$/, '').replaceAll('/', '.');
  return new Promise((resolve, reject) =>
    execFile(
      'javap',
      ['-c', '-p', '-constants', '-cp', jarFile(jar), name],
      { maxBuffer: 64 << 20, timeout: 60000 },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve(stdout)),
    ),
  );
}
