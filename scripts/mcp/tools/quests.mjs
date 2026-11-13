/**
 * Книга квестов FTB Quests: просмотр глав и квестов, создание и правка главы в папку-оверлей
 * (её проверяют pack_devserver overlay=… и предлагают хосту tfc admin propose).
 * Источник — config/ftbquests/quests снимка сборки (рядом с jar), поверх него — оверлей, если указан.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildQuestBook, chapterOf, questTexts } from '@tfc/core/ftbQuests';
import { applyChapterSpec } from '@tfc/core/ftbQuestsEdit';
import { parseSnbt, stringifySnbt } from '@tfc/core/snbt';
import { getTag, items, MODS, WORK } from '../data.mjs';
import { clip, MAX, named, nameOf, norm, page, paging, str, words } from '../fmt.mjs';

const REL = path.join('config', 'ftbquests', 'quests');
const PACK_QUESTS = path.join(path.dirname(MODS), REL);
const DEFAULT_OVERLAY = path.join(WORK, '.cache', 'mcp', 'quests-overlay');

const readSnbt = (file) => parseSnbt(fs.readFileSync(file, 'utf8'));
const exists = (f) => fs.existsSync(f);

/** Файл книги: из оверлея, если он там есть, иначе из сборки */
function source(overlay, rel) {
  const o = overlay && path.join(overlay, REL, rel);
  if (o && exists(o)) return o;
  const p = path.join(PACK_QUESTS, rel);
  return exists(p) ? p : null;
}

/** Книга целиком: сырые узлы глав (с файлом) и языки, оверлей поверх сборки */
function loadBook(overlay) {
  if (!exists(PACK_QUESTS)) throw new Error(`нет ${PACK_QUESTS} — npm run pack:fetch`);
  const names = new Set();
  for (const dir of [path.join(PACK_QUESTS, 'chapters'), overlay && path.join(overlay, REL, 'chapters')])
    if (dir && exists(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.snbt')) names.add(f);
  const chapters = [...names].sort().map((f) => {
    const file = source(overlay, path.join('chapters', f));
    return { file, node: readSnbt(file) };
  });
  const lang = {};
  const langNames = new Set();
  for (const dir of [path.join(PACK_QUESTS, 'lang'), overlay && path.join(overlay, REL, 'lang')])
    if (dir && exists(dir)) for (const f of fs.readdirSync(dir)) if (/^\w+\.snbt$/.test(f)) langNames.add(f);
  for (const f of langNames) lang[f.slice(0, -5)] = readSnbt(source(overlay, path.join('lang', f)));
  const groupsFile = source(overlay, 'chapter_groups.snbt');
  const groups = groupsFile ? readSnbt(groupsFile) : undefined;
  return { chapters, lang, groups, view: buildQuestBook({ chapters: chapters.map((c) => c.node), lang, groups }) };
}

const overlayOf = (a) => (a.overlay ? path.resolve(String(a.overlay)) : null);

function findChapter(book, q) {
  const s = norm(String(q ?? '').trim());
  if (!s) throw new Error('укажите chapter: id, имя файла или часть названия');
  const v = book.view.chapters;
  const hit =
    v.find((c) => c.id.toLowerCase() === s || norm(c.filename) === s) ??
    v.find((c) => norm(c.title) === s) ??
    v.filter((c) => norm(c.title).includes(s));
  if (Array.isArray(hit)) {
    if (hit.length === 1) return hit[0];
    throw new Error(
      hit.length
        ? `несколько глав: ${hit.map((c) => `${c.filename} «${c.title}»`).join(', ')}`
        : `главы «${q}» нет; quests_list — все главы`,
    );
  }
  return hit;
}

const refText = (r) => `${named(r.id)}${r.count ? ` ×${r.count}` : ''}`;

function taskText(t) {
  const opt = t.optional ? ' (необязательно)' : '';
  const title = t.title ? ` «${t.title}»` : '';
  if (t.type === 'item') {
    const what = t.items?.length ? t.items.map(refText).join(' | ') : `фильтр ${t.filter}`;
    return `предмет${title}: ${what}${t.count ? ` ×${t.count}` : ''}${opt} [${t.id}]`;
  }
  if (t.type === 'checkmark') return `галочка${title}${opt} [${t.id}]`;
  return `${t.type}${title}${t.target ? `: ${t.target}` : ''}${t.count ? ` ×${t.count}` : ''}${opt} [${t.id}]`;
}

function rewardText(r) {
  if (r.type === 'xp') return `${r.xp} опыта`;
  if (r.type === 'xp_levels') return `${r.xp} ур. опыта`;
  if (r.type === 'item' && r.item) return refText(r.item);
  return r.title ? `${r.type} «${r.title}»` : r.type;
}

/** Все квесты книги по id: глава и квест */
function questIndex(book) {
  const m = new Map();
  for (const c of book.view.chapters) for (const q of c.quests) m.set(q.id, { c, q });
  return m;
}

/** Название квеста; пустое — как в игре: имя первого предмета задачи */
const titleOf = (q) => q.title || (q.icon ? nameOf(q.icon) || q.icon : '—');

function questLines(q, idx, full) {
  const out = [
    `${q.id} (${q.x}, ${q.y}) «${titleOf(q)}»${q.subtitle ? ` — ${q.subtitle}` : ''}${q.optional ? ' [необязательный]' : ''}`,
  ];
  if (q.deps.length) {
    const deps = q.deps.map((d) => {
      const hit = idx.get(d);
      return hit
        ? `«${titleOf(hit.q)}»${hit.c.id !== idx.get(q.id)?.c.id ? ` (глава «${hit.c.title}»)` : ''} ${d}`
        : `${d} (нет такого)`;
    });
    out.push(`   после${q.depMode === 'one_completed' ? ' любого из' : ''}: ${deps.join(', ')}`);
  }
  for (const t of q.tasks) out.push(`   • ${taskText(t)}`);
  if (q.rewards.length) out.push(`   награды: ${q.rewards.map(rewardText).join(', ')}`);
  if (q.desc.length) {
    const desc = full ? q.desc : [q.desc.join(' ').slice(0, 160) + (q.desc.join(' ').length > 160 ? '…' : '')];
    for (const l of desc) out.push(`   │ ${l}`);
  }
  return out;
}

// ---------------------------------------------------------------- quests_list

function questsList(a) {
  const book = loadBook(overlayOf(a));
  const q = words(a.query);
  if (!q.length) {
    const lines = [];
    for (const g of book.view.groups) {
      lines.push(g.id ? `■ ${g.title} [${g.id}]` : '■ Без группы');
      for (const c of book.view.chapters.filter((x) => x.group === g.id))
        lines.push(
          `   ${c.order}. «${c.title}» — ${c.quests.length} кв. · ${c.filename === c.id ? c.id : `${c.filename} [${c.id}]`}${c.icon ? ` · ${c.icon}` : ''}`,
        );
    }
    const total = book.view.chapters.reduce((n, c) => n + c.quests.length, 0);
    return clip(`Книга квестов: ${book.view.chapters.length} глав, ${total} квестов.\n${lines.join('\n')}`);
  }
  // Поиск: название, подзаголовок, описание, задачи (id предметов и их имена)
  const hits = [];
  for (const c of book.view.chapters)
    for (const quest of c.quests) {
      const refs = quest.tasks.flatMap((t) => [
        ...(t.items ?? []).map((r) => named(r.id)),
        t.filter ?? '',
        t.target ?? '',
        t.title ?? '',
      ]);
      const hay = norm([quest.title, quest.subtitle ?? '', ...quest.desc, ...refs].join(' '));
      if (q.every((w) => hay.includes(w))) hits.push({ c, quest });
    }
  const idx = questIndex(book);
  return clip(
    page(hits, a, ({ c, quest }) => [`«${c.title}» (${c.filename}) → ${questLines(quest, idx, false).join('\n')}`]),
  );
}

// ---------------------------------------------------------------- quest_chapter

/**
 * Глава как спецификация для quest_chapter_put (существующие квесты и задачи — с id). Тексты — как в ru_ru.snbt,
 * с кодами форматирования (&e, \\&): записываются обратно без потерь; нет русского — поля нет.
 */
function chapterSpec(c, ru) {
  const raw = (kind, id, field) => {
    const v = ru[`${kind}.${id}.${field}`];
    return typeof v === 'string' || Array.isArray(v) ? v : undefined;
  };
  const opt = (k, v) => (v === undefined || (Array.isArray(v) && !v.length) ? {} : { [k]: v });
  return {
    filename: c.filename,
    ...opt('title', raw('chapter', c.id, 'title')),
    ...opt('subtitle', raw('chapter', c.id, 'chapter_subtitle')),
    group: c.group,
    order: c.order,
    ...(c.icon ? { icon: c.icon } : {}),
    quests: c.quests.map((q) => ({
      id: q.id,
      ...opt('title', raw('quest', q.id, 'title')),
      ...opt('subtitle', raw('quest', q.id, 'quest_subtitle')),
      ...opt('desc', raw('quest', q.id, 'quest_desc')),
      x: q.x,
      y: q.y,
      ...(q.size ? { size: q.size } : {}),
      ...(q.deps.length ? { deps: q.deps } : {}),
      ...(q.depMode === 'one_completed' ? { depMode: 'one' } : {}),
      ...(q.optional ? { optional: true } : {}),
      tasks: q.tasks.map((t) => {
        const title = opt('title', raw('task', t.id, 'title'));
        // фильтр сложнее перечня и задачи не item/checkmark/advancement — только id: останутся как есть
        if (t.type === 'item' && t.items?.length) {
          const items = t.items.map((r) => r.id);
          return {
            id: t.id,
            ...(items.length === 1 ? { item: items[0] } : { items }),
            ...(t.count ? { count: t.count } : {}),
            ...title,
            ...(t.optional ? { optional: true } : {}),
          };
        }
        return { id: t.id, type: t.type, ...title };
      }),
      ...(q.rewards.length
        ? {
            rewards: q.rewards.map((r) =>
              r.type === 'xp'
                ? { id: r.id, xp: r.xp }
                : r.type === 'item' && r.item
                  ? { id: r.id, item: r.item.id, ...(r.item.count ? { count: r.item.count } : {}) }
                  : { id: r.id },
            ),
          }
        : {}),
    })),
  };
}

function questChapter(a) {
  const overlay = overlayOf(a);
  const book = loadBook(overlay);
  const c = findChapter(book, a.chapter);
  const format = a.format ?? 'text';
  const raw = book.chapters.find((x) => x.node.id === c.id);
  if (format === 'spec') {
    // Постранично по квестам: большая глава не влезает в один ответ; merge в quest_chapter_put примет и часть
    const spec = chapterSpec(c, book.lang.ru_ru ?? {});
    const offset = Math.max(0, Number(a.offset ?? 0) | 0);
    const limit = Math.max(1, Math.min(200, Number(a.limit ?? 200) | 0));
    const all = a.quest
      ? spec.quests.filter((q, i) => q.id === a.quest || norm(c.quests[i].title).includes(norm(a.quest)))
      : spec.quests;
    // страница кончается и по limit, и по объёму ответа
    const part = [];
    let size = 0;
    for (const q of all.slice(offset, offset + limit)) {
      const n = JSON.stringify(q, null, 1).length;
      if (part.length && size + n > MAX - 2000) break;
      part.push(q);
      size += n;
    }
    const more = offset + part.length < all.length ? `; дальше: offset=${offset + part.length}` : '';
    const head = `// квесты ${offset + 1}–${offset + part.length} из ${all.length}${more}; mode merge — можно отдавать по частям`;
    return clip(`${head}\n${JSON.stringify({ ...spec, quests: part }, null, 1)}`);
  }
  if (format === 'snbt') {
    const keys = [
      `chapter.${c.id}.`,
      ...c.quests.flatMap((q) => [`quest.${q.id}.`, ...q.tasks.map((t) => `task.${t.id}.`)]),
    ];
    const ru = Object.entries(book.lang.ru_ru ?? {}).filter(([k]) => keys.some((p) => k.startsWith(p)));
    return clip(
      `${raw.file}\n${stringifySnbt(raw.node)}\n\nlang/ru_ru.snbt (${ru.length} строк этой главы):\n${stringifySnbt(Object.fromEntries(ru))}`,
    );
  }
  const idx = questIndex(book);
  const group = book.view.groups.find((g) => g.id === c.group);
  const quests = a.quest ? c.quests.filter((q) => q.id === a.quest || norm(q.title).includes(norm(a.quest))) : c.quests;
  if (a.quest && !quests.length) return `В главе «${c.title}» нет квеста «${a.quest}».`;
  const xs = c.quests.map((q) => q.x);
  const ys = c.quests.map((q) => q.y);
  const head = [
    `Глава «${c.title}» [${c.id}] — ${c.quests.length} кв.; файл ${path.relative(path.dirname(MODS), raw.file).startsWith('..') ? raw.file : path.join(REL, 'chapters', `${c.filename}.snbt`)}`,
    `группа: ${group?.title || 'без группы'}${c.group ? ` [${c.group}]` : ''}; порядок ${c.order}${c.icon ? `; иконка ${named(c.icon)}` : ''}`,
    c.quests.length
      ? `поле: x ${Math.min(...xs)}…${Math.max(...xs)}, y ${Math.min(...ys)}…${Math.max(...ys)} (шаг сетки обычно 1–1.5)`
      : '',
    raw.file.startsWith(overlay ?? '\0') ? `(из оверлея ${overlay})` : '',
  ].filter(Boolean);
  return clip(`${head.join('\n')}\n${page(quests, a, (q) => questLines(q, idx, !!a.quest), 200)}`);
}

// ---------------------------------------------------------------- quest_chapter_put

function questChapterPut(a) {
  const overlay = overlayOf(a) ?? DEFAULT_OVERLAY;
  const spec = typeof a.spec === 'string' ? JSON.parse(a.spec) : a.spec;
  if (!spec || typeof spec !== 'object') throw new Error('spec: объект главы (см. описание)');
  const book = loadBook(overlay);

  const target = a.chapter ? findChapter(book, a.chapter) : null;
  if (!target && spec.filename && book.view.chapters.some((c) => c.filename === spec.filename))
    throw new Error(`глава ${spec.filename} уже есть — передайте chapter=${spec.filename}, чтобы править её`);
  const raw = target ? book.chapters.find((x) => x.node.id === target.id) : null;

  // Все id книги: новые не должны совпасть ни с чем
  const takenIds = new Set();
  const questIds = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.id === 'string' && /^[0-9A-F]{16}$/.test(v.id)) takenIds.add(v.id);
      Object.values(v).forEach(walk);
    }
  };
  for (const c of book.chapters) {
    walk(c.node);
    for (const q of c.node.quests ?? []) questIds.add(q.id);
  }
  const itemIds = items().byId;
  const knownItem = (id) => (id.startsWith('#') ? !!getTag('item', id.slice(1)) : itemIds.has(id));
  const groups = new Map(book.view.groups.filter((g) => g.id).map((g) => [g.id, g.title]));
  if (!target && spec.order === undefined) {
    const inGroup = book.view.chapters.filter((c) => c.group === (spec.group ?? ''));
    spec.order = inGroup.length ? Math.max(...inGroup.map((c) => c.order)) + 1 : 0;
  }

  const res = applyChapterSpec(raw?.node ?? null, book.lang, spec, { takenIds, questIds, knownItem, groups });
  const filename = String(res.chapter.filename);
  const files = [];
  const write = (rel, node) => {
    const file = path.join(overlay, REL, rel);
    files.push(path.relative(overlay, file));
    if (a.dryRun) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${stringifySnbt(node)}\n`);
  };
  write(path.join('chapters', `${filename}.snbt`), res.chapter);
  // Переименовали файл главы — старый в оверлее убрать
  if (raw && raw.node.filename !== filename && raw.file.startsWith(overlay) && !a.dryRun) fs.rmSync(raw.file);
  for (const [loc, table] of Object.entries(res.lang)) write(path.join('lang', `${loc}.snbt`), table);

  const texts = questTexts({ ...book.lang, ...res.lang }, 'ru_ru');
  const view = chapterOf(res.chapter, texts);
  const out = [
    `${a.dryRun ? 'Пробно (dryRun), ничего не записано' : `Записано в оверлей ${overlay}`}: ${files.join(', ')}`,
    `Глава «${view.title}» [${view.id}] — ${view.quests.length} кв.; добавлено ${res.added.length}, изменено ${res.updated.length}, удалено ${res.removed.length}.`,
  ];
  if (Object.keys(res.refs).length)
    out.push(
      `Новые id: ${Object.entries(res.refs)
        .map(([r, id]) => `${r}=${id}`)
        .join(', ')}`,
    );
  if (res.warnings.length) out.push('Внимание:', ...res.warnings.map((w) => `  • ${w}`));
  if (!a.dryRun)
    out.push(
      'Дальше: quest_chapter chapter=… overlay=… — проверить текст; pack_devserver overlay=<оверлей> — сервер сборки прочтёт книгу (ошибки FTB Quests в логе);',
      `хосту — npm run tfc -- admin propose ${overlay} --note "…". Языковые файлы в оверлее — целиком, на основе текущих из сборки.`,
    );
  return clip(out.join('\n'));
}

// ---------------------------------------------------------------- описания

const overlayArg = str(
  `overlay folder (game-dir layout: config/ftbquests/quests/…) read over the pack; default for quest_chapter_put — ${DEFAULT_OVERLAY}`,
);

export const TOOLS = [
  {
    name: 'quests_list',
    description:
      'FTB Quests book of the pack (the in-game quest book): without query — chapter groups and chapters (title, quest count, filename, id); with query — quests whose title/description/task items match (all words; item names included). Texts in Russian (English fallback).',
    inputSchema: {
      type: 'object',
      properties: { query: str('search words'), overlay: overlayArg, ...paging },
    },
    handler: questsList,
  },
  {
    name: 'quest_chapter',
    description:
      'One FTB Quests chapter. format=text (default): every quest with id, x/y, dependencies (titles), tasks (items with names, tags, filters), rewards, short description (quest= — one quest, full text); format=spec — JSON in the quest_chapter_put format (existing quests/tasks with ids: edit and put back); format=snbt — raw chapter file plus its ru_ru lang lines.',
    inputSchema: {
      type: 'object',
      properties: {
        chapter: str('chapter id, filename or part of the title'),
        quest: str('only this quest: id or part of the title'),
        format: { type: 'string', enum: ['text', 'spec', 'snbt'], description: 'text (default), spec or snbt' },
        overlay: overlayArg,
        ...paging,
      },
      required: ['chapter'],
    },
    handler: questChapter,
  },
  {
    name: 'quest_chapter_put',
    description: [
      'Create or edit an FTB Quests chapter into an overlay folder (not the pack): writes config/ftbquests/quests/chapters/<filename>.snbt and the whole lang/ru_ru.snbt (+ en_us.snbt if en texts given) = pack file + your lines. Validates item ids/tags against the pack, dependencies, overlaps; prints new ids. Then check with pack_devserver overlay=… and hand the folder to the host (tfc admin propose).',
      'spec: {filename (new chapter, a-z0-9_), title, subtitle, group (chapter group id from quests_list), icon (item), order, mode: merge (default; listed quests added/updated, others kept, remove:[ids]) | replace (chapter = exactly these quests),',
      'quests: [{id (existing) | ref (new, any label for deps), title, subtitle, desc (string or lines), x, y (grid units; neighbours ~1.5 apart), size, shape, icon, deps: [ids or refs, other chapters allowed], depMode: all|one, optional,',
      'tasks: [{id (existing; only id = keep as is) | new: item:"mod:id"|"#tag" or items:[…] (any of), count, title, optional; type:"checkmark" (title); type:"advancement", advancement, criterion}],',
      'rewards: [{xp:N} | {item, count} | {id} keep]}]}. Text fields: string = Russian, or {ru, en}. Existing quests keep fields the spec does not mention. Start from quest_chapter format=spec to edit.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'object', description: 'chapter spec (see description)' },
        chapter: str('existing chapter to edit: id, filename or title; omit to create a new one'),
        overlay: overlayArg,
        dryRun: { type: 'boolean', description: 'validate and report, write nothing' },
      },
      required: ['spec'],
    },
    handler: questChapterPut,
  },
];
