/**
 * Инструменты MCP: исходники KubeJS сборки — instance/kubejs/<слой>/ (pack, world; server_scripts, startup_scripts,
 * client_scripts, data, assets). Список файлов, поиск по тексту, чтение по строкам — с пометками того, что
 * разобрал npm run kubejs (public/kubejs.json: правила remove/replace…, рецепты скриптов и data, теги, предметы).
 *
 * Папка — основной копии репозитория (в worktree её нет, в git тоже), на сервере сборки — TFC_KUBEJS_DIR.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson } from '../data.mjs';
import { clip, dateOf, norm, num, page, paging, short, str, words } from '../fmt.mjs';

function packRoot() {
  try {
    const common = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.resolve(path.dirname(common));
  } catch {
    return ROOT;
  }
}

export const KUBEJS =
  process.env.TFC_KUBEJS_DIR ?? path.join(process.env.TFC_PACK_ROOT ?? packRoot(), 'instance', 'kubejs');

const FOLDERS = ['server_scripts', 'startup_scripts', 'client_scripts', 'data', 'assets'];
const SCRIPT_FOLDERS = new Set(['server_scripts', 'startup_scripts', 'client_scripts']);
const TEXT = /\.(js|ts|json|json5|mcmeta|md|txt|snbt|toml|cfg|properties|mcfunction|lang|yml|yaml)$/i;
const MAX_TEXT = 2 * 1024 * 1024;

// ---------------------------------------------------------------- файлы

/** Все файлы слоёв: путь от instance/kubejs («pack/server_scripts/recipes/misc.js»), слой, папка, время */
function walk() {
  const out = [];
  if (!fs.existsSync(KUBEJS)) return out;
  const rec = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) rec(full, r);
      else if (e.isFile()) {
        const parts = r.split('/');
        if (parts.length < 2) continue;
        const st = fs.statSync(full);
        out.push({
          rel: r,
          full,
          layer: parts[0],
          folder: parts.length > 2 ? parts[1] : '',
          mtime: st.mtimeMs,
          size: st.size,
        });
      }
    }
  };
  rec(KUBEJS, '');
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const textCache = new Map();
/** Строки текстового файла (кеш по времени изменения) */
function linesOf(f) {
  const c = textCache.get(f.full);
  if (c && c.mtime === f.mtime) return c.lines;
  const lines = fs.readFileSync(f.full, 'utf8').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  textCache.set(f.full, { mtime: f.mtime, lines });
  return lines;
}
const isText = (f) => TEXT.test(f.rel) && f.size <= MAX_TEXT;

function filterFiles(list, a) {
  let l = list;
  if (a.layer) l = l.filter((f) => f.layer === a.layer);
  if (a.folder) l = l.filter((f) => f.folder === a.folder);
  if (a.path) {
    const p = norm(a.path);
    l = l.filter((f) => norm(f.rel).includes(p));
  }
  return l;
}

/** Файл по пути: точный от instance/kubejs, без слоя или по концу пути — если один */
function findFile(p) {
  const want = String(p ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .replace(/^(instance\/)?kubejs\//, '');
  const all = walk();
  const exact = all.find((f) => f.rel === want);
  if (exact) return { file: exact };
  const tail = all.filter((f) => f.rel.endsWith(`/${want}`));
  if (tail.length === 1) return { file: tail[0] };
  return { candidates: tail.length ? tail : all.filter((f) => f.rel.includes(want)) };
}

// ---------------------------------------------------------------- что разобрал kubejs.json

/** Указатель разбора: файл → строка → записи; data-рецепты — по пути файла из id */
let indexCache = { src: null, value: null };
function parsed() {
  const k = readJson('kubejs.json', null);
  if (indexCache.src === k) return indexCache.value;
  const byFile = new Map();
  const add = (file, line, entry) => {
    if (!file) return;
    let f = byFile.get(file);
    if (!f) byFile.set(file, (f = { rules: 0, recipes: 0, tags: 0, items: 0, lines: new Map() }));
    f[entry.group]++;
    const l = line ?? 0;
    if (!f.lines.has(l)) f.lines.set(l, []);
    f.lines.get(l).push(entry);
  };
  for (const r of k?.rules ?? []) add(r.file, r.line, { group: 'rules', kind: r.kind, text: ruleText(r) });
  for (const r of k?.recipes ?? []) {
    if (r.k) add(r.k.file, r.k.line, { group: 'recipes', kind: 'recipe', text: `${r.i} [${r.t ?? '?'}]` });
    else if (r.s?.startsWith('kubejs/') && r.s.endsWith('/data')) {
      // «kubejs/pack/data» + id «ns:path» → pack/data/ns/recipe(s)/path.json — какая из папок, решаем по диску
      const layer = r.s.split('/')[1];
      const [ns, p] = r.i.split(':');
      const variants = ['recipe', 'recipes'].map((d) => `${layer}/data/${ns}/${d}/${p}.json`);
      const file = variants.find((v) => fs.existsSync(path.join(KUBEJS, v))) ?? variants[0];
      add(file, 0, { group: 'recipes', kind: 'data', text: `${r.i} [${r.t ?? '?'}]` });
    }
  }
  for (const t of k?.tags ?? [])
    add(t.file, t.line, {
      group: 'tags',
      kind: 'tag',
      text: `${t.k} #${t.tag} ${t.op}${t.v?.length ? ` ${short(t.v.join(', '), 120)}` : ''}`,
    });
  for (const it of k?.items ?? [])
    add(it.file, it.line, { group: 'items', kind: 'item', text: `${it.id}${it.type ? ` [${it.type}]` : ''}` });
  indexCache = { src: k, value: { k, byFile } };
  return indexCache.value;
}

function ruleText(r) {
  const f = short(JSON.stringify(r.filter ?? {}), 160);
  if (r.kind === 'remove') return `remove ${f}`;
  return `${r.kind} ${f}: ${r.from ?? '?'} → ${r.to ?? '?'}`;
}

const MARK = { remove: '−', replaceInput: '~', replaceOutput: '~', recipe: '+', data: '+', tag: '#', item: '@' };
const LEGEND = 'Пометки: − remove, ~ replaceInput/Output, + рецепт, # тег, @ свой предмет (по public/kubejs.json).';

/** Сколько чего разобрано из файла: «правил 3, рецептов 12» */
function statsText(s) {
  if (!s) return '';
  const parts = [
    s.rules && `правил ${s.rules}`,
    s.recipes && `рецептов ${s.recipes}`,
    s.tags && `тегов ${s.tags}`,
    s.items && `предметов ${s.items}`,
  ].filter(Boolean);
  return parts.join(', ');
}

/** Предупреждение, если файлы новее разбора или разбора нет */
function staleNote(files) {
  const { k } = parsed();
  if (!k) return 'public/kubejs.json не собран — пометок разбора нет. Соберите: npm run kubejs';
  const newer = files.filter((f) => f.mtime > k.generatedAt + 1000);
  if (!newer.length) return '';
  const names = newer.slice(0, 5).map((f) => f.rel);
  return (
    `⚠ Новее разбора (${dateOf(k.generatedAt)}): ${names.join(', ')}${newer.length > 5 ? ` и ещё ${newer.length - 5}` : ''}` +
    ' — пометки и номера строк могут не совпадать. Пересоберите: npm run kubejs'
  );
}

function noDir() {
  return `Папки ${KUBEJS} нет — импортируйте KubeJS сборки: npm run kubejs -- <zip|папка> (или npm run pack:fetch -- --kubejs).`;
}

// ---------------------------------------------------------------- kubejs_files

function kubejsFiles(a) {
  const all = walk();
  if (!all.length) return noDir();
  const { k, byFile } = parsed();
  const list = filterFiles(a.folder || a.path ? all : all.filter((f) => SCRIPT_FOLDERS.has(f.folder)), a);
  const out = [];
  if (k) {
    out.push(
      `Разбор public/kubejs.json от ${dateOf(k.generatedAt)}: ` +
        (k.layers ?? [])
          .map(
            (l) =>
              `${l.name}${l.source ? ` (${l.source})` : ''} — скриптов ${l.scripts}, правил ${l.rules}, рецептов скриптов ${l.added}, data ${l.data}, тегов ${l.tags}, предметов ${l.items}`,
          )
          .join('; '),
    );
    if (k.errors?.length)
      out.push(`Ошибок разбора: ${k.errors.length} (${short(k.errors.map((e) => e.file).join(', '), 200)})`);
    const gone = [...byFile.keys()].filter((f) => !all.some((x) => x.rel === f));
    if (gone.length)
      out.push(`В разборе есть, на диске нет: ${short(gone.join(', '), 300)} — пересоберите: npm run kubejs`);
  }
  const stale = staleNote(list);
  if (stale) out.push(stale);
  if (!a.folder && !a.path) {
    // data/assets — сводкой, файлы — по folder
    const sum = new Map();
    for (const f of filterFiles(all, a))
      if (!SCRIPT_FOLDERS.has(f.folder))
        sum.set(`${f.layer}/${f.folder}`, (sum.get(`${f.layer}/${f.folder}`) ?? 0) + 1);
    if (sum.size)
      out.push(
        `Кроме скриптов: ${[...sum].map(([d, n]) => `${d} — ${n} файлов`).join(', ')} (список — folder=data/assets или path).`,
      );
  }
  out.push(
    page(
      list,
      a,
      (f) => {
        const lines = isText(f) ? `${linesOf(f).length} стр.` : `${Math.round(f.size / 1024)} КБ`;
        const st = statsText(byFile.get(f.rel));
        const fresh = k && f.mtime > k.generatedAt + 1000 ? ' ⚠ новее разбора' : '';
        return [`${f.rel} — ${lines}${st ? `; разобрано: ${st}` : ''}${fresh}`];
      },
      100,
    ),
  );
  return clip(out.join('\n'));
}

// ---------------------------------------------------------------- kubejs_search

function lineMarks(entries) {
  if (!entries?.length) return ' ';
  return [...new Set(entries.map((e) => MARK[e.kind] ?? '*'))].join('');
}

function numbered(lines, i, marks, width) {
  const m = marks?.get(i + 1);
  return `${String(i + 1).padStart(width)} ${lineMarks(m).padEnd(2)}| ${short(lines[i], 300)}`;
}

function kubejsSearch(a) {
  const all = walk();
  if (!all.length) return noDir();
  const q = String(a.query ?? '');
  let test;
  if (a.regex) {
    let re;
    try {
      re = new RegExp(q, 'i');
    } catch (e) {
      return `Регулярка не разобралась: ${e.message}`;
    }
    test = (s) => re.test(s);
  } else {
    const w = words(q);
    if (!w.length) return 'Пустой запрос.';
    test = (s) => {
      const n = norm(s);
      return w.every((x) => n.includes(x));
    };
  }
  const ctx = Math.min(10, Math.max(0, Number(a.context ?? 2) | 0));
  const { byFile } = parsed();
  const files = filterFiles(all, a).filter(isText);
  const hits = [];
  for (const f of files) {
    const lines = linesOf(f);
    for (let i = 0; i < lines.length; i++) if (test(lines[i])) hits.push({ f, i, lines });
  }
  // Соседние совпадения в одном файле — одним блоком
  const blocks = [];
  for (const h of hits) {
    const last = blocks.at(-1);
    if (last && last.f === h.f && h.i - last.to <= ctx * 2 + 1) {
      last.to = h.i;
      last.hits.push(h.i);
    } else blocks.push({ f: h.f, lines: h.lines, from: h.i, to: h.i, hits: [h.i] });
  }
  const head = [
    `Совпадений: ${hits.length} строк в ${new Set(hits.map((h) => h.f)).size} файлах (искали в ${files.length}); блоки:`,
  ];
  const stale = staleNote([...new Set(blocks.map((b) => b.f))]);
  if (stale) head.push(stale);
  if (hits.length) head.push(`${LEGEND} «>» — строка с совпадением.`);
  const body = page(
    blocks,
    a,
    (b) => {
      const marks = byFile.get(b.f.rel)?.lines;
      const from = Math.max(0, b.from - ctx);
      const to = Math.min(b.lines.length - 1, b.to + ctx);
      const width = String(to + 1).length;
      const out = [`— ${b.f.rel}:${b.from + 1}`];
      for (let i = from; i <= to; i++)
        out.push(`${b.hits.includes(i) ? '>' : ' '}${numbered(b.lines, i, marks, width)}`);
      return out;
    },
    20,
  );
  return clip([...head, body].join('\n'));
}

// ---------------------------------------------------------------- kubejs_read

function kubejsRead(a) {
  if (!fs.existsSync(KUBEJS)) return noDir();
  const { file: f, candidates } = findFile(a.path);
  if (!f) {
    if (!candidates?.length) return `Файл «${a.path}» не найден. Список — kubejs_files.`;
    return `«${a.path}» — несколько файлов, уточните путь:\n${candidates
      .slice(0, 30)
      .map((c) => c.rel)
      .join('\n')}${candidates.length > 30 ? `\n… ещё ${candidates.length - 30}` : ''}`;
  }
  if (!isText(f)) return `${f.rel} — не текст (${Math.round(f.size / 1024)} КБ).`;
  const lines = linesOf(f);
  const info = parsed().byFile.get(f.rel);
  const marks = info?.lines;
  const out = [
    `${f.rel} — ${lines.length} стр., изменён ${dateOf(f.mtime)}${info ? `; разобрано: ${statsText(info)}` : ''}`,
  ];
  const stale = staleNote([f]);
  if (stale) out.push(stale);
  // Записи без строки (рецепт из data — весь файл)
  for (const e of marks?.get(0) ?? []) out.push(`${MARK[e.kind]} весь файл: ${e.text}`);

  let idx = lines.map((_, i) => i);
  if (a.grep) {
    let re;
    try {
      re = new RegExp(a.grep, 'i');
    } catch {
      const g = norm(a.grep);
      re = { test: (s) => norm(s).includes(g) };
    }
    idx = idx.filter((i) => re.test(lines[i]));
    out.push(`grep «${a.grep}»: ${idx.length} строк.`);
  }
  const start = Math.max(1, Number(a.offset ?? 1) | 0);
  const limit = Math.min(1000, Math.max(1, Number(a.limit ?? 200) | 0));
  const shown = idx.filter((i) => i + 1 >= start).slice(0, limit);
  if (marks?.size) out.push(LEGEND);
  const width = String(lines.length).length;
  const notes = [];
  for (const i of shown) {
    out.push(numbered(lines, i, marks, width));
    for (const e of marks?.get(i + 1) ?? []) notes.push({ line: i + 1, e });
  }
  const lastShown = shown.at(-1);
  const rest = idx.filter((i) => i > lastShown).length;
  if (rest) out.push(`… ещё ${rest} стр.; дальше: offset=${lastShown + 2}`);
  if (notes.length) {
    // Цикл в скрипте даёт много записей на одной строке — по строке и виду одной строкой с числом
    const groups = new Map();
    for (const n of notes) {
      const key = `${n.line} ${n.e.kind}`;
      if (!groups.has(key)) groups.set(key, { line: n.line, kind: n.e.kind, texts: [] });
      groups.get(key).texts.push(n.e.text);
    }
    out.push(`Разобрано на показанных строках (${notes.length}):`);
    const max = Math.max(1, Number(a.notes ?? 60) | 0);
    for (const g of [...groups.values()].slice(0, max)) {
      const more = g.texts.length > 3 ? `; … всего ${g.texts.length}` : '';
      out.push(`  ${g.line} ${MARK[g.kind]} ${short(g.texts.slice(0, 3).join('; '), 500)}${more}`);
    }
    if (groups.size > max) out.push(`  … ещё ${groups.size - max} строк (notes=…, или сузьте offset/limit)`);
  }
  return clip(out.join('\n'));
}

// ---------------------------------------------------------------- описание

const where = {
  layer: str('слой: pack (сборка) или world (мир сервера)'),
  folder: str(`папка слоя: ${FOLDERS.join(', ')}`),
  path: str('часть пути файла, например recipes/tfc'),
};

export const TOOLS = [
  {
    name: 'kubejs_files',
    description:
      'Файлы KubeJS сборки (instance/kubejs/<слой>/…): число строк и что из файла разобрано в public/kubejs.json (правила remove/replace, рецепты, теги, предметы); предупреждает, если файлы новее разбора. По умолчанию — скрипты, data/assets — через folder или path.',
    inputSchema: {
      type: 'object',
      properties: { ...where, limit: num('сколько файлов (по умолчанию 100)'), offset: paging.offset },
    },
    handler: kubejsFiles,
  },
  {
    name: 'kubejs_search',
    description:
      'Поиск по тексту скриптов и файлов KubeJS сборки (все слова в строке или регулярка): файл:строка с соседними строками и пометками разобранного (правило/рецепт/тег/предмет).',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('слова (все в одной строке) или регулярка при regex=true'),
        regex: { type: 'boolean', description: 'query — регулярное выражение (без учёта регистра)' },
        context: num('соседних строк до и после (по умолчанию 2, до 10)'),
        ...where,
        ...paging,
      },
      required: ['query'],
    },
    handler: kubejsSearch,
  },
  {
    name: 'kubejs_read',
    description:
      'Файл KubeJS сборки по строкам (offset — с какой строки, limit, grep) с пометками строк, которые public/kubejs.json разобрал как правило remove/replaceInput/replaceOutput, рецепт, тег или свой предмет, и списком этих записей.',
    inputSchema: {
      type: 'object',
      properties: {
        path: str('путь от instance/kubejs, например pack/server_scripts/recipes/misc.js (можно без слоя, если один)'),
        offset: num('с какой строки (1 — начало)'),
        limit: num('сколько строк (по умолчанию 200)'),
        grep: str('только строки с совпадением (регулярка или подстрока)'),
        notes: num('сколько строк с записями разбора перечислить (по умолчанию 60)'),
      },
      required: ['path'],
    },
    handler: kubejsRead,
  },
];
