/**
 * Инструменты MCP сборки: описание (имя, схема входа) и обработчик. Не зависят от транспорта — тот же список
 * подключается к stdio (server.mjs), а на сервере сборки — к HTTP (docs/plans/pack-cli.md, этап 4).
 *
 * Ответ — короткий текст: строки вместо JSON, списки — с лимитом и «дальше: offset=…», без выдачи целых файлов.
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  PUBLIC,
  directMembers,
  flattenTag,
  getTag,
  isActive,
  items,
  meals,
  modLabel,
  mods,
  readJson,
  recipeStatus,
  recipes,
  reference,
  searchItems,
  tags,
  tagsOf,
} from './data.mjs';
import { FirestoreError, configDocs, guideDoc, guideDocs, writeGuide } from './firestore.mjs';
import { clip, dateOf, nameOf, named, norm, num, page, paging, short, str, words } from './fmt.mjs';
import { javap, jarList, jarToc, pathMatcher, readEntry, resolveJar } from './jars.mjs';
import { TOOLS as blocksTools } from './tools/blocks.mjs';
import { TOOLS as booksTools } from './tools/books.mjs';
import { TOOLS as kubejsTools } from './tools/kubejs.mjs';
import { TOOLS as mapTools } from './tools/map.mjs';
import { TOOLS as packTools } from './tools/pack.mjs';
import { TOOLS as siteTools } from './tools/site.mjs';

const NICK = 'Claude';

// ---------------------------------------------------------------- предметы

function itemLine(it) {
  const en = it.r && it.r !== it.e ? ` / ${it.e}` : '';
  return `${it.i} — ${it.r ?? it.e}${en} [${it.kjs ? 'KubeJS сборки' : modLabel(it.i)}]`;
}

function itemsSearch(a) {
  let list = searchItems(a.query ?? '');
  if (a.mod) list = list.filter((it) => it.i.split(':')[0] === a.mod);
  return page(list, a, (it) => [itemLine(it)]);
}

function itemGet(a) {
  const id = String(a.id ?? '').trim();
  const it = items().byId.get(id);
  const out = [];
  if (it) out.push(itemLine(it));
  else out.push(`${id} — в библиотеке предметов нет (это может быть блок без предмета, жидкость или опечатка).`);
  const ns = id.split(':')[0];
  const m = mods().get(ns);
  if (m) out.push(`мод: ${m.name} ${m.version}, ${m.jar}`);
  const kj = readJson('kubejs.json', null)?.items?.find((x) => x.id === id);
  if (kj) out.push(`регистрирует KubeJS: ${kj.layer}/${kj.file}:${kj.line}`);
  const fluid = tags().fluids.get(id);
  if (fluid) out.push(`жидкость: ${fluid.r ?? fluid.e}`);
  const t = tagsOf(fluid ? 'fluid' : 'item', id);
  out.push(`теги (${t.length}): ${t.length ? t.map((x) => `#${x}`).join(', ') : '—'}`);
  const bt = fluid ? [] : tagsOf('block', id);
  if (bt.length) out.push(`теги блока (${bt.length}): ${bt.map((x) => `#${x}`).join(', ')}`);
  const cat = recipes();
  const made = cat.byOutput.get(id) ?? [];
  const used = cat.byInput.get(id) ?? [];
  out.push(
    `рецепты: получение ${made.filter(isActive).length} работают из ${made.length} (recipes_for); ` +
      `использование напрямую ${used.filter(isActive).length} из ${used.length}, ещё через теги — recipes_using`,
  );
  const ref = reference();
  if (ref) {
    const food = ref.foods.find((f) => f.items?.includes(id));
    if (food) out.push(`еда: ${JSON.stringify(stripSrc(food))}`);
    const fuel = ref.fuels.find((f) => f.items?.includes(id));
    if (fuel) out.push(`топливо: ${JSON.stringify(stripSrc(fuel))}`);
    if (ref.smelt?.[id]) out.push(`плавка: ${JSON.stringify(ref.smelt[id])}`);
    if (ref.chains?.[id]) out.push(`цепочка обогащения: reference_get section=chains id=${id}`);
  }
  const bot = readJson('botany.json', null)?.entries?.filter((e) => e.i === id || e.product === id || e.seed === id);
  if (bot?.length) out.push(`ботаника: ${bot.map((e) => e.i).join(', ')} (reference_get section=botany)`);
  return out.join('\n');
}

const stripSrc = (o) => {
  const { source, ...rest } = o;
  return source?.startsWith('kubejs/') ? { ...rest, source } : rest;
};

// ---------------------------------------------------------------- рецепты

function ruleRef(n) {
  const r = recipes().rules[n];
  return `${r.kind} ${r.layer}/${r.file.replace(/^[^/]+\//, '')}:${r.line}: ${short(r.code, 200)}`;
}

function recipeSource(r) {
  if (r.k) return `скрипт KubeJS ${r.s}:${r.k.line}`;
  if (r.s.startsWith('kubejs/')) return `датапак ${r.s}`;
  return r.s;
}

function recipeLines(r, via) {
  const outs = r.effOutputs.map(named).join(', ') || '—';
  const ins = r.effInputs.map(named).join(', ') || '—';
  return [
    `• ${r.i} [${r.t || 'заглушка'}] — ${recipeStatus(r)}; ${recipeSource(r)}${via ? `; ${via}` : ''}`,
    `  выход: ${short(outs, 600)}`,
    `  вход: ${short(ins, 600)}`,
  ];
}

const byActive = (a, b) => Number(isActive(b)) - Number(isActive(a));

function recipeFilterArgs(list, a) {
  let l = list;
  if (a.status === 'active') l = l.filter(isActive);
  else if (a.status === 'removed') l = l.filter((r) => !isActive(r));
  if (a.type) l = l.filter((r) => r.t === a.type || r.t.endsWith(`:${a.type}`));
  return l;
}

function recipesFor(a) {
  const id = String(a.output ?? '').trim();
  const list = recipeFilterArgs([...(recipes().byOutput.get(id) ?? [])], a).sort(byActive);
  const head = `Рецепты, где на выходе ${named(id)} (с учётом KubeJS: удаления, replaceOutput, kubejs/data):`;
  return `${head}\n${page(list, a, (r) => recipeLines(r))}`;
}

function recipesUsing(a) {
  const id = String(a.input ?? '').trim();
  const cat = recipes();
  const seen = new Map();
  for (const r of cat.byInput.get(id) ?? []) seen.set(r.i, { r, via: '' });
  if (!id.startsWith('#') && a.via_tags !== false) {
    const kind = tags().fluids.has(id) ? 'fluid' : 'item';
    for (const t of tagsOf(kind, id))
      for (const r of cat.byInput.get(`#${t}`) ?? []) if (!seen.has(r.i)) seen.set(r.i, { r, via: `через #${t}` });
  }
  const list = [...seen.values()].filter((x) => recipeFilterArgs([x.r], a).length).sort((x, y) => byActive(x.r, y.r));
  const head = `Рецепты, где на входе ${named(id)} (напрямую и через теги, с учётом KubeJS):`;
  return `${head}\n${page(list, a, ({ r, via }) => recipeLines(r, via))}`;
}

function recipeGet(a) {
  const r = recipes().byId.get(String(a.id ?? '').trim());
  if (!r) return `Рецепта ${a.id} нет. Найти: recipes_for / recipes_using.`;
  const out = [
    `${r.i} [${r.t || 'заглушка'}] — ${recipeStatus(r)}`,
    `источник: ${recipeSource(r)}${r.origin === 'mod' ? '' : r.origin === 'kubejs-data' ? ' (заменяет рецепт мода с тем же id, если был)' : ''}`,
  ];
  if (r.k) out.push(`код KubeJS: ${short(r.k.code, 400)}`);
  for (const n of r.kjsRemoved) out.push(`удаляет: ${ruleRef(n)}`);
  for (const n of r.kjsMaybe) out.push(`может удалять (фильтр не разобрать): ${ruleRef(n)}`);
  for (const n of r.kjsChanged) out.push(`меняет: ${ruleRef(n)}`);
  out.push(`выход: ${r.outputs.map(named).join(', ') || '—'}`);
  out.push(`вход: ${r.inputs.map(named).join(', ') || '—'}`);
  if (r.effInputs.join() !== r.inputs.join() || r.effOutputs.join() !== r.outputs.join())
    out.push(`после замен KubeJS — выход: ${r.effOutputs.join(', ')}; вход: ${r.effInputs.join(', ')}`);
  out.push(`JSON (${r.s.startsWith('kubejs/') ? r.s : `data/${r.i.replace(':', '/recipe/')}.json`}):`);
  out.push(short(JSON.stringify(r.j, null, 1), 12000));
  return out.join('\n');
}

// ---------------------------------------------------------------- теги

const KINDS = ['item', 'fluid', 'block', 'entity_type'];

function tagMembers(a) {
  const id = String(a.tag ?? '')
    .trim()
    .replace(/^#/, '');
  const kind = KINDS.includes(a.kind) ? a.kind : 'item';
  const tag = getTag(kind, id);
  if (!tag) {
    const q = norm(id);
    const similar = [...tags().byKey.values()].filter((t) => t.k === kind && norm(t.i).includes(q)).slice(0, 20);
    return `Тега #${id} (${kind}) нет.${similar.length ? ` Похожие: ${similar.map((t) => `#${t.i}`).join(', ')}` : ''}`;
  }
  const out = [`#${id} (${kind})`];
  const src = tag.s.map(
    (s) => `${s.s}${s.r ? ' (replace)' : ''}: +${s.v.length}${s.x?.length ? ` −${s.x.length}` : ''}`,
  );
  out.push(`источники: ${src.join('; ') || '—'}`);
  for (const o of tag.ops)
    out.push(
      `KubeJS ${o.op} ${o.layer}/${o.file.replace(/^[^/]+\//, '')}:${o.line}: ${short(o.code, 200)}${o.re?.length ? ` (шаблоны ${o.re.join(', ')} не раскрыты)` : ''}`,
    );
  const direct = directMembers(tag);
  const nested = direct.filter((m) => m.startsWith('#'));
  if (nested.length) out.push(`вложенные теги: ${nested.join(', ')}`);
  const list = a.expand === false ? direct : flattenTag(tags(), kind, direct);
  out.push(a.expand === false ? 'Прямой состав:' : 'Состав (вложенные теги раскрыты):');
  return `${out.join('\n')}\n${page(list, a, (m) => [`  ${named(m)}`], 100)}`;
}

function tagsOfTool(a) {
  const id = String(a.id ?? '').trim();
  const kind = KINDS.includes(a.kind) ? a.kind : tags().fluids.has(id) ? 'fluid' : 'item';
  const list = tagsOf(kind, id);
  return `Теги (${kind}), где состоит ${named(id)} — с вложенными и KubeJS:\n${page(list, a, (t) => [`  #${t}`], 100)}`;
}

// ---------------------------------------------------------------- справочник

/** Разделы справочника: записи с id */
const SECTIONS = {
  ores: () => reference()?.veins ?? [],
  smelt: () => Object.entries(reference()?.smelt ?? {}).map(([item, v]) => ({ id: item, ...v })),
  chains: () => Object.entries(reference()?.chains ?? {}).map(([ore, steps]) => ({ id: ore, steps })),
  metals: () => reference()?.metals ?? [],
  fuels: () => reference()?.fuels ?? [],
  liquid: () => (reference()?.liquid?.families ?? []).map((f) => ({ id: f.tag, ...f })),
  foods: () => reference()?.foods ?? [],
  botany: () => (readJson('botany.json', null)?.entries ?? []).map((e) => ({ id: e.i, ...e })),
  greenhouse: () => (readJson('botany.json', null)?.greenhouse ?? []).map((e) => ({ id: e.i, ...e })),
  meals: () => {
    const m = meals();
    return [
      ...(m?.families ?? []).map((x) => ({ kind: 'family', ...x })),
      ...(m?.computed ?? []).map((x) => ({ kind: 'computed', ...x })),
      ...(m?.dynamic ?? []).map((x) => ({ kind: 'dynamic', ...x })),
    ];
  },
  skillet: () => {
    const s = meals()?.skillet;
    if (!s) return [];
    const { entries, cooked, ...head } = s;
    return [
      { ...head, id: 'settings', meal: head.id },
      ...entries.map((e, n) => ({ id: `entry/${n}`, ...e })),
      ...cooked.map((c, n) => ({ id: `cooked/${n}`, ...c })),
    ];
  },
  multiblocks: () => readJson('multiblocks.json', null)?.list ?? [],
  power: () =>
    Object.entries(readJson('power.json', null) ?? {}).flatMap(([mod, v]) =>
      Object.entries(v).map(([k, x]) => ({ id: `${mod}.${k}`, value: x })),
    ),
};

const SECTION_HELP = {
  ores: 'жилы руд (reference.json veins)',
  smelt: 'плавка руд/порошков: id предмета → жидкость, мБ, °C (с kubejs/data и скриптами)',
  chains: 'цепочки обогащения руды (с kubejs/data и скриптами)',
  metals: 'металлы: жидкость, плавление, теплоёмкость (kubejs/data заменяет мод; modMelt — значение мода)',
  fuels: 'твёрдое топливо TFC',
  liquid: 'жидкое топливо: семейства, двигатели, горелки',
  foods: 'еда TFC: голод, насыщение, вода, порча, нутриенты (kubejs/data заменяет мод)',
  botany: 'растения/деревья/культуры: климат, жизненный цикл',
  greenhouse: 'теплица Firmalife',
  meals: 'сборные блюда',
  skillet: 'сковорода Cuisine Delight (kubejs/data заменяет файлы мода)',
  multiblocks: 'мультиблоки IE',
  power: 'электричество: ee.*, ie.*, create.*, att.* (настройки — config_get)',
};

function referenceGet(a) {
  const section = String(a.section ?? '');
  if (!SECTIONS[section])
    return `Разделы: ${Object.entries(SECTION_HELP)
      .map(([k, v]) => `${k} — ${v}`)
      .join('; ')}`;
  const all = SECTIONS[section]();
  if (a.id) {
    const rec = all.find((r) => r.id === a.id);
    return rec ? clip(JSON.stringify(rec, null, 1)) : `В ${section} нет записи ${a.id}.`;
  }
  const w = words(a.filter);
  const list = w.length
    ? all.filter((r) => {
        const json = JSON.stringify(r);
        const names = (json.match(/[a-z0-9_.-]+:[a-z0-9_./-]+/g) ?? []).map(nameOf).join(' ');
        const hay = norm(`${json} ${names}`);
        return w.every((x) => hay.includes(x));
      })
    : all;
  if (list.length === 1) return clip(JSON.stringify(list[0], null, 1));
  return clip(
    `${section}: ${SECTION_HELP[section]}. Полная запись — с id.\n${page(list, a, (r) => [
      `• ${r.id ?? '?'} — ${short(JSON.stringify(r), 500)}`,
    ])}`,
  );
}

// ---------------------------------------------------------------- конфиги

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
    const q = String(a.file).trim();
    const hit =
      files.get(q) ??
      (() => {
        const l = [...files.keys()].filter((p) => norm(p).includes(norm(q)));
        if (l.length === 1) return files.get(l[0]);
        throw new Error(
          l.length
            ? `«${q}» подходит к нескольким файлам: ${l.join(', ')}`
            : `файла «${q}» нет; список — config_get без параметров`,
        );
      })();
    const scopes = Object.entries(hit.layers).map(([s, l]) => `${s} (${l.source ?? '?'}, ${dateOf(l.at)})`);
    const head = `${hit.path}: импортировано — ${scopes.join(', ') || 'нет'}; значений по умолчанию из кода — ${hit.defaults.size}. Приоритет: world > server > config > default.`;
    return clip(`${head}\n${page(configKeyLines(hit, keyWords), a, (l) => [l], 60)}`);
  }
  if (keyWords.length) {
    const lines = [...files.values()].flatMap((f) => configKeyLines(f, keyWords).map((l) => `${f.path}: ${l}`));
    return clip(`Ключи по «${a.key}» во всех файлах:\n${page(lines, a, (l) => [l], 40)}`);
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

// ---------------------------------------------------------------- гайды

const CHECKED = ['game', 'server', 'code', 'none'];
const HEAD_FIELDS = ['section', 'title', 'summary', 'icon', 'group', 'order', 'checked', 'hidden'];

function guideMarkdown(g) {
  const head = stringifyYaml(Object.fromEntries(HEAD_FIELDS.map((k) => [k, g[k] ?? null])), { lineWidth: 0 });
  return `---\n${head}---\n${g.body ?? ''}`;
}

async function guidesList(a) {
  let list = await guideDocs();
  if (a.section) list = list.filter((g) => g.section === a.section);
  const w = words(a.query);
  if (w.length)
    list = list.filter((g) => w.every((x) => norm(`${g.id} ${g.title} ${g.summary} ${g.group}`).includes(x)));
  list.sort((x, y) => `${x.section}/${x.group}`.localeCompare(`${y.section}/${y.group}`) || x.order - y.order);
  return page(
    list,
    a,
    (g) => [
      `${g.id} — ${g.title} [${g.section}${g.group ? ` / ${g.group}` : ''}, ${g.order}]${g.hidden ? ' СНЯТ' : ''}; проверено: ${g.checked}; правил ${g.updatedBy} ${dateOf(g.updatedAt)}`,
    ],
    50,
  );
}

async function guideGet(a) {
  const g = await guideDoc(String(a.id ?? ''));
  if (!g) return `Гайда ${a.id} нет. Список — guides_list; новый — guide_put с baseRevision="new".`;
  const md = guideMarkdown(g);
  const lines = md.split('\n');
  const offset = Math.max(0, Number(a.offset ?? 0) | 0);
  const limit = Number(a.limit ?? 0) | 0;
  const whole = !offset && !limit && md.length <= 60000;
  const part = whole ? lines : lines.slice(offset, offset + (limit || 400));
  const head = [
    `revision: ${g.updateTime}   ← передайте в guide_put как baseRevision`,
    `правил ${g.updatedBy} ${dateOf(g.updatedAt)}; строк ${lines.length}${whole ? '' : `; показаны ${offset + 1}–${offset + part.length}${offset + part.length < lines.length ? `, дальше: offset=${offset + part.length}` : ''}`}`,
    '',
  ];
  return [...head, ...part].join('\n');
}

async function guideSearch(a) {
  const w = words(a.query);
  if (!w.length) return 'Пустой запрос.';
  let list = await guideDocs();
  if (a.section) list = list.filter((g) => g.section === a.section);
  const hits = list.filter((g) => {
    const hay = norm(`${g.id} ${g.title} ${g.summary} ${g.body}`);
    return w.every((x) => hay.includes(x));
  });
  return page(hits, a, (g) => {
    const lines = (g.body ?? '').split('\n');
    const found = [];
    for (let i = 0; i < lines.length && found.length < 3; i++)
      if (w.some((x) => norm(lines[i]).includes(x))) found.push(`    ${i + 1}: ${short(lines[i].trim(), 200)}`);
    return [`${g.id} — ${g.title} [${g.section}]`, ...found];
  });
}

async function guidePut(a) {
  const id = String(a.id ?? '');
  const base = String(a.baseRevision ?? '');
  const md = String(a.markdown ?? '');
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('id — латиница, цифры и дефис (это адрес статьи)');
  if (!base) throw new Error('нужен baseRevision: revision из guide_get или "new" для новой статьи');
  const cur = await guideDoc(id);
  if (base === 'new' && cur)
    return `Отказ: гайд ${id} уже есть (ревизия ${cur.updateTime}, правил ${cur.updatedBy}). Прочитайте guide_get.`;
  if (base !== 'new' && !cur) return `Отказ: гайда ${id} нет. Для новой статьи baseRevision="new".`;
  if (cur && cur.updateTime !== base)
    return `Отказ: статья изменилась после чтения — ваша ревизия ${base}, сейчас ${cur.updateTime} (правил ${cur.updatedBy} ${dateOf(cur.updatedAt)}). Перечитайте guide_get и перенесите правки; ничего не записано.`;
  // Как readGuide в scripts/guides.mjs: YAML-заголовок между «---» и текст; без заголовка — меняется только текст
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(md);
  const fm = m ? (parseYaml(m[1]) ?? {}) : {};
  const body = (m ? m[2] : md).replace(/^\n+/, '');
  const pick = (k, def) => (k in fm ? fm[k] : (cur?.[k] ?? def));
  const g = {
    section: String(pick('section', '')),
    title: String(pick('title', '')),
    summary: String(pick('summary', '') ?? '').trim(),
    body,
    icon: pick('icon', null) || null,
    group: String(pick('group', '') ?? ''),
    order: Number(pick('order', 100)),
    checked: CHECKED.includes(pick('checked', 'none')) ? pick('checked', 'none') : 'none',
    hidden: Boolean(pick('hidden', false)),
  };
  const bad = [];
  if (!g.section || g.section.length > 40) bad.push('section — 1…40 символов');
  if (!g.title || g.title.length > 200) bad.push('title — 1…200 символов');
  if (g.summary.length > 1000) bad.push('summary — до 1000 символов');
  if (g.body.length > 200000) bad.push('текст — до 200 000 символов');
  if (g.group.length > 80) bad.push('group — до 80 символов');
  if (g.icon !== null && String(g.icon).length > 200) bad.push('icon — до 200 символов');
  if (!Number.isFinite(g.order)) bad.push('order — число');
  if (bad.length) throw new Error(bad.join('; '));
  const now = Date.now();
  try {
    const rev = await writeGuide(id, { ...g, updatedBy: NICK, createdAt: cur?.createdAt ?? now, updatedAt: now }, base);
    return `Сохранено: ${id} — ${g.title}. Новая ревизия ${rev}; версия добавлена в историю (подпись ${NICK}).`;
  } catch (e) {
    if (
      e instanceof FirestoreError &&
      (e.status === 400 || e.status === 409 || e.status === 404) &&
      /FAILED_PRECONDITION|ALREADY_EXISTS|NOT_FOUND/.test(e.body)
    )
      return `Отказ: статью изменили одновременно с записью (${e.status}). Перечитайте guide_get; ничего не записано.`;
    throw e;
  }
}

// ---------------------------------------------------------------- jar

function jarFind(a) {
  const match = pathMatcher(a.pattern);
  const jars = a.jar ? [resolveJar(a.jar)] : jarList();
  const hits = [];
  for (const jar of jars) for (const e of jarToc(jar)) if (match(e.name)) hits.push(`${jar}: ${e.name} (${e.size} Б)`);
  return page(hits, a, (l) => [l], 50);
}

function jarRead(a) {
  const jar = resolveJar(a.jar);
  const r = readEntry(jar, String(a.path ?? ''));
  if (!r) return `В ${jar} нет ${a.path}. Найти: jar_find.`;
  if (r.entry.name.endsWith('.class')) return `${a.path} — класс (${r.data.length} Б): используйте jar_javap.`;
  const text = r.data.toString('utf8');
  if (text.includes('\u0000') || /\.(png|ogg|nbt|jar|zip|dat)$/i.test(r.entry.name))
    return `${a.path} — двоичный файл, ${r.data.length} Б.`;
  let lines = text.split('\n').map((l, i) => [i + 1, l]);
  if (a.grep) {
    const re = new RegExp(a.grep, 'i');
    lines = lines.filter(([, l]) => re.test(l));
  }
  const offset = Math.max(0, Number(a.offset ?? 0) | 0);
  const limit = Math.min(2000, Math.max(1, Number(a.limit ?? 300) | 0));
  const part = lines.slice(offset, offset + limit);
  const end = offset + part.length;
  const head = `${jar}: ${r.entry.name} — ${lines.length} строк${a.grep ? ` по «${a.grep}»` : ''}; показаны ${offset + 1}–${end}${end < lines.length ? `; дальше: offset=${end}` : ''}`;
  return clip([head, ...part.map(([n, l]) => `${n}: ${l}`)].join('\n'));
}

async function jarJavap(a) {
  const jar = resolveJar(a.jar);
  const text = await javap(jar, String(a.class ?? ''));
  let lines = text.split('\n');
  if (a.method) {
    // Блоки методов javap: заголовок с отступом 2, тело до пустой строки
    const blocks = [];
    let cur = null;
    for (const l of lines) {
      if (/^ {2}\S/.test(l)) {
        cur = [l];
        blocks.push(cur);
      } else if (cur) cur.push(l);
    }
    const want = blocks.filter((b) => b[0].includes(`${a.method}(`) || b[0].includes(` ${a.method};`));
    if (!want.length)
      return `В ${a.class} нет метода/поля ${a.method}. Заголовки:\n${blocks.map((b) => b[0]).join('\n')}`;
    lines = want.flat();
  }
  const offset = Math.max(0, Number(a.offset ?? 0) | 0);
  const limit = Math.min(3000, Math.max(1, Number(a.limit ?? 400) | 0));
  const part = lines.slice(offset, offset + limit);
  const end = offset + part.length;
  return clip(
    [
      `javap -c -p ${a.class} (${jar}) — ${lines.length} строк; показаны ${offset + 1}–${end}${end < lines.length ? `; дальше: offset=${end}` : ''}`,
      ...part,
    ].join('\n'),
  );
}

// ---------------------------------------------------------------- список

const recipeOpts = {
  status: {
    type: 'string',
    enum: ['all', 'active', 'removed'],
    description: 'all (по умолчанию; работающие сверху), active — работают в игре, removed — удалены',
  },
  type: str('тип рецепта, например tfc:anvil или create:mixing'),
  ...paging,
};

const CORE = [
  {
    name: 'items_search',
    description: 'Поиск предметов сборки по русскому/английскому названию или id. Возвращает id, названия и мод.',
    inputSchema: {
      type: 'object',
      properties: { query: str('слова названия или id'), mod: str('namespace мода, например tfc'), ...paging },
      required: ['query'],
    },
    handler: itemsSearch,
  },
  {
    name: 'item_get',
    description:
      'Предмет по id: названия, мод и jar, теги (с KubeJS), сколько рецептов получения/использования, еда/топливо/плавка/ботаника.',
    inputSchema: {
      type: 'object',
      properties: { id: str('id предмета, например tfc:metal/ingot/copper') },
      required: ['id'],
    },
    handler: itemGet,
  },
  {
    name: 'recipes_for',
    description:
      'Как получить предмет: рецепты с ним на выходе. Учитывает KubeJS (удаления, replaceOutput, рецепты скриптов) и kubejs/data; у каждого — статус в игре.',
    inputSchema: {
      type: 'object',
      properties: { output: str('id предмета/жидкости или тег «#c:…»'), ...recipeOpts },
      required: ['output'],
    },
    handler: recipesFor,
  },
  {
    name: 'recipes_using',
    description:
      'Где используется предмет: рецепты с ним на входе — напрямую, через теги, где он состоит, и после replaceInput KubeJS.',
    inputSchema: {
      type: 'object',
      properties: {
        input: str('id предмета/жидкости или тег «#…»'),
        via_tags: { type: 'boolean', description: 'искать и через теги (по умолчанию да)' },
        ...recipeOpts,
      },
      required: ['input'],
    },
    handler: recipesUsing,
  },
  {
    name: 'recipe_get',
    description:
      'Рецепт по id: статус, источник (мод / kubejs/data / скрипт), какие правила KubeJS его удаляют или меняют (файл:строка), входы/выходы и JSON.',
    inputSchema: { type: 'object', properties: { id: str('id рецепта ns:path') }, required: ['id'] },
    handler: recipeGet,
  },
  {
    name: 'tag_members',
    description:
      'Состав тега после слияния модов и KubeJS: источники, операции KubeJS (файл:строка), значения с названиями.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: str('тег, с # или без'),
        kind: { type: 'string', enum: KINDS, description: 'вид тега (по умолчанию item)' },
        expand: { type: 'boolean', description: 'раскрывать вложенные теги (по умолчанию да)' },
        ...paging,
      },
      required: ['tag'],
    },
    handler: tagMembers,
  },
  {
    name: 'tags_of',
    description: 'В каких тегах состоит предмет/жидкость/блок (с вложенными тегами и KubeJS).',
    inputSchema: {
      type: 'object',
      properties: { id: str('id'), kind: { type: 'string', enum: KINDS }, ...paging },
      required: ['id'],
    },
    handler: tagsOfTool,
  },
  {
    name: 'reference_get',
    description: `Справочник сборки (как на сайте, с поправками kubejs/data). Разделы: ${Object.entries(SECTION_HELP)
      .map(([k, v]) => `${k} — ${v}`)
      .join(
        '; ',
      )}. Без section — список разделов. filter — слова (по JSON записи и названиям предметов), id — одна запись целиком.`,
    inputSchema: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: Object.keys(SECTIONS) },
        filter: str('слова для отбора'),
        id: str('id записи — показать целиком'),
        ...paging,
      },
    },
    handler: referenceGet,
  },
  {
    name: 'config_get',
    description:
      'Настройки модов с учётом слоёв: сохранение мира > serverconfig/ сервера > config/ сборки > значение по умолчанию из кода мода. Без параметров — список файлов; file — ключи файла; key — поиск ключа (во всех файлах или в file). Только чтение.',
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
    name: 'guides_list',
    description: 'Гайды справочника сайта: id, заголовок, раздел/группа, проверено ли, кто правил.',
    inputSchema: {
      type: 'object',
      properties: { section: str('раздел, например power'), query: str('слова в id/заголовке/«коротко»'), ...paging },
    },
    handler: guidesList,
  },
  {
    name: 'guide_get',
    description:
      'Гайд целиком в формате файла npm run guides (YAML-заголовок + Markdown) и его revision для guide_put. Длинный — по строкам (offset/limit).',
    inputSchema: {
      type: 'object',
      properties: { id: str('id гайда'), offset: num('с какой строки'), limit: num('сколько строк') },
      required: ['id'],
    },
    handler: guideGet,
  },
  {
    name: 'guide_search',
    description: 'Поиск по тексту гайдов: какие статьи упоминают слова, со строками совпадений.',
    inputSchema: {
      type: 'object',
      properties: { query: str('слова'), section: str('раздел'), ...paging },
      required: ['query'],
    },
    handler: guideSearch,
  },
  {
    name: 'guide_put',
    description:
      'Сохранить гайд (запись в общую базу сайта, подпись Claude, версия — в историю). markdown — как из guide_get (YAML-заголовок + текст) или только текст (остальные поля не меняются). Отказ, если статья изменилась после чтения: baseRevision — revision из guide_get, для новой статьи "new".',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('id (латиница, цифры, дефис)'),
        markdown: str('содержимое'),
        baseRevision: str('revision из guide_get или "new"'),
      },
      required: ['id', 'markdown', 'baseRevision'],
    },
    handler: guidePut,
  },
  {
    name: 'jar_find',
    description:
      'Поиск файлов и классов в jar сборки (mods/). Шаблон: часть пути, имя класса через точки (net.dries007.tfc.config) или glob (data/tfc/**/*.json, *Config.class).',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: str('шаблон'),
        jar: str('искать в одном jar: имя файла, часть имени или id мода'),
        ...paging,
      },
      required: ['pattern'],
    },
    handler: jarFind,
  },
  {
    name: 'jar_read',
    description: 'Текстовый файл из jar (json, toml, lang, mcmeta, js…) по строкам; grep — только строки по регулярке.',
    inputSchema: {
      type: 'object',
      properties: {
        jar: str('jar: имя файла, часть имени или id мода'),
        path: str('путь внутри jar'),
        grep: str('регулярное выражение'),
        offset: num('с какой строки'),
        limit: num('сколько строк (300)'),
      },
      required: ['jar', 'path'],
    },
    handler: jarRead,
  },
  {
    name: 'jar_javap',
    description: 'Байткод класса из jar (javap -c -p -constants); method — только этот метод/поле.',
    inputSchema: {
      type: 'object',
      properties: {
        jar: str('jar: имя файла, часть имени или id мода'),
        class: str('класс через точки или путь .class'),
        method: str('имя метода или поля'),
        offset: num('с какой строки'),
        limit: num('сколько строк (400)'),
      },
      required: ['jar', 'class'],
    },
    handler: jarJavap,
  },
];

export const TOOLS = [...CORE, ...packTools, ...kubejsTools, ...booksTools, ...blocksTools, ...siteTools, ...mapTools];

// Любой ответ — не длиннее MAX: списки и так режутся страницами, это страховка от длинных строк
for (const t of TOOLS) {
  const run = t.handler;
  t.handler = async (a) => clip(String(await run(a)));
}

export const INSTRUCTIONS = `Данные сборки TFC RealWorld для сайта «TFC Планы» (данные: ${PUBLIC}). Используйте вместо grep по public/*.json и распаковки mods/*.jar: ответы уже учитывают KubeJS (удаления, замены, kubejs/data), теги со вложенными и KubeJS, слои конфигов. Факты из jar — jar_find/jar_read/jar_javap. Гайды: guide_get → правка → guide_put с revision.`;
