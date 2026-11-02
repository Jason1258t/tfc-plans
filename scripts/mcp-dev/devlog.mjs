/**
 * Журнал и документы задач разработки для tfc-plans-dev: dev_log, dev_find, dev_doc_get/edit/append/list (dev #193,
 * сервер — server/pack-server/lib/dev-log.mjs). Ссылки в выводе — по договору: #175, note:881, doc:12#Раздел.
 */
const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });
const day = (t) => new Date(t).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

const NOTE_LABEL = { status: ' [статус]', report: ' [отчёт]' };

/** Запись журнала одной строкой; clip — обрезать длинный текст (полный — dev_log) */
export function noteLine(n, clip) {
  const long = clip && n.text.length > clip;
  const text = long
    ? `${n.text.slice(0, clip)}… (полностью — dev_log id=${n.task} before=${n.id + 1} limit=1)`
    : n.text;
  return `- note:${n.id} ${day(n.createdAt)} ${n.author}${NOTE_LABEL[n.kind] ?? ''}: ${text}`;
}

/** Инструмент со строгой проверкой: неизвестное поле или пропущенное обязательное — ошибка с подсказкой */
function tool(name, description, properties, required, handler, hints = {}) {
  const strict = (a) => {
    for (const k of Object.keys(a)) {
      if (properties[k]) continue;
      const hint = hints[k] ? ` Вместо него — ${hints[k]}.` : '';
      throw new Error(`${name}: неизвестное поле ${k}.${hint} Есть: ${Object.keys(properties).join(', ')}`);
    }
    for (const k of required) if (a[k] === undefined) throw new Error(`${name}: ${k} — обязательное поле`);
    return handler(a);
  };
  return { name, description, inputSchema: { type: 'object', properties, required }, handler: strict };
}

const query = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Инструменты журнала и документов; api — запрос к /dev/… из devtasks.mjs */
export function logTools(api) {
  async function devLog(a) {
    const r = await api(
      'GET',
      `tasks/${a.id}/notes${query({ before: a.before, limit: a.limit, kind: a.kind, q: a.query })}`,
    );
    const filtered = a.kind || a.query ? `, подходит ${r.matched}` : '';
    const head = `Журнал #${a.id}: записей ${r.total}${filtered}, показано ${r.notes.length}`;
    if (!r.notes.length) return `${head}.`;
    const more = r.nextBefore ? `\nРаньше ещё ${r.left} — before=${r.nextBefore}.` : '';
    return `${head}:\n${r.notes.map((n) => noteLine(n)).join('\n')}${more}`;
  }

  async function devFind(a) {
    const r = await api('GET', `find${query({ q: a.query, kinds: a.kinds, limit: a.limit })}`);
    if (!r.total) return `По запросу «${a.query}» ничего нет.`;
    const row = (h) => {
      const task = h.task ? `#${h.task}` : 'без задачи';
      const where =
        h.kind === 'task'
          ? `${h.status} «${h.title}»`
          : h.kind === 'note'
            ? `${task} «${h.title}», ${h.author}${NOTE_LABEL[h.noteKind] ?? ''}, ${day(h.at)}`
            : `«${h.title}», ${task}, строка ${h.line}`;
      return `- ${h.ref} (${where}): ${h.snippet}`;
    };
    const { task, note, doc } = r.counts;
    const more = r.total > r.results.length ? ` Показано ${r.results.length} — больше: limit.` : '';
    return `Найдено ${r.total}: задач ${task}, записей ${note}, документов ${doc}.${more}\n${r.results.map(row).join('\n')}`;
  }

  async function devDocGet(a) {
    const r = await api('GET', `docs/${a.id}/read${query({ heading: a.heading, offset: a.offset, limit: a.limit })}`);
    const d = r.doc;
    const out = [
      `doc:${d.id} «${d.title}» · задача ${d.task ? `#${d.task}` : '—'} · rev ${d.rev} · ${d.author}, ${day(d.updatedAt)}`,
    ];
    if (r.outline.length)
      out.push(
        `Оглавление (${r.total} строк):\n${r.outline.map((h) => `${'  '.repeat(h.level - 1)}${h.text} — строка ${h.line + 1}`).join('\n')}`,
      );
    if (r.heading) out.push(`Раздел «${r.heading}», строки ${r.from + 1}–${r.to}:`);
    out.push(r.lines.join('\n'));
    if (r.to < r.end) out.push(`… строки ${r.from + 1}–${r.to} из ${r.total}; дальше — offset=${r.offset}`);
    return out.join('\n\n');
  }

  async function devDocEdit(a) {
    const r = await api('POST', `docs/${a.id}/edit`, { old: a.old, new: a.new });
    return r.changed
      ? `doc:${r.doc.id} «${r.doc.title}»: заменено на строке ${r.line} (rev ${r.doc.rev}, ${r.doc.size} симв.).`
      : `doc:${r.doc.id}: new совпадает с old, ничего не изменилось (rev ${r.doc.rev}).`;
  }

  async function devDocAppend(a) {
    const r = await api('POST', `docs/${a.id}/append`, { text: a.text, heading: a.heading });
    const where = a.heading ? `в конец раздела «${a.heading}»` : 'в конец';
    return `doc:${r.doc.id} «${r.doc.title}»: дописано ${where}, строка ${r.line} (rev ${r.doc.rev}, ${r.doc.size} симв.).`;
  }

  async function devDocList(a) {
    const { docs } = await api('GET', `docs${query({ task: a.task, q: a.query })}`);
    if (!docs.length) return 'Документов не найдено.';
    const row = (d) =>
      `- doc:${d.id} «${d.title}» · ${d.task ? `#${d.task}` : 'без задачи'} · ${d.size} симв. · rev ${d.rev} · ${d.author}, ${day(d.updatedAt)}`;
    return `Документов: ${docs.length}\n${docs.map(row).join('\n')}`;
  }

  return [
    tool(
      'dev_log',
      'Work log of a dev task, page by page: entries are note:<id>, oldest of the page first. Older page — before=<id from the footer>. Whole text of every entry.',
      {
        id: int('task number'),
        before: { type: ['integer', 'string'], description: 'only entries older than this id (881 or note:881)' },
        limit: int('entries per page (20, up to 200)'),
        kind: str('comma list of note,status,report'),
        query: str('words in the entry text, all must match'),
      },
      ['id'],
      devLog,
      { offset: 'before', text: 'query', q: 'query', notes: 'limit' },
    ),
    tool(
      'dev_find',
      'Search dev tasks, work-log entries and plan docs at once (zero Firestore reads): all words must match, case and ё ignored. Each hit — a link (#175, note:881, doc:12#Section) and a short excerpt. Status-change entries are skipped.',
      {
        query: str('words'),
        kinds: str('comma list of task,note,doc (all by default)'),
        limit: int('results (20, up to 100)'),
      },
      ['query'],
      devFind,
      { q: 'query', text: 'query', kind: 'kinds' },
    ),
    tool(
      'dev_doc_get',
      'Dev plan doc: outline with line numbers, rev and lines. heading — only that section (with subsections; doc:12#Этап 2 → heading="Этап 2"); offset and limit then count inside it. Outline line numbers start at 1, offset at 0.',
      {
        id: int('doc id'),
        heading: str('section heading text'),
        offset: int('first line (0)'),
        limit: int('lines (400)'),
      },
      ['id'],
      devDocGet,
      { section: 'heading' },
    ),
    tool(
      'dev_doc_edit',
      'Write: replace one fragment of a plan doc, no rev needed. old must occur exactly once, otherwise an error says where it occurs; new may be empty to delete.',
      {
        id: int('doc id'),
        old: str('exact fragment to replace'),
        new: str('replacement'),
      },
      ['id', 'old', 'new'],
      devDocEdit,
      { old_string: 'old', new_string: 'new', baseRev: 'ничего: rev здесь не нужен', content: 'old и new' },
    ),
    tool(
      'dev_doc_append',
      'Write: add text to the end of a plan doc or of a section (before the next heading of the same or higher level), no rev needed.',
      {
        id: int('doc id'),
        text: str('markdown to add'),
        heading: str('section heading text; end of the doc by default'),
      },
      ['id', 'text'],
      devDocAppend,
      { section: 'heading', content: 'text', baseRev: 'ничего: rev здесь не нужен' },
    ),
    tool(
      'dev_doc_list',
      'List dev plan docs: of a task ("-" — without a task), with words in the title or text; newest change first.',
      {
        task: { type: ['integer', 'string'], description: 'task number or "-"' },
        query: str('words in title or text'),
      },
      [],
      devDocList,
      { id: 'task', q: 'query' },
    ),
  ];
}
