/**
 * Инструменты MCP: обзор сборки — моды (pack-manifest.json + библиотека и каталог рецептов) и история обновлений
 * (Firestore packUpdates, пишет scripts/pack-release.mjs при деплое). Firestore — только чтение и с кешем.
 */
import { DOCS, fromValue } from '../../firestore-rest.mjs';
import { STATUS_LABEL, STATUS_ORDER } from '../../../src/lib/freshness.ts';
import path from 'node:path';
import { downloadVersionJar, freshnessReport, modChangelog, summary as freshSummary } from '../../freshness.mjs';
import { archiveMods, jarMeta } from '../code-index.mjs';
import { MODS, WORK, isActive, items, mods, readJson, recipes, tags } from '../data.mjs';
import { FirestoreError, api, cached, configDocs, listAll } from '../firestore.mjs';
import { MAX, dateOf, named, norm, page, paging, short, str, words } from '../fmt.mjs';
import { depContext } from './code.mjs';

// ---------------------------------------------------------------- моды

/** Число предметов и рецептов по пространству имён — из манифеста (как их видел деплой, без KubeJS) */
function manifestCounts() {
  const m = readJson('pack-manifest.json', null);
  const count = (ids) => {
    const map = new Map();
    for (const id of ids) {
      const ns = id.split(':')[0];
      map.set(ns, (map.get(ns) ?? 0) + 1);
    }
    return map;
  };
  return {
    manifest: m,
    items: count(m?.items ?? []),
    recipes: count(Object.keys(m?.recipes ?? {})),
  };
}

const modLine = (m, c) =>
  `${m.id} — ${m.name} ${m.version} [${m.jar}] предметов ${c.items.get(m.id) ?? 0}, рецептов ${c.recipes.get(m.id) ?? 0}`;

function modsList(a) {
  const c = manifestCounts();
  if (!c.manifest) return 'pack-manifest.json не собран (npm run mods).';
  const w = words(a.query);
  let list = [...mods().values()].filter((m) => {
    const hay = norm(`${m.id} ${m.name} ${m.jar}`);
    return w.every((x) => hay.includes(x));
  });
  if (a.sort === 'items' || a.sort === 'recipes')
    list.sort((x, y) => (c[a.sort].get(y.id) ?? 0) - (c[a.sort].get(x.id) ?? 0));
  else list.sort((x, y) => x.id.localeCompare(y.id));
  const head = `Сборка: ${mods().size} модов, сборка данных ${dateOf(Number(c.manifest.builtAt))}. Числа — предметы и рецепты с id в пространстве мода, до KubeJS (подробно — mod_get).`;
  return `${head}\n${page(list, a, (m) => [modLine(m, c)], 30)}`;
}

/** Мод по id, имени jar или части названия: точное совпадение id, иначе единственный по словам */
function findMod(q) {
  const all = [...mods().values()];
  const s = norm(String(q ?? '').trim());
  const exact = all.find((m) => m.id === s || norm(m.jar) === s || norm(m.name) === s);
  if (exact) return { mod: exact };
  const w = words(s);
  const hits = w.length ? all.filter((m) => w.every((x) => norm(`${m.id} ${m.name} ${m.jar}`).includes(x))) : [];
  return hits.length === 1 ? { mod: hits[0] } : { hits };
}

/** Импортированные конфиги мода из Firestore (кеш configDocs общий с config_get); при ошибке — текст ошибки */
async function importedConfigs(id) {
  try {
    const docs = await configDocs();
    const low = id.toLowerCase();
    return docs
      .filter((d) => {
        const file = String(d.path ?? '').toLowerCase();
        return String(d.mod ?? '').toLowerCase() === low || file.startsWith(`${low}-`) || file.startsWith(`${low}/`);
      })
      .map((d) => `${d.scope}/${d.path}`);
  } catch (e) {
    return `не прочитаны (${short(String(e.message ?? e), 120)})`;
  }
}

async function modGet(a) {
  if (!readJson('pack-manifest.json', null)) return 'pack-manifest.json не собран (npm run mods).';
  const { mod: m, hits } = findMod(a.id);
  if (!m) {
    if (!hits.length) return `Мод «${a.id}» не найден. Список — mods_list.`;
    return `Под «${a.id}» подходит несколько модов, уточните id:\n${hits
      .slice(0, 30)
      .map((x) => `${x.id} — ${x.name}`)
      .join('\n')}`;
  }
  const ns = m.id;
  const c = manifestCounts();
  const out = [`${m.id} — ${m.name}`, `версия ${m.version}; jar ${m.jar}; sha1 ${m.sha1 ?? '?'}`];

  // Предметы: библиотека сайта (items.json + свои предметы KubeJS сборки в этом пространстве имён)
  const its = items().list.filter((it) => it.i.split(':')[0] === ns);
  const own = its.filter((it) => it.kjs).length;
  out.push(
    `предметов: ${its.length}${own ? ` (из них ${own} регистрирует KubeJS сборки)` : ''}; в манифесте ${c.items.get(ns) ?? 0} — items_search с mod="${ns}"`,
  );

  // Рецепты с id мода: состояние в игре с учётом KubeJS
  const cat = recipes();
  const rs = cat.list.filter((r) => r.i.split(':')[0] === ns);
  const n = (f) => rs.filter(f).length;
  out.push(
    `рецептов с id мода: ${rs.length} — работают ${n(isActive)}, удалены KubeJS ${n((r) => !r.removed && r.kjsRemoved.length)}, ` +
      `отключены заглушкой датапака ${n((r) => r.removed)}, изменены KubeJS ${n((r) => isActive(r) && r.kjsChanged.length)}, ` +
      `под сомнением (неразборчивый фильтр удаления) ${n((r) => isActive(r) && r.kjsMaybe.length)}` +
      `${n((r) => r.origin !== 'mod') ? `; из kubejs/data или скриптов сборки (замены и новые) ${n((r) => r.origin !== 'mod')}` : ''}` +
      `; в манифесте ${c.recipes.get(ns) ?? 0}`,
  );
  // Рецепты, дающие предметы мода (любого пространства имён) — так видно, сколько из них остались в игре
  const ids = new Set(its.map((it) => it.i));
  const making = new Set();
  for (const id of ids) for (const r of cat.byOutput.get(id) ?? []) making.add(r);
  const makingActive = [...making].filter(isActive).length;
  out.push(`рецептов, дающих предметы мода (из любых модов): ${making.size}, работают ${makingActive}`);

  // Типы рецептов мода: из манифеста (зарегистрированные в jar) + сколько рецептов каждого типа в каталоге
  const types = (c.manifest.recipeTypes ?? []).filter((t) => t.split(':')[0] === ns);
  if (types.length) {
    const byType = new Map();
    for (const r of cat.list) if (r.t.split(':')[0] === ns) byType.set(r.t, (byType.get(r.t) ?? 0) + 1);
    out.push(`типов рецептов: ${types.length} — ${types.map((t) => `${t} (${byType.get(t) ?? 0})`).join(', ')}`);
  } else out.push('типов рецептов: 0');

  // Теги с id мода по видам
  const kinds = new Map();
  for (const t of tags().byKey.values()) if (t.i.split(':')[0] === ns) kinds.set(t.k, (kinds.get(t.k) ?? 0) + 1);
  const tagTotal = [...kinds.values()].reduce((s, x) => s + x, 0);
  out.push(`тегов с id мода: ${tagTotal}${tagTotal ? ` (${[...kinds].map(([k, x]) => `${k} ${x}`).join(', ')})` : ''}`);

  // Конфиг: значения по умолчанию из кода (config-defaults.json) и импортированные файлы
  const base = m.jar.replace(/\.jar$/, '');
  const defs = (readJson('config-defaults.json', []) ?? []).filter((d) => d.src === base);
  out.push(
    defs.length
      ? `конфиг из кода (config-defaults.json): ${defs.map((d) => `${d.type} — ${d.keys.length} ключей`).join(', ')}`
      : 'конфиг из кода: не разобран (config-defaults.json знает только часть модов)',
  );
  const imported = await importedConfigs(ns);
  out.push(
    typeof imported === 'string'
      ? `импортированные конфиги: ${imported}`
      : `импортированные конфиги (Firestore): ${imported.length ? imported.join(', ') : 'нет'}${imported.length || defs.length ? ' — config_get' : ''}`,
  );
  out.push(`код мода: jar_find с jar="${ns}"`);
  return out.join('\n');
}

// ---------------------------------------------------------------- обновления сборки

const TTL = 10 * 60_000;

/** Лента без больших списков (предметы, рецепты, ченджлоги, текст патчноута): одно чтение на запись раз в 10 мин */
const updatesList = cached(TTL, async () =>
  (
    await listAll('packUpdates', [
      'createdAt',
      'deployedBy',
      'baseline',
      'counts',
      'totals',
      'mods',
      'newRecipeTypes',
      'notes.updatedAt',
    ])
  ).sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0)),
);

/** Запись целиком — свой кеш на каждую (патчноут могут дописать на сайте, поэтому не навсегда) */
const docCache = new Map();
function updateDoc(id) {
  if (!docCache.has(id))
    docCache.set(
      id,
      cached(TTL, async () => {
        try {
          const d = await api(`${DOCS}/packUpdates/${encodeURIComponent(id)}`);
          return {
            id,
            updateTime: d.updateTime,
            ...Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, fromValue(v)])),
          };
        } catch (e) {
          if (e instanceof FirestoreError && e.status === 404) return null;
          throw e;
        }
      }),
    );
  return docCache.get(id)();
}

const delta = ([a, b] = [0, 0]) => `${a} → ${b}${b - a ? ` (${b - a > 0 ? '+' : ''}${b - a})` : ''}`;

function summary(u) {
  const md = u.mods ?? {};
  const t = u.totals;
  const parts = u.baseline
    ? [`первая запись: вся сборка — ${md.added?.length ?? 0} модов`]
    : [
        `моды +${md.added?.length ?? 0} −${md.removed?.length ?? 0} ~${md.updated?.length ?? 0}`,
        ...(t
          ? [
              `предметы +${t.itemsAdded} −${t.itemsRemoved}`,
              `рецепты +${t.recipesAdded} −${t.recipesRemoved} ~${t.recipesChanged}`,
            ]
          : []),
      ];
  if (u.newRecipeTypes?.length) parts.push(`новых типов рецептов ${u.newRecipeTypes.length}`);
  return parts.join('; ');
}

const modRef = (m) => `${m.id} — ${m.name} ${m.from ? `${m.from} → ` : ''}${m.version}`;

/** Короткие имена модов для строки ленты: «+ee_overheat, ~tfc 4.2.8→4.2.9» */
function modsBrief(u) {
  if (u.baseline) return '';
  const md = u.mods ?? {};
  const all = [
    ...(md.added ?? []).map((m) => `+${m.id}`),
    ...(md.removed ?? []).map((m) => `−${m.id}`),
    ...(md.updated ?? []).map((m) => `~${m.id} ${m.from ?? '?'}→${m.version}`),
  ];
  return all.length ? `\n  ${short(all.join(', '), 400)}` : '';
}

const SECTIONS = ['items', 'recipes', 'mods', 'changelog', 'notes'];
const KINDS = { items: ['added', 'removed'], recipes: ['added', 'removed', 'changed'] };
const KIND_RU = { added: 'добавлены', removed: 'убраны', changed: 'изменены' };

async function packUpdates(a) {
  const id = String(a.id ?? '').trim();
  if (!id) {
    const list = await updatesList();
    return (
      page(list, a, (u) => [
        `${u.id} — ${dateOf(u.createdAt)}, ${u.deployedBy ?? '?'}: ${summary(u)}; модов ${delta(u.counts?.mods)}` +
          `${u.notes?.updatedAt ? '; есть патчноут' : ''}${modsBrief(u)}`,
      ]) + (list.length ? '\nПодробно — pack_updates с id.' : '')
    );
  }
  const u = await updateDoc(id);
  if (!u) return `Обновления ${id} нет. Список — pack_updates без id.`;
  const section = a.section ?? '';
  if (section && !SECTIONS.includes(section)) return `section: одно из ${SECTIONS.join(', ')}.`;
  const w = words(a.query);
  const match = (s) => w.every((x) => norm(s).includes(x));

  if (section === 'items' || section === 'recipes') {
    const kind = a.kind ?? KINDS[section][0];
    if (!KINDS[section].includes(kind)) return `kind для ${section}: ${KINDS[section].join(', ')}.`;
    const ids = u[section]?.[kind] ?? [];
    const total = u.totals?.[`${section}${kind[0].toUpperCase()}${kind.slice(1)}`];
    const list = ids.map((x) => (section === 'items' ? named(x) : x)).filter(match);
    const cut = total > ids.length ? ` (в записи сохранены ${ids.length} из ${total})` : '';
    return `${section === 'items' ? 'Предметы' : 'Рецепты'} ${KIND_RU[kind]}${cut}:\n${page(list, a, (x) => [x], 50)}`;
  }
  if (section === 'mods') {
    const md = u.mods ?? {};
    const list = [
      ...(md.added ?? []).map((m) => `+ ${modRef(m)}`),
      ...(md.removed ?? []).map((m) => `− ${modRef(m)}`),
      ...(md.updated ?? []).map((m) => `~ ${modRef(m)}`),
    ].filter(match);
    return page(list, a, (x) => [x], 50);
  }
  if (section === 'changelog') {
    const logs = u.changelogs ?? {};
    const mod = String(a.mod ?? '').trim();
    if (!mod) {
      const keys = Object.keys(logs);
      return keys.length
        ? `Ченджлоги с Modrinth (${keys.length}): ${keys.join(', ')}. Текст — section=changelog, mod=<id>.`
        : 'Ченджлогов в записи нет.';
    }
    return logs[mod]
      ? `Ченджлог ${mod}:\n${logs[mod]}`
      : `Ченджлога ${mod} нет. Есть: ${Object.keys(logs).join(', ') || '—'}.`;
  }
  if (section === 'notes')
    return u.notes?.body
      ? `Патчноут (${u.notes.source === 'agent' ? 'от модели' : 'вручную'}, ${u.notes.updatedBy ?? '?'}, ${dateOf(u.notes.updatedAt)}):\n${u.notes.body}`
      : 'Патчноута нет (пишется при первом открытии обновления на сайте).';

  // Обзор записи: сводка, моды полностью (кроме первой записи), начало списков предметов и рецептов
  const out = [
    `${u.id} — ${dateOf(u.createdAt)}, ${u.deployedBy ?? '?'}${u.baseline ? ' (первая запись: вся сборка)' : ''}`,
    `модов ${delta(u.counts?.mods)}; предметов ${delta(u.counts?.items)}; рецептов ${delta(u.counts?.recipes)}`,
    summary(u),
  ];
  const md = u.mods ?? {};
  if (u.baseline) out.push(`моды: ${md.added?.length ?? 0} — section=mods`);
  else
    for (const [k, sign] of [
      ['added', '+'],
      ['removed', '−'],
      ['updated', '~'],
    ])
      if (md[k]?.length)
        out.push(`моды ${k === 'updated' ? 'обновлены' : KIND_RU[k]}:`, ...md[k].map((m) => `  ${sign} ${modRef(m)}`));
  if (u.newRecipeTypes?.length) out.push(`новые типы рецептов: ${u.newRecipeTypes.join(', ')}`);
  const SHOW = 10;
  for (const s of ['items', 'recipes'])
    for (const kind of KINDS[s]) {
      const ids = u[s]?.[kind] ?? [];
      if (!ids.length) continue;
      const total = u.totals?.[`${s}${kind[0].toUpperCase()}${kind.slice(1)}`] ?? ids.length;
      out.push(
        `${s === 'items' ? 'предметы' : 'рецепты'} ${KIND_RU[kind]} (${total}):`,
        ...ids.slice(0, SHOW).map((x) => `  ${s === 'items' ? named(x) : x}`),
      );
      if (total > SHOW) out.push(`  … ещё ${total - SHOW}: section=${s}, kind=${kind}`);
    }
  const logs = Object.keys(u.changelogs ?? {});
  if (logs.length) out.push(`ченджлоги (${logs.length}): ${logs.join(', ')} — section=changelog, mod=<id>`);
  out.push(u.notes?.body ? `патчноут есть — section=notes` : 'патчноута нет');
  return out.join('\n');
}

// ---------------------------------------------------------------- свежесть сборки

const FRESH_TTL = 10 * 60e3;
let freshCache = null;

/** Отчёт о свежести: живой расчёт по снимку сборки (Modrinth + CurseForge), кеш 10 мин */
async function freshReport(refresh) {
  const manifest = readJson('pack-manifest.json', null);
  if (!manifest?.mods?.length) throw new Error('pack-manifest.json не собран (npm run mods).');
  if (!refresh && freshCache && freshCache.builtAt === manifest.builtAt && Date.now() - freshCache.at < FRESH_TTL)
    return freshCache.report;
  const report = await freshnessReport({ manifest, modsDirs: [MODS] });
  freshCache = { at: Date.now(), builtAt: manifest.builtAt, report };
  return report;
}

const OUTDATED = ['red', 'orange', 'yellow', 'unknown'];

const freshLine = (m) => {
  const cur = m.current?.version ?? m.version;
  const to =
    m.latest && m.status !== 'ok'
      ? ` → ${m.latest.version}${m.latest.type !== 'release' ? ` [${m.latest.type}]` : ''}`
      : '';
  const beta = m.beta ? ` (есть ${m.beta.type} ${m.beta.version})` : '';
  const date = m.latest?.date && m.status !== 'ok' ? `, вышла ${m.latest.date.slice(0, 10)}` : '';
  const deps = m.newDeps?.length ? `; новые обязательные зависимости: ${m.newDeps.map((d) => d.name).join(', ')}` : '';
  return `[${STATUS_LABEL[m.status]}] ${m.id} — ${m.project?.title ?? m.name}: ${cur}${to}${beta}${date}${m.source ? ` · ${m.source}` : ''}${deps}${m.note ? ` · ${m.note}` : ''}`;
};

const CHANGELOG_ONE = 10000;

/** Страница ченджлогов: старые версии сверху, с offset (номер версии), сколько влезет в budget символов */
async function changelogPage(log, a, budget) {
  const offset = Math.max(0, Number(a.offset ?? 0) | 0);
  const limit = Math.max(1, Number(a.limit ?? 20) | 0);
  const parts = [];
  let size = 0;
  let end = offset;
  for (; end < Math.min(log.length, offset + limit); end++) {
    const v = log[end];
    let text = await v.text();
    if (text.length > CHANGELOG_ONE) text = `${text.slice(0, CHANGELOG_ONE)}\n… (ченджлог версии обрезан)`;
    const part = `### ${v.version} (${v.type}, ${v.date.slice(0, 10)})\n${text || '(пусто)'}`;
    if (end > offset && size + part.length > budget) break;
    parts.push(part);
    size += part.length + 2;
  }
  const kinds = a.beta ? 'версий' : 'релизов';
  const head = `Ченджлоги ${kinds} новее нашей (старые сверху): всего ${log.length}; показаны ${offset + 1}–${end}${end < log.length ? `; дальше: offset=${end}` : ''}${a.beta ? '' : '; с бетами — beta=true'}.`;
  return [head, parts.join('\n\n')];
}

/**
 * Зависимости новой версии мода: скачать её jar (кеш .cache/mcp/fresh рядом с mods/), прочитать neoforge.mods.toml
 * с вложенными и проверить по сборке, где наш jar заменён новым, — как mods_check. Плюс кто в сборке зависит от мода и
 * чьи диапазоны новая версия нарушит.
 */
async function newDeps(m, target, neoforge) {
  const file = await downloadVersionJar(m, target, path.join(WORK, '.cache', 'mcp', 'fresh'));
  const archive = archiveMods(file, target.file ?? path.basename(file));
  const top = archive[0];
  if (!top.mods.length) return [`Новая версия ${target.version}: в jar нет neoforge.mods.toml — не мод NeoForge?`];
  const before = depContext({ neoforge });
  const after = depContext({ neoforge, swap: { jar: m.jar, archive } });
  const oldMeta = jarMeta(m.jar);
  const oldIds = oldMeta.mods.map((x) => x.id);
  const newIds = top.mods.map((x) => x.id);
  const out = [
    `Новая версия ${target.version} (${target.file ?? path.basename(file)}): ${top.mods.map((x) => `${x.id} ${x.version}`).join(', ')}. Зависимости из её neoforge.mods.toml — по сборке, где наш jar заменён новым:`,
  ];
  if (oldIds.join() !== newIds.join())
    out.push(`  ! id модов в jar сменились: было ${oldIds.join(', ')}, стало ${newIds.join(', ')}`);
  const BAD = ['missing', 'version', 'incompatible'];
  let bad = 0;
  for (const a of archive) {
    const deps = a.deps.filter((d) => a.mods.some((x) => x.id === d.owner));
    if (!deps.length) continue;
    if (a !== top)
      out.push(
        `  вложенный ${a.path.slice(a.path.indexOf('!') + 1)} (${a.mods.map((x) => `${x.id} ${x.version}`).join(', ')}):`,
      );
    for (const d of deps) {
      const r = after.check(d);
      const was = oldMeta.deps.find((x) => x.owner === d.owner && x.id === d.id);
      const diff = !was
        ? ' (новая)'
        : was.range !== d.range || was.type !== d.type
          ? ` (было ${was.type} ${was.range})`
          : '';
      if (BAD.includes(r.status) && !(r.status === 'missing' && d.side === 'CLIENT')) bad++;
      out.push(`  ${BAD.includes(r.status) ? '✗' : ' '} ${after.depLine({ id: d.owner }, d)}${diff}`);
    }
  }
  const gone = oldMeta.deps.filter(
    (x) => oldIds.includes(x.owner) && !top.deps.some((d) => d.owner === x.owner && d.id === x.id),
  );
  if (gone.length) out.push(`  убраны: ${gone.map((x) => `${x.type} ${x.id} ${x.range}`).join('; ')}`);
  const bundled = archive.slice(1).flatMap((a) => a.mods.map((x) => `${x.id} ${x.version}`));
  if (bundled.length) out.push(`  несёт внутри (jar-in-jar): ${bundled.join(', ')}`);
  // Кто зависит от мода: те же диапазоны — до замены и после
  const rev = [];
  for (const o of after.active) {
    if (o.jar === top.path || o.jar.startsWith(`${top.path}!`)) continue;
    for (const d of after.depsOf(o)) {
      if (!newIds.includes(d.id) && !oldIds.includes(d.id)) continue;
      const now = before.check(d).status;
      const then = after.check(d).status;
      const broke = BAD.includes(then) && !BAD.includes(now);
      if (broke) bad++;
      rev.push(
        `  ${broke ? '✗' : ' '} ${o.id} ${o.version}: ${after.depLine(o, d)}${broke ? ' — сейчас ок, сломается' : ''}`,
      );
    }
  }
  out.push(`От него зависят в сборке (${rev.length})${rev.length ? ', с новой версией:' : '.'}`, ...rev);
  out.push(
    bad
      ? `Итог: ${bad} проблем(ы) ✗ — обновлять вместе с ними или подобрать версию.`
      : 'Итог: по диапазонам версий новая версия встаёт в сборку без конфликтов (в игре не проверялось).',
  );
  return out;
}

async function modsFreshness(a) {
  const report = await freshReport(a.refresh);
  const when = `проверено ${new Date(report.generatedAt).toLocaleString('ru-RU')}`;
  if (a.mod) {
    const w = words(a.mod);
    const m =
      report.mods.find((x) => x.id === a.mod || x.jar === a.mod) ??
      report.mods.find((x) => w.every((t) => norm(`${x.id} ${x.name} ${x.jar} ${x.project?.title ?? ''}`).includes(t)));
    if (!m) throw new Error(`мод «${a.mod}» не найден в сборке (mods_list)`);
    if (a.format === 'json') return JSON.stringify(m, null, 1);
    const out = [freshLine(m), `jar: ${m.jar}; версия в mods.toml: ${m.version}`];
    if (m.project?.url) out.push(`страница: ${m.project.url}`);
    if (m.latest?.url && m.status !== 'ok')
      out.push(`новая версия: ${m.latest.url}${m.latest.file ? ` (${m.latest.file})` : ''}`);
    if (m.status === 'missing')
      out.push('Нет ни на Modrinth, ни на CurseForge по файлу jar — вероятно, собран вручную.');
    const target = a.beta ? (m.beta ?? m.latest) : m.latest;
    if (a.deps && target && m.status !== 'ok' && m.status !== 'missing')
      try {
        out.push('', ...(await newDeps(m, target, a.neoforge)));
      } catch (e) {
        out.push('', `Зависимости новой версии не проверены: ${e.message}`);
      }
    try {
      const log = await modChangelog(m, { beta: a.beta });
      if (log?.length) out.push('', ...(await changelogPage(log, a, MAX - out.join('\n').length - 500)));
      else if (log) out.push('', `Версий новее нашей${a.beta ? '' : ' (релизов)'} в ченджлогах нет.`);
    } catch (e) {
      out.push('', `Ченджлоги не получены: ${e.message}`);
    }
    return out.join('\n');
  }
  const status = a.status ?? 'outdated';
  const list = report.mods.filter((m) =>
    status === 'all' ? true : status === 'outdated' ? OUTDATED.includes(m.status) : m.status === status,
  );
  if (a.format === 'json') return JSON.stringify({ ...report, mods: list }, null, 1);
  const head = `Свежесть сборки (${when}): ${freshSummary(report)}`;
  if (!list.length) return `${head}\nПо фильтру «${status}» модов нет.`;
  return `${head}\n${page(list, a, (m) => [freshLine(m)], 60)}`;
}

export const TOOLS = [
  {
    name: 'mods_list',
    description:
      'Pack mods (pack-manifest.json): id, name, version, jar, item and recipe counts. Search by words in id/name/jar, sort by id or by item/recipe count.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('search words (id, name, jar name); empty — all'),
        sort: {
          type: 'string',
          enum: ['id', 'items', 'recipes'],
          description: 'order: id (default), items, recipes',
        },
        ...paging,
      },
    },
    handler: modsList,
  },
  {
    name: 'mod_get',
    description:
      'One pack mod: version, jar, sha1, items, recipes (working / removed by KubeJS / disabled / changed), recipe types, tags, config (values from code and imported files).',
    inputSchema: {
      type: 'object',
      properties: { id: str('mod id (namespace), jar name or words from the name') },
      required: ['id'],
    },
    handler: modGet,
  },
  {
    name: 'pack_updates',
    description:
      'Pack update history (Firestore packUpdates, written on deploy): without id — feed with dates and summary; with id — the record: mods added/removed/updated, items, recipes, new recipe types; section — full list (items/recipes with kind, mods), mod changelog from Modrinth (changelog + mod), patch notes (notes). 10 min cache.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('record id from the feed'),
        section: { type: 'string', enum: SECTIONS, description: 'part of the record in full' },
        kind: {
          type: 'string',
          enum: ['added', 'removed', 'changed'],
          description: 'for items/recipes: added (default), removed, changed (recipes only)',
        },
        mod: str('for changelog: mod id'),
        query: str('for items/recipes/mods: filter words'),
        ...paging,
      },
    },
    handler: packUpdates,
  },
  {
    name: 'mods_freshness',
    description:
      'How far behind each pack mod is: newest version for MC 1.21.1 NeoForge from Modrinth (by jar sha1) and CurseForge (by jar fingerprint), lag colour by the first differing number of x.y.z (red — x, orange — y, yellow — z/pre-release), newer betas, new required dependencies. Sorted red → orange → yellow → unknown → missing → ok. With mod — one mod plus changelogs of the releases newer than ours, oldest first (offset/limit page by version; beta=true adds betas), deps=true — dependency check of the new jar. Live, 10 min cache. Input for planning a full or partial pack update.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['outdated', ...STATUS_ORDER, 'all'],
          description: 'filter: outdated (default: red+orange+yellow+unknown), one status, or all',
        },
        mod: str('one mod: id, jar name or words from the name — details and changelogs'),
        deps: {
          type: 'boolean',
          description:
            'with mod: download the newest release jar (cached), check its neoforge.mods.toml (+ jar-in-jar) against the pack like mods_check, and who in the pack depends on the mod with ranges it would break',
        },
        neoforge: str('with deps: server NeoForge version to check neoforge ranges against (e.g. 21.1.248)'),
        beta: {
          type: 'boolean',
          description: 'with mod: include betas/alphas — changelogs up to the newest beta, deps of the beta jar',
        },
        refresh: { type: 'boolean', description: 'recheck now, ignoring the 10 min cache' },
        format: { type: 'string', enum: ['text', 'json'], description: 'text (default) or the raw report JSON' },
        ...paging,
      },
    },
    handler: modsFreshness,
  },
];
