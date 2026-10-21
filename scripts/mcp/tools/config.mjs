/**
 * Инструменты MCP: настройки модов. config_get — чтение со слоями (мир > serverconfig/ > config/ сборки > код мода);
 * config_propose — предложить правку (Firestore configChanges), config_changes — список и отмена. Агент файлы хоста
 * не трогает: правку применяет хост — `tfc admin changes pull` правит TOML в папке игры и сервера, отмечает итог.
 * Документ: { note, author, createdAt, status: pending|applied|rejected|cancelled, edits: [{ path, layer, key, from,
 * to, mod }], appliedAt, appliedBy, results }. Сайту коллекция закрыта (правил на неё нет).
 */
import { mods, readJson } from '../data.mjs';
import { FirestoreError, configChangeDocs, configDocs, createDoc, patchDoc } from '../firestore.mjs';
import { clip, dateOf, norm, page, paging, short, str, words } from '../fmt.mjs';

const NICK = 'Claude';

const ORIGIN = {
  world: 'сохранение мира',
  server: 'serverconfig/ сервера',
  config: 'config/ сборки',
  default: 'по умолчанию в коде мода',
};

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

/** Значения по умолчанию: config-defaults.json (jar → «<modid>-<тип>.toml»), power.json (свои ключи файлов) */
function defaultFiles() {
  const files = new Map();
  const add = (file, key, d) => {
    if (!files.has(file)) files.set(file, new Map());
    if (!files.get(file).has(key)) files.get(file).set(key, d);
  };
  const byJar = new Map([...mods().values()].map((m) => [m.jar.replace(/\.jar$/, ''), m.id]));
  for (const c of readJson('config-defaults.json', []) ?? [])
    for (const k of c.keys)
      // Ключи-шаблоны («%s» в описании — имя собирается в коде) и без раздела («?») — не настоящие ключи файла
      if (!k.key.includes('?') && !/%s/.test(k.comment ?? ''))
        add(`${byJar.get(c.src) ?? c.src}-${c.type}.toml`, k.key, k);
  for (const v of Object.values(readJson('power.json', null) ?? {}))
    if (v?.file && Array.isArray(v.keys)) for (const k of v.keys) add(v.file, k.key, k);
  return files;
}

async function configCatalog() {
  const docs = await configDocs();
  const defaults = defaultFiles();
  const files = new Map();
  const get = (p) => {
    if (!files.has(p)) files.set(p, { path: p, layers: {}, mod: '', defaults: new Map() });
    return files.get(p);
  };
  for (const d of docs) {
    const f = get(d.path);
    f.layers[d.scope] = { values: flatten(d.values), at: d.importedAt, source: d.source };
    f.mod ||= d.mod ?? '';
  }
  for (const [p, keys] of defaults) get(p).defaults = keys;
  return files;
}

function configKeyLines(f, keyWords) {
  const keys = new Set(f.defaults.keys());
  for (const l of Object.values(f.layers)) for (const k of l.values.keys()) keys.add(k);
  const out = [];
  for (const key of [...keys].sort()) {
    if (keyWords.length && !keyWords.every((w) => norm(key).includes(w))) continue;
    const def = f.defaults.get(key);
    const layers = ['world', 'server', 'config'].filter((s) => f.layers[s]?.values.has(key));
    const origin = layers[0] ?? (def ? 'default' : null);
    const value = origin === 'default' ? def.default : f.layers[origin].values.get(key);
    const also = layers.slice(1).map((s) => `${s}: ${JSON.stringify(f.layers[s].values.get(key))}`);
    if (def && origin !== 'default') also.push(`по умолчанию ${JSON.stringify(def.default)}`);
    const range =
      def && (def.min !== undefined || def.max !== undefined) ? ` [${def.min ?? ''}..${def.max ?? ''}]` : '';
    const comment = def?.comment ? ` — ${short(def.comment.replace(/\s+/g, ' '), 160)}` : '';
    out.push(
      `${key} = ${short(JSON.stringify(value), 300)}  (${ORIGIN[origin]}${also.length ? `; ${also.join('; ')}` : ''})${range}${comment}`,
    );
  }
  return out;
}

async function configGet(a) {
  const files = await configCatalog();
  const keyWords = words(a.key);
  if (a.file) {
    const hit = findFile(files, a.file);
    const scopes = Object.entries(hit.layers).map(([s, l]) => `${s} (${l.source ?? '?'}, ${dateOf(l.at)})`);
    const head = `${hit.path}: импортировано — ${scopes.join(', ') || 'нет'}; значений по умолчанию из кода — ${hit.defaults.size}. Приоритет: world > server > config > default.`;
    return clip(
      `${head}${await pendingText(hit.path, keyWords)}\n${page(configKeyLines(hit, keyWords), a, (l) => [l], 60)}`,
    );
  }
  if (keyWords.length) {
    const lines = [...files.values()].flatMap((f) => configKeyLines(f, keyWords).map((l) => `${f.path}: ${l}`));
    return clip(
      `Ключи по «${a.key}» во всех файлах:${await pendingText(null, keyWords)}\n${page(lines, a, (l) => [l], 40)}`,
    );
  }
  let list = [...files.values()].sort((x, y) => x.path.localeCompare(y.path));
  if (a.mod) list = list.filter((f) => norm(`${f.path} ${f.mod}`).includes(norm(a.mod)));
  return `Файлы конфигов (слои: world/server/config — импорт с сервера в Firestore; default — из кода мода):\n${page(
    list,
    a,
    (f) => [
      `${f.path} — ${[...Object.keys(f.layers), ...(f.defaults.size ? ['default'] : [])].join(', ')}; ключей: ${new Set([...f.defaults.keys(), ...Object.values(f.layers).flatMap((l) => [...l.values.keys()])]).size}`,
    ],
    100,
  )}`;
}

// ---------------------------------------------------------------- правки

const STATUS = {
  pending: 'ждёт хоста',
  applied: 'применено',
  rejected: 'отклонено хостом',
  cancelled: 'отменено',
};
/** Где правка ляжет у хоста (для текста; сами пути выбирает tfc) */
const WHERE = {
  config: 'config/ (и defaultconfigs/, если там есть)',
  server: 'serverconfig/ (папка сервера или мира)',
};

/** Файл каталога по имени: точное или единственное совпадение по части */
function findFile(files, q) {
  q = String(q ?? '').trim();
  if (!q) throw new Error('file — имя файла конфига, например tfc-server.toml');
  if (files.has(q)) return files.get(q);
  const l = [...files.keys()].filter((p) => norm(p).includes(norm(q)));
  if (l.length === 1) return files.get(l[0]);
  throw new Error(
    l.length
      ? `«${q}» подходит к нескольким файлам: ${l.join(', ')}`
      : `файла «${q}» нет; список — config_get без параметров`,
  );
}

const kind = (v) => (Array.isArray(v) ? 'array' : typeof v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Значение из ответа агента — к типу текущего (число строкой «5» → 5, «true» → true) */
function coerce(value, current) {
  if (typeof current === 'number' && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  if (typeof current === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  return value;
}

/** Одна правка: проверить по каталогу и описать (слой, текущее значение) */
function checkEdit(files, e) {
  const f = findFile(files, e?.file);
  if (!/\.toml$/i.test(f.path)) throw new Error(`${f.path}: пока правятся только TOML-конфиги`);
  const key = String(e?.key ?? '').trim();
  const def = f.defaults.get(key);
  const layers = ['world', 'server', 'config'].filter((s) => f.layers[s]?.values.has(key));
  if (!def && !layers.length) {
    const near = configKeyLines(f, words(key.split('.').pop())).slice(0, 5);
    throw new Error(
      `в ${f.path} нет ключа «${key}» (нужно полное имя с разделами)${near.length ? `; похожие:\n${near.join('\n')}` : ''}`,
    );
  }
  if (layers[0] === 'world')
    throw new Error(`${f.path}: ${key} задан в сохранении мира — это меняется командой в игре, не файлом`);
  const from = layers.length ? f.layers[layers[0]].values.get(key) : def.default;
  const to = coerce(e.value, from);
  if (to === undefined || to === null) throw new Error(`${key}: нужно value`);
  if (from !== undefined && from !== null && kind(to) !== kind(from))
    throw new Error(`${key}: сейчас ${kind(from)} (${JSON.stringify(from)}), а предложено ${kind(to)}`);
  if (typeof to === 'number') {
    if (!Number.isFinite(to)) throw new Error(`${key}: число`);
    if (def?.min !== undefined && to < def.min) throw new Error(`${key}: меньше допустимого ${def.min}`);
    if (def?.max !== undefined && to > def.max) throw new Error(`${key}: больше допустимого ${def.max}`);
  }
  if (same(to, from)) throw new Error(`${key} уже ${JSON.stringify(from)}`);
  return { path: f.path, layer: layers[0] ?? 'config', key, from: from ?? null, to, mod: f.mod || '' };
}

const editLine = (e) =>
  `${e.path}: ${e.key} ${JSON.stringify(e.from)} → ${JSON.stringify(e.to)} ${'·'} ${WHERE[e.layer] ?? e.layer}`;

function changeText(c, full = false) {
  const head = `${c.id} — ${STATUS[c.status] ?? c.status} · ${c.author ?? '?'}, ${dateOf(c.createdAt)}${c.appliedAt ? ` · ${c.appliedBy ?? '?'} ${dateOf(c.appliedAt)}` : ''}`;
  const lines = [head, `  ${c.note ?? ''}`, ...(c.edits ?? []).map((e) => `  • ${editLine(e)}`)];
  if (full || c.status !== 'pending')
    for (const r of c.results ?? []) lines.push(`  ${r.ok ? '✓' : '✗'} ${r.key}: ${r.msg ?? ''}`);
  return lines.join('\n');
}

async function configPropose(a) {
  const note = String(a.note ?? '').trim();
  if (note.length < 5) throw new Error('note — зачем правка, по-русски: её прочитает хост перед применением');
  if (note.length > 2000) throw new Error('note — до 2000 символов');
  const list = Array.isArray(a.edits) ? a.edits : [];
  if (!list.length || list.length > 50) throw new Error('edits — от 1 до 50 правок { file, key, value }');
  const files = await configCatalog();
  const edits = list.map((e) => checkEdit(files, e));
  const dup = edits.find((e, i) => edits.findIndex((x) => x.path === e.path && x.key === e.key) !== i);
  if (dup) throw new Error(`${dup.key} в правке дважды`);
  configChangeDocs.reset();
  const pending = (await configChangeDocs()).filter((c) => c.status === 'pending');
  for (const e of edits) {
    const busy = pending.find((c) => (c.edits ?? []).some((x) => x.path === e.path && x.key === e.key));
    if (busy)
      throw new Error(`${e.key} уже есть в неприменённой правке ${busy.id} — отмените её (config_changes cancel)`);
  }
  const doc = { note, author: NICK, createdAt: Date.now(), status: 'pending', edits };
  const { id } = await createDoc('configChanges', doc);
  configChangeDocs.reset();
  return `Предложено: ${id}\n${edits.map((e) => `• ${editLine(e)}`).join('\n')}\nПрименяет хост: tfc admin changes pull (покажет и спросит), потом перезапуск сервера и tfc publish — тогда config_get покажет новое значение.`;
}

async function configChanges(a) {
  if (a.cancel) {
    configChangeDocs.reset();
    const c = (await configChangeDocs()).find((x) => x.id === a.cancel);
    if (!c) return `Правки ${a.cancel} нет.`;
    if (c.status !== 'pending') return `Правка ${c.id} уже ${STATUS[c.status] ?? c.status} — отменять нечего.`;
    try {
      await patchDoc(
        'configChanges',
        c.id,
        { status: 'cancelled', appliedAt: Date.now(), appliedBy: NICK },
        c.updateTime,
      );
    } catch (e) {
      if (e instanceof FirestoreError && (e.status === 400 || e.status === 409 || e.status === 412))
        return `Правка ${c.id} изменилась после чтения (хост мог её применить) — посмотрите config_changes id=${c.id}.`;
      throw e;
    }
    configChangeDocs.reset();
    return `Отменено: ${c.id}.`;
  }
  const all = (await configChangeDocs()).sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0));
  if (a.id) {
    const c = all.find((x) => x.id === a.id);
    return c ? changeText(c, true) : `Правки ${a.id} нет.`;
  }
  const status = a.status ?? 'pending';
  const list = status === 'all' ? all : all.filter((c) => c.status === status);
  if (!list.length) return status === 'pending' ? 'Неприменённых правок нет.' : 'Правок нет.';
  return clip(
    `Правки конфигов (${status === 'all' ? 'все' : STATUS[status]}):\n${page(list, a, (c) => [changeText(c)], 10)}`,
  );
}

/** Неприменённые правки (файла p или всех) по словам ключа — строки для config_get; ошибка Firestore — пусто */
async function pendingText(p, keyWords) {
  let list;
  try {
    list = (await configChangeDocs())
      .filter((c) => c.status === 'pending')
      .flatMap((c) => (c.edits ?? []).map((e) => ({ ...e, id: c.id })))
      .filter((e) => (!p || e.path === p) && keyWords.every((w) => norm(e.key).includes(w)));
  } catch {
    return '';
  }
  return list.map((e) => `\n⏳ предложено ${e.id}, ждёт хоста: ${editLine(e)}`).join('');
}

export const TOOLS = [
  {
    name: 'config_get',
    description:
      'Настройки модов с учётом слоёв: сохранение мира > serverconfig/ сервера > config/ сборки > значение по умолчанию из кода мода. Без параметров — список файлов; file — ключи файла; key — поиск ключа (во всех файлах или в file). Неприменённые правки (config_propose) помечены ⏳.',
    inputSchema: {
      type: 'object',
      properties: {
        file: str('файл, например tfc-server.toml (можно часть имени)'),
        key: str('слова ключа, например sapling'),
        mod: str('отбор списка файлов по моду'),
        ...paging,
      },
    },
    handler: configGet,
  },
  {
    name: 'config_propose',
    description:
      'Предложить правку конфигов сборки (TOML): запись в Firestore configChanges, файлы хоста не меняются. Хост смотрит и применяет командой tfc admin changes pull (правит файлы в папке игры и сервера с копией, tfc undo — вернуть). Ключ — полное имя из config_get (blocks.crops.cropGrowthModifier); проверяются тип и диапазон из кода мода. Одна запись — одна осмысленная правка (несколько ключей вместе), note — зачем, по-русски. Это запись в общую базу.',
    inputSchema: {
      type: 'object',
      properties: {
        note: str('зачем правка: что изменится для игроков (это прочитает хост)'),
        edits: {
          type: 'array',
          description: 'правки: { file: "tfc-server.toml", key: "blocks.crops.cropGrowthModifier", value: 5 }',
          items: {
            type: 'object',
            properties: {
              file: str('файл конфига, как в config_get'),
              key: str('полный ключ с разделами'),
              value: { description: 'новое значение (число, true/false, строка, массив)' },
            },
            required: ['file', 'key', 'value'],
          },
        },
      },
      required: ['note', 'edits'],
    },
    handler: configPropose,
  },
  {
    name: 'config_changes',
    description:
      'Предложенные правки конфигов (config_propose) и что с ними сделал хост: status=pending (по умолчанию) | applied | rejected | cancelled | all; id — одна с итогом по ключам; cancel=<id> — отменить свою неприменённую.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'applied', 'rejected', 'cancelled', 'all'] },
        id: str('id правки'),
        cancel: str('id неприменённой правки — отменить'),
        ...paging,
      },
    },
    handler: configChanges,
  },
];
