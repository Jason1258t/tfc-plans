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
import { siteRecipes } from './site-datapacks.mjs';
import { FirestoreError, guideDoc, guideDocs, writeGuide } from './firestore.mjs';
import { clip, dateOf, nameOf, named, norm, num, page, paging, short, str, userRegex, words } from './fmt.mjs';
import { oneClass, classRecord } from './code-index.mjs';
import { javap, jarList, jarToc, nestedJars, pathMatcher, readEntry, resolveJar } from './jars.mjs';
import { TOOLS as addonsTools } from './tools/addons.mjs';
import { TOOLS as blocksTools } from './tools/blocks.mjs';
import { TOOLS as booksTools } from './tools/books.mjs';
import { TOOLS as candidatesTools } from './tools/candidates.mjs';
import { TOOLS as codeTools } from './tools/code.mjs';
import { TOOLS as configTools } from './tools/config.mjs';
import { TOOLS as disasmTools } from './tools/disasm.mjs';
import { TOOLS as kubejsTools } from './tools/kubejs.mjs';
import { TOOLS as logsTools } from './tools/logs.mjs';
import { TOOLS as mapTools } from './tools/map.mjs';
import { TOOLS as packTools } from './tools/pack.mjs';
import { TOOLS as resourcesTools } from './tools/resources.mjs';
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
  if (it?.h) out.push(`⚠ в игре не видно (на сайте скрыт): ${it.h}`);
  if (!it) out.push(`${id} — в библиотеке предметов нет (это может быть блок без предмета, жидкость или опечатка).`);
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

function ruleRef(n, cat = recipes()) {
  const r = cat.rules[n];
  return `${r.kind} ${r.layer}/${r.file.replace(/^[^/]+\//, '')}:${r.line}: ${short(r.code, 200)}`;
}

function recipeSource(r) {
  if (r.k) return `скрипт KubeJS ${r.s}:${r.k.line}`;
  if (r.s.startsWith('kubejs/')) return `датапак ${r.s}`;
  if (r.dp) return `${r.s}${r.replaces ? ` (заменяет рецепт ${r.replaces})` : ''}`;
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

/** Хвост ответа: датапаки сайта, которые не ставятся, и предупреждение, если Firestore недоступен */
function siteTail(site, found) {
  const out = [];
  if (found?.length)
    out.push(
      `Есть на сайте, но не ставится в мир (датапак без отметки «ставить»): ${found
        .map((r) => `${r.i} (${r.dp})`)
        .join('; ')}`,
    );
  if (site.note) out.push(site.note);
  return out.length ? `\n${out.join('\n')}` : '';
}

async function recipesFor(a) {
  const id = String(a.output ?? '').trim();
  const site = await siteRecipes();
  const list = recipeFilterArgs([...(site.cat.byOutput.get(id) ?? [])], a).sort(byActive);
  const head = `Рецепты, где на выходе ${named(id)} (с учётом KubeJS: удаления, replaceOutput, kubejs/data; и датапаков сайта):`;
  return `${head}\n${page(list, a, (r) => recipeLines(r))}${siteTail(site, site.other?.byOutput.get(id))}`;
}

async function recipesUsing(a) {
  const id = String(a.input ?? '').trim();
  const site = await siteRecipes();
  const seen = new Map();
  const other = new Map();
  const add = (map, l, via) => {
    for (const r of l ?? []) if (!map.has(r.i)) map.set(r.i, { r, via });
  };
  add(seen, site.cat.byInput.get(id), '');
  add(other, site.other?.byInput.get(id), '');
  if (!id.startsWith('#') && a.via_tags !== false) {
    const kind = tags().fluids.has(id) ? 'fluid' : 'item';
    for (const t of tagsOf(kind, id)) {
      add(seen, site.cat.byInput.get(`#${t}`), `через #${t}`);
      add(other, site.other?.byInput.get(`#${t}`), `через #${t}`);
    }
  }
  const list = [...seen.values()].filter((x) => recipeFilterArgs([x.r], a).length).sort((x, y) => byActive(x.r, y.r));
  const head = `Рецепты, где на входе ${named(id)} (напрямую и через теги, с учётом KubeJS и датапаков сайта):`;
  return `${head}\n${page(list, a, ({ r, via }) => recipeLines(r, via))}${siteTail(
    site,
    [...other.values()].map((x) => x.r),
  )}`;
}

async function recipeGet(a) {
  const id = String(a.id ?? '').trim();
  const site = await siteRecipes();
  const cat = site.cat;
  let r = cat.byId.get(id);
  let notInstalled = false;
  if (!r && site.other?.byId.get(id)) {
    r = site.other.byId.get(id);
    notInstalled = true;
  }
  if (!r) return `Рецепта ${a.id} нет. Найти: recipes_for / recipes_using.${siteTail(site)}`;
  const origin = {
    mod: '',
    'kubejs-data': ' (заменяет рецепт мода с тем же id, если был)',
    'site-datapack': '',
    'kubejs-script': '',
  }[r.origin];
  const out = [
    `${r.i} [${r.t || 'заглушка'}] — ${notInstalled ? 'не ставится в мир: датапак сайта без отметки «ставить»' : recipeStatus(r)}`,
    `источник: ${recipeSource(r)}${origin}`,
  ];
  if (r.dp) out.push(`датапак: datapack_get id=${r.dpId}, файл ${r.file}`);
  if (r.k) out.push(`код KubeJS: ${short(r.k.code, 400)}`);
  for (const n of r.kjsRemoved) out.push(`удаляет: ${ruleRef(n, cat)}`);
  for (const n of r.kjsMaybe) out.push(`может удалять (фильтр не разобрать): ${ruleRef(n, cat)}`);
  for (const n of r.kjsChanged) out.push(`меняет: ${ruleRef(n, cat)}`);
  out.push(`выход: ${r.outputs.map(named).join(', ') || '—'}`);
  out.push(`вход: ${r.inputs.map(named).join(', ') || '—'}`);
  if (r.effInputs.join() !== r.inputs.join() || r.effOutputs.join() !== r.outputs.join())
    out.push(`после замен KubeJS — выход: ${r.effOutputs.join(', ')}; вход: ${r.effInputs.join(', ')}`);
  const file = r.file ?? (r.s.startsWith('kubejs/') ? r.s : `data/${r.i.replace(':', '/recipe/')}.json`);
  out.push(`JSON (${file}):`);
  out.push(short(JSON.stringify(r.j, null, 1), 12000));
  if (site.note) out.push(site.note);
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
  const jars = a.jar ? [resolveJar(a.jar, true)] : [...jarList(), ...(a.nested ? nestedJars() : [])];
  const hits = [];
  for (const jar of jars) for (const e of jarToc(jar)) if (match(e.name)) hits.push(`${jar}: ${e.name} (${e.size} Б)`);
  return page(hits, a, (l) => [l], 50);
}

function jarRead(a) {
  const jar = resolveJar(a.jar, true);
  const r = readEntry(jar, String(a.path ?? ''));
  if (!r) return `В ${jar} нет ${a.path}. Найти: jar_find.`;
  if (r.entry.name.endsWith('.class')) return `${a.path} — класс (${r.data.length} Б): используйте jar_javap.`;
  const text = r.data.toString('utf8');
  if (text.includes('\u0000') || /\.(png|ogg|nbt|jar|zip|dat)$/i.test(r.entry.name))
    return `${a.path} — двоичный файл, ${r.data.length} Б.`;
  let lines = text.split('\n').map((l, i) => [i + 1, l]);
  if (a.grep) {
    const re = userRegex(a.grep);
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
  // jar не обязателен: класс находится по индексу кода (в т. ч. во вложенных jar и Minecraft)
  let jar = a.jar ? resolveJar(a.jar, true) : null;
  let cls = String(a.class ?? '');
  if (!jar) {
    const name = oneClass(cls);
    jar = classRecord(name).jar;
    cls = name;
  }
  const text = await javap(jar, cls);
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
    description: 'all (default; working ones first), active — work in game, removed — removed',
  },
  type: str('recipe type, e.g. tfc:anvil or create:mixing'),
  ...paging,
};

const CORE = [
  {
    name: 'items_search',
    description: 'Search pack items by Russian/English name or id. Returns id, names and mod.',
    inputSchema: {
      type: 'object',
      properties: { query: str('name words or id'), mod: str('mod namespace, e.g. tfc'), ...paging },
      required: ['query'],
    },
    handler: itemsSearch,
  },
  {
    name: 'item_get',
    description:
      'Item by id: names, mod and jar, tags (with KubeJS), number of recipes producing/using it, food/fuel/melting/botany.',
    inputSchema: {
      type: 'object',
      properties: { id: str('item id, e.g. tfc:metal/ingot/copper') },
      required: ['id'],
    },
    handler: itemGet,
  },
  {
    name: 'recipes_for',
    description:
      'How to obtain an item: recipes with it as output. Includes KubeJS (removals, replaceOutput, script recipes), kubejs/data and site datapacks installed into the world (non-installed ones on a separate line); each with in-game status and source.',
    inputSchema: {
      type: 'object',
      properties: { output: str('item/fluid id or tag «#c:…»'), ...recipeOpts },
      required: ['output'],
    },
    handler: recipesFor,
  },
  {
    name: 'recipes_using',
    description:
      'Where an item is used: recipes with it as input — directly, via tags it belongs to, and after KubeJS replaceInput; includes site datapacks.',
    inputSchema: {
      type: 'object',
      properties: {
        input: str('item/fluid id or tag «#…»'),
        via_tags: { type: 'boolean', description: 'also search via tags (default yes)' },
        ...recipeOpts,
      },
      required: ['input'],
    },
    handler: recipesUsing,
  },
  {
    name: 'recipe_get',
    description:
      'Recipe by id: status, source (mod / site datapack / kubejs/data / script), which KubeJS rules remove or change it (file:line), inputs/outputs and JSON.',
    inputSchema: { type: 'object', properties: { id: str('recipe id ns:path') }, required: ['id'] },
    handler: recipeGet,
  },
  {
    name: 'tag_members',
    description:
      'Tag members after merging mods and KubeJS: sources, KubeJS operations (file:line), values with names.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: str('tag, with or without #'),
        kind: { type: 'string', enum: KINDS, description: 'tag kind (default item)' },
        expand: { type: 'boolean', description: 'expand nested tags (default yes)' },
        ...paging,
      },
      required: ['tag'],
    },
    handler: tagMembers,
  },
  {
    name: 'tags_of',
    description: 'Which tags contain an item/fluid/block (with nested tags and KubeJS).',
    inputSchema: {
      type: 'object',
      properties: { id: str('id'), kind: { type: 'string', enum: KINDS }, ...paging },
      required: ['id'],
    },
    handler: tagsOfTool,
  },
  {
    name: 'reference_get',
    description:
      'Pack reference (as on the site, with kubejs/data corrections). Sections: ores — ore veins; smelt — ore/powder smelting: item id → fluid, mB, °C; chains — ore processing chains; metals — metals: fluid, melting point, heat capacity (modMelt — the mod value); fuels — TFC solid fuel; liquid — liquid fuel: families, engines, burners; foods — TFC food: hunger, saturation, water, decay, nutrients; botany — plants/trees/crops: climate, life cycle; greenhouse — Firmalife greenhouse; meals — composite meals; skillet — Cuisine Delight skillet; multiblocks — IE multiblocks; power — electricity: ee.*, ie.*, create.*, att.* (settings — config_get). kubejs/data overrides mod data where it exists. Without section — list of sections. filter — words (over record JSON and item names), id — one record in full.',
    inputSchema: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: Object.keys(SECTIONS) },
        filter: str('words to filter by'),
        id: str('record id — show in full'),
        ...paging,
      },
    },
    handler: referenceGet,
  },
  {
    name: 'guides_list',
    description: 'Site reference guides: id, title, section/group, verified flag, editors.',
    inputSchema: {
      type: 'object',
      properties: { section: str('section, e.g. power'), query: str('words in id/title/summary'), ...paging },
    },
    handler: guidesList,
  },
  {
    name: 'guide_get',
    description:
      'Whole guide in npm run guides file format (YAML header + Markdown) and its revision for guide_put. Long ones by lines (offset/limit).',
    inputSchema: {
      type: 'object',
      properties: { id: str('guide id'), offset: num('start line'), limit: num('how many lines') },
      required: ['id'],
    },
    handler: guideGet,
  },
  {
    name: 'guide_search',
    description: 'Full-text search in guides: which articles mention the words, with matching lines.',
    inputSchema: {
      type: 'object',
      properties: { query: str('words'), section: str('section'), ...paging },
      required: ['query'],
    },
    handler: guideSearch,
  },
  {
    name: 'guide_put',
    description:
      'Save a guide (write to the shared site database, signed Claude, version goes to history). markdown — as from guide_get (YAML header + text) or text only (other fields unchanged). Refused if the article changed after reading: baseRevision — revision from guide_get, "new" for a new article.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('id (latin, digits, hyphen)'),
        markdown: str('content'),
        baseRevision: str('revision from guide_get or "new"'),
      },
      required: ['id', 'markdown', 'baseRevision'],
    },
    handler: guidePut,
  },
  {
    name: 'jar_find',
    description:
      'Find files and classes in pack jars (mods/). Pattern: path part, dotted class name (net.dries007.tfc.config) or glob (data/tfc/**/*.json, *Config.class). For classes prefer class_find, for text in files — jar_grep.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: str('pattern'),
        jar: str(
          'search one jar: file name, name part, mod id, nested «jar!META-INF/jarjar/x.jar», «minecraft» or «candidate:<file>» (candidate_get)',
        ),
        nested: { type: 'boolean', description: 'also search nested jars (jar-in-jar)' },
        ...paging,
      },
      required: ['pattern'],
    },
    handler: jarFind,
  },
  {
    name: 'jar_read',
    description: 'Text file from a jar (json, toml, lang, mcmeta, js…) by lines; grep — only lines matching a regex.',
    inputSchema: {
      type: 'object',
      properties: {
        jar: str('jar: file name, name part, mod id, nested, «minecraft» or «candidate:<file>» (candidate_get)'),
        path: str('path inside the jar'),
        grep: str('regular expression'),
        offset: num('start line'),
        limit: num('how many lines (300)'),
      },
      required: ['jar', 'path'],
    },
    handler: jarRead,
  },
  {
    name: 'jar_javap',
    description:
      'Class bytecode (javap -c -p -constants); method — only this method/field. jar is optional — the class is found via the index. Readable code — decompile.',
    inputSchema: {
      type: 'object',
      properties: {
        jar: str(
          'jar (optional): file name, name part, mod id, nested, «minecraft» or «candidate:<file>» (candidate_get)',
        ),
        class: str('dotted class name or .class path'),
        method: str('method or field name'),
        offset: num('start line'),
        limit: num('how many lines (400)'),
      },
      required: ['class'],
    },
    handler: jarJavap,
  },
];

export const TOOLS = [
  ...CORE,
  ...codeTools,
  ...disasmTools,
  ...logsTools,
  ...packTools,
  ...candidatesTools,
  ...configTools,
  ...kubejsTools,
  ...booksTools,
  ...blocksTools,
  ...resourcesTools,
  ...siteTools,
  ...addonsTools,
  ...mapTools,
];

// Любой ответ (текст ответа с картинками тоже) — не длиннее MAX: списки и так режутся страницами, это страховка от длинных строк
for (const t of TOOLS) {
  const run = t.handler;
  t.handler = async (a) => {
    const r = await run(a);
    return r && typeof r === 'object' && 'images' in r ? { ...r, text: clip(String(r.text ?? '')) } : clip(String(r));
  };
}

export const INSTRUCTIONS = `TFC RealWorld pack data for the «TFC Планы» site (data: ${PUBLIC}). Use instead of grep over public/*.json and unzipping mods/*.jar: answers already include KubeJS (removals, replacements, kubejs/data), tags with nested and KubeJS members, config layers. Jar facts — jar_find/jar_read; bytecode instead of javap in a shell (method outline, one method's op stream, a jar/classes folder on disk, diff of two versions). Pack debugging: class_find/class_info/class_hierarchy, code_refs (callers, field writers, code side), event_listeners (event handlers incl. KubeJS), mixins (mixins and conflicts), decompile, jar_grep, mods_check (dependencies), candidate_get (a candidate mod jar not in the pack: summary, then the jar tools with jar="candidate:<file>"), log_analyze (log/crash; level=timeline — game chronology). World regions — map_regions. Resources without a client: model_render (model as an image), texture_get, resources_check (blockstates ↔ block properties, models, textures, translation keys from Component.translatable of a mod or a tools/ addon; addon from a git worktree — addon=<path>, same for model_render/texture_get). Recipes include site datapacks. Settings: config_get; config edits — config_propose (host applies), result — config_changes. Guides: guide_get → edit → guide_put with revision. Pack addons: addons_list, addon_check (release check: card tools/<mod>/addon.json, jar, icons, site page = guide addon-<mod>). Site tasks and plans: groups_list, task_create, task_get → task_update with revision; plan doc for a task — artifact_put (edits with revision from artifact_get). Tool output is in Russian.`;
