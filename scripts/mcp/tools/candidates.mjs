/**
 * Моды-кандидаты — jar не из сборки (для анализа интеграции, скилл integration-plan): candidate_get кладёт jar в
 * .cache/mcp/candidates рядом с mods/ (локальный файл, Modrinth или прямая ссылка площадки — скачивание только с
 * download=true) и даёт сводку по нему: моды и зависимости по сборке (как mods_check), лицензия, сторона, контент
 * по lang/blockstates, рецепты по типам, теги, worldgen, конфиги, миксины с пересечениями. Дальше файлы и код —
 * jar_find/jar_read/jar_javap/class_find/class_info/decompile/jar_grep с jar="candidate:<файл>".
 * В индекс сборки (классы, рецепты, предметы) кандидат не попадает.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SITE } from '../../firestore-rest.mjs';
import { archiveMods, candidateIndex, classIndex, jarMeta, mixinConfig, parseToml } from '../code-index.mjs';
import { tags } from '../data.mjs';
import { CANDIDATE, CANDIDATES, candidateList, jarToc, platform, readEntry, resolveJar } from '../jars.mjs';
import { page, paging, str } from '../fmt.mjs';
import { depContext } from './code.mjs';

const UA = { 'User-Agent': `tfc-plans/1.0 (${SITE})` };
const dotted = (n) => n.replaceAll('/', '.');
const mb = (n) => `${(n / 1048576).toFixed(1)} МБ`;
/** Официальные площадки: прямые ссылки на файлы */
const HOSTS =
  /^(cdn\.modrinth\.com|(edge|mediafilez|media)\.forgecdn\.net|github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)$/;

// ---------------------------------------------------------------- регистрация jar

function save(name, buf) {
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error(`${name} — не jar (не zip)`);
  const file = path.basename(name).replace(/[^\w.+-]+/g, '_');
  fs.mkdirSync(CANDIDATES, { recursive: true });
  const dst = path.join(CANDIDATES, file.endsWith('.jar') ? file : `${file}.jar`);
  fs.writeFileSync(`${dst}.part`, buf);
  fs.renameSync(`${dst}.part`, dst);
  return `${CANDIDATE}${path.basename(dst)}`;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: UA });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

/** Версия проекта Modrinth под 1.21.1 NeoForge: { project, version, file } */
async function modrinthPick(slug, want) {
  const project = await fetchJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}`);
  if (!project) {
    const facets = encodeURIComponent('[["categories:neoforge"],["versions:1.21.1"]]');
    const hits =
      (await fetchJson(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(slug)}&facets=${facets}&limit=8`))
        ?.hits ?? [];
    throw new Error(
      `на Modrinth нет проекта «${slug}»${hits.length ? `; похожие под NeoForge 1.21.1: ${hits.map((h) => `${h.slug} — ${h.title}`).join('; ')}` : ' (поиск под NeoForge 1.21.1 пуст)'}`,
    );
  }
  const q = `loaders=${encodeURIComponent('["neoforge"]')}&game_versions=${encodeURIComponent('["1.21.1"]')}`;
  const versions = (await fetchJson(`https://api.modrinth.com/v2/project/${project.id}/version?${q}`)) ?? [];
  if (!versions.length) throw new Error(`у «${project.title}» на Modrinth нет версий под NeoForge 1.21.1`);
  let v;
  if (want) {
    const w = String(want).toLowerCase();
    v =
      versions.find((x) => x.id === want || x.version_number.toLowerCase() === w) ??
      versions.find((x) => x.version_number.toLowerCase().includes(w));
    if (!v)
      throw new Error(
        `версии «${want}» нет; под NeoForge 1.21.1: ${versions
          .slice(0, 15)
          .map((x) => `${x.version_number} (${x.version_type})`)
          .join(', ')}`,
      );
  } else v = versions.find((x) => x.version_type === 'release') ?? versions[0];
  const file = v.files.find((f) => f.primary) ?? v.files[0];
  if (!file) throw new Error(`у версии ${v.version_number} нет файлов`);
  return { project, version: v, file, others: versions.length };
}

/** Найти или положить кандидата → { jar, origin } или текст-вопрос (без download=true ничего не скачивается) */
async function register(a) {
  if (a.jar) {
    const jar = resolveJar(`${CANDIDATE}${String(a.jar).replace(/^candidate:/i, '')}`, true);
    if (jar.includes('!')) throw new Error('сводка — по внешнему jar кандидата; вложенные видны в ней (jar-in-jar)');
    return { jar };
  }
  if (a.path) {
    const src = path.resolve(String(a.path));
    if (!fs.existsSync(src)) throw new Error(`нет файла ${src}`);
    return { jar: save(path.basename(src), fs.readFileSync(src)), origin: `локальный файл ${src}` };
  }
  if (a.modrinth) {
    const { project, version, file, others } = await modrinthPick(String(a.modrinth), a.version);
    const head = `Modrinth: ${project.title} (${project.slug}) — версия ${version.version_number} (${version.version_type}, ${version.date_published.slice(0, 10)}), файл ${file.filename}, ${mb(file.size)}, ${file.url}`;
    const have = candidateList().find((f) => f === file.filename.replace(/[^\w.+-]+/g, '_'));
    if (have) return { jar: `${CANDIDATE}${have}`, origin: `${head} (уже скачан)`, project };
    if (!a.download)
      return `${head}\nЛицензия: ${project.license?.id ?? '?'}; сторона: клиент ${project.client_side}, сервер ${project.server_side}; версий под NeoForge 1.21.1: ${others}.\nНичего не скачано. Скачать — только с согласия пользователя (назовите ему файл, источник и размер): повторите с download=true.`;
    const r = await fetch(file.url, { headers: UA, redirect: 'follow' });
    if (!r.ok) throw new Error(`скачивание ${file.url}: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
    if (file.hashes?.sha1 && file.hashes.sha1 !== sha1) throw new Error(`sha1 не совпал с Modrinth — файл не сохранён`);
    return { jar: save(file.filename, buf), origin: `${head} (скачан, sha1 сверен)`, project };
  }
  if (a.url) {
    let u;
    try {
      u = new URL(String(a.url));
    } catch {
      throw new Error(`не ссылка: ${a.url}`);
    }
    if (u.protocol !== 'https:' || !HOSTS.test(u.hostname))
      throw new Error(
        `ссылка не с площадки (Modrinth CDN, forgecdn, GitHub): ${u.hostname}; страницу CurseForge — прямой ссылкой на файл`,
      );
    const name = decodeURIComponent(u.pathname.split('/').pop() || 'candidate.jar');
    if (!a.download) {
      const h = await fetch(u, { method: 'HEAD', headers: UA, redirect: 'follow' }).catch(() => null);
      const size = Number(h?.headers.get('content-length') ?? 0);
      return `${u.hostname}: файл ${name}${size ? `, ${mb(size)}` : ''}${h && !h.ok ? ` (HEAD ${h.status})` : ''}\nНичего не скачано. Скачать — только с согласия пользователя (файл, источник, размер): повторите с download=true.`;
    }
    const r = await fetch(u, { headers: UA, redirect: 'follow' });
    if (!r.ok) throw new Error(`скачивание ${u}: ${r.status}`);
    return { jar: save(name, Buffer.from(await r.arrayBuffer())), origin: `скачан с ${u.hostname}` };
  }
  return null;
}

// ---------------------------------------------------------------- разбор jar

const reportCache = new Map(); // jar → { toc, r }

/** Всё, что видно в jar: моды, toml, lang, данные, конфиги, миксины */
function scan(jar) {
  const toc = jarToc(jar);
  const c = reportCache.get(jar);
  if (c && c.toc === toc) return c.r;
  const read = (n) => readEntry(jar, n)?.data;
  const json = (n) => {
    try {
      return JSON.parse(read(n).toString('utf8'));
    } catch {
      return null;
    }
  };
  let toml = {};
  try {
    toml = parseToml(read('META-INF/neoforge.mods.toml')?.toString('utf8') ?? '');
  } catch {
    /* битый toml */
  }
  const r = {
    toc,
    toml,
    lang: new Map(),
    files: { recipe: [], tags: [], worldgen: [], biomeMods: [], other: new Map() },
  };
  r.archive = archiveMods(readWhole(jar), jar);
  // Контент по lang: ключи «вид.ns.путь» (без подключей)
  for (const e of toc) {
    let m = e.name.match(/^assets\/([^/]+)\/lang\/(en_us|ru_ru)\.json$/);
    if (m) {
      const j = json(e.name) ?? {};
      const l = r.lang.get(m[1]) ?? { en: {}, ru: {} };
      l[m[2] === 'en_us' ? 'en' : 'ru'] = j;
      r.lang.set(m[1], l);
      continue;
    }
    m = e.name.match(/^data\/([^/]+)\/(.+)\.json$/);
    if (!m) continue;
    const [, ns, rest] = m;
    if (rest.startsWith('recipe/') || rest.startsWith('recipes/')) {
      const j = json(e.name);
      const conds = j?.['neoforge:conditions'];
      r.files.recipe.push({
        id: `${ns}:${rest.slice(rest.indexOf('/') + 1)}`,
        type: String(j?.type ?? '?'),
        cond: Array.isArray(conds) ? conds.map((x) => x?.type).join(',') : '',
      });
    } else if (rest.startsWith('tags/')) {
      const parts = rest.split('/');
      // tags/<реестр>/<путь>; реестры worldgen — два уровня (tags/worldgen/biome/…)
      const reg = parts[1] === 'worldgen' ? `${parts[1]}/${parts[2]}` : parts[1];
      const p = parts.slice(reg.split('/').length + 1).join('/');
      const j = json(e.name);
      r.files.tags.push({
        reg,
        id: `${ns}:${p}`,
        n: j?.values?.length ?? 0,
        replace: Boolean(j?.replace),
        values: j?.values ?? [],
      });
    } else if (rest.startsWith('worldgen/')) {
      const parts = rest.split('/');
      r.files.worldgen.push({ kind: parts[1], id: `${ns}:${parts.slice(2).join('/')}` });
    } else if (rest.startsWith('neoforge/biome_modifier/')) {
      const j = json(e.name);
      r.files.biomeMods.push({
        id: `${ns}:${rest.slice(24)}`,
        type: j?.type ?? '?',
        biomes: j?.biomes,
        features: j?.features,
        step: j?.step,
      });
    } else {
      const kind = rest.split('/')[0] === 'neoforge' ? rest.split('/').slice(0, 2).join('/') : rest.split('/')[0];
      r.files.other.set(kind, (r.files.other.get(kind) ?? 0) + 1);
    }
  }
  r.blockstates = toc.filter((e) => /^assets\/[^/]+\/blockstates\/.+\.json$/.test(e.name)).length;
  r.itemModels = toc.filter((e) => /^assets\/[^/]+\/models\/item\/.+\.json$/.test(e.name)).length;
  r.structures = toc.filter((e) => /^data\/[^/]+\/structures?\/.+\.nbt$/.test(e.name)).length;
  r.classes = toc.filter((e) => e.name.endsWith('.class') && !e.name.startsWith('META-INF/')).length;
  // Конфиги: классы, где в пуле констант есть ModConfigSpec (строитель конфига NeoForge)
  const idx = candidateIndex(jar);
  r.configClasses = idx.all
    .filter((x) => !x.mixin && read(x.path)?.includes('net/neoforged/neoforge/common/ModConfigSpec'))
    .map((x) => x.name);
  // Миксины: конфиги из toml/MANIFEST, их классы и цели @Mixin
  const meta = jarMeta(jar);
  r.mixinConfigs = meta.mixinConfigs.map((m) => {
    const cfg = mixinConfig(jar, m.file);
    return { ...m, cfg, list: (cfg?.mixins ?? []).map((x) => ({ ...x, rec: idx.byName.get(x.cls)?.[0] ?? null })) };
  });
  r.accessTransformers = meta.accessTransformers;
  reportCache.set(jar, { toc, r });
  return r;
}

/** Весь jar кандидата в памяти (для archiveMods с вложенными) */
function readWhole(jar) {
  return fs.readFileSync(path.join(CANDIDATES, jar.slice(CANDIDATE.length).split('!')[0]));
}

const KINDS = [
  ['block', 'блоков'],
  ['item', 'предметов'],
  ['fluid_type', 'жидкостей'],
  ['fluid', 'жидкостей (fluid.*)'],
  ['entity', 'сущностей'],
  ['effect', 'эффектов'],
  ['enchantment', 'зачарований'],
  ['biome', 'биомов'],
];

/** Ключи lang «вид.ns.путь» по видам, с переводом на русский */
function content(r) {
  const out = new Map(KINDS.map(([k]) => [k, []]));
  for (const [ns, l] of r.lang)
    for (const [key, en] of Object.entries(l.en)) {
      const p = key.split('.');
      if (p.length !== 3 || p[1] !== ns || !out.has(p[0])) continue;
      out.get(p[0]).push({ key, id: `${ns}:${p[2]}`, en, ru: l.ru[key] ?? null });
    }
  return out;
}

const PLATFORM_PKG = /^(net\/minecraft|com\/mojang|net\/neoforged)\//;

/** Цели миксинов кандидата: [{ target, mixins: [имя], inPack, packMods: [mod] }] */
function mixinTargets(r) {
  const idx = classIndex();
  const by = new Map();
  for (const c of r.mixinConfigs)
    for (const m of c.list)
      for (const t of m.rec?.mixin ?? []) {
        const x = by.get(t) ?? { target: t, mixins: [], pseudo: false };
        x.mixins.push(`${m.cls.slice(m.cls.lastIndexOf('/') + 1)} [${m.side}]`);
        if (m.rec.pseudo) x.pseudo = true;
        by.set(t, x);
      }
  const owner = (jar) => (jar === 'minecraft' ? 'minecraft' : (jarMeta(jar).mods[0]?.id ?? jar.split('!').pop()));
  for (const x of by.values()) {
    x.inPack = idx.byName.has(x.target) || (!platform() && PLATFORM_PKG.test(x.target)) ? true : false;
    x.where = idx.byName.has(x.target) ? owner(idx.byName.get(x.target)[0].jar) : null;
    x.packMods = [...new Set((idx.mixinsOf.get(x.target) ?? []).map((m) => owner(m.jar)))];
  }
  return [...by.values()].sort((a, b) => b.packMods.length - a.packMods.length || (a.target < b.target ? -1 : 1));
}

// ---------------------------------------------------------------- ответы

function summary(jar, r, origin) {
  const top = r.archive[0];
  const t = r.toml;
  const out = [`Кандидат ${jar} (не в сборке)${origin ? ` — ${origin}` : ''}`];
  if (!top.mods.length)
    return [...out, 'В jar нет META-INF/neoforge.mods.toml — не мод NeoForge (Fabric/Forge или библиотека?).'].join(
      '\n',
    );
  for (const m of t.mods ?? []) {
    const mod = top.mods.find((x) => x.id === m.modId);
    out.push(
      `мод ${m.modId} — ${m.displayName ?? m.modId} ${mod?.version ?? m.version ?? '?'}${m.authors ? `; авторы: ${m.authors}` : ''}${m.displayURL ? `; ${m.displayURL}` : ''}${m.displayTest ? `; displayTest ${m.displayTest}` : ''}`,
    );
  }
  out.push(
    `лицензия (mods.toml): ${t.license ?? 'не указана'}${r.toc.some((e) => /^(META-INF\/)?LICEN[CS]E/i.test(e.name)) ? '; есть файл LICENSE' : ''}`,
  );

  // Зависимости по сборке: как mods_check; если мод уже в сборке — как замена его jar
  const ids = top.mods.map((m) => m.id);
  const before = depContext({});
  const inPack = ids.flatMap((id) => (before.present.get(id) ?? []).map((x) => `${id} ${x.version} (${x.jar})`));
  const swapJar =
    ids
      .map((id) => before.present.get(id)?.[0]?.jar)
      .find(Boolean)
      ?.split('!')[0] ?? '\0';
  const after = depContext({ swap: { jar: swapJar, archive: r.archive } });
  if (inPack.length) out.push(`! уже в сборке: ${inPack.join('; ')} — проверка ниже как замена этого jar`);
  const BAD = ['missing', 'version', 'incompatible'];
  let bad = 0;
  out.push('зависимости — по сборке, как mods_check (Minecraft 1.21.1; NeoForge не задан):');
  for (const a of r.archive) {
    const deps = a.deps.filter((d) => a.mods.some((x) => x.id === d.owner));
    if (a !== top && deps.length)
      out.push(
        `  вложенный ${a.path.slice(a.path.indexOf('!') + 1)} (${a.mods.map((x) => `${x.id} ${x.version}`).join(', ')}):`,
      );
    for (const d of deps) {
      const st = after.check(d).status;
      if (BAD.includes(st) && !(st === 'missing' && d.side === 'CLIENT')) bad++;
      out.push(`  ${BAD.includes(st) ? '✗' : ' '} ${after.depLine({ id: d.owner }, d)}`);
    }
  }
  const bundled = r.archive
    .slice(1)
    .map(
      (a) =>
        `${a.path.slice(a.path.lastIndexOf('/') + 1)}${a.mods.length ? ` (${a.mods.map((x) => `${x.id} ${x.version}`).join(', ')})` : ''}`,
    );
  if (bundled.length) out.push(`несёт внутри (jar-in-jar): ${bundled.join(', ')}`);
  // Вложенные моды, которые уже есть в сборке: загрузчик берёт новейшую версию
  for (const a of r.archive.slice(1))
    for (const m of a.mods) {
      const p = before.present.get(m.id);
      if (p)
        out.push(
          `  ${m.id}: в сборке ${[...new Set(p.map((x) => x.version))].join(', ')}, во вложенном ${m.version} — загрузчик возьмёт новейшую`,
        );
    }
  out.push(
    bad
      ? `итог по зависимостям: ${bad} ✗ — не встанет без них`
      : 'итог по зависимостям: по диапазонам встаёт в сборку (в игре не проверялось)',
  );
  const sides = [...new Set(top.deps.map((d) => d.side))];
  out.push(
    `сторона: зависимости ${sides.join('/') || '—'}; классов ${r.classes}, из них в пакетах client: ${candidateIndex(jar).all.filter((x) => /\/client\//.test(x.name)).length}`,
  );

  // Контент
  const c = content(r);
  const cnt = KINDS.filter(([k]) => c.get(k).length).map(([k, ru]) => {
    const l = c.get(k);
    const tr = l.filter((x) => x.ru).length;
    return `${ru} ${l.length} (ru ${tr})`;
  });
  const langs = [...r.lang].map(
    ([ns, l]) =>
      `${ns}: en ${Object.keys(l.en).length} ключей, ru_ru ${Object.keys(l.ru).length ? `${Object.keys(l.ru).length}` : 'нет'}`,
  );
  out.push(
    `контент по lang: ${cnt.join(', ') || 'нет ключей block./item.'}; ${langs.join('; ') || 'lang нет'}; blockstates ${r.blockstates}, модели предметов ${r.itemModels} — section=content`,
  );

  // Данные
  const types = new Map();
  for (const x of r.files.recipe) types.set(x.type, (types.get(x.type) ?? 0) + 1);
  const tlist = [...types].sort((a, b) => b[1] - a[1]);
  out.push(
    `рецепты: ${r.files.recipe.length}${
      tlist.length
        ? ` — ${tlist
            .slice(0, 12)
            .map(([k, n]) => `${k} ${n}`)
            .join(', ')}${tlist.length > 12 ? ` … ещё ${tlist.length - 12} типов` : ''}`
        : ''
    }${r.files.recipe.some((x) => x.cond) ? `; с условиями ${r.files.recipe.filter((x) => x.cond).length}` : ''} — section=recipes`,
  );
  const tagNs = new Map();
  for (const x of r.files.tags) tagNs.set(x.id.split(':')[0], (tagNs.get(x.id.split(':')[0]) ?? 0) + 1);
  const cTags = r.files.tags.filter((x) => x.id.startsWith('c:'));
  out.push(
    `теги: ${r.files.tags.length} (${[...tagNs].map(([k, n]) => `${k} ${n}`).join(', ') || '—'})${
      cTags.length
        ? `; c: ${cTags
            .slice(0, 12)
            .map((x) => `${x.reg === 'item' ? '' : `${x.reg} `}#${x.id}`)
            .join(', ')}${cTags.length > 12 ? ' …' : ''}`
        : ''
    } — section=tags`,
  );
  const wg = new Map();
  for (const x of r.files.worldgen) wg.set(x.kind, (wg.get(x.kind) ?? 0) + 1);
  out.push(
    `worldgen: ${r.files.worldgen.length ? [...wg].map(([k, n]) => `${k} ${n}`).join(', ') : 'нет'}; biome_modifier ${r.files.biomeMods.length}${r.structures ? `; структур .nbt ${r.structures}` : ''} — section=worldgen`,
  );
  if (r.files.other.size)
    out.push(
      `прочие данные: ${[...r.files.other]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${n}`)
        .join(', ')}`,
    );
  out.push(
    `конфиги (классы с ModConfigSpec): ${r.configClasses.length ? r.configClasses.slice(0, 8).map(dotted).join(', ') : 'нет'}${r.configClasses.length > 8 ? ' …' : ''} — section=config`,
  );

  const mt = mixinTargets(r);
  const shared = mt.filter((x) => x.packMods.length);
  const absent = mt.filter((x) => !x.inPack);
  out.push(
    `миксины: конфигов ${r.mixinConfigs.length}, классов ${r.mixinConfigs.reduce((s, c) => s + c.list.length, 0)}, целей ${mt.length}; те же цели миксуют моды сборки: ${shared.length}${
      shared.length
        ? ` (${shared
            .slice(0, 6)
            .map(
              (x) =>
                `${dotted(x.target).split('.').pop()} ← ${x.packMods.length > 3 ? `${x.packMods.length} модов` : x.packMods.join(', ')}`,
            )
            .join('; ')}${shared.length > 6 ? ' …' : ''})`
        : ''
    }; целей нет в сборке: ${absent.length} — section=mixins`,
  );
  if (r.accessTransformers.length) out.push(`access transformers: ${r.accessTransformers.join(', ')}`);
  out.push(
    `Файлы и код: jar_find / jar_read / jar_grep / class_find / class_info / decompile / jar_javap с jar="${jar}".`,
  );
  return out.join('\n');
}

function section(jar, r, a) {
  const s = String(a.section);
  if (s === 'content') {
    const c = content(r);
    const kind = a.query ? String(a.query) : null;
    const list = KINDS.filter(([k]) => !kind || k === kind).flatMap(([k]) => c.get(k).map((x) => ({ ...x, k })));
    return `${jar}: контент по lang (${list.length})${kind ? `, вид ${kind}` : ' — query=block|item|fluid_type|entity|effect…'}\n${page(list, a, (x) => [`${x.k} ${x.id} — ${x.en}${x.ru ? ` / ${x.ru}` : ' / (нет ru)'}`], 60)}`;
  }
  if (s === 'recipes') {
    const q = a.query ? String(a.query).toLowerCase() : null;
    const list = r.files.recipe.filter((x) => !q || x.type.toLowerCase().includes(q) || x.id.includes(q));
    return `${jar}: рецепты${q ? ` по «${q}»` : ''} (${list.length}) — файл: jar_read jar="${jar}" path="data/<ns>/recipe/<путь>.json"\n${page(list, a, (x) => [`${x.id} — ${x.type}${x.cond ? ` [${x.cond}]` : ''}`], 60)}`;
  }
  if (s === 'tags') {
    const q = a.query ? String(a.query).toLowerCase() : null;
    const t = tags();
    const list = r.files.tags.filter((x) => !q || x.id.includes(q) || x.reg.includes(q));
    return `${jar}: теги${q ? ` по «${q}»` : ''} (${list.length}); «в сборке» — тот же тег у модов сборки\n${page(
      list,
      a,
      (x) => {
        const pack = t.byKey.get(`${x.reg}|${x.id}`);
        const vals = x.values.map((v) => (typeof v === 'string' ? v : `${v.id}${v.required === false ? '?' : ''}`));
        return [
          `${x.reg} #${x.id}${x.replace ? ' (replace)' : ''}: ${vals.slice(0, 8).join(', ')}${vals.length > 8 ? ` … всего ${vals.length}` : ''}${pack ? ` — в сборке есть (${pack.s.reduce((n, y) => n + y.v.length, 0)} знач.)` : ''}`,
        ];
      },
      40,
    )}`;
  }
  if (s === 'worldgen') {
    const list = [
      ...r.files.biomeMods.map(
        (x) =>
          `biome_modifier ${x.id} — ${x.type}${x.biomes ? `; биомы ${JSON.stringify(x.biomes)}` : ''}${x.features ? `; фичи ${JSON.stringify(x.features)}` : ''}${x.step ? `; шаг ${x.step}` : ''}`,
      ),
      ...r.files.worldgen.map((x) => `${x.kind} ${x.id}`),
    ];
    return `${jar}: worldgen (${list.length}); файл — jar_read path="data/<ns>/worldgen/<вид>/<путь>.json"; отключаемость — section=config\n${page(list, a, (l) => [l], 60)}`;
  }
  if (s === 'config') {
    return `${jar}: классы конфигов (ModConfigSpec) — ${r.configClasses.length}; ключи и значения по умолчанию — decompile class=<класс> jar="${jar}"\n${page(r.configClasses, a, (n) => [dotted(n)], 60)}`;
  }
  if (s === 'mixins') {
    const out = [];
    for (const c of r.mixinConfigs)
      out.push(
        `конфиг ${c.file} (${c.declared ?? 'НЕ объявлен — не применяется'})${c.cfg ? `: пакет ${c.cfg.package}, приоритет ${c.cfg.priority}${c.cfg.plugin ? `, плагин ${c.cfg.plugin}` : ''}${c.cfg.required ? ', required' : ''}, миксинов ${c.list.length}` : ' — нет файла'}`,
      );
    const mt = mixinTargets(r);
    const list = mt.map(
      (x) =>
        `${dotted(x.target)}${x.where ? ` [${x.where}]` : x.inPack ? '' : ' [нет в сборке]'}${x.pseudo ? ' @Pseudo' : ''} ← ${x.mixins.join(', ')}${x.packMods.length ? `; миксуют и моды сборки: ${x.packMods.join(', ')} — mixins target="${dotted(x.target)}"` : ''}`,
    );
    return `${jar}: миксины\n${out.join('\n')}\nцели (${list.length}), сначала общие с модами сборки:\n${page(list, a, (l) => [l], 50)}`;
  }
  throw new Error(`нет раздела «${s}»: content, recipes, tags, worldgen, config, mixins`);
}

async function candidateGet(a) {
  const reg = await register(a);
  if (typeof reg === 'string') return reg;
  if (!reg) {
    const list = candidateList();
    return list.length
      ? `Кандидаты (${CANDIDATES}):\n${list
          .map(
            (f) =>
              `${CANDIDATE}${f} — ${mb(fs.statSync(path.join(CANDIDATES, f)).size)}; ${
                archiveMods(fs.readFileSync(path.join(CANDIDATES, f)))[0]
                  .mods.map((m) => `${m.id} ${m.version}`)
                  .join(', ') || 'не мод NeoForge'
              }`,
          )
          .join('\n')}\nСводка — candidate_get jar=<файл>.`
      : 'Кандидатов нет. Положить: path=<jar в scratchpad>, modrinth=<slug> или url=<прямая ссылка>.';
  }
  const r = scan(reg.jar);
  return a.section ? section(reg.jar, r, a) : summary(reg.jar, r, reg.origin);
}

export const TOOLS = [
  {
    name: 'candidate_get',
    description:
      'Candidate mod jar NOT in the pack (for integration analysis): register it from a local path (scratchpad), Modrinth (slug + version, newest NeoForge 1.21.1 release by default) or a direct file URL (Modrinth CDN, forgecdn, GitHub) into .cache/mcp/candidates, then report: mod ids/versions, license, deps checked against the pack like mods_check (as a replacement if the mod is already in the pack), jar-in-jar, side, content counts from lang/blockstates with ru_ru coverage, recipes by type, tags (c:), worldgen and biome modifiers, ModConfigSpec classes, mixin configs and targets also mixed by pack mods. Downloads only with download=true — ask the user first (file, source, size); without it reports what would be downloaded. No args — list registered candidates. Afterwards jar_find/jar_read/jar_grep/class_find/class_info/decompile/jar_javap accept jar="candidate:<file>". Candidates never enter the pack index (items, recipes, classes).',
    inputSchema: {
      type: 'object',
      properties: {
        jar: str('registered candidate: file name or part (with or without «candidate:»)'),
        path: str('local jar path (e.g. in the scratchpad) — copied into the candidates folder'),
        modrinth: str('Modrinth project slug or id'),
        version: str('with modrinth: version number or id (default — newest release for NeoForge 1.21.1)'),
        url: str('direct jar URL from cdn.modrinth.com, forgecdn.net or GitHub releases'),
        download: { type: 'boolean', description: 'actually download (modrinth/url) — only after the user agreed' },
        section: {
          type: 'string',
          enum: ['content', 'recipes', 'tags', 'worldgen', 'config', 'mixins'],
          description: 'full list instead of the summary',
        },
        query: str(
          'with section: filter (content — kind block/item/fluid_type/entity/effect; recipes — type or id part; tags — id or registry part)',
        ),
        ...paging,
      },
    },
    handler: candidateGet,
  },
];
