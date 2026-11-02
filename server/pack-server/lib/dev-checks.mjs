/**
 * Чек-листы задач разработки: пункты — отдельные записи со стабильным номером внутри задачи (#175.3).
 * Договор с соседними задачами — план 42 в трекере, #192. Операция над пунктами — одна транзакция, без baseRev
 * и без смены rev задачи, поэтому агенты и страница не мешают друг другу. Номер не переиспользуется, удалённый пункт
 * остаётся строкой с removed_at, чтобы ссылка на него открывалась.
 * Старый формат — JSON в tasks.checklist. Не пустой JSON означает «ещё не перенесено»: так остаются закрытые задачи,
 * только для чтения. Переоткрытие или операция над пунктами переносит задачу сама.
 */
import { HttpError } from './util.mjs';

export const CHECKS_SCHEMA = `
create table if not exists checks (
  task_id integer not null references tasks(id) on delete cascade,
  num integer not null,
  position integer not null,
  text text not null,
  done integer not null default 0,
  done_at integer,
  done_by text,
  author text not null,
  created_at integer not null,
  updated_at integer not null,
  removed_at integer,
  primary key (task_id, num)
);
`;

const LIMITS = { items: 500, text: 500 };
const OPS = ['done', 'undone', 'add', 'remove', 'edit', 'move', 'note', 'by'];

const bad = (msg) => new HttpError(400, msg);

/** Неизвестное поле — ошибка: молча отброшенная отметка хуже отказа */
export function rejectUnknown(b, allowed, hints = {}) {
  const extra = Object.keys(b).filter((k) => !allowed.includes(k));
  if (!extra.length) return;
  const hint = extra.map((k) => hints[k]).filter(Boolean);
  throw bad(
    `Неизвестные поля: ${extra.join(', ')}. Можно: ${allowed.join(', ')}.${hint.length ? ` ${hint.join(' ')}` : ''}`,
  );
}

function itemText(v) {
  if (typeof v !== 'string' || !v.trim() || v.length > LIMITS.text)
    throw bad(`Текст пункта — не пустая строка до ${LIMITS.text} символов`);
  const s = v.trim();
  if (/^([-*]\s*)?\[[ xXхХ]?\]/.test(s))
    throw bad(`Отметка не пишется в текст («${s.slice(0, 40)}»): передайте { text, done } или отметьте пункт отдельно`);
  return s;
}

/** Пункт на входе: строка или { text, done }; done — только true/false */
export function parseItem(x, extra = []) {
  const it = typeof x === 'string' ? { text: x } : x;
  if (!it || typeof it !== 'object') throw bad('Пункт — строка или { text, done }');
  rejectUnknown(it, ['text', 'done', 'num', ...extra]);
  if (it.done !== undefined && typeof it.done !== 'boolean') throw bad('done у пункта — true или false, не строка');
  return { ...it, text: itemText(it.text) };
}

function parseList(v) {
  if (!Array.isArray(v) || v.length > LIMITS.items) throw bad(`checklist — список до ${LIMITS.items} пунктов`);
  return v.map((x) => parseItem(x));
}

function nums(v, name) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((n) => Number.isInteger(n) && n > 0))
    throw bad(`${name} — список номеров пунктов, например [2, 3]`);
  return [...new Set(v)];
}

const legacyItems = (r) => JSON.parse(r.checklist);

export function openChecks(db, tx) {
  const q = {
    items: db.prepare('select * from checks where task_id = ? and removed_at is null order by position, num'),
    one: db.prepare('select * from checks where task_id = ? and num = ?'),
    nextNum: db.prepare('select coalesce(max(num), 0) + 1 n from checks where task_id = ?'),
    nextPos: db.prepare('select coalesce(max(position), 0) + 1 n from checks where task_id = ? and removed_at is null'),
    insert: db.prepare(
      `insert into checks (task_id, num, position, text, done, done_at, done_by, author, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    setDone: db.prepare(
      'update checks set done = ?, done_at = ?, done_by = ?, updated_at = ? where task_id = ? and num = ?',
    ),
    setText: db.prepare('update checks set text = ?, updated_at = ? where task_id = ? and num = ?'),
    setPos: db.prepare('update checks set position = ? where task_id = ? and num = ?'),
    remove: db.prepare('update checks set removed_at = ?, updated_at = ? where task_id = ? and num = ?'),
    clearLegacy: db.prepare(`update tasks set checklist = '[]' where id = ?`),
    pending: db.prepare(`select * from tasks where checklist <> '[]' and status not in ('done', 'dropped')`),
    touch: db.prepare('update tasks set updated_at = ? where id = ?'),
  };

  const insert = (taskId, it, by, now) => {
    const done = it.done === true;
    const num = q.nextNum.get(taskId).n;
    q.insert.run(
      taskId,
      num,
      q.nextPos.get(taskId).n,
      it.text,
      done ? 1 : 0,
      done ? now : null,
      done ? by : null,
      by,
      now,
      now,
    );
    return num;
  };

  /** Перенос старого JSON в записи; без него ничего не делает. Кто и когда отметил — неизвестно, поэтому пусто */
  function migrate(row) {
    const old = legacyItems(row);
    if (!old.length) return;
    tx(() => {
      old.forEach((it) => {
        const num = q.nextNum.get(row.id).n;
        q.insert.run(
          row.id,
          num,
          q.nextPos.get(row.id).n,
          it.text,
          it.done ? 1 : 0,
          null,
          null,
          row.author,
          row.created_at,
          row.updated_at,
        );
      });
      q.clearLegacy.run(row.id);
    });
  }

  const pendingTasks = () => q.pending.all();

  /** Поля чек-листа для ответа API */
  function view(row) {
    const old = legacyItems(row);
    if (old.length) return { checklist: old, checklistLegacy: true };
    return {
      checklist: q.items.all(row.id).map((c) => ({
        num: c.num,
        text: c.text,
        done: !!c.done,
        doneAt: c.done_at,
        doneBy: c.done_by,
      })),
    };
  }

  /** Начальные пункты новой задачи */
  function addInitial(taskId, list, by, now) {
    for (const it of parseList(list)) insert(taskId, it, by, now);
  }

  function need(taskId, num) {
    const c = q.one.get(taskId, num);
    if (c && !c.removed_at) return c;
    const have = q.items.all(taskId).map((i) => i.num);
    throw bad(`Нет пункта ${num} в задаче #${taskId}. Есть: ${have.join(', ') || 'пунктов нет'}`);
  }

  function reorder(taskId, num, after) {
    const order = q.items
      .all(taskId)
      .map((c) => c.num)
      .filter((n) => n !== num);
    const at = after === 0 ? 0 : order.indexOf(after) + 1;
    if (after !== 0 && at === 0) need(taskId, after);
    order.splice(at, 0, num);
    order.forEach((n, i) => q.setPos.run(i + 1, taskId, n));
  }

  const parseAfter = (v) => {
    if (!Number.isInteger(v) || v < 0) throw bad('after — номер пункта, после которого поставить, или 0 — в начало');
    return v;
  };

  /** Операция над пунктами: всё или ничего. Возвращает, что реально изменилось */
  function apply(row, b, by) {
    rejectUnknown(b, OPS);
    const done = nums(b.done, 'done');
    const undone = nums(b.undone, 'undone');
    const remove = nums(b.remove, 'remove');
    const add = b.add === undefined ? [] : Array.isArray(b.add) ? b.add.map((x) => parseItem(x, ['after'])) : null;
    if (!add) throw bad('add — список строк или { text, done, after }');
    if (b.edit !== undefined && !Array.isArray(b.edit)) throw bad('edit — список { num, text }');
    if (b.move !== undefined && !Array.isArray(b.move)) throw bad('move — список { num, after }');
    const edit = (b.edit ?? []).map((e) => {
      if (!Number.isInteger(e?.num)) throw bad('edit — список { num, text }');
      return { num: e.num, text: itemText(e.text) };
    });
    const move = (b.move ?? []).map((m) => {
      if (!Number.isInteger(m?.num)) throw bad('move — список { num, after }');
      return { num: m.num, after: parseAfter(m.after) };
    });
    add.forEach((a) => a.after !== undefined && parseAfter(a.after));
    const both = done.filter((n) => undone.includes(n) || remove.includes(n));
    if (both.length) throw bad(`Пункт ${both.join(', ')} указан в противоречащих друг другу списках`);
    if (!done.length && !undone.length && !remove.length && !add.length && !edit.length && !move.length && !b.note)
      throw bad('Нечего делать: укажите done, undone, add, remove, edit, move или note');

    const applied = { done: [], undone: [], added: [], removed: [], edited: [], moved: [] };
    const now = Date.now();
    tx(() => {
      migrate(row);
      for (const e of edit) {
        const c = need(row.id, e.num);
        if (c.text === e.text) continue;
        q.setText.run(e.text, now, row.id, e.num);
        applied.edited.push(e.num);
      }
      for (const a of add) {
        const num = insert(row.id, a, by, now);
        if (a.after !== undefined) reorder(row.id, num, a.after);
        applied.added.push(num);
      }
      for (const n of done) {
        if (need(row.id, n).done) continue;
        q.setDone.run(1, now, by, now, row.id, n);
        applied.done.push(n);
      }
      for (const n of undone) {
        if (!need(row.id, n).done) continue;
        q.setDone.run(0, null, null, now, row.id, n);
        applied.undone.push(n);
      }
      for (const n of remove) {
        need(row.id, n);
        q.remove.run(now, now, row.id, n);
        applied.removed.push(n);
      }
      for (const m of move) {
        need(row.id, m.num);
        reorder(row.id, m.num, m.after);
        applied.moved.push(m.num);
      }
      q.touch.run(now, row.id);
    });
    return applied;
  }

  /**
   * Совместимость: PATCH с целым checklist от старого клиента (закэшированная страница, MCP в уже идущей сессии).
   * Пункты сопоставляются по num, иначе по тексту, поэтому отметки не теряются: строка оставляет отметку как есть.
   */
  function replace(row, list, by, now) {
    const items = parseList(list);
    migrate(row);
    const cur = q.items.all(row.id);
    const free = new Map(cur.map((c) => [c.num, c]));
    let changed = false;
    const order = [];
    for (const it of items) {
      let c = it.num !== undefined ? free.get(it.num) : undefined;
      if (!c) c = [...free.values()].find((x) => x.text === it.text);
      if (!c) {
        order.push(insert(row.id, it, by, now));
        changed = true;
        continue;
      }
      free.delete(c.num);
      order.push(c.num);
      if (c.text !== it.text) {
        q.setText.run(it.text, now, row.id, c.num);
        changed = true;
      }
      if (it.done !== undefined && it.done !== !!c.done) {
        q.setDone.run(it.done ? 1 : 0, it.done ? now : null, it.done ? by : null, now, row.id, c.num);
        changed = true;
      }
    }
    for (const c of free.values()) {
      q.remove.run(now, now, row.id, c.num);
      changed = true;
    }
    const before = cur.map((c) => c.num).filter((n) => order.includes(n));
    if (before.join() !== order.filter((n) => before.includes(n)).join()) changed = true;
    order.forEach((n, i) => q.setPos.run(i + 1, row.id, n));
    return changed;
  }

  return { view, addInitial, apply, replace, migrate, pendingTasks };
}
