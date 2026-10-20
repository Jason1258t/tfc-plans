/**
 * Индекс внутриигровых книг сборки: Patchouli (руководство TFC и статьи, которые в него добавляют аддоны) и
 * справочник Immersive Engineering (с разделами аддонов через manual/autoload.json).
 *
 * Слои — как ресурспаки в игре, снизу вверх: jar из mods/ (по имени файла), KubeJS сборки (instance/kubejs/<слой>/assets),
 * ресурспаки (instance/resourcepacks/, папка или zip). Тот же файл в слое выше заменяет нижний. Статья берётся на
 * русском из любого слоя, иначе на английском — так Patchouli и IE подставляют язык (en_us — запасной).
 *
 * Индекс строится при первом запросе и держится, пока не поменялся ни один источник (время изменения файлов).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MODS, PUBLIC, mods, readJson, recipeStatus, recipes } from '../data.mjs';
import { named } from '../fmt.mjs';
import { jarList, jarToc, readEntry, zipEntries, zipRead } from '../jars.mjs';

const INSTANCE = process.env.TFC_INSTANCE_DIR ?? path.join(path.dirname(PUBLIC), 'instance');
export const LANGS = ['ru_ru', 'en_us'];

// ---------------------------------------------------------------- источники (слои)

const RELEVANT =
  /^(assets\/[^/]+\/(patchouli_books|manual)\/|data\/[^/]+\/patchouli_books\/[^/]+\/book\.json$|assets\/[^/]+\/lang\/(ru_ru|en_us)\.json$)/;

/** Файлы папки-слоя (только нужные пути), относительные, с «/» */
function walk(root) {
  const out = [];
  const go = (dir, rel) => {
    let list;
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of list) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      // Ниже assets/<ns>/ заходим только в нужные папки — текстуры и звуки не обходим
      const depth = r.split('/').length;
      if (d.isDirectory()) {
        if (depth === 3 && !['patchouli_books', 'manual', 'lang'].includes(d.name)) continue;
        go(path.join(dir, d.name), r);
      } else if (RELEVANT.test(r)) out.push({ name: r, file: path.join(dir, d.name) });
    }
  };
  for (const top of ['assets', 'data']) go(path.join(root, top), top);
  return out;
}

const modByJar = () => new Map([...mods().values()].map((m) => [m.jar, m.name]));

/** Слои снизу вверх: { label, sig, files: Map(путь → () => Buffer) } */
function sources() {
  const out = [];
  const names = modByJar();
  for (const jar of jarList()) {
    const st = fs.statSync(path.join(MODS, jar));
    const files = new Map();
    for (const e of jarToc(jar)) if (RELEVANT.test(e.name)) files.set(e.name, () => readEntry(jar, e.name).data);
    out.push({ label: jar, mod: names.get(jar), sig: `${jar}:${st.mtimeMs}`, files });
  }
  const dirLayer = (label, root) => {
    const list = walk(root);
    const files = new Map(list.map((f) => [f.name, () => fs.readFileSync(f.file)]));
    const sig = `${label}:${list.map((f) => `${f.name}@${fs.statSync(f.file).mtimeMs}`).join(',')}`;
    out.push({ label, sig, files });
  };
  const kjs = path.join(INSTANCE, 'kubejs');
  for (const layer of safeDir(kjs).sort())
    if (fs.existsSync(path.join(kjs, layer, 'assets'))) dirLayer(`KubeJS ${layer}`, path.join(kjs, layer));
  const rp = path.join(INSTANCE, 'resourcepacks');
  const packs = safeDir(rp).sort();
  for (const p of packs) {
    const full = path.join(rp, p);
    if (fs.statSync(full).isDirectory()) dirLayer(`ресурспак ${p}`, full);
    else if (p.endsWith('.zip') && !packs.includes(p.slice(0, -4))) {
      const st = fs.statSync(full);
      const files = new Map();
      for (const e of zipEntries(full)) if (RELEVANT.test(e.name)) files.set(e.name, () => zipRead(full, e));
      out.push({ label: `ресурспак ${p}`, sig: `${p}:${st.mtimeMs}`, files });
    }
  }
  return out;
}

function safeDir(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
  } catch {
    return [];
  }
}

const parse = (buf) => {
  try {
    return JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- индекс

let cache = null;

/** Индекс книг; пересобирается, если поменялся какой-нибудь слой */
export function booksIndex() {
  const src = sources();
  const sig = src.map((s) => s.sig).join('|');
  if (cache && cache.sig === sig) return cache.index;
  const t0 = Date.now();
  const index = build(src);
  index.ms = Date.now() - t0;
  cache = { sig, index };
  return index;
}

/** Верхний слой выигрывает: путь → { layer, read } */
function overlay(src) {
  const top = new Map();
  for (const s of src) for (const [name, read] of s.files) top.set(name, { layer: s, read });
  return top;
}

function build(src) {
  const top = overlay(src);
  const nsSet = new Set(['immersiveengineering']);
  for (const name of top.keys()) {
    const m = name.match(/^assets\/([^/]+)\/(patchouli_books|manual)\//);
    if (m) nsSet.add(m[1]);
  }
  const lang = langTable(src, nsSet);
  const books = new Map();
  buildPatchouli(src, top, lang, books);
  buildIe(src, top, lang, books);
  for (const b of books.values()) {
    b.entries.sort((x, y) => catSort(b, x.cat) - catSort(b, y.cat) || (x.sort ?? 0) - (y.sort ?? 0));
    b.byId = new Map(b.entries.map((e) => [e.id, e]));
  }
  const used = new Set();
  for (const b of books.values())
    for (const e of b.entries) for (const v of Object.values(e.variants)) used.add(v.layer);
  return { books, lang, layers: src.filter((s) => used.has(s)).map((s) => s.label) };
}

const catSort = (b, c) => b.categories.get(c)?.sort ?? 1e9;

/** Переводы: «ключ» → { ru_ru, en_us }; ключи сливаются по слоям (верхний выигрывает), читаются только моды с книгами */
function langTable(src, nsSet) {
  const t = new Map();
  for (const s of src)
    for (const [name, read] of s.files) {
      const m = name.match(/^assets\/([^/]+)\/lang\/(ru_ru|en_us)\.json$/);
      if (!m || !nsSet.has(m[1])) continue;
      const d = parse(read());
      if (!d) continue;
      for (const [k, v] of Object.entries(d)) {
        let x = t.get(k);
        if (!x) t.set(k, (x = {}));
        x[m[2]] = String(v);
      }
    }
  return t;
}

export const tr = (lang, key, l = 'ru_ru') => {
  const x = lang.get(key);
  return x ? (x[l] ?? x.en_us ?? x.ru_ru) : null;
};

// ---------------------------------------------------------------- Patchouli

const PATCH = /^assets\/([^/]+)\/patchouli_books\/([^/]+)\/([a-z]{2,3}_[a-z]{2,4})\/(entries|categories)\/(.+)\.json$/;

function buildPatchouli(src, top, lang, books) {
  const book = (ns, id) => {
    const key = `${ns}:${id}`;
    let b = books.get(key);
    if (!b)
      books.set(
        key,
        (b = {
          id: key,
          kind: 'patchouli',
          title: key,
          langs: new Set(),
          categories: new Map(),
          entries: [],
          _raw: new Map(),
        }),
      );
    return b;
  };
  for (const [name, f] of top) {
    const m = name.match(/^assets\/([^/]+)\/patchouli_books\/([^/]+)\/([a-z]{2,3}_[a-z]{2,4})\//);
    if (!m) continue;
    const b = book(m[1], m[2]);
    b.langs.add(m[3]);
    const p = name.match(PATCH);
    if (!p || !LANGS.includes(p[3])) continue;
    const key = `${p[4]}|${p[5]}`;
    let x = b._raw.get(key);
    if (!x) b._raw.set(key, (x = { kind: p[4], id: p[5], ns: p[1] }));
    x[p[3]] = f;
  }
  // book.json кладут и аддоны (заглушки с ${version}); берём из слоя, где больше всего файлов этой книги — у её мода
  for (const b of books.values()) {
    const [ns, id] = b.id.split(':');
    const prefix = `assets/${ns}/patchouli_books/${id}/`;
    let best = null;
    for (const s of src) {
      const read = s.files.get(`data/${ns}/patchouli_books/${id}/book.json`);
      if (!read) continue;
      const n = [...s.files.keys()].filter((k) => k.startsWith(prefix)).length;
      if (!best || n > best.n) best = { n, read };
    }
    const d = best && parse(best.read());
    if (!d) continue;
    b.titleKey = d.name;
    b.version = /\$\{/.test(String(d.subtitle ?? '')) ? null : d.subtitle;
  }
  for (const b of books.values()) {
    b.title = (b.titleKey && tr(lang, b.titleKey)) ?? b.titleKey ?? b.id;
    for (const x of b._raw.values()) {
      const variants = {};
      for (const l of LANGS) {
        if (!x[l]) continue;
        const d = parse(x[l].read());
        if (d) variants[l] = { d, layer: x[l].layer };
      }
      const main = variants.ru_ru ?? variants.en_us;
      if (!main) continue;
      const nm = (v) => {
        const s = String(v?.d.name ?? x.id);
        return tr(lang, s, v === variants.en_us ? 'en_us' : 'ru_ru') ?? s;
      };
      if (x.kind === 'categories') {
        b.categories.set(x.id, {
          id: x.id,
          name: nm(main),
          en: variants.en_us && variants.ru_ru ? nm(variants.en_us) : null,
          parent: main.d.parent ? String(main.d.parent).replace(/^[^:]+:/, '') : null,
          sort: Number(main.d.sortnum ?? 0),
          layer: main.layer.label,
        });
        continue;
      }
      b.entries.push({
        id: x.id,
        ns: x.ns,
        book: b,
        cat: String(main.d.category ?? '').replace(/^[^:]+:/, ''),
        name: nm(main),
        en: variants.en_us && variants.ru_ru ? nm(variants.en_us) : null,
        sort: Number(main.d.sortnum ?? 0),
        icon: main.d.icon,
        variants,
      });
    }
    delete b._raw;
  }
}

// ---------------------------------------------------------------- Immersive Engineering

const ieId = (s, ns = 'immersiveengineering') => (String(s).includes(':') ? String(s) : `${ns}:${s}`);

function buildIe(src, top, lang, books) {
  // autoload.json всех слоёв складываются (IE читает весь стек ресурсов), порядок — autoload_priority
  const loads = [];
  for (const s of src) {
    const f = s.files.get('assets/immersiveengineering/manual/autoload.json');
    const d = f && parse(f());
    if (d) loads.push({ d, layer: s.label });
  }
  if (!loads.length) return;
  loads.sort((a, b) => Number(a.d.autoload_priority ?? 0) - Number(b.d.autoload_priority ?? 0));
  const b = {
    id: 'immersiveengineering:manual',
    kind: 'ie',
    title: tr(lang, 'manual.immersiveengineering.manual') ?? 'Engineer’s Manual',
    langs: new Set(),
    categories: new Map(),
    entries: [],
  };
  const listed = new Map();
  for (const { d, layer } of loads)
    for (const [key, v] of Object.entries(d)) {
      if (key === 'autoload_priority') continue;
      const list = key === 'entry_list' ? v : v?.entry_list;
      if (!Array.isArray(list)) continue;
      const cat = key === 'entry_list' ? '' : ieId(key);
      if (cat && !b.categories.has(cat)) {
        const [ns, p] = cat.split(':');
        b.categories.set(cat, {
          id: cat,
          name: tr(lang, `manual.${ns}.${p}`) ?? p,
          en: null,
          sort: Number(v.category_weight ?? 0),
          layer,
        });
      }
      list.forEach((e, n) => {
        const id = ieId(typeof e === 'string' ? e : e.source);
        if (!listed.has(id)) listed.set(id, { cat, sort: typeof e === 'object' ? Number(e.weight ?? n) : n });
      });
    }
  if (!b.categories.has('')) b.categories.set('', { id: '', name: 'Введение', sort: -1 });
  const nsSet = new Set([...listed.keys()].map((id) => id.split(':')[0]));
  const raw = new Map();
  for (const [name, f] of top) {
    const m = name.match(/^assets\/([^/]+)\/manual\/(?:([a-z]{2,3}_[a-z]{2,4})\/)?([^/]+)\.(txt|json)$/);
    if (!m || !nsSet.has(m[1]) || m[3] === 'autoload') continue;
    if (m[2]) b.langs.add(m[2]);
    const id = `${m[1]}:${m[3]}`;
    let x = raw.get(id);
    if (!x) raw.set(id, (x = {}));
    if (m[4] === 'json' && !m[2]) x.json = f;
    else if (m[4] === 'txt' && LANGS.includes(m[2])) x[m[2]] = f;
  }
  for (const [id, x] of raw) {
    const variants = {};
    for (const l of LANGS) if (x[l]) variants[l] = { text: x[l].read().toString('utf8'), layer: x[l].layer };
    const main = variants.ru_ru ?? variants.en_us;
    if (!main) continue;
    const head = (v) =>
      v.text
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map((x) => x.replace(/§./g, ''));
    const l = listed.get(id);
    b.entries.push({
      id,
      ns: id.split(':')[0],
      book: b,
      cat: l ? l.cat : '?',
      name: head(main)[0].trim(),
      sub: head(main)[1]?.trim(),
      en: variants.en_us && variants.ru_ru ? head(variants.en_us)[0].trim() : null,
      sort: l?.sort ?? 1e6,
      elements: x.json ? (parse(x.json.read()) ?? {}) : {},
      jsonLayer: x.json?.layer.label,
      variants,
    });
  }
  if (b.entries.some((e) => e.cat === '?'))
    b.categories.set('?', { id: '?', name: 'Не в оглавлении (нет в autoload.json)', sort: 1e8 });
  books.set(b.id, b);
}

// ---------------------------------------------------------------- текст

const KEYS = {
  'key.use': 'ПКМ',
  'key.attack': 'ЛКМ',
  'key.sneak': 'Shift',
  'key.inventory': 'E',
  'key.drop': 'Q',
  'key.jump': 'Пробел',
  'key.sprint': 'Ctrl',
  'key.swapOffhand': 'F',
  'key.pickItem': 'СКМ',
};
const keyName = (k, lang) => KEYS[k] ?? `клавиша «${tr(lang, k) ?? k}»`;

const fmtNum = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 10) / 10));

/** $(cfg:…) руководства TFC — как ConfigTextFunction: температура/нагрев — °C, climate.* — из botany.json */
function tfcCfg(key) {
  const t = key.match(/^(temperature|heat):(-?[\d.]+)$/);
  if (t) return `${t[2]} °C`;
  const c = key.match(/^climate\.(.+)\.(temperature|hydration)$/);
  if (c) {
    const e = (readJson('botany.json', null)?.entries ?? []).find((x) => x.n === c[1] && x.r);
    if (e) {
      const [lo, hi, u] = c[2] === 'temperature' ? [e.r.minT, e.r.maxT, ' °C'] : [e.r.minH, e.r.maxH, ''];
      if (lo != null && hi != null) return `${fmtNum(lo)}…${fmtNum(hi)}${u}`;
      if (lo != null) return `от ${fmtNum(lo)}${u}`;
      if (hi != null) return `до ${fmtNum(hi)}${u}`;
    }
  }
  // Остальное — поле серверного конфига TFC; на сервере значение может быть другим (config_get)
  const def = (readJson('config-defaults.json', null) ?? [])
    .filter((x) => x.src?.startsWith('TerraFirmaCraft'))
    .flatMap((x) => x.keys)
    .find((k) => k.field === key);
  return def ? `[настройка TFC ${def.key}, по умолчанию ${def.default}]` : `[настройка TFC ${key}]`;
}

const tidy = (s) =>
  s
    .replace(/§./g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Текст Patchouli без $(…): ссылки — «текст [→ статья]», клавиши — [ПКМ], настройки — значения */
export function patchouliText(s, lang) {
  if (typeof s !== 'string') return '';
  let out = '';
  let link = null;
  let tip = null;
  let last = 0;
  const close = () => {
    if (link) out += ` [→ ${link}]`;
    if (tip) out += ` (${tip})`;
    link = tip = null;
  };
  for (const m of s.matchAll(/\$\(([^)]*)\)/g)) {
    out += s.slice(last, m.index);
    last = m.index + m[0].length;
    const t = m[1];
    if (t === 'br') out += '\n';
    else if (t === 'br2' || t === '2br') out += '\n\n';
    else if (/^li\d?$/.test(t)) out += '\n• ';
    else if (t.startsWith('l:')) {
      close();
      link = t.slice(2);
    } else if (t.startsWith('t:')) {
      close();
      tip = t.slice(2);
    } else if (t.startsWith('k:')) out += `[${keyName(t.slice(2), lang)}]`;
    else if (t.startsWith('cfg:')) out += tfcCfg(t.slice(4));
    else if (t === '' || t === '/l' || t === '/t' || t === 'l' || t === 't') close();
  }
  out += s.slice(last);
  close();
  return tidy(out);
}

/** Текст страниц IE: <np> — новая страница, <br> — строка, <link;…>, <config;…>, <keybind;…>, <&якорь> — элемент */
export function ieText(text, lang, element) {
  const body = text.replace(/^﻿/, '').split(/\r?\n/).slice(2).join('\n');
  const used = new Set();
  const pages = body.split(/<np>/).map((p) =>
    tidy(
      p
        .replace(/<br>/g, '\n')
        .replace(/<link;([^;>]*);([^;>]*)(?:;([^>]*))?>/g, (_, to, t, a) => `${t} [→ ${to}${a ? `#${a}` : ''}]`)
        .replace(/<config;b;([^;>]*);([^;>]*);([^>]*)>/g, (_, k, y, n) => `${y} / ${n} [настройка IE ${k}]`)
        .replace(/<config;[^;>]*;([^;>]*)(?:;l?(\d+))?>/g, (_, k, i) => `[настройка IE ${k}${i ? `[${i}]` : ''}]`)
        .replace(/<keybind;([^>]*)>/g, (_, k) => `[${keyName(k, lang)}]`)
        .replace(/<&([^>]*)>/g, (_, a) => {
          used.add(a);
          return `\n${element(a)}\n`;
        }),
    ),
  );
  return { pages, used };
}

// ---------------------------------------------------------------- рецепты, предметы, блоки на страницах

const bare = (id) =>
  String(id)
    .trim()
    .replace(/[[{#].*$/s, '');

export function recipeRef(id, ns) {
  const cat = recipes();
  const full = String(id).includes(':') ? String(id) : `${ns}:${id}`;
  const r = cat.byId.get(full) ?? cat.byId.get(`minecraft:${id}`);
  if (!r) return `рецепт ${full} — нет в каталоге сборки`;
  const outs = r.effOutputs.slice(0, 4).map(named).join(', ') + (r.effOutputs.length > 4 ? ' …' : '');
  const st = recipeStatus(r);
  return `рецепт ${r.i}${outs ? ` → ${outs}` : ''}${st === 'работает' ? '' : ` — ${st}`}`;
}

export const itemRef = (s) =>
  String(s)
    .split(/,(?![^[{]*[\]}])/)
    .map(bare)
    .filter(Boolean)
    .map(named)
    .join(', ');

const blockRef = (s) => named(bare(s));

function multiblockRef(mb) {
  if (!mb || typeof mb !== 'object') return '';
  const blocks = [...new Set(Object.values(mb.mapping ?? {}).map(String))];
  const layers = Array.isArray(mb.pattern) ? `${mb.pattern.length} сл. × ${mb.pattern[0]?.length ?? 0}` : '';
  return `${layers}${layers ? '; ' : ''}блоки: ${blocks.map(blockRef).join(', ') || '—'}`;
}

/** Строки таблицы tfc:table: первая колонка + columns, заливка — по легенде */
function tableRows(p, lang) {
  const width = Number(p.columns ?? 1) + 1;
  const legend = new Map(
    (p.legend ?? []).map((l) => [String(l.color ?? '').toLowerCase(), patchouliText(String(l.text ?? ''), lang)]),
  );
  const cells = (p.strings ?? []).map((c) =>
    c.text != null
      ? patchouliText(String(c.text), lang)
      : c.fill
        ? (legend.get(String(c.fill).toLowerCase()) ?? '■')
        : '',
  );
  const rows = [];
  for (let i = 0; i < cells.length; i += width) rows.push(`| ${cells.slice(i, i + width).join(' | ')} |`);
  if (legend.size) rows.push(`легенда: ${[...legend.values()].join('; ')}`);
  return rows;
}

const PAGE_LABEL = {
  'patchouli:crafting': 'крафт',
  'patchouli:smelting': 'плавка',
  'patchouli:multiblock': 'мультиблок',
  'patchouli:spotlight': 'предмет',
  'patchouli:image': 'картинка',
  'patchouli:entity': 'существо',
  'patchouli:link': 'ссылка',
  'patchouli:relations': 'связанные статьи',
  'tfc:multimultiblock': 'мультиблок (варианты)',
  'tfc:table': 'таблица',
  'tfc:table_small': 'таблица',
  'tfc:anvil_recipe': 'наковальня',
  'tfc:tri_anvil_recipe': 'наковальня',
  'tfc:welding_recipe': 'сварка',
  'tfc:heat_recipe': 'нагрев',
  'tfc:knapping_recipe': 'оббивание',
  'tfc:rock_knapping_recipe': 'оббивание камня',
  'tfc:quern_recipe': 'жёрнов',
  'tfc:loom_recipe': 'ткацкий станок',
  'tfc:sealed_barrel_recipe': 'бочка (закрытая)',
  'tfc:instant_barrel_recipe': 'бочка (сразу)',
  'tfc:glassworking_recipe': 'стеклодувное дело',
  'tfc:drying_recipe': 'сушка',
};

/** Страница Patchouli → строки текста */
export function patchouliPage(p, lang, ns) {
  if (typeof p === 'string') return [patchouliText(p, lang)];
  if (!p || typeof p !== 'object') return [];
  const type = String(p.type ?? '');
  if (type === 'patchouli:empty') return [];
  const out = [];
  const label = PAGE_LABEL[type] ?? (type === 'patchouli:text' ? '' : type.replace(/^[^:]+:/, '').replaceAll('_', ' '));
  const title = p.title ?? p.header ?? p.name;
  const head = [label, title ? `«${patchouliText(String(title), lang)}»` : '', p.anchor ? `#${p.anchor}` : '']
    .filter(Boolean)
    .join(' ');
  if (head) out.push(`[${head}]`);
  for (const k of ['recipe', 'recipe2', 'recipe3'])
    if (typeof p[k] === 'string' && p[k]) out.push(`  ${recipeRef(p[k], ns)}`);
  if (Array.isArray(p.recipes)) for (const r of p.recipes) if (typeof r === 'string') out.push(`  ${recipeRef(r, ns)}`);
  if (p.item) out.push(`  ${itemRef(p.item)}`);
  if (p.multiblock_id) out.push(`  мультиблок ${p.multiblock_id}`);
  if (p.multiblock) out.push(`  ${multiblockRef(p.multiblock)}`);
  if (Array.isArray(p.multiblocks)) {
    // Варианты часто отличаются только состоянием блоков (стадии роста) — одинаковые строки сворачиваем
    const groups = new Map();
    p.multiblocks.forEach((m, i) => {
      const t = multiblockRef(m);
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(i + 1);
    });
    for (const [t, ns] of groups)
      out.push(`  ${ns.length > 1 ? `варианты ${ns[0]}–${ns.at(-1)}` : `вариант ${ns[0]}`}: ${t}`);
  }
  if (p.entity) out.push(`  ${String(p.entity).replace(/[{[].*$/s, '')}`);
  if (Array.isArray(p.images)) out.push(`  ${p.images.join(', ')}`);
  if (p.url) out.push(`  ${p.url}`);
  if (Array.isArray(p.entries)) out.push(`  ${p.entries.map((e) => `→ ${e}`).join(', ')}`);
  if (type === 'tfc:table' || type === 'tfc:table_small') out.push(...tableRows(p, lang));
  const text = patchouliText(p.text, lang);
  if (text) out.push(text);
  return out;
}

/** Элемент страницы IE (из <имя>.json) → одна строка */
export function ieElement(el, ns) {
  if (Array.isArray(el)) return el.map((x) => ieElement(x, ns)).join('\n');
  if (!el || typeof el !== 'object') return '';
  const recs = [];
  const outs = [];
  // Рецепт — id строкой или { recipe }; { id } — «рецепты, дающие этот предмет» (так IE показывает bottling, mixer…)
  const collect = (v) => {
    if (typeof v === 'string') recs.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object' && v.recipe) collect(v.recipe);
    else if (v && typeof v === 'object' && v.id) outs.push(String(v.id));
  };
  collect(el.recipe);
  collect(el.recipes);
  const type = String(el.type ?? '');
  const parts = [];
  if (type === 'multiblock') parts.push(`[мультиблок ${ieId(el.name ?? '', ns)}]`);
  else if (type === 'item_display')
    parts.push(`[предметы: ${(el.items ?? []).map((i) => named(String(i.id ?? i))).join(', ')}]`);
  else if (type === 'image') parts.push(`[картинка: ${(el.images ?? []).map((i) => i.location ?? i).join(', ')}]`);
  else if (type === 'entity') parts.push(`[существо ${el.id}]`);
  else if (type === 'dynamic_table' || type === 'table') parts.push('[таблица — строится кодом мода]');
  else if (!recs.length && !outs.length) parts.push(`[${type || 'элемент'}]`);
  if (outs.length) parts.push(`[${type || 'рецепты'}: рецепты на ${outs.map(named).join(', ')}]`);
  if (recs.length) parts.push(...recs.map((r) => `[${type || 'рецепт'}: ${recipeRef(r, ns)}]`));
  return parts.join('\n');
}

/** Статья → страницы (массив массивов строк) на нужном языке */
export function entryPages(e, l, lang) {
  const v = e.variants[l] ?? e.variants.ru_ru ?? e.variants.en_us;
  if (e.book.kind === 'patchouli')
    return (v.d.pages ?? []).map((p) => patchouliPage(p, lang, e.ns)).filter((p) => p.length);
  const els = e.elements ?? {};
  const el = (a) => (els[a] ? ieElement(els[a], e.ns).replace(/^\[/, `[#${a} `) : `[элемент #${a}]`);
  const { pages, used } = ieText(v.text, lang, el);
  const out = pages.map((p) => p.split('\n'));
  const rest = Object.keys(els).filter((a) => !used.has(a) && a !== 'require_advancement');
  if (rest.length) out[0].unshift(...rest.map(el).filter(Boolean));
  return out.filter((p) => p.some(Boolean));
}

/** Плоский текст статьи для поиска (кешируется в статье) */
export function entryText(e, l, lang) {
  e._text ??= {};
  return (e._text[l] ??= [e.name, e.sub ?? '', ...entryPages(e, l, lang).flat()].join('\n'));
}
