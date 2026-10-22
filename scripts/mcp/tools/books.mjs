/**
 * Инструменты MCP: внутриигровые книги сборки — руководство TFC (Patchouli, с дополнениями аддонов и KubeJS) и
 * справочник Immersive Engineering. Индекс — books-index.mjs.
 */
import { clip, norm, page, paging, short, str, words } from '../fmt.mjs';
import { booksIndex, entryPages, entryText, itemRef } from './books-index.mjs';

const KIND = { patchouli: 'Patchouli', ie: 'справочник IE' };

const langOf = (a) => (/^en/i.test(String(a.lang ?? '')) ? 'en_us' : 'ru_ru');

function findBooks(q) {
  const all = [...booksIndex().books.values()];
  const s = norm(String(q ?? '').trim());
  if (!s) return all;
  const exact = all.filter((b) => b.id === s);
  if (exact.length) return exact;
  const alias = s === 'ie' ? 'immersiveengineering' : s === 'tfc' || s === 'field guide' ? 'field_guide' : s;
  const hits = all.filter((b) => b.id.includes(alias) || norm(b.title).includes(alias));
  if (!hits.length) throw new Error(`книга «${q}» не найдена; есть: ${all.map((b) => b.id).join(', ')}`);
  return hits;
}

const title = (e, l) => (l === 'en_us' && e.en ? e.en : e.name);
const catName = (b, id) => b.categories.get(id)?.name ?? (id || '—');
const usedLang = (e, l) => (e.variants[l] ? l : e.variants.ru_ru ? 'ru_ru' : 'en_us');
const layerOf = (e, l) => {
  const v = e.variants[usedLang(e, l)];
  return v.layer.mod ? `${v.layer.mod} — ${v.layer.label}` : v.layer.label;
};

// ---------------------------------------------------------------- books_list

function booksList(a) {
  const idx = booksIndex();
  const books = findBooks(a.book);
  if (!a.book) {
    const out = books.map((b) => {
      const ru = b.entries.filter((e) => e.variants.ru_ru).length;
      const by = new Map();
      for (const e of b.entries) {
        const v = e.variants.ru_ru ?? e.variants.en_us;
        const k = v.layer.mod ?? v.layer.label;
        by.set(k, (by.get(k) ?? 0) + 1);
      }
      const src = [...by].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} (${n})`);
      return [
        `• ${b.id} — «${b.title}» [${KIND[b.kind]}${b.version ? ` ${b.version}` : ''}]: категорий ${b.categories.size}, статей ${b.entries.length} (по-русски ${ru}, только англ. ${b.entries.length - ru})`,
        `  языки: ${[...b.langs].sort().join(', ')}`,
        `  статьи из: ${src.join(', ')}`,
      ];
    });
    return [
      ...out.flat(),
      `Слоёв с файлами книг: ${idx.layers.length} (jar, затем KubeJS и ресурспаки сборки — верхний заменяет нижний); индекс построен за ${idx.ms} мс.`,
      'Оглавление книги: books_list с book; поиск — book_search; статья — book_entry.',
    ].join('\n');
  }
  const l = langOf(a);
  const groups = [];
  for (const b of books) {
    const byCat = new Map();
    for (const e of b.entries) {
      if (!byCat.has(e.cat)) byCat.set(e.cat, []);
      byCat.get(e.cat).push(e);
    }
    const cats = [...b.categories.keys(), ...[...byCat.keys()].filter((c) => !b.categories.has(c))];
    for (const c of cats) {
      const list = byCat.get(c) ?? [];
      if (a.category && !norm(`${c} ${catName(b, c)}`).includes(norm(a.category))) continue;
      if (!list.length && !a.category) continue;
      groups.push({ b, c, list });
    }
  }
  return page(
    groups,
    a,
    ({ b, c, list }) => {
      const cat = b.categories.get(c);
      return [
        `## ${b.id} › ${c || '(без категории)'} — «${catName(b, c)}»${cat?.parent ? ` (внутри ${cat.parent})` : ''}: ${list.length}`,
        ...list.map((e) => {
          const ul = usedLang(e, l);
          return `  ${e.id} — ${title(e, l)}${e.en && l !== 'en_us' ? ` / ${e.en}` : ''}${ul !== l ? ` [${ul}]` : ''}`;
        }),
      ];
    },
    30,
  );
}

// ---------------------------------------------------------------- book_search

function snippets(text, ws, n = 3) {
  const out = [];
  for (const line of text.split('\n')) {
    const low = norm(line);
    const pos = Math.min(...ws.map((w) => low.indexOf(w)).filter((p) => p >= 0));
    if (!Number.isFinite(pos)) continue;
    const from = Math.max(0, pos - 80);
    out.push(`${from ? '…' : ''}${short(line.slice(from), 220)}`);
    if (out.length >= n) break;
  }
  return out;
}

/** Основа русского слова: «крица» найдёт и «крицы», «крицу» (окончания отбрасываются у слов от 5 букв) */
const stem = (w) =>
  /^[а-я]{5,}$/.test(w)
    ? w.replace(/(ами|ями|ого|его|ому|ему|ой|ей|ий|ый|ая|яя|ое|ее|ом|ем|ов|ев|ах|ях|ам|ям|[аяоеиыуюйь])$/, '')
    : w;

function bookSearch(a) {
  const ws = words(a.query).map(stem);
  if (!ws.length) return 'Пустой запрос.';
  const l = langOf(a);
  const lang = booksIndex().lang;
  const hits = [];
  for (const b of findBooks(a.book))
    for (const e of b.entries) {
      if (a.category && !norm(`${e.cat} ${catName(b, e.cat)}`).includes(norm(a.category))) continue;
      const text = entryText(e, l, lang);
      const low = norm(text);
      if (!ws.every((w) => low.includes(w))) continue;
      const title = norm(`${e.name} ${e.en ?? ''} ${e.id}`);
      let score = 0;
      for (const w of ws) {
        if (title.includes(w)) score += 50;
        score += Math.min(20, low.split(w).length - 1);
      }
      hits.push({ e, b, score, text });
    }
  hits.sort((x, y) => y.score - x.score);
  return page(hits, a, ({ e, b, text }) => [
    `• ${b.id} › ${e.id} — «${title(e, l)}» (${catName(b, e.cat)})${usedLang(e, l) !== l ? ` [${usedLang(e, l)}]` : ''}`,
    ...snippets(
      text
        .split('\n')
        .slice(e.sub ? 2 : 1)
        .join('\n'),
      ws,
    ).map((s) => `  ${s.trim()}`),
  ]);
}

// ---------------------------------------------------------------- book_entry

function findEntry(a) {
  const raw = String(a.id ?? '').trim();
  if (!raw) throw new Error('не указана статья (id или название)');
  const [q, anchor] = raw.split('#');
  const books = findBooks(a.book);
  const all = books.flatMap((b) => b.entries);
  const bareId = q.replace(/^[^:]+:/, '');
  let hits = all.filter((e) => e.id === q || `${e.ns}:${e.id}` === q);
  if (!hits.length) hits = all.filter((e) => e.id === bareId || e.id.replace(/^[^:]+:/, '') === bareId);
  if (!hits.length) {
    const s = norm(q);
    hits = all.filter((e) => norm(e.name) === s || norm(e.en ?? '') === s);
    if (!hits.length) hits = all.filter((e) => norm(`${e.name} ${e.en ?? ''} ${e.id}`).includes(s));
  }
  return { hits, anchor };
}

function bookEntry(a) {
  const { hits, anchor } = findEntry(a);
  if (!hits.length) return `Статья «${a.id}» не найдена. Искать: book_search, оглавление — books_list с book.`;
  if (hits.length > 1)
    return [
      `Подходят несколько статей (${hits.length}) — уточните id (или book):`,
      ...hits.slice(0, 30).map((e) => `  ${e.book.id} › ${e.id} — ${e.name}`),
      ...(hits.length > 30 ? ['  …'] : []),
    ].join('\n');
  const e = hits[0];
  const b = e.book;
  const l = langOf(a);
  const ul = usedLang(e, l);
  const lang = booksIndex().lang;
  const pages = entryPages(e, ul, lang);
  const head = [
    `${b.id} «${b.title}» › ${e.cat || '(без категории)'} «${catName(b, e.cat)}» › ${e.id}`,
    `«${e.name}»${e.sub ? ` — ${e.sub}` : ''}${e.en && ul !== 'en_us' ? ` (англ. «${e.en}»)` : ''}`,
    `язык: ${ul}${ul !== l ? ` (на ${l} статьи нет)` : ''}; файл из: ${layerOf(e, ul)}${e.jsonLayer ? `; элементы: ${e.jsonLayer}` : ''}`,
  ];
  if (e.icon) head.push(`значок: ${/textures\//.test(e.icon) ? e.icon : itemRef(e.icon)}`);
  let args = a;
  if (anchor) {
    const n = pages.findIndex((p) =>
      p.some((x) => x.startsWith('[') && (x.includes(`#${anchor}]`) || x.includes(`#${anchor} `))),
    );
    head.push(n >= 0 ? `якорь #${anchor} — стр. ${n + 1}` : `якорь #${anchor} не найден`);
    if (n >= 0 && a.offset == null) args = { ...a, offset: n };
  }
  head.push('Ссылки в тексте — [→ статья#якорь], их можно передать в book_entry.');
  const body = page(pages, args, (p, i) => [`— стр. ${i + 1} —`, ...p], 100);
  return clip(`${head.join('\n')}\n${body.replace(/^Всего (\d+)/, 'Страниц $1')}`);
}

// ---------------------------------------------------------------- описания

const bookArg = str('book: id (tfc:field_guide, immersiveengineering:manual) or part of id/name; tfc, ie');
const langArg = str('language: ru (default; falls back to English) or en');

export const TOOLS = [
  {
    name: 'books_list',
    description:
      'In-game pack books: TFC field guide (Patchouli, with addon and pack KubeJS entries) and the Immersive Engineering manual (with addon sections). Without book — list of books (categories, entries, languages, entry sources); with book — table of contents: categories and entry ids.',
    inputSchema: {
      type: 'object',
      properties: {
        book: bookArg,
        category: str('only this category (id or part of the name)'),
        lang: langArg,
        ...paging,
      },
    },
    handler: booksList,
  },
  {
    name: 'book_search',
    description:
      'Full-text search in in-game book entries (all query words; Russian matched by stem; text in Russian, English where untranslated; recipes and items on pages with names). Answer: entry, category and matching lines.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('search words'),
        book: bookArg,
        category: str('only this category (id or part of the name)'),
        lang: langArg,
        ...paging,
      },
      required: ['query'],
    },
    handler: bookSearch,
  },
  {
    name: 'book_entry',
    description:
      'Whole in-game book entry as readable text: pages in order, links as [→ entry], keys and settings substituted, recipes/multiblocks/items — id with name and pack recipe status (removed by KubeJS etc.). Pages — offset/limit.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str(
          'entry id (metalworking/bloomery, tfc:metalworking/bloomery#anchor, immersiveengineering:arc_furnace) or title',
        ),
        book: bookArg,
        lang: langArg,
        limit: { type: 'integer', description: 'how many pages (default 100)' },
        offset: { type: 'integer', description: 'start page (for «дальше»)' },
      },
      required: ['id'],
    },
    handler: bookEntry,
  },
];
