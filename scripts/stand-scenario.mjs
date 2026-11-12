/**
 * Сценарий RCON стенда с приёмкой (dev #319). Включается только явно — флагом failFast, своими failOn или строками
 * «expect …» / «!…» в командах; без них команды идут как раньше и итог прогона не меняется.
 *
 *   «!команда»   — отрицательная проверка: ответ обязан быть ошибкой (иначе — провал); её ошибка провалом не считается.
 *   «expect A=4.95±0.002 A+B-C=0±1e-7 D=5±1% E<=1e-11» — числа из ответа последней отправленной команды:
 *                  поля «Имя:1.5d» (SNBT) и «Имя=1.5», при повторе берётся последнее; «±N%» — от ожидаемого.
 *   «sleep N»    — пауза, как раньше.
 * Ошибкой ответа считается FAIL_RE и свои failOn. failFast — после первого провала остальные команды не шлются,
 * ожидание until пропускается. Итог — report(): машиночитаемый measured/expected/tolerance по каждой проверке.
 */

/** Ответ сервера, который означает неудачу команды */
export const FAIL_RE =
  /ASSERTFAIL|An unexpected error occurred trying to execute that command|Unknown or incomplete command|Incorrect argument for command|<--\[HERE\]/;

const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const FIELD_RE = new RegExp(`([A-Za-z_][\\w.]*)\\s*[:=]\\s*(${NUM})[dfbsLD]?(?![\\w.])`, 'g');
const CHECK_RE = new RegExp(`^(.+?)(<=|>=|<|>|=)(${NUM})(?:(?:±|\\+-)(${NUM})(%)?)?$`);

/** Числовые поля ответа: { Имя: число } */
export function parseFields(text) {
  const out = {};
  for (const m of String(text).matchAll(FIELD_RE)) out[m[1]] = Number(m[2]);
  return out;
}

/** Одна проверка «A+B-C=0±1e-7» против полей → { expr, op, expected, tolerance, measured, error, ok, reason? } */
export function evalCheck(spec, fields) {
  const m = CHECK_RE.exec(spec.trim());
  if (!m) return { expr: spec, ok: false, reason: 'не разобрана: нужно Поле=число±допуск, Поле<=число …' };
  const [, lhs, op, exp, tol, pct] = m;
  const expected = Number(exp);
  const tolerance = tol === undefined ? 0 : pct ? (Math.abs(expected) * Number(tol)) / 100 : Number(tol);
  if (!/^[+-]?[A-Za-z_][\w.]*(?:[+-][A-Za-z_][\w.]*)*$/.test(lhs))
    return { expr: lhs, op, expected, tolerance, ok: false, reason: 'левая часть — поля через + и -' };
  const terms = [...lhs.matchAll(/([+-]?)([A-Za-z_][\w.]*)/g)];
  const missing = terms.map((t) => t[2]).filter((k) => !(k in fields));
  if (missing.length)
    return { expr: lhs, op, expected, tolerance, measured: null, ok: false, reason: `нет поля: ${missing.join(', ')}` };
  const measured = terms.reduce((s, t) => s + (t[1] === '-' ? -1 : 1) * fields[t[2]], 0);
  const error = measured - expected;
  const ok =
    op === '='
      ? Math.abs(error) <= tolerance
      : op === '<='
        ? measured <= expected + tolerance
        : op === '>='
          ? measured >= expected - tolerance
          : op === '<'
            ? measured < expected
            : measured > expected;
  return { expr: lhs, op, expected, tolerance, measured, error, ok };
}

/** Сценарий нужен: есть его строки, свои failOn или failFast */
export const scenarioWanted = (commands, { failFast = false, failOn = [] } = {}) =>
  failFast || failOn.length > 0 || commands.some((c) => /^\s*(expect\s|!)/.test(String(c)));

/**
 * Состояние сценария для runRcon: before(c) решает, слать ли команду, after(c, body) разбирает ответ.
 * → { before, after, finish(), report() }
 */
export function createScenario(commands, { failFast = false, failOn = [] } = {}) {
  const extra = failOn.map((r) => new RegExp(r));
  const isFail = (body) => FAIL_RE.test(body) || extra.some((r) => r.test(body));
  const total = commands.filter((c) => !/^(sleep|expect)\s/.test(c)).length;
  const st = { n: 0, sent: 0, last: null, pending: null, stopped: null, failures: [], negatives: [], checks: [] };
  const fail = (command, reason) => {
    st.failures.push({ n: st.n, command, reason });
    if (failFast && !st.stopped) st.stopped = { n: st.n, command, reason };
  };

  return {
    /** → строка для отправки | { local: текст } | { stop: true } */
    before(c) {
      if (st.stopped) return { stop: true };
      st.n++;
      if (/^expect\s/.test(c)) {
        const fields = parseFields(st.last?.body ?? '');
        const res = c
          .replace(/^expect\s+/, '')
          .split(/\s+/)
          .filter(Boolean)
          .map((spec) => ({ n: st.n, command: st.last?.command ?? null, ...evalCheck(spec, fields) }));
        st.checks.push(...res);
        const bad = res.filter((r) => !r.ok);
        if (bad.length) fail(c, bad.map(checkLine).join('; '));
        return { local: res.map((r) => checkLine(r)).join('\n') };
      }
      const negative = c.startsWith('!');
      const send = negative ? c.slice(1).trim() : c;
      st.pending = { command: send, negative };
      st.sent++;
      return send;
    },
    after(c, body) {
      const p = st.pending;
      st.pending = null;
      st.last = { command: c, body };
      const failed = isFail(body);
      if (p?.negative) {
        st.negatives.push({ n: st.n, command: c, ok: failed });
        if (!failed) fail(`!${c}`, 'отрицательная проверка не упала');
      } else if (failed) fail(c, firstLine(body, extra));
    },
    /** После runRcon: команда без ответа (сервер замолчал) или ошибка соединения — провал */
    finish(error = null) {
      if (error && !st.pending) fail('RCON', error);
      if (st.pending) {
        const { command } = st.pending;
        st.pending = null;
        fail(command, error ?? 'нет ответа RCON');
      }
    },
    report() {
      return {
        ok: st.failures.length === 0,
        failFast,
        total,
        sent: st.sent,
        stopped: st.stopped,
        failures: st.failures,
        negatives: st.negatives,
        checks: st.checks,
      };
    },
  };

  function firstLine(body, res) {
    const line = body.split('\n').find((l) => [FAIL_RE, ...res].some((r) => r.test(l))) ?? body;
    return line.trim().slice(0, 200);
  }
}

const fmt = (x) => (x === null || x === undefined ? '—' : String(Number(x.toPrecision(9))));

/** Проверка одной строкой */
export function checkLine(r) {
  const want = `${r.op ?? '='} ${fmt(r.expected)}${r.tolerance ? ` ±${fmt(r.tolerance)}` : ''}`;
  if (r.reason) return `${r.ok ? 'OK' : 'FAIL'} ${r.expr} ${want}: ${r.reason}`;
  return `${r.ok ? 'OK' : 'FAIL'} ${r.expr} = ${fmt(r.measured)} (нужно ${want}, отклонение ${fmt(r.error)})`;
}

/** Итог сценария для сводки: { head — строка в начало, tail — строки в конец } */
export function reportText(rep, file) {
  const okChecks = rep.checks.filter((c) => c.ok).length;
  const negOk = rep.negatives.filter((c) => c.ok).length;
  const head =
    `Сценарий: ${rep.ok ? 'ПРОЙДЕН' : 'ПРОВАЛ'} — команд отправлено ${rep.sent} из ${rep.total}` +
    (rep.stopped ? `, остановлен на шаге ${rep.stopped.n} «${rep.stopped.command}»: ${rep.stopped.reason}` : '') +
    `; проверок ${okChecks} OK / ${rep.checks.length - okChecks} FAIL` +
    (rep.negatives.length ? `; отрицательных ${negOk}/${rep.negatives.length}` : '') +
    (rep.failures.length ? `; провалов ${rep.failures.length}` : '') +
    (file ? `; ${file}` : '');
  const tail = [
    `Сценарий — провалы (${rep.failures.length}):`,
    ...(rep.failures.length ? rep.failures.map((f) => `  шаг ${f.n} «${f.command}»: ${f.reason}`) : ['  нет']),
    ...(rep.checks.length
      ? [`Сценарий — проверки (${rep.checks.length}):`, ...rep.checks.map((c) => `  шаг ${c.n} ${checkLine(c)}`)]
      : []),
  ];
  return { head, tail };
}
