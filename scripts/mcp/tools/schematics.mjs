/**
 * Инструменты MCP: библиотека схем Create сайта. Список и исходники .nbt — через сервер сборки (GET /site/schematics,
 * /site/files/:id: он сам кеширует Firestore, нам — 0 чтений), исходник на диске — ~/.cache/tfc-plans/schematics/<fileId>
 * (файл с данным id не меняется). Свежая запись для правки — один GET Firestore (ревизия = updateTime).
 * Запись: новый или изменённый исходник — POST /site/schematics сервера сборки (проверка NBT, дублей, ревизии, как
 * `tfc schematics publish`); название, описание, замены, форма и превью — PATCH Firestore с условием на ревизию.
 * Разбор и сборка файла — те же функции, что у сайта (@tfc/core/nbt, @tfc/core/schematicFile).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readNbt, T, writeNbt } from '@tfc/core/nbt';
import {
  applyEdits,
  countBlocks,
  DEFAULT_SHAPE,
  EMPTY_BLOCKS,
  intList,
  nameOf as stateName,
  paletteLists,
  posOf,
  REMOVE,
  savedEdits,
  shapeBox,
  sizeOf,
} from '@tfc/core/schematicFile';
import { inspectSchematic, SCHEMATIC_MAX } from '@tfc/pack-server/schematic-nbt';
import { DOCS, fromValue } from '../../firestore-rest.mjs';
import { packServer } from '../../pack-fetch.mjs';
import { itemName } from '../data.mjs';
import { FirestoreError, api, patchDoc } from '../firestore.mjs';
import { dateOf, named, NICK, norm, num, page, paging, str, words } from '../fmt.mjs';
import { blockstatePath, findResource, resourceLayers } from '../resources.mjs';
import { renderSchematic } from '../schematic-render.mjs';
import { mentions } from './site.mjs';

const SITE = 'https://tfc-plans-fd2c.web.app';
const CACHE = path.join(os.homedir(), '.cache', 'tfc-plans', 'schematics');
const TTL = 60_000;
/** Лимиты правил Firestore (firestore.rules, match /schematics) и сайта (MAX_PREVIEW в schematicLibrary.ts) */
const MAX_NAME = 120;
const MAX_DESCRIPTION = 4000;
const MAX_REPLACE = 2000;
const MAX_PREVIEW = 280_000;
const MAX_EDIT_CELLS = 100_000;
const BLOCK_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

const link = (id) => `${SITE}/schematics?id=${id}`;
const kb = (n) =>
  n == null
    ? '?'
    : n < 1024
      ? `${n} Б`
      : n < 1048576
        ? `${(n / 1024).toFixed(1)} КБ`
        : `${(n / 1048576).toFixed(1)} МБ`;
const who = (d) => `${d.author ?? '?'}${d.updatedBy && d.updatedBy !== d.author ? `, правил ${d.updatedBy}` : ''}`;
const sizeText = (s) => (s?.length ? s.join('×') : '?');
const nm = (id) => itemName(id) ?? '';

// ---------------------------------------------------------------- сервер сборки

async function pack(p, init = {}, raw = false) {
  const srv = packServer();
  if (!srv) throw new Error('Нужен ключ сервера сборки: tfc login или TFC_PACK_URL/TFC_PACK_TOKEN');
  let res;
  try {
    res = await fetch(srv.url + p, {
      ...init,
      headers: { Authorization: `Bearer ${srv.token}`, ...init.headers },
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error('Сервер сборки недоступен или не ответил');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const e = new Error(`Сервер сборки: HTTP ${res.status}${body?.error ? ` — ${body.error}` : ''}`);
    e.status = res.status;
    throw e;
  }
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}

/** Записи, которые мы сами только что поменяли: список сервера сборки кеширует их до 5 минут */
const fresh = new Map();
let listCache = null;

async function schematics() {
  if (!listCache || listCache.until < Date.now()) {
    const value = pack('/site/schematics').then((r) => r.items ?? []);
    listCache = { until: Date.now() + TTL, value };
    value.catch(() => (listCache = null));
  }
  const list = await listCache.value;
  const out = list.map((s) => {
    const f = fresh.get(s.id);
    return f && Date.parse(f.revision) >= Date.parse(s.revision ?? 0) ? { ...s, ...f } : s;
  });
  for (const [id, f] of fresh) if (!out.some((s) => s.id === id)) out.push(f);
  return out.filter((s) => !s.deleted);
}

/** Исходник .nbt по fileId: кеш на диске, иначе с сервера сборки; хеш сверяется, если он есть в записи */
async function sourceBytes(entry) {
  const file = path.join(CACHE, entry.fileId);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const bytes = await pack(`/site/files/${encodeURIComponent(entry.fileId)}`, {}, true);
  if (entry.sha256 && createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw new Error(`Исходник ${entry.fileId}: хеш не сошёлся с записью`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(`${file}.part`, bytes);
  fs.renameSync(`${file}.part`, file);
  return bytes;
}

/** Хеш распакованного NBT исходника (как у сервера сборки); у записей с сайта его нет в карточке — считаем сами */
const hashes = new Map();
async function contentHashOf(entry) {
  if (entry.contentHash) return entry.contentHash;
  if (!hashes.has(entry.fileId)) {
    try {
      hashes.set(entry.fileId, inspectSchematic(await sourceBytes(entry)).contentHash);
    } catch {
      hashes.set(entry.fileId, null);
    }
  }
  return hashes.get(entry.fileId);
}

// ---------------------------------------------------------------- Firestore: одна запись

let reads = 0;
async function firestoreEntry(id) {
  try {
    const d = await api(`${DOCS}/schematics/${encodeURIComponent(id)}`);
    reads += 1;
    const f = Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, fromValue(v)]));
    return { id, revision: d.updateTime, ...f, hasPreview: Boolean(f.preview), preview: undefined };
  } catch (e) {
    if (e instanceof FirestoreError && e.status === 404) {
      reads += 1;
      return null;
    }
    throw e;
  }
}

/** Запись по id, названию, имени файла или ссылке на сайт; несколько подходящих — отказ со списком */
async function findEntry(key) {
  let k = String(key ?? '').trim();
  const ref = k.match(/[?&]id=([A-Za-z0-9]{20})\b/);
  if (ref) k = ref[1];
  if (!k) throw new Error('Укажите id схемы (schematics_list).');
  const list = await schematics();
  const exact =
    list.find((s) => s.id === k) ??
    list.find((s) => norm(s.name) === norm(k)) ??
    list.find((s) => norm(s.fileName) === norm(k));
  if (exact) return exact;
  const ws = words(k);
  const found = list.filter((s) => ws.every((w) => norm(`${s.id} ${s.name} ${s.fileName}`).includes(w)));
  if (found.length === 1) return found[0];
  if (!found.length) throw new Error(`Схема не найдена: ${k}. Список — schematics_list.`);
  throw new Error(
    `Подходит несколько (${found.length}), уточните id:\n${found.map((s) => `${s.id} — ${s.name}`).join('\n')}`,
  );
}

// ---------------------------------------------------------------- разбор схемы

const propsOf = (entry) => {
  const p = entry?.type === T.Compound ? entry.value.get('Properties') : null;
  const out = new Map();
  if (p?.type === T.Compound)
    for (const [k, v] of [...p.value].sort(([a], [b]) => a.localeCompare(b)))
      if (v.type === T.String) out.set(k, v.value);
  return out;
};
const stateText = (s) => `${s.name}${s.props.size ? `[${[...s.props].map(([k, v]) => `${k}=${v}`).join(',')}]` : ''}`;

/** Схема в памяти: палитра (первая), клетки с позициями и данными блок-сущностей */
async function parse(bytes) {
  const parsed = await readNbt(bytes);
  const root = parsed.root.value;
  const palettes = paletteLists(root);
  if (!palettes.length) throw new Error('В файле нет палитры блоков — это не схема');
  const states = palettes[0].map((e) => {
    const name = stateName(e) ?? '?';
    return { name, props: propsOf(e), empty: EMPTY_BLOCKS.has(name) };
  });
  const cells = [];
  const blocks = root.get('blocks');
  for (const b of blocks?.type === T.List ? blocks.value : []) {
    const pos = posOf(b);
    const st = b.type === T.Compound ? b.value.get('state') : null;
    if (!pos || st?.type !== T.Int) continue;
    const nbt = b.value.get('nbt');
    cells.push({ pos, state: st.value, nbt: nbt?.type === T.Compound ? nbt : null });
  }
  const ents = root.get('entities');
  return {
    parsed,
    root,
    states,
    cells,
    palettes: palettes.length,
    size: sizeOf(root) ?? bboxSize(cells),
    entities: ents?.type === T.List ? ents.value : [],
  };
}

function bboxSize(cells) {
  const hi = [0, 0, 0];
  for (const c of cells) for (let i = 0; i < 3; i++) hi[i] = Math.max(hi[i], c.pos[i] + 1);
  return hi;
}

/** Схема с заменами и формой записи — то, что скачивает сайт */
async function editedModel(src, entry, { shape = true } = {}) {
  const { replace, shape: sh } = savedEdits({ replace: entry.replace ?? [], shape: entry.shape });
  return parse(await applyEdits(src.parsed, replace, shape ? sh : { ...DEFAULT_SHAPE }));
}

/** SNBT: компактная запись тега для показа данных блок-сущностей */
function snbt(tag, depth = 0) {
  const q = (s) => (/^[A-Za-z0-9_.+-]+$/.test(s) ? s : JSON.stringify(s));
  switch (tag.type) {
    case T.Byte:
      return `${tag.value}b`;
    case T.Short:
      return `${tag.value}s`;
    case T.Int:
      return String(tag.value);
    case T.Long:
      return `${tag.value}L`;
    case T.Float:
      return `${tag.value}f`;
    case T.Double:
      return `${tag.value}d`;
    case T.String:
      return JSON.stringify(tag.value);
    case T.ByteArray:
      return `[B;${[...tag.value].join(',')}]`;
    case T.IntArray:
      return `[I;${[...tag.value].join(',')}]`;
    case T.LongArray:
      return `[L;${[...tag.value].join(',')}]`;
    case T.List:
      return depth > 12 ? '[…]' : `[${tag.value.map((t) => snbt(t, depth + 1)).join(',')}]`;
    case T.Compound:
      return depth > 12 ? '{…}' : `{${[...tag.value].map(([k, v]) => `${q(k)}:${snbt(v, depth + 1)}`).join(',')}}`;
    default:
      return '?';
  }
}

const vec = (s, what) => {
  const v = String(s ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (v.length !== 3 || v.some((x) => !Number.isInteger(x))) throw new Error(`${what}: нужно «x,y,z» целыми`);
  return v;
};

/** Коробка «x1,y1,z1,x2,y2,z2» (включительно) или null */
function boxOf(s) {
  if (s == null || s === '') return null;
  const v = String(s)
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (v.length !== 6 || v.some((x) => !Number.isInteger(x))) throw new Error('box: нужно «x1,y1,z1,x2,y2,z2»');
  return {
    lo: [0, 1, 2].map((i) => Math.min(v[i], v[i + 3])),
    hi: [0, 1, 2].map((i) => Math.max(v[i], v[i + 3])),
  };
}
const inBox = (p, b) => !b || p.every((v, i) => v >= b.lo[i] && v <= b.hi[i]);

/** Блоки по id с количеством; заменённые — со стрелкой */
function countLines(m, replace) {
  const counts = countBlocks(m.parsed);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, n]) => {
      const to = replace?.get(id);
      return `${String(n).padStart(6)}  ${named(id)}${to ? ` → ${to === REMOVE ? 'удалить' : named(to)}` : ''}`;
    });
}

const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+=?@';

/** Слой Y текстом: x — вправо, z — вниз, «.» — пусто; легенда по id блока */
function layerText(m, y, box) {
  const [X, Y, Z] = m.size;
  if (y < 0 || y >= Y) return `Слой y=${y} вне схемы (высота ${Y}: y от 0 до ${Y - 1}).`;
  const lo = [box?.lo[0] ?? 0, box?.lo[2] ?? 0];
  const hi = [Math.min(X - 1, box?.hi[0] ?? X - 1), Math.min(Z - 1, box?.hi[2] ?? Z - 1)];
  const w = hi[0] - lo[0] + 1;
  const h = hi[1] - lo[1] + 1;
  if (w * h > 12000)
    return `Слой ${w}×${h} слишком большой для текста — сузьте box (x1,y1,z1,x2,y2,z2) или смотрите schematic_render view=layer.`;
  const sym = new Map();
  const count = new Map();
  const grid = Array.from({ length: h }, () => Array(w).fill('.'));
  for (const c of m.cells) {
    if (c.pos[1] !== y) continue;
    const x = c.pos[0] - lo[0];
    const z = c.pos[2] - lo[1];
    if (x < 0 || z < 0 || x >= w || z >= h) continue;
    const s = m.states[c.state];
    if (!s || s.empty) continue;
    if (!sym.has(s.name)) sym.set(s.name, SYMBOLS[sym.size] ?? '~');
    count.set(s.name, (count.get(s.name) ?? 0) + 1);
    grid[z][x] = sym.get(s.name);
  }
  const ruler = (from, n) => Array.from({ length: n }, (_, i) => String((from + i) % 10)).join('');
  return [
    `Слой y=${y}, x ${lo[0]}…${hi[0]} (вправо), z ${lo[1]}…${hi[1]} (вниз); «.» — пусто или воздух.`,
    `     ${ruler(lo[0], w)}`,
    ...grid.map((row, i) => `${String(lo[1] + i).padStart(4)} ${row.join('')}`),
    '',
    'Легенда:',
    ...[...sym].map(([id, s]) => `${s}  ${count.get(id)}× ${named(id)}`),
    ...(sym.size > SYMBOLS.length ? ['~  — остальные блоки (символы кончились)'] : []),
  ].join('\n');
}

// ---------------------------------------------------------------- schematics_list

/** id и названия блоков исходника — для поиска; кеш в памяти по fileId */
const blockText = new Map();
async function blocksOf(entry) {
  if (blockText.has(entry.fileId)) return blockText.get(entry.fileId);
  const parsed = await readNbt(await sourceBytes(entry));
  const ids = [...countBlocks(parsed).keys()];
  const v = { ids, text: norm(ids.map((id) => `${id} ${nm(id)}`).join(' ')) };
  blockText.set(entry.fileId, v);
  return v;
}

async function schematicsList(a) {
  let list = await schematics();
  const ws = words(a.query);
  const byBlocks = new Map();
  if (ws.length) {
    const out = [];
    for (const s of list) {
      const meta = norm(
        `${s.id} ${s.name} ${s.fileName} ${s.author ?? ''} ${s.description ?? ''} ${(s.replace ?? [])
          .map((x) => `${x.from} ${nm(x.from)} ${x.to} ${nm(x.to)}`)
          .join(' ')}`,
      );
      const rest = ws.filter((w) => !meta.includes(w));
      if (!rest.length) {
        out.push(s);
        continue;
      }
      if (a.blocks === false || !s.fileId) continue;
      let b;
      try {
        b = await blocksOf(s);
      } catch {
        continue;
      }
      if (rest.every((w) => b.text.includes(w))) {
        out.push(s);
        byBlocks.set(
          s.id,
          b.ids.filter((id) => rest.some((w) => norm(`${id} ${nm(id)}`).includes(w))),
        );
      }
    }
    list = out;
  }
  list.sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0));
  return page(list, a, (s) => {
    const hit = byBlocks.get(s.id);
    return [
      `${s.id} — ${s.name} (${s.fileName}, ${sizeText(s.size)}, ${s.blocks ?? '?'} блоков, замен ${(s.replace ?? []).length}; ${who(s)}, ${dateOf(s.updatedAt)})`,
      ...(s.description ? [`    ${s.description.replace(/\s+/g, ' ').slice(0, 160)}`] : []),
      ...(hit ? [`    найдено по блокам: ${hit.slice(0, 6).map(named).join(', ')}`] : []),
      `    ${link(s.id)}`,
    ];
  });
}

// ---------------------------------------------------------------- schematic_get

function shapeText(sh) {
  if (!sh) return 'по умолчанию (без обрезки)';
  return (
    `${sh.crop ? 'обрезка, ' : ''}отступы по бокам ${sh.sides}, снизу ${sh.bottom}, сверху ${sh.top}` +
    `${sh.clearAir ? ', воздух очищает место' : ''}${
      sh.platform
        ? `; площадка ${sh.platformBlock ?? '?'} высотой ${sh.platformHeight ?? 1}${sh.platformHollow ? ' (полая)' : ''}`
        : ''
    }`
  );
}

async function schematicGet(a) {
  reads = 0;
  const listed = await findEntry(a.id);
  const entry = a.fresh ? ((await firestoreEntry(listed.id)) ?? listed) : listed;
  const src = await parse(await sourceBytes(entry));
  const m = a.edited ? await editedModel(src, entry) : src;
  const view = a.edited ? 'файл с заменами и формой (как скачивает сайт)' : 'исходник';
  const box = boxOf(a.box);
  const replace = savedEdits({ replace: entry.replace ?? [], shape: entry.shape }).replace;
  const tail = reads ? `\n— Firestore: ${reads} чтен.` : '';

  if (a.save) {
    const out = path.resolve(String(a.save));
    const { replace: rep, shape } = savedEdits({ replace: entry.replace ?? [], shape: entry.shape });
    const bytes = a.edited === false ? await sourceBytes(entry) : await applyEdits(src.parsed, rep, shape);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, bytes);
    return `Сохранено: ${out} (${kb(bytes.length)}; ${a.edited === false ? 'исходник' : 'с заменами и формой, как «Скачать» на сайте'}).`;
  }

  if (a.pos != null) {
    const p = vec(a.pos, 'pos');
    const here = m.cells.filter((c) => c.pos.every((v, i) => v === p[i]));
    if (!here.length) return `${entry.name}, ${view}: в ${p.join(',')} блока нет (пусто).${tail}`;
    const out = [`${entry.name}, ${view}: ${p.join(',')}`];
    for (const c of here) {
      const s = m.states[c.state];
      out.push(`состояние #${c.state}: ${stateText(s)}${nm(s.name) ? ` «${nm(s.name)}»` : ''}`);
      if (c.nbt) {
        const text = snbt(c.nbt);
        out.push(`данные блок-сущности (${text.length} симв.):`, text.length > 8000 ? `${text.slice(0, 8000)}…` : text);
      } else out.push('данных блок-сущности нет');
    }
    return out.join('\n') + tail;
  }

  if (a.section === 'layer' || a.y != null) {
    const y = Number(a.y ?? 0) | 0;
    return `${entry.name}, ${view}\n${layerText(m, y, box)}${tail}`;
  }

  if (a.section === 'palette') {
    const used = new Map();
    for (const c of m.cells) used.set(c.state, (used.get(c.state) ?? 0) + 1);
    return (
      [
        `${entry.name}, ${view}: палитра ${m.states.length} состояний${m.palettes > 1 ? ` (вариантов палитры ${m.palettes}, показана первая)` : ''}`,
        ...m.states.map(
          (s, i) =>
            `#${String(i).padEnd(4)} ${String(used.get(i) ?? 0).padStart(6)}×  ${stateText(s)}${nm(s.name) ? ` «${nm(s.name)}»` : ''}`,
        ),
      ].join('\n') + tail
    );
  }

  if (a.section === 'blocks' || a.block) {
    const ws = words(a.block);
    const list = m.cells
      .filter((c) => inBox(c.pos, box))
      .filter((c) => {
        const s = m.states[c.state];
        return s && (!ws.length || ws.every((w) => norm(`${s.name} ${nm(s.name)}`).includes(w)));
      })
      .sort((x, y) => x.pos[1] - y.pos[1] || x.pos[2] - y.pos[2] || x.pos[0] - y.pos[0]);
    return (
      `${entry.name}, ${view}; координаты x,y,z от угла схемы\n` +
      page(
        list,
        a,
        (c) => [`${c.pos.join(',').padEnd(12)} ${stateText(m.states[c.state])}${c.nbt ? '  +данные' : ''}`],
        50,
      ) +
      tail
    );
  }

  if (a.section === 'nbt') {
    const out = [`${entry.name}, ${view}: корень NBT «${m.parsed.root.name}», gzip ${m.parsed.gzipped ? 'да' : 'нет'}`];
    for (const [k, v] of m.root) {
      if (['blocks', 'palette', 'palettes', 'entities'].includes(k))
        out.push(`${k}: список из ${v.type === T.List ? v.value.length : '?'}`);
      else out.push(`${k}: ${snbt(v).slice(0, 500)}`);
    }
    if (m.entities.length) {
      out.push('', `Сущности (${m.entities.length}):`);
      for (const e of m.entities.slice(0, 50)) {
        const id = e.type === T.Compound ? e.value.get('nbt')?.value?.get?.('id')?.value : null;
        const bp = e.type === T.Compound ? e.value.get('blockPos') : null;
        out.push(`${id ?? '?'} в ${bp?.type === T.List ? bp.value.map((x) => x.value).join(',') : '?'}`);
      }
    }
    return out.join('\n') + tail;
  }

  // Сводка
  const withNbt = m.cells.filter((c) => c.nbt).length;
  const out = [
    `${entry.id} — ${entry.name}`,
    `ссылка: ${link(entry.id)}`,
    `файл: ${entry.fileName} (${kb(entry.fileSize)}, files/${entry.fileId}); ${who(entry)}; изменена ${dateOf(entry.updatedAt)}`,
    `ревизия: ${entry.revision ?? '?'}${a.fresh ? '' : ' (из списка сервера сборки, до 5 мин; свежая — fresh=true)'}`,
    `исходник: ${sizeText(src.size)}, клеток ${src.cells.length}, палитра ${src.states.length}, блок-сущностей ${src.cells.filter((c) => c.nbt).length}, сущностей ${src.entities.length}, DataVersion ${src.root.get('DataVersion')?.value ?? '?'}`,
    `при скачивании: ${shapeText(entry.shape)}`,
  ];
  if (a.edited)
    out.push(`после замен и формы: ${sizeText(m.size)}, клеток ${m.cells.length}, блок-сущностей ${withNbt}`);
  else {
    const box2 = shapeBox(src.parsed, savedEdits(entry).shape, replace);
    if (box2) out.push(`после замен и формы: ${sizeText(box2.size)}`);
  }
  if (entry.description) out.push('', 'Описание:', entry.description);
  out.push(
    '',
    `Блоки ${a.edited ? 'файла с заменами' : 'исходника (→ замена из записи)'}:`,
    ...countLines(m, a.edited ? null : replace),
  );
  out.push(
    '',
    'Дальше: section=palette | blocks (block=, box=) | layer (y=, box=) | nbt; pos=x,y,z — блок и его данные; edited=true — как скачивается; save=<путь> — файл; schematic_render — картинка.',
  );
  const mm = await mentions(entry.name);
  if (mm) out.push(mm);
  return out.join('\n') + tail;
}

// ---------------------------------------------------------------- schematic_render

async function schematicRender(a) {
  let m;
  let title;
  if (a.file) {
    const file = path.resolve(String(a.file));
    m = await parse(fs.readFileSync(file));
    title = file;
  } else {
    const entry = await findEntry(a.id);
    const src = await parse(await sourceBytes(entry));
    m = a.edited === false ? src : await editedModel(src, entry, { shape: Boolean(a.shape) });
    title = `${entry.name}${a.edited === false ? ' (исходник)' : ' (с заменами)'}`;
  }
  const view = ['iso', 'top', 'layer'].includes(a.view) ? a.view : 'iso';
  const y = Number(a.y ?? 0) | 0;
  if (view === 'layer' && (y < 0 || y >= m.size[1])) return `Слой y=${y} вне схемы (y от 0 до ${m.size[1] - 1}).`;
  const max = Math.min(1600, Math.max(128, Number(a.size ?? 768) | 0));
  const r = renderSchematic(m, { view, y, max });
  const lines = [
    `${title}: ${sizeText(m.size)}, вид ${view === 'iso' ? 'изометрия' : view === 'top' ? 'сверху' : `слой y=${y}`}; ${r.w}×${r.h}, ${r.scale} пикс. на блок, нарисовано ${r.drawn}`,
    'Цвет блока — средний по его модели; форма неполных блоков не передаётся (точный 3D — на сайте).',
  ];
  if (view === 'layer') lines.push('x — вправо, z — вниз; текстом с легендой — schematic_get y=…');
  if (r.undrawn.length) lines.push(`без модели (цвет по id): ${r.undrawn.slice(0, 15).join(', ')}`);
  return { text: lines.join('\n'), images: [r.png] };
}

/** Превью для записи: изометрия с заменами, PNG data URL не больше лимита сайта */
function previewOf(m) {
  for (const max of [512, 384, 256]) {
    const url = `data:image/png;base64,${renderSchematic(m, { view: 'iso', max }).png.toString('base64')}`;
    if (url.length <= MAX_PREVIEW) return url;
  }
  return null;
}

// ---------------------------------------------------------------- schematic_put

function parseBlock(s) {
  const t = String(s ?? '').trim();
  if (t === REMOVE || t === 'remove') return { remove: true };
  const m = t.match(/^([^[\]]+)(?:\[(.*)\])?$/);
  if (!m) throw new Error(`Блок «${t}»: нужно ns:id или ns:id[свойство=значение,…]`);
  const name = m[1].includes(':') ? m[1] : `minecraft:${m[1]}`;
  if (!BLOCK_ID.test(name)) throw new Error(`Блок «${t}»: неверный id`);
  const props = new Map();
  for (const part of (m[2] ?? '').split(',').filter(Boolean)) {
    const [k, v] = part.split('=').map((x) => x?.trim());
    if (!k || v == null) throw new Error(`Блок «${t}»: свойство «${part}» — нужно ключ=значение`);
    props.set(k, v);
  }
  return { name, props: new Map([...props].sort(([x], [y]) => x.localeCompare(y))) };
}

/**
 * Правки клеток в исходнике: удалить (#remove), поставить блок (с заменой данных блок-сущности — они теряются).
 * Возвращает строки отчёта; parsed меняется на месте.
 */
function editBlocks(src, edits, warnings) {
  if (src.palettes > 1) throw new Error('Правка блоков схем с несколькими вариантами палитры не поддерживается');
  const root = src.root;
  const palette = paletteLists(root)[0];
  const blocks = root.get('blocks');
  if (blocks?.type !== T.List) throw new Error('В схеме нет списка блоков');
  const stateIndex = (b) => {
    const i = src.states.findIndex(
      (s) => s.name === b.name && s.props.size === b.props.size && [...b.props].every(([k, v]) => s.props.get(k) === v),
    );
    if (i >= 0) return i;
    const value = new Map([['Name', { type: T.String, value: b.name }]]);
    if (b.props.size)
      value.set('Properties', {
        type: T.Compound,
        value: new Map([...b.props].map(([k, v]) => [k, { type: T.String, value: v }])),
      });
    palette.push({ type: T.Compound, value });
    src.states.push({ name: b.name, props: b.props, empty: EMPTY_BLOCKS.has(b.name) });
    return palette.length - 1;
  };
  const size = src.size;
  const k = (p) => (p[1] * size[2] + p[2]) * size[0] + p[0];
  const report = [];
  const touched = new Map(); // клетка → новое состояние или -1 (удалить)
  let cellsTotal = 0;
  let layers = null;
  for (const [n, e] of edits.entries()) {
    const from = vec(e.pos, `blocks[${n}].pos`);
    const to = e.to != null ? vec(e.to, `blocks[${n}].to`) : from;
    const lo = from.map((v, i) => Math.min(v, to[i]));
    const hi = from.map((v, i) => Math.max(v, to[i]));
    if (lo.some((v) => v < 0) || hi.some((v, i) => v >= size[i]))
      throw new Error(`blocks[${n}]: ${lo.join(',')}…${hi.join(',')} выходит за габариты ${size.join('×')}`);
    const cells = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
    cellsTotal += cells;
    if (cellsTotal > MAX_EDIT_CELLS) throw new Error(`Слишком много клеток за раз (больше ${MAX_EDIT_CELLS})`);
    const b = parseBlock(e.block);
    let state = -1;
    if (!b.remove) {
      state = stateIndex(b);
      layers ??= resourceLayers();
      if (!EMPTY_BLOCKS.has(b.name) && !findResource(layers, blockstatePath(b.name)))
        warnings.add(`${b.name}: блокстейта нет в ресурсах сборки — проверьте id`);
    }
    for (let y = lo[1]; y <= hi[1]; y++)
      for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) touched.set(k([x, y, z]), state);
    report.push(
      `${lo.join(',')}${cells > 1 ? `…${hi.join(',')} (${cells} кл.)` : ''} → ${b.remove ? 'удалить' : stateText(b)}`,
    );
  }
  let lostNbt = 0;
  const kept = [];
  for (const t of blocks.value) {
    const p = posOf(t);
    if (p && touched.has(k(p))) {
      if (t.type === T.Compound && t.value.has('nbt')) lostNbt++;
      continue;
    }
    kept.push(t);
  }
  for (const [cell, state] of touched) {
    if (state < 0) continue;
    const x = cell % size[0];
    const z = Math.floor(cell / size[0]) % size[2];
    const y = Math.floor(cell / (size[0] * size[2]));
    kept.push({
      type: T.Compound,
      value: new Map([
        ['pos', intList([x, y, z])],
        ['state', { type: T.Int, value: state }],
      ]),
    });
  }
  blocks.value = kept;
  blocks.elemType = T.Compound;
  if (lostNbt) warnings.add(`данные блок-сущностей сняты с ${lostNbt} заменённых клеток`);
  return report;
}

function checkShape(base, patch) {
  const sh = { ...DEFAULT_SHAPE, ...base, ...patch };
  for (const f of ['crop', 'clearAir', 'platform', 'platformHollow'])
    if (typeof sh[f] !== 'boolean') throw new Error(`shape.${f}: true или false`);
  for (const f of ['sides', 'bottom', 'top'])
    if (!Number.isInteger(sh[f]) || sh[f] < 0 || sh[f] > 64) throw new Error(`shape.${f}: целое 0…64`);
  if (!Number.isInteger(sh.platformHeight) || sh.platformHeight < 1 || sh.platformHeight > 64)
    throw new Error('shape.platformHeight: целое 1…64');
  if (!BLOCK_ID.test(sh.platformBlock)) throw new Error('shape.platformBlock: id блока ns:path');
  return sh;
}

/** Новый список замен: replace — целиком, replaceSet — поправить отдельные (значение "-" снимает замену) */
function nextReplace(current, a, counts, warnings) {
  let list = a.replace != null ? a.replace : [...(current ?? [])];
  if (!Array.isArray(list)) throw new Error('replace: массив { from, to }');
  const map = new Map(list.map((r) => [String(r.from ?? '').trim(), String(r.to ?? '').trim()]));
  for (const [from, to] of Object.entries(a.replaceSet ?? {})) {
    const t = String(to).trim();
    if (t === '-' || t === '') map.delete(from.trim());
    else map.set(from.trim(), t);
  }
  const bad = [];
  for (const [from, to] of map) {
    if (!BLOCK_ID.test(from) || (to !== REMOVE && !BLOCK_ID.test(to))) bad.push(`${from} → ${to}`);
    else if (!counts.has(from)) bad.push(`${from}: такого блока в схеме нет`);
    else if (to !== REMOVE && !EMPTY_BLOCKS.has(to) && !itemName(to)) warnings.add(`${to}: нет в предметах сборки`);
  }
  if (bad.length) throw new Error(`Неверные замены:\n${bad.join('\n')}`);
  if (map.size > MAX_REPLACE) throw new Error(`Замен больше ${MAX_REPLACE}`);
  return [...map].map(([from, to]) => ({ from, to }));
}

const sameJson = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);

async function schematicPut(a) {
  reads = 0;
  const warnings = new Set();
  const out = [];
  const dry = a.dryRun === true;
  if (a.blocks != null && (!Array.isArray(a.blocks) || !a.blocks.length)) throw new Error('blocks: непустой массив');

  // Текущая запись (правка) — свежая из Firestore, с проверкой ревизии
  let entry = null;
  if (a.id) {
    const listed = await findEntry(a.id);
    entry = await firestoreEntry(listed.id);
    if (!entry) throw new Error('Схема удалена');
    if (!a.baseRevision)
      throw new Error(`Нужен baseRevision — текущая ревизия ${entry.revision} (schematic_get fresh=true)`);
    if (a.baseRevision !== entry.revision)
      throw new Error(
        `Схему изменили после вашего чтения: ревизия ${entry.revision}, правил ${entry.updatedBy ?? '?'} ${dateOf(entry.updatedAt)}. Посмотрите её заново (schematic_get fresh=true) и повторите с новой ревизией.`,
      );
  } else if (!a.file) throw new Error('Без id нужен file — путь к .nbt для загрузки в библиотеку');

  // Исходник: новый файл и/или правка клеток
  let bytes = null;
  let fileName = entry?.fileName;
  if (a.file) {
    const file = path.resolve(String(a.file));
    if (!fs.existsSync(file)) throw new Error(`Нет файла ${file}`);
    if (fs.statSync(file).size > SCHEMATIC_MAX) throw new Error('Схема больше 10 МБ');
    bytes = fs.readFileSync(file);
    // oxlint-disable-next-line no-control-regex -- имена файлов не содержат управляющих символов
    if (!entry) fileName = path.basename(file).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_');
    if (!/\.nbt$/i.test(fileName)) throw new Error('Нужен файл .nbt');
  }
  let src = await parse(bytes ?? (await sourceBytes(entry)));
  if (a.blocks) {
    out.push('Правки блоков:', ...editBlocks(src, a.blocks, warnings));
    bytes = Buffer.from(await writeNbt(src.parsed.root, src.parsed.gzipped));
    src = await parse(bytes);
  }
  if (bytes) {
    let info;
    try {
      info = inspectSchematic(bytes);
    } catch (e) {
      throw new Error(`Неверная схема: ${e.message}`);
    }
    // Тот же исходник уже в библиотеке — отказ сразу (сервер сборки проверит ещё раз, в т. ч. обработанные копии)
    let same = null;
    for (const s of await schematics()) {
      if (s.id === entry?.id || !s.fileId) continue;
      if ((await contentHashOf(s)) === info.contentHash) same = s;
    }
    if (same) throw new Error(`Эта схема уже в библиотеке: ${same.name} (${same.id}) — ${link(same.id)}`);
    if (entry && (await contentHashOf(entry)) === info.contentHash) {
      out.push('исходник тот же — файл не перезаписывается');
      bytes = null;
    }
  }

  // Поля записи
  const patch = {};
  if (a.name != null) {
    const n = String(a.name).trim();
    if (!n || n.length > MAX_NAME) throw new Error(`Название — от 1 до ${MAX_NAME} символов`);
    if (!entry || n !== entry.name) patch.name = n;
  }
  if (a.description != null) {
    const d = String(a.description);
    if (d.length > MAX_DESCRIPTION) throw new Error(`Описание длиннее ${MAX_DESCRIPTION} символов`);
    if (d !== (entry?.description ?? '')) patch.description = d;
  }
  const counts = countBlocks(src.parsed);
  if (a.replace != null || a.replaceSet != null) {
    const r = nextReplace(entry?.replace, a, counts, warnings);
    if (!sameJson(r, entry?.replace ?? [])) patch.replace = r;
  } else if (entry && bytes) {
    // Новый исходник: замены блоков, которых в нём больше нет, сайт не показывает — убираем
    const r = (entry.replace ?? []).filter((x) => counts.has(x.from));
    if (r.length !== (entry.replace ?? []).length) {
      patch.replace = r;
      warnings.add(`снято замен блоков, которых нет в новом исходнике: ${(entry.replace ?? []).length - r.length}`);
    }
  }
  if (a.shape != null) {
    const sh = checkShape(entry?.shape, a.shape);
    if (!sameJson(sh, entry?.shape)) patch.shape = sh;
  }
  // Сборка файла с новыми заменами и формой должна пройти, как «Скачать» на сайте
  const finalEntry = { replace: patch.replace ?? entry?.replace ?? [], shape: patch.shape ?? entry?.shape };
  const edited = await editedModel(src, finalEntry, { shape: true });
  const forPreview = await editedModel(src, finalEntry, { shape: false });
  const wantPreview = Boolean(bytes) || a.preview === true;

  const fields = Object.keys(patch);
  out.unshift(
    `${dry ? 'Пробно (dryRun), ничего не записано' : entry ? 'Правка' : 'Загрузка'}: ${patch.name ?? entry?.name ?? fileName.replace(/\.nbt$/i, '')}`,
  );
  if (bytes) out.push(`исходник: ${sizeText(src.size)}, клеток ${src.cells.length}, ${kb(bytes.length)}`);
  if (fields.length) out.push(`поля: ${fields.join(', ')}`);
  out.push(`файл при скачивании: ${sizeText(edited.size)}, клеток ${edited.cells.length}`);
  if (!bytes && !fields.length && !wantPreview) return [...out, 'Менять нечего.'].join('\n');
  if (dry) return [...out, ...[...warnings].map((w) => `⚠ ${w}`)].join('\n');

  // 1. Исходник — через сервер сборки (дубли, NBT, ревизия)
  let id = entry?.id;
  let revision = entry?.revision;
  if (bytes) {
    const meta = entry
      ? { id: entry.id, revision: entry.revision, name: entry.name, fileName: entry.fileName, asSource: a.asSource }
      : {
          name: patch.name ?? fileName.replace(/\.nbt$/i, ''),
          fileName,
          author: a.author ? String(a.author).trim() : NICK,
          asSource: a.asSource,
        };
    const r = await pack('/site/schematics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Schematic': encodeURIComponent(JSON.stringify(meta)) },
      body: bytes,
    });
    id = r.id;
    revision = r.revision;
    listCache = null;
    out.push(r.unchanged ? 'исходник не изменился (тот же файл)' : `исходник записан: files/${r.fileId}`);
    if (!entry) delete patch.name;
  }

  // 2. Поля и превью — Firestore с условием на ревизию
  if (wantPreview) {
    const url = previewOf(forPreview);
    if (url) patch.preview = url;
    else warnings.add('превью не поместилось в лимит — обновите его на сайте');
  }
  if (Object.keys(patch).length) {
    try {
      revision = await patchDoc('schematics', id, { ...patch, updatedBy: NICK, updatedAt: Date.now() }, revision);
    } catch (e) {
      if (e instanceof FirestoreError && (e.status === 400 || e.status === 409 || e.status === 412))
        throw new Error(
          `Схему изменили между шагами записи — ${bytes ? 'исходник уже записан, ' : ''}посмотрите заново (schematic_get fresh=true) и повторите поля.`,
        );
      throw e;
    }
  }
  const saved = await firestoreEntry(id);
  if (saved) fresh.set(id, saved);
  out.push(`id ${id}; ревизия ${saved?.revision ?? revision}`, `ссылка: ${link(id)}`);
  if (patch.preview) out.push('превью: изометрия по цветам блоков (точнее — кнопка обновления превью на сайте)');
  else if (patch.replace && saved?.hasPreview)
    out.push('превью прежнее — после замен его можно обновить: preview=true или на сайте');
  for (const w of warnings) out.push(`⚠ ${w}`);
  return `${out.join('\n')}\n— Firestore: ${reads} чтен. + запись`;
}

// ---------------------------------------------------------------- описание

const idProp = str('schematic id, name, file name or site link');
const boxProp = str('box filter "x1,y1,z1,x2,y2,z2" (inclusive)');

export const TOOLS = [
  {
    name: 'schematics_list',
    description:
      'Create schematics in the site library (via the pack server, 0 Firestore reads): name, file, size, blocks, replacements, description, site link. Search by words in id/name/file name/author/description/replacements; words not found there are searched in the blocks of each schematic (ids and Russian names; sources are downloaded once and cached).',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('words'),
        blocks: { type: 'boolean', description: 'also search block contents (default true)' },
        ...paging,
      },
    },
    handler: schematicsList,
  },
  {
    name: 'schematic_get',
    description:
      'One schematic from the library, read from its .nbt: summary (link, revision, size, shape, description, block counts with replacements); section=palette (states with properties and counts); section=blocks with block= words and box= (coordinates); y= — a layer as text with a legend; pos=x,y,z — block state and block-entity NBT (SNBT); section=nbt — root tags and entities. edited=true — the file after replacements and shape (as the site downloads it). save=<path> — write the file (edited by default; edited=false — the source). fresh=true — record from Firestore (current revision before schematic_put).',
    inputSchema: {
      type: 'object',
      properties: {
        id: idProp,
        section: { type: 'string', enum: ['summary', 'palette', 'blocks', 'layer', 'nbt'] },
        block: str('section=blocks: words of block id or Russian name'),
        y: num('layer Y (0 = bottom)'),
        pos: str('"x,y,z" — block at position'),
        box: boxProp,
        edited: { type: 'boolean', description: 'after replacements and shape (default false; save — default true)' },
        save: str('local path to write the .nbt'),
        fresh: { type: 'boolean', description: 'read the record from Firestore (1 read) for the current revision' },
        ...paging,
      },
      required: ['id'],
    },
    handler: schematicGet,
  },
  {
    name: 'schematic_render',
    description:
      'Schematic as a PNG: view=iso (isometric, default), top (top-down height map), layer (one Y layer, cells). Block colours are averaged from block models; partial block shapes are not drawn (exact 3D view is on the site). Library schematic by id (with replacements by default; shape=true — also crop/platform) or a local .nbt (file=) to check before upload.',
    inputSchema: {
      type: 'object',
      properties: {
        id: idProp,
        file: str('local .nbt path instead of id'),
        view: { type: 'string', enum: ['iso', 'top', 'layer'] },
        y: num('view=layer: layer Y'),
        edited: { type: 'boolean', description: 'apply replacements (default true); false — source' },
        shape: { type: 'boolean', description: 'also apply crop/padding/platform (default false)' },
        size: num('max image side in px (default 768, up to 1600)'),
      },
    },
    handler: schematicRender,
  },
  {
    name: 'schematic_put',
    description: `Write to the schematic library, signed ${NICK}. Without id — upload a local .nbt (file=) as a new schematic: NBT check, duplicate check against existing sources and their processed copies (pack server), author (default ${NICK}), preview (block-colour isometric). With id + baseRevision (schematic_get fresh=true) — edit: name, description, replace (whole list) / replaceSet (single replacements, "-" removes), shape (crop/padding/platform, merged), blocks (cell edits in the source: [{ pos:"x,y,z", to?:"x,y,z" box corner, block:"ns:id[prop=v]" | "minecraft:air" (explicit air clears space when pasted) | "#remove" (no block) }] — block-entity data of replaced cells is dropped), file (new source). Refuses if the record changed since baseRevision. dryRun=true — check and show without writing.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: idProp,
        baseRevision: str('revision from schematic_get fresh=true (required with id)'),
        file: str('local .nbt path: new schematic or new source'),
        name: str(`name (1–${MAX_NAME})`),
        description: str(`description, Markdown (up to ${MAX_DESCRIPTION}); "" clears`),
        author: str('new schematic only: author nick (who built it)'),
        replace: {
          type: 'array',
          items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
          description: 'whole replacement list: to = block id or "#remove"',
        },
        replaceSet: { type: 'object', description: '{ "from": "to" | "#remove" | "-" (drop) } — merged into current' },
        shape: {
          type: 'object',
          description:
            'merged: crop, sides, bottom, top (0–64), clearAir, platform, platformHeight (1–64), platformBlock, platformHollow',
        },
        blocks: { type: 'array', items: { type: 'object' }, description: 'cell edits, see description' },
        asSource: {
          type: 'boolean',
          description: 'publish a file that equals a processed library copy as a new source',
        },
        preview: { type: 'boolean', description: 'regenerate the preview (always done when the source changes)' },
        dryRun: { type: 'boolean', description: 'validate and show the result without writing' },
      },
    },
    handler: schematicPut,
  },
];
