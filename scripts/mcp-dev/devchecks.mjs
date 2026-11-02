/**
 * Короткие команды трекера: dev_check (пункты чек-листа), dev_start, dev_finish — все без baseRev.
 * Сервер — server/pack-server/lib/dev-checks.mjs. api передаётся извне, чтобы не было цикла с devtasks.mjs.
 */

const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });
const flag = (description) => ({ type: 'boolean', description });
const numList = (description) => ({ type: 'array', items: { type: ['integer', 'string'] }, description });

/** Номера пунктов: 2, "2" или "#192.2" этой же задачи; всё остальное — ошибка */
function toNums(v, name, taskId) {
  if (v === undefined) return undefined;
  return (Array.isArray(v) ? v : [v]).map((x) => {
    const m = typeof x === 'string' ? x.trim().match(/^(?:#(\d+)\.)?(\d+)$/) : null;
    if (Number.isInteger(x)) return x;
    if (!m || (m[1] !== undefined && Number(m[1]) !== taskId))
      throw new Error(`${name}: «${x}» — не номер пункта задачи #${taskId}. Пример: [2, 3]`);
    return Number(m[2]);
  });
}

const progress = (list) => `${list.filter((c) => c.done).length}/${list.length}`;
const openItems = (list) => list.filter((c) => !c.done).map((c) => `${c.num ?? '—'}. ${c.text}`);

function summary(applied) {
  const parts = [
    ['отмечено', applied.done],
    ['снято', applied.undone],
    ['добавлено', applied.added],
    ['убрано', applied.removed],
    ['изменено', applied.edited],
    ['перемещено', applied.moved],
  ].filter(([, list]) => list.length);
  return parts.length ? parts.map(([name, list]) => `${name}: ${list.join(', ')}`).join('; ') : 'пункты без изменений';
}

export function checkTools({ api, line }) {
  async function devCheck(a) {
    const body = {};
    for (const k of ['done', 'undone', 'remove']) {
      const list = toNums(a[k], k, a.id);
      if (list) body[k] = list;
    }
    for (const k of ['add', 'edit', 'move', 'note']) if (a[k] !== undefined) body[k] = a[k];
    const r = await api('POST', `tasks/${a.id}/checks`, body);
    const list = r.task.checklist;
    const left = openItems(list);
    return [
      `#${a.id} ${summary(r.applied)}. Готово ${progress(list)}.`,
      ...(left.length ? ['Осталось:', ...left] : ['Все пункты закрыты.']),
    ].join('\n');
  }

  async function devStart(a) {
    const body = {};
    for (const k of ['branch', 'reopen', 'takeover', 'note']) if (a[k] !== undefined) body[k] = a[k];
    const r = await api('POST', `tasks/${a.id}/start`, body);
    const left = openItems(r.task.checklist);
    return [
      `В работе: ${line({ ...r.task, notes: r.noteCount, docs: r.docs.length })}`,
      ...(left.length ? [`Пункты (${progress(r.task.checklist)}):`, ...left] : []),
    ].join('\n');
  }

  async function devFinish(a) {
    const body = { report: a.report };
    for (const k of ['status', 'takeover']) if (a[k] !== undefined) body[k] = a[k];
    const r = await api('POST', `tasks/${a.id}/finish`, body);
    const left = openItems(r.task.checklist);
    return [
      `Закрыта: ${line({ ...r.task, notes: r.noteCount, docs: r.docs.length })}`,
      ...(left.length
        ? [`Внимание, не отмечены пункты (${left.length}) — отметьте или уберите через dev_check:`, ...left]
        : []),
    ].join('\n');
  }

  return [
    {
      name: 'dev_check',
      description:
        'Write: change checklist items by their numbers (no baseRev, other fields untouched). Numbers come from dev_get and never shift. All passed changes apply together or not at all.',
      inputSchema: {
        type: 'object',
        properties: {
          id: int('task number'),
          done: numList('item numbers to mark done, e.g. [2, 3]'),
          undone: numList('item numbers to unmark'),
          add: {
            type: 'array',
            items: {},
            description: 'new items: strings or { text, done, after }; after — item number, 0 = first',
          },
          remove: numList('item numbers to remove'),
          edit: { type: 'array', items: {}, description: '[{ num, text }]' },
          move: { type: 'array', items: {}, description: '[{ num, after }]; after — item number, 0 = first' },
          note: str('work-log entry added with this change'),
        },
        required: ['id'],
      },
      handler: devCheck,
    },
    {
      name: 'dev_start',
      description:
        'Write: start work (no baseRev): status doing, assignee = you, branch. Refuses a task another agent is working on and a closed task.',
      inputSchema: {
        type: 'object',
        properties: {
          id: int('task number'),
          branch: str('git branch, e.g. feat/dev-tracker'),
          reopen: flag('allow reopening a closed task'),
          takeover: flag("take another agent's task; only after the user said so"),
          note: str('work-log entry added with this change'),
        },
        required: ['id'],
      },
      handler: devStart,
    },
    {
      name: 'dev_finish',
      description:
        'Write: close a task (no baseRev) with a final Russian report: what changed for players, what was checked, what not. Lists items still not done.',
      inputSchema: {
        type: 'object',
        properties: {
          id: int('task number'),
          report: str('final report'),
          status: { type: 'string', enum: ['done', 'dropped'], description: 'default done' },
          takeover: flag("close another agent's task; only after the user said so"),
        },
        required: ['id', 'report'],
      },
      handler: devFinish,
    },
  ];
}
