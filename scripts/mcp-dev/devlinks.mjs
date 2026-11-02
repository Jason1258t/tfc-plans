/**
 * Связи задач разработки для tfc-plans-dev: dev_open открывает что угодно по ссылке и показывает обратные связи,
 * dev_link и dev_unlink — явные связи. Сервер — server/pack-server/lib/dev-links.mjs.
 */
import { api } from './devtasks.mjs';

const KIND_RU = { mention: 'упоминает', related: 'связано с', blocks: 'блокирует' };
const KIND_BACK = { mention: 'упомянут в', related: 'связано с', blocks: 'блокируется' };
const BLOCK_LIMIT = 30;
const OPEN_TEXT = 4000;

/** «#175.3 «текст»», битая ссылка помечена */
function shown(x) {
  const mark = x.broken ? ` (битая${x.note ? `: ${x.note}` : ''})` : x.removed ? ' (пункт удалён)' : '';
  return `${x.ref}${x.label ? ` «${x.label}»` : ''}${mark}`;
}

/** Короткий блок связей для dev_get */
export function linksBlock(links) {
  if (!links?.length) return [];
  const lines = links.slice(0, BLOCK_LIMIT).map((l) => `- ${l.source.ref} ${KIND_RU[l.kind]} ${shown(l.target)}`);
  if (links.length > BLOCK_LIMIT) lines.push(`… ещё ${links.length - BLOCK_LIMIT}: dev_open по пункту или документу`);
  return ['', `Связи (${links.length}, открыть — dev_open):`, ...lines];
}

function linkedBlock({ out, in: inc }) {
  const lines = [];
  if (out.length) lines.push('', 'Ссылается на:', ...out.map((l) => `- ${KIND_RU[l.kind]} ${shown(l.target)}`));
  if (inc.length)
    lines.push('', 'Обратные связи:', ...inc.map((l) => `- ${KIND_BACK[l.kind]} ${shown(l.source)} → ${l.target.ref}`));
  if (!lines.length) lines.push('', 'Связей нет.');
  return lines;
}

const clip = (s, max) => (s.length > max ? `${s.slice(0, max)}\n… ещё ${s.length - max} симв.` : s);
const taskLine = (t) => `Задача #${t.id} «${t.title}» (${t.status})`;

function openText(r) {
  if (r.type === 'task') {
    const t = r.task;
    const out = [
      `${r.ref} ${t.title}`,
      `${t.status} · ${t.assignee ?? 'без исполнителя'} · ветка ${t.branch ?? '—'} · rev ${t.rev}`,
    ];
    if (t.body) out.push('', clip(t.body, 800));
    if (t.checklist.length) {
      out.push('', 'Чек-лист:');
      t.checklist.forEach((c, i) => out.push(`- #${t.id}.${c.num ?? i + 1} [${c.done ? 'x' : ' '}] ${c.text}`));
    }
    if (r.docs.length) out.push('', 'Документы:', ...r.docs.map((d) => `- doc:${d.id} «${d.title}» (${d.size} симв.)`));
    if (r.notes.length)
      out.push(
        '',
        `Журнал (последние ${r.notes.length} из ${r.noteCount}):`,
        ...r.notes.map((n) => `- note:${n.id} ${n.author}: ${clip(n.text, 200)}`),
      );
    return out;
  }
  if (r.type === 'check')
    return [
      `${r.ref} [${r.check.done ? 'x' : ' '}]${r.check.removed ? ' (удалён)' : ''} ${r.check.text}`,
      taskLine(r.task),
    ];
  if (r.type === 'note')
    return [`${r.ref} ${r.note.author} [${r.note.kind}]`, taskLine(r.task), '', clip(r.note.text, OPEN_TEXT)];
  const head = [
    `${r.ref} «${r.doc.title}» · задача ${r.doc.task ? `#${r.doc.task}` : '—'} · rev ${r.doc.rev} · ${r.doc.size} симв.`,
  ];
  if (r.section) return [...head, '', clip(r.text, OPEN_TEXT)];
  if (r.toc.length)
    head.push('', 'Разделы:', ...r.toc.map((h) => `${'  '.repeat(h.level - 1)}- doc:${r.doc.id}#${h.text}`));
  return [...head, '', clip(r.text, 1000), r.text.length > 1000 ? 'Весь текст — dev_doc_get.' : ''];
}

async function devOpen(a) {
  const r = await api('GET', `open?ref=${encodeURIComponent(a.ref)}`);
  return [...openText(r), ...linkedBlock(r.linked)].join('\n').trimEnd();
}

async function devLink(a) {
  await api('POST', 'links', { from: a.from, to: a.to, kind: a.kind ?? 'related' });
  return `Связь добавлена: ${a.from} ${KIND_RU[a.kind ?? 'related']} ${a.to}.`;
}

async function devUnlink(a) {
  const p = new URLSearchParams({ from: a.from, to: a.to, kind: a.kind ?? 'related' });
  await api('DELETE', `links?${p}`);
  return `Связь снята: ${a.from} → ${a.to}.`;
}

const REF = '#175, #175.3, doc:12, doc:12#Раздел or note:881';
const LINK_SCHEMA = {
  type: 'object',
  properties: {
    from: { type: 'string', description: REF },
    to: { type: 'string', description: REF },
    kind: { type: 'string', enum: ['related', 'blocks'], description: 'default related; blocks: from blocks to' },
  },
  required: ['from', 'to'],
};

export const DEV_LINK_TOOLS = [
  {
    name: 'dev_open',
    description: `Open anything by ref (${REF}): short content plus outgoing and incoming links. Refs in the text are indexed by the server; a broken one is marked.`,
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: REF } },
      required: ['ref'],
    },
    handler: devOpen,
  },
  {
    name: 'dev_link',
    description:
      'Write: explicit link between two existing objects, also to relate a doc to one more task (docs.task stays the main one). Mentions in text need no call.',
    inputSchema: LINK_SCHEMA,
    handler: devLink,
  },
  {
    name: 'dev_unlink',
    description: 'Write: remove an explicit link. A mention goes away with the text.',
    inputSchema: LINK_SCHEMA,
    handler: devUnlink,
  },
];
