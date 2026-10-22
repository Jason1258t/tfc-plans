/**
 * Индекс кода сборки для MCP: все классы всех jar (с вложенными jar-in-jar и Minecraft + NeoForge), моды с
 * зависимостями из neoforge.mods.toml, конфиги миксинов. Строится в памяти при первом запросе (~3 с на ~60 тыс.
 * классов) и пересобирается по одному jar, когда тот поменялся.
 */
import { ACC, parseClassFull } from './bytecode.mjs';
import { PLATFORM, allJars, jarToc, platform, readEntry, zipEntries, zipRead } from './jars.mjs';

// ---------------------------------------------------------------- классы

const MIXIN = 'Lorg/spongepowered/asm/mixin/Mixin;';
const perJar = new Map(); // jar → { sig, classes: [{ name, path, super, ifaces, access, mixin? }] }

/** Цели @Mixin: классы из value и строки из targets (internal names) */
export function mixinTargets(ann) {
  const out = [];
  for (const v of [ann.values.value ?? []].flat()) if (v?.class) out.push(v.class.slice(1, -1));
  for (const v of [ann.values.targets ?? []].flat()) if (typeof v === 'string') out.push(v.replaceAll('.', '/'));
  return out;
}

function scanJar(jar) {
  const classes = [];
  for (const e of jarToc(jar)) {
    if (!e.name.endsWith('.class') || e.name.endsWith('module-info.class')) continue;
    // Многоверсионные jar: META-INF/versions/N/… — копии классов для новых Java, в индекс не берём
    if (e.name.startsWith('META-INF/')) continue;
    let c;
    try {
      c = parseClassFull(readEntry(jar, e.name).data);
    } catch {
      continue;
    }
    const rec = { name: c.name, path: e.name, super: c.superName, ifaces: c.interfaces, access: c.access, jar };
    const mx = c.annotations.find((a) => a.type === MIXIN);
    if (mx) {
      rec.mixin = mixinTargets(mx);
      if (typeof mx.values.priority === 'number') rec.priority = mx.values.priority;
      // @Pseudo: цель может отсутствовать — Mixin молча пропускает
      if (c.annotations.some((a) => a.type === 'Lorg/spongepowered/asm/mixin/Pseudo;')) rec.pseudo = true;
    }
    classes.push(rec);
  }
  return classes;
}

let index = null; // { toc, jars, byName: Map(name → [rec]), subs: Map(name → [rec]), mixinsOf: Map(target → [rec]), all: [rec] }

/** Индекс всех классов; пересобирается по jar, которые поменялись */
export function classIndex() {
  // Оглавление jar из кеша — тот же массив, пока jar не поменялся: по нему и видно, что пересобирать
  const jars = allJars();
  const toc = jars.map((j) => jarToc(j));
  if (index && index.toc.length === toc.length && index.toc.every((x, i) => x === toc[i])) return index;
  const all = [];
  for (const [i, jar] of jars.entries()) {
    let c = perJar.get(jar);
    if (!c || c.toc !== toc[i]) {
      c = { toc: toc[i], classes: scanJar(jar) };
      perJar.set(jar, c);
    }
    all.push(...c.classes);
  }
  for (const jar of perJar.keys()) if (!jars.includes(jar)) perJar.delete(jar);
  const byName = new Map();
  const subs = new Map();
  const mixinsOf = new Map();
  const push = (m, k, v) => (m.get(k) ?? m.set(k, []).get(k)).push(v);
  for (const r of all) {
    push(byName, r.name, r);
    if (r.super) push(subs, r.super, r);
    for (const i of r.ifaces) push(subs, i, r);
    for (const t of r.mixin ?? []) push(mixinsOf, t, r);
  }
  index = { toc, jars, all, byName, subs, mixinsOf };
  return index;
}

/** Имя класса из запроса: «net.foo.Bar», «net/foo/Bar», «Bar$Inner», «Bar» (если однозначно) → [internal names] */
export function findClasses(q, jar) {
  const s = String(q ?? '')
    .trim()
    .replace(/\.class$/, '')
    .replace(/^L(.+);$/, '$1');
  if (!s) throw new Error('не указан класс');
  const idx = classIndex();
  const internal = s.replaceAll('.', '/');
  const inJar = (n) => !jar || idx.byName.get(n).some((r) => r.jar === jar);
  if (idx.byName.has(internal) && inJar(internal)) return [internal];
  // Вложенный класс через точку: net.foo.Bar.Inner → net/foo/Bar$Inner
  const parts = internal.split('/');
  for (let k = parts.length - 1; k > 0; k--) {
    const n = `${parts.slice(0, k).join('/')}/${parts.slice(k).join('$')}`;
    if (idx.byName.has(n) && inJar(n)) return [n];
  }
  // Простое имя или хвост пути
  const tail = `/${internal}`;
  const low = internal.toLowerCase();
  const hits = [];
  for (const n of idx.byName.keys()) {
    if (!inJar(n)) continue;
    if (n.endsWith(tail) || n.slice(n.lastIndexOf('/') + 1) === internal) hits.push(n);
  }
  if (hits.length) return hits.sort();
  if (low.length >= 3)
    for (const n of idx.byName.keys())
      if (
        inJar(n) &&
        n
          .slice(n.lastIndexOf('/') + 1)
          .toLowerCase()
          .includes(low)
      )
        hits.push(n);
  return hits.sort();
}

/** Один класс по запросу или ошибка с вариантами */
export function oneClass(q, jar) {
  const hits = findClasses(q, jar);
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`класс «${q}» не найден ни в одном jar (class_find — поиск по части имени)`);
  throw new Error(
    `«${q}» — несколько классов, укажите полное имя:\n${hits
      .slice(0, 25)
      .map((h) => h.replaceAll('/', '.'))
      .join('\n')}${hits.length > 25 ? `\n… ещё ${hits.length - 25}` : ''}`,
  );
}

/** Записи класса (может быть в нескольких jar) и выбор одной: указанный jar, jar мода, потом platform */
export function classRecord(name, jar) {
  const recs = classIndex().byName.get(name) ?? [];
  if (jar) return recs.find((r) => r.jar === jar) ?? null;
  return recs.find((r) => !r.jar.includes('!') && r.jar !== PLATFORM) ?? recs[0] ?? null;
}

export function readClass(rec) {
  return parseClassFull(readEntry(rec.jar, rec.path).data);
}

/** Классы JDK и библиотек загрузчика, которых нет в индексе, но они точно есть в игре */
export const isRuntimeClass = (n) =>
  /^(java|javax|jdk|sun|com\/sun|org\/slf4j|org\/apache\/logging|com\/mojang\/(serialization|datafixers|brigadier|logging|authlib|blaze3d)|com\/google|it\/unimi|io\/netty|org\/joml|org\/lwjgl|org\/spongepowered|cpw\/mods|net\/neoforged\/(fml|bus|neoforgespi))\//.test(
    n,
  );

/** Цепочка предков: [{ name, rec|null }] до java/lang/Object или до класса вне сборки */
export function superChain(name) {
  const out = [];
  const seen = new Set();
  let cur = name;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const rec = classRecord(cur);
    out.push({ name: cur, rec });
    if (!rec) break;
    cur = rec.super;
  }
  return out;
}

/** Все наследники и реализации (транзитивно): [{ rec, depth, via }] */
export function subtypes(name, max = 5000) {
  const idx = classIndex();
  const out = [];
  const seen = new Set([name]);
  const queue = [[name, 0]];
  while (queue.length && out.length < max) {
    const [cur, d] = queue.shift();
    for (const r of idx.subs.get(cur) ?? []) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      out.push({ rec: r, depth: d + 1, via: cur });
      queue.push([r.name, d + 1]);
    }
  }
  return out;
}

export const isInterface = (rec) => Boolean(rec && rec.access & ACC.INTERFACE);

// ---------------------------------------------------------------- TOML (то, что бывает в neoforge.mods.toml)

/** Минимальный TOML: таблицы, массивы таблиц, строки (в т. ч. многострочные), числа, true/false, массивы */
export function parseToml(text) {
  const root = {};
  let cur = root;
  const lines = text.replace(/\r/g, '').split('\n');
  const path = (s) =>
    [...s.matchAll(/"([^"]*)"|'([^']*)'|([^.\s]+)/g)].map((m) => m[1] ?? m[2] ?? m[3]).filter((x) => x !== undefined);
  const table = (keys, arr) => {
    let t = root;
    for (const [i, k] of keys.entries()) {
      const last = i === keys.length - 1;
      if (last && arr) {
        if (!Array.isArray(t[k])) t[k] = [];
        const o = {};
        t[k].push(o);
        return o;
      }
      if (t[k] === undefined) t[k] = {};
      t = Array.isArray(t[k]) ? t[k].at(-1) : t[k];
    }
    return t;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    let m = line.match(/^\[\[\s*(.+?)\s*\]\]/);
    if (m) {
      cur = table(path(m[1]), true);
      continue;
    }
    m = line.match(/^\[\s*(.+?)\s*\]/);
    if (m) {
      cur = table(path(m[1]), false);
      continue;
    }
    m = line.match(/^("[^"]*"|'[^']*'|[\w.-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = path(m[1]);
    let raw = m[2];
    let value;
    const multi = raw.match(/^('''|""")(.*)$/);
    if (multi) {
      const q = multi[1];
      let acc = multi[2];
      while (!acc.includes(q) && i + 1 < lines.length) acc += `\n${lines[++i]}`;
      value = acc.slice(0, acc.indexOf(q)).replace(/^\n/, '');
    } else if (raw.startsWith('"')) value = JSON.parse(raw.match(/^"(?:[^"\\]|\\.)*"/)?.[0] ?? '""');
    else if (raw.startsWith("'")) value = raw.slice(1, raw.indexOf("'", 1));
    else if (raw.startsWith('[')) {
      while (!/\]\s*(#.*)?$/.test(raw) && i + 1 < lines.length) raw += lines[++i];
      value = [...raw.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((x) => x[2] ?? JSON.parse(`"${x[1]}"`));
    } else {
      const v = raw.replace(/#.*$/, '').trim();
      value = v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) ? Number(v) : v;
    }
    let t = cur;
    for (const k of key.slice(0, -1)) t = t[k] ??= {};
    t[key.at(-1)] = value;
  }
  return root;
}

// ---------------------------------------------------------------- моды и зависимости

/** Атрибуты MANIFEST.MF */
function manifest(jar) {
  return parseManifest(readEntry(jar, 'META-INF/MANIFEST.MF')?.data);
}

function parseManifest(data) {
  if (!data) return {};
  const out = {};
  let last = null;
  for (const line of data.toString('utf8').replace(/\r/g, '').split('\n')) {
    if (line.startsWith(' ') && last) out[last] += line.slice(1);
    else {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (m) out[(last = m[1])] = m[2];
    }
  }
  return out;
}

/** Моды и зависимости из neoforge.mods.toml (data — байты файла, mf — MANIFEST.MF для версии ${file.jarVersion}) */
function tomlMeta(data, mf) {
  let raw = {};
  try {
    raw = parseToml(data.toString('utf8'));
  } catch {
    /* битый toml — без модов */
  }
  const ver = (v) => (!v || String(v).includes('${') ? (mf['Implementation-Version'] ?? '?') : String(v));
  const mods = (raw.mods ?? []).map((m) => ({ id: m.modId, version: ver(m.version), name: m.displayName ?? m.modId }));
  const deps = [];
  for (const [owner, list] of Object.entries(raw.dependencies ?? {}))
    for (const d of [list].flat())
      deps.push({
        owner,
        id: d.modId,
        type: String(d.type ?? (d.mandatory === false ? 'optional' : 'required')).toLowerCase(),
        range: d.versionRange ?? '*',
        side: String(d.side ?? 'BOTH').toUpperCase(),
        ordering: d.ordering ?? 'NONE',
        reason: d.reason ?? null,
      });
  return { raw, mods, deps };
}

/**
 * Моды и зависимости jar вне сборки (путь или Buffer) — вместе с вложенными (jar-in-jar по metadata.json, до 3
 * уровней): [{ path, mods, deps }], первым — сам jar. Для проверки скачанной новой версии мода.
 */
export function archiveMods(src, name = 'jar', depth = 0) {
  const toc = zipEntries(src);
  const by = new Map(toc.map((e) => [e.name, e]));
  const read = (n) => (by.has(n) ? zipRead(src, by.get(n)) : null);
  const t = read('META-INF/neoforge.mods.toml');
  const { mods, deps } = t ? tomlMeta(t, parseManifest(read('META-INF/MANIFEST.MF'))) : { mods: [], deps: [] };
  const out = [{ path: name, mods, deps }];
  if (depth >= 3) return out;
  let nested = [];
  const md = read('META-INF/jarjar/metadata.json');
  if (md)
    try {
      nested = (JSON.parse(md.toString('utf8')).jars ?? []).map((j) => j.path).filter((p) => by.has(p));
    } catch {
      /* битый metadata.json — вложенные не грузятся */
    }
  for (const n of nested) out.push(...archiveMods(read(n), `${name}!${n}`, depth + 1));
  return out;
}

const metaCache = new Map(); // jar → { toc, meta }

/** Метаданные архива: моды (id, версия, название), зависимости, конфиги миксинов, тип (мод, библиотека) */
export function jarMeta(jar) {
  const toc = jarToc(jar);
  const c = metaCache.get(jar);
  if (c && c.toc === toc) return c.meta;
  const mf = manifest(jar);
  const meta = { jar, mods: [], deps: [], mixinConfigs: [], type: mf.FMLModType ?? null, accessTransformers: [] };
  const t = readEntry(jar, 'META-INF/neoforge.mods.toml');
  if (t) {
    const toml = tomlMeta(t.data, mf);
    meta.mods.push(...toml.mods);
    meta.deps.push(...toml.deps);
    for (const m of toml.raw.mixins ?? [])
      if (m.config) meta.mixinConfigs.push({ file: m.config, declared: 'mods.toml' });
    for (const a of toml.raw.accessTransformers ?? []) if (a.file) meta.accessTransformers.push(a.file);
  }
  for (const f of String(mf.MixinConfigs ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean))
    if (!meta.mixinConfigs.some((m) => m.file === f)) meta.mixinConfigs.push({ file: f, declared: 'MANIFEST' });
  // Конфиги в корне jar, которые нигде не объявлены: миксины из них не применяются
  for (const e of toc)
    if (/^[^/]+\.json$/.test(e.name) && /mixin/i.test(e.name) && !meta.mixinConfigs.some((m) => m.file === e.name))
      meta.mixinConfigs.push({ file: e.name, declared: null });
  if (!meta.mods.length && !meta.type && jar !== PLATFORM) meta.type = 'LIBRARY';
  metaCache.set(jar, { toc, meta });
  return meta;
}

/** Конфиг миксинов из jar: { file, package, priority, plugin, required, mixins: [{ cls, side }] } */
export function mixinConfig(jar, file) {
  const r = readEntry(jar, file);
  if (!r) return null;
  let j;
  try {
    j = JSON.parse(r.data.toString('utf8'));
  } catch {
    return { file, error: 'не JSON', mixins: [] };
  }
  const pkg = String(j.package ?? '');
  const mixins = [];
  for (const [side, key] of [
    ['общий', 'mixins'],
    ['клиент', 'client'],
    ['сервер', 'server'],
  ])
    for (const m of j[key] ?? []) mixins.push({ cls: `${pkg}.${m}`.replaceAll('.', '/'), side });
  return {
    file,
    package: pkg,
    priority: j.priority ?? 1000,
    plugin: j.plugin ?? null,
    required: j.required ?? false,
    defaultRequire: j.injectors?.defaultRequire ?? null,
    refmap: j.refmap ?? null,
    mixins,
  };
}

/** Владелец архива: id модов из toml или имя jar */
export function jarOwner(jar) {
  if (jar === PLATFORM) return `minecraft+neoforge ${platform()?.version ?? ''}`.trim();
  const m = jarMeta(jar).mods;
  return m.length ? m.map((x) => x.id).join(',') : jar.slice(jar.lastIndexOf('/') + 1);
}

// ---------------------------------------------------------------- версии (как в Maven / FML)

const QUAL = ['alpha', 'beta', 'milestone', 'rc', 'snapshot', '', 'sp'];
const ALIAS = { a: 'alpha', b: 'beta', m: 'milestone', cr: 'rc', ga: '', final: '', release: '' };

function tokens(v) {
  return String(v)
    .toLowerCase()
    .split(/[.\-+_]|(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)/)
    .filter((x) => x !== '');
}

const isNum = (t) => /^\d+$/.test(t);
/** Место квалификатора: alpha < beta < milestone < rc < snapshot < релиз < sp < незнакомые */
const qual = (t) => {
  const i = QUAL.indexOf(ALIAS[t] ?? t);
  return i >= 0 ? i : QUAL.length;
};

/** Сравнение версий: числа — по значению, квалификаторы alpha < beta < rc < (релиз) */
export function compareVersions(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    // Недостающая часть — 0 против числа и «релиз» против квалификатора: 1.0 = 1.0.0, 1.0-beta < 1.0
    const p = x[i] ?? (isNum(y[i]) ? '0' : '');
    const q = y[i] ?? (isNum(x[i]) ? '0' : '');
    if (p === q) continue;
    if (isNum(p) && isNum(q)) {
      if (Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1;
      continue;
    }
    if (isNum(p)) return 1;
    if (isNum(q)) return -1;
    if (qual(p) !== qual(q)) return qual(p) < qual(q) ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** Диапазон версий Maven: «[1.2,2)», «[1.21.1]», «(,3]», «*», «1.0» (любая) → проверка */
export function inRange(version, range) {
  const r = String(range ?? '*').trim();
  if (!r || r === '*' || !/^[[(]/.test(r)) return true;
  for (const m of r.matchAll(/([[(])([^\])]*)([\])])/g)) {
    const [lo, hi] = m[2].includes(',') ? m[2].split(',').map((s) => s.trim()) : [m[2].trim(), m[2].trim()];
    const okLo = !lo || (m[1] === '[' ? compareVersions(version, lo) >= 0 : compareVersions(version, lo) > 0);
    const okHi = !hi || (m[3] === ']' ? compareVersions(version, hi) <= 0 : compareVersions(version, hi) < 0);
    if (okLo && okHi) return true;
  }
  return false;
}

/** Нижняя граница диапазона (для «какая минимальная версия NeoForge нужна») */
export function rangeMin(range) {
  const m = String(range ?? '').match(/^\[([^,\]]+)/);
  return m ? m[1].trim() : null;
}
