/**
 * Инструменты MCP: раздел «blockstates» — есть ли состояние блока в данных сайта block-models/<ns>.json
 * (их пишет scripts/mods/block-models.mjs, формат — там же): варианты `v` и multipart `mp`.
 * Нужен коду, который сам собирает состояния (генератор построек, схемы): facing/half/shape у ступеней, axis у брёвен,
 * соединения панелей.
 *
 * Данные: public/block-models основной копии; файла нет (их публикует только сервер сборки) — тот же файл с сайта,
 * держим в памяти 15 мин. Нет и там — честное «нет данных» по моду, а не ошибка.
 * Сопоставление повторяет сайт (src/entities/schematic/blockModels.ts: parseKey, whenMatches).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC } from '../data.mjs';
import { str } from '../fmt.mjs';

const SITE = 'https://tfc-plans-fd2c.web.app';
const TTL = 15 * 60 * 1000;
/** Больше стольких состояний — по умолчанию показываем только проблемные */
const BRIEF = 30;

// ---------------------------------------------------------------- данные

/** ns → { file, from, at, mtime } — file: null, если данных нет */
const cache = new Map();

async function blockFile(ns) {
  const local = path.join(PUBLIC, 'block-models', `${ns}.json`);
  let mtime = null;
  try {
    mtime = fs.statSync(local).mtimeMs;
  } catch {
    // локального файла нет — с сайта
  }
  const hit = cache.get(ns);
  if (hit && (mtime != null ? hit.mtime === mtime : hit.mtime == null && Date.now() - hit.at < TTL)) return hit;
  let file = null;
  let from;
  if (mtime != null) {
    from = `public/block-models/${ns}.json`;
    try {
      file = JSON.parse(fs.readFileSync(local, 'utf8'));
    } catch (e) {
      from = `public/block-models/${ns}.json не читается: ${e.message}`;
    }
  } else {
    const url = `${SITE}/block-models/${encodeURIComponent(ns)}.json`;
    from = url;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      // Нет файла — хостинг отдаёт страницу сайта (text/html), это «нет данных», а не JSON
      if (r.ok && r.headers.get('content-type')?.includes('json')) file = await r.json();
      else from = `${url} — нет файла`;
    } catch (e) {
      from = `${url} — не загрузился: ${e.message}`;
    }
  }
  const out = { file: file?.b ? file : null, from, at: Date.now(), mtime };
  cache.set(ns, out);
  return out;
}

// ---------------------------------------------------------------- разбор входа

/** «tfc:rock/raw/granite[facing=north,half=top]» → { id, properties } */
function parseState(s) {
  if (typeof s === 'string') {
    const m = s.trim().match(/^([^[\]]+)(?:\[(.*)\])?$/);
    if (!m)
      throw new Error(`Не разобрать состояние «${s}» — нужно «ns:путь[свойство=значение,…]» или { id, properties }.`);
    return { id: m[1].trim(), properties: Object.fromEntries(parseKey(m[2] ?? '')) };
  }
  if (!s || typeof s !== 'object' || typeof s.id !== 'string')
    throw new Error('Каждое состояние — { id, properties? } или строка «ns:путь[…]».');
  const props = {};
  for (const [k, v] of Object.entries(s.properties ?? {})) props[k] = String(v);
  // id с [..] внутри объекта — тоже понимаем
  if (s.id.includes('[')) {
    const p = parseState(s.id);
    return { id: p.id, properties: { ...p.properties, ...props } };
  }
  return { id: s.id.trim(), properties: props };
}

const parseKey = (k) =>
  k && k !== 'normal'
    ? k
        .split(',')
        .filter((kv) => kv.includes('='))
        .map((kv) => {
          const i = kv.indexOf('=');
          return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
        })
    : [];

const stateText = (id, props) => {
  const kv = Object.entries(props).sort(([a], [b]) => (a < b ? -1 : 1));
  return kv.length ? `${id}[${kv.map(([k, v]) => `${k}=${v}`).join(',')}]` : id;
};

// ---------------------------------------------------------------- multipart

function whenMatches(w, p) {
  if (!w) return true;
  if (Array.isArray(w.OR)) return w.OR.some((x) => whenMatches(x, p));
  if (Array.isArray(w.AND)) return w.AND.every((x) => whenMatches(x, p));
  return Object.entries(w).every(([k, v]) => {
    const s = String(v);
    const neg = s.startsWith('!');
    const ok = s
      .replace(/^!/, '')
      .split('|')
      .includes(p.get(k) ?? '');
    return neg ? !ok : ok;
  });
}

/** Все свойства и значения, упомянутые в условиях multipart */
function whenValues(mp) {
  const vals = new Map();
  const walk = (w) => {
    if (!w) return;
    if (Array.isArray(w.OR)) return w.OR.forEach(walk);
    if (Array.isArray(w.AND)) return w.AND.forEach(walk);
    for (const [k, v] of Object.entries(w)) {
      const set = vals.get(k) ?? new Set();
      for (const x of String(v).replace(/^!/, '').split('|')) set.add(x);
      vals.set(k, set);
    }
  };
  for (const [w] of mp) walk(w);
  return vals;
}

const BOOL = new Set(['true', 'false']);
const list = (set) => [...set].sort().join('|');

// ---------------------------------------------------------------- проверка одного состояния

/** → { status: 'ok' | 'warn' | 'bad', notes: [] } */
function checkBlock(b, props) {
  const notes = [];
  let bad = false;
  let warn = false;
  const given = Object.entries(props);

  if (b.v) {
    const keys = b.v.map(([k]) => parseKey(k));
    const vals = new Map();
    for (const kv of keys)
      for (const [k, v] of kv) {
        const set = vals.get(k) ?? new Set();
        set.add(v);
        vals.set(k, set);
      }
    for (const [k, v] of given) {
      if (!vals.has(k)) {
        // waterlogged, natural… — у блока есть, на модель не влияют: пометка, не предупреждение
        notes.push(`${k} не влияет на модель (нет в blockstate) — значение не проверить`);
      } else if (!vals.get(k).has(v)) {
        notes.push(`${k}=${v} нет; бывает ${list(vals.get(k))}`);
        bad = true;
      }
    }
    if (bad) return { status: 'bad', notes };
    // Вариант подходит, если все его свойства заданы и равны; свойства вне ключа игра не смотрит
    const i = keys.findIndex((kv) => kv.every(([k, v]) => props[k] === v));
    if (i >= 0) {
      notes.unshift(`вариант «${b.v[i][0] || '(без свойств)'}»`);
      return { status: 'ok', notes };
    }
    const loose = keys.filter((kv) => kv.every(([k, v]) => !(k in props) || props[k] === v));
    if (loose.length) {
      const miss = new Map();
      for (const kv of loose)
        for (const [k, v] of kv)
          if (!(k in props)) {
            const set = miss.get(k) ?? new Set();
            set.add(v);
            miss.set(k, set);
          }
      notes.unshift(
        `не заданы ${[...miss].map(([k, s]) => `${k} (${list(s)})`).join(', ')} — подходит вариантов: ${loose.length}`,
      );
      return { status: 'warn', notes };
    }
    // Каждое значение по отдельности бывает, а такого сочетания нет
    const near = b.v
      .map(([k], j) => [k, keys[j].filter(([kk, vv]) => props[kk] === vv).length])
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([k]) => `«${k}»`);
    notes.unshift(`такого сочетания нет; ближе всего: ${near.join(', ')}`);
    return { status: 'bad', notes };
  }

  // multipart: каждое свойство может браться из своей записи (стекло-панель: north из одной, east из другой)
  const mp = b.mp ?? [];
  const vals = whenValues(mp);
  for (const [k, v] of given) {
    const set = vals.get(k);
    if (!set) {
      notes.push(`${k} не влияет на модель (нет в multipart) — значение не проверить`);
    } else if (!set.has(v)) {
      // Булево свойство, где упомянуто только true: false — законное «части нет»; иначе значение не известно модели
      if ([...set].every((x) => BOOL.has(x))) {
        if (!BOOL.has(v)) {
          notes.push(`${k}=${v} — свойство булево (true|false)`);
          bad = true;
        }
      } else {
        notes.push(`${k}=${v} не упомянуто в multipart (упомянуты ${list(set)}) — части модели для него нет`);
        warn = true;
      }
    }
  }
  if (bad) return { status: 'bad', notes };
  const p = new Map(given);
  const parts = mp.filter(([w]) => whenMatches(w, p)).length;
  const unset = [...vals.keys()].filter((k) => !(k in props));
  notes.unshift(`частей модели: ${parts} из ${mp.length}`);
  if (!parts) {
    notes.push('ни одна часть не подходит — блок будет невидим');
    warn = true;
  }
  if (unset.length) notes.push(`не заданы ${unset.join(', ')} — части с ними не включены`);
  return { status: warn ? 'warn' : 'ok', notes };
}

// ---------------------------------------------------------------- инструмент

const MARK = { ok: '✓', warn: '⚠', bad: '✗', none: '?' };

async function blockstateCheck(a) {
  const input = typeof a.states === 'string' ? a.states.split(/\s*;\s*|\n/).filter(Boolean) : a.states;
  if (!Array.isArray(input) || !input.length) throw new Error('states — список состояний { id, properties? }.');
  const seen = new Map();
  for (const s of input) {
    const st = parseState(s);
    if (!st.id.includes(':')) st.id = `minecraft:${st.id}`;
    const key = stateText(st.id, st.properties);
    if (!seen.has(key)) seen.set(key, st);
  }
  const files = new Map();
  for (const ns of new Set([...seen.values()].map((s) => s.id.split(':')[0]))) files.set(ns, await blockFile(ns));

  const rows = [];
  for (const [key, st] of seen) {
    const [ns, p] = st.id.split(':', 2);
    const f = files.get(ns);
    if (!f.file) {
      rows.push({ status: 'none', text: `${key} — нет данных по моду ${ns} (${f.from})` });
      continue;
    }
    const b = f.file.b[p];
    if (!b) {
      rows.push({ status: 'bad', text: `${key} — блока нет в block-models ${ns}` });
      continue;
    }
    const r = checkBlock(b, st.properties);
    rows.push({ status: r.status, text: `${key} — ${r.notes.join('; ')}` });
  }

  const count = { ok: 0, warn: 0, bad: 0, none: 0 };
  for (const r of rows) count[r.status]++;
  const all = a.all ?? rows.length <= BRIEF;
  const shown = all ? rows : rows.filter((r) => r.status !== 'ok');
  const src = [...files].map(([ns, f]) => `${ns}: ${f.file ? f.from : 'нет данных'}`).join('; ');
  return [
    `Состояний ${rows.length}: ✓ ${count.ok} · ⚠ ${count.warn} · ✗ ${count.bad}${count.none ? ` · ? ${count.none} (нет данных)` : ''}`,
    `Данные: ${src}`,
    ...(all || !count.ok ? [] : [`(показаны только проблемные; все — all=true)`]),
    ...shown.map((r) => `${MARK[r.status]} ${r.text}`),
  ].join('\n');
}

export const TOOLS = [
  {
    name: 'blockstate_check',
    description:
      'Check block states against the site block models (block-models/<ns>.json: blockstate variants and multipart): block exists, each property/value is known, the variant for the combination exists (multipart — each property may come from its own part, counts matched parts). Local public/block-models of the main checkout, else the live site. For code that builds block states itself (building generator, schematics).',
    inputSchema: {
      type: 'object',
      properties: {
        states: {
          type: 'array',
          description:
            'states: { id, properties? } or a string «ns:path[key=value,…]»; id without namespace = minecraft',
          items: {
            anyOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: { id: str('block id'), properties: { type: 'object', description: 'property → value' } },
                required: ['id'],
              },
            ],
          },
        },
        all: { type: 'boolean', description: `list ok states too (default: only when ≤ ${BRIEF} states)` },
      },
      required: ['states'],
    },
    handler: blockstateCheck,
  },
];
