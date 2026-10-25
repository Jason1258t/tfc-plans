import { useMemo, useState, type ReactNode } from 'react';
import { cx, errorText, type Scope } from '@/shared/lib';
import { Button, Input, Select } from '@/shared/ui';
import { formatValue, parseSpec } from '@/lib/guideFormat';
import { Markdown } from '@/components/Markdown';
import { useGuideEditing, useGuideLink } from './guideLinks';
import { expand, value, yaml } from './guideText';
import styles from './Guides.module.css';

/**
 * Калькулятор, описанный в статье блоком ```calc (YAML):
 *   title, inputs (поля), let (промежуточные), outputs (плашки), notes, chart, table, footer.
 * Формат — в справке редактора (GuideHelp) и docs/plans/guides.md.
 */

export interface Picker {
  label: string;
  /** Панель, которая отдаёт значение в ваттах */
  render: (onApply: (watts: number) => void) => ReactNode;
}

interface InputSpec {
  label?: string;
  default?: unknown;
  min?: unknown;
  max?: unknown;
  step?: number;
  unit?: string;
  options?: unknown;
  list?: string;
  key?: string;
  text?: string;
  toggle?: boolean;
  picker?: string;
}

interface OutSpec {
  label?: string;
  value?: unknown;
  text?: string;
  fmt?: string;
  hint?: string;
  bad?: unknown;
  warn?: unknown;
  when?: unknown;
}

interface ChartSpec {
  values: unknown;
  max?: unknown;
  title?: string;
  unit?: string;
  caption?: string;
  left?: string;
  right?: string;
  when?: unknown;
}

interface TableSpec {
  rows: unknown;
  columns: { title?: string; value?: unknown; text?: string; fmt?: string; num?: boolean; bad?: unknown }[];
  caption?: string;
  when?: unknown;
}

interface Spec {
  title?: string;
  inputs?: Record<string, InputSpec>;
  let?: Record<string, unknown>;
  outputs?: OutSpec[];
  notes?: OutSpec[];
  chart?: ChartSpec | ChartSpec[];
  table?: TableSpec | TableSpec[];
  footer?: string;
}

type Option = { id: string; label: string; row?: unknown };

const INPUT_KEYS = [
  'label',
  'default',
  'min',
  'max',
  'step',
  'unit',
  'options',
  'list',
  'key',
  'text',
  'toggle',
  'picker',
];
const OUT_KEYS = ['label', 'value', 'text', 'fmt', 'hint', 'bad', 'warn', 'when'];
const COL_KEYS = ['title', 'value', 'text', 'fmt', 'num', 'bad'];
const SPEC_KEYS = ['title', 'inputs', 'let', 'outputs', 'notes', 'chart', 'table', 'footer'];

const arr = <T,>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const truthy = (v: unknown) => Boolean(v) && !(typeof v === 'number' && Number.isNaN(v));

export function CalcBlock({
  text,
  envs,
  pickers,
}: {
  text: string;
  /** Определения статьи и область раздела */
  envs: Scope[];
  pickers?: Record<string, Picker>;
}) {
  const parsed = useMemo(() => {
    try {
      const s = yaml(text);
      if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('калькулятор — это набор «поле: значение»');
      return { spec: s as Spec };
    } catch (e) {
      return { error: errorText(e) };
    }
  }, [text]);
  if ('error' in parsed) return <CalcErrors list={[`Калькулятор не разобран: ${parsed.error}`]} />;
  return <Calc spec={parsed.spec} envs={envs} pickers={pickers} />;
}

function Calc({ spec, envs, pickers }: { spec: Spec; envs: Scope[]; pickers?: Record<string, Picker> }) {
  const errors: string[] = [];
  const at = <T,>(where: string, f: () => T, fallback: T): T => {
    try {
      return f();
    } catch (e) {
      errors.push(`${where}: ${errorText(e)}`);
      return fallback;
    }
  };

  // Лишние поля — обычно кусок формулы с запятой в короткой записи { … }: молча терять его нельзя
  const known = (o: unknown, keys: string[], where: string) => {
    if (o && typeof o === 'object' && !Array.isArray(o))
      for (const k of Object.keys(o))
        if (!keys.includes(k))
          errors.push(
            `${where}: неизвестное поле «${k}» — если это часть формулы с запятой, возьмите формулу в кавычки или запишите поле отдельной строкой`,
          );
  };
  Object.entries(spec.inputs ?? {}).forEach(([k, v]) => known(v, INPUT_KEYS, `inputs.${k}`));
  arr(spec.outputs).forEach((o, i) => known(o, OUT_KEYS, `outputs[${i}]`));
  arr(spec.notes).forEach((o, i) => known(o, OUT_KEYS, `notes[${i}]`));
  arr(spec.table).forEach((t, i) => arr(t?.columns).forEach((c, j) => known(c, COL_KEYS, `table[${i}].columns[${j}]`)));
  known(spec, SPEC_KEYS, 'калькулятор');

  const inputs = Object.entries(spec.inputs ?? {}).filter(([, v]) => v && typeof v === 'object');
  // Списки выбора и значения по умолчанию — от области статьи, без полей ввода
  const meta = inputs.map(([name, inp]) => {
    const options: Option[] | null = inp.list
      ? at(`inputs.${name}.list`, () => listOptions(value(inp.list, envs), inp), [])
      : inp.options
        ? at(`inputs.${name}.options`, () => plainOptions(inp.options), [])
        : null;
    // У выбора по умолчанию — id варианта как есть, у числа — формула или число
    const def = options ? (inp.default ?? null) : at(`inputs.${name}.default`, () => value(inp.default, envs), null);
    const num = (v: unknown, k: string) => at(`inputs.${name}.${k}`, () => value(v, envs), null) as number | null;
    return { name, inp, options, def, min: num(inp.min, 'min'), max: num(inp.max, 'max') };
  });
  const [state, setState] = useState<Record<string, unknown>>({});
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  const local: Scope = {};
  const selected: Record<string, string> = {};
  for (const m of meta) {
    const raw = m.name in state ? state[m.name] : m.def;
    if (m.options) {
      const id = String(raw ?? '');
      const o = m.options.find((x) => x.id === id) ?? m.options[0];
      local[m.name] = o ? (o.row ?? o.id) : null;
      selected[m.name] = o?.id ?? '';
    } else if (m.inp.toggle) local[m.name] = Boolean(raw);
    else local[m.name] = typeof raw === 'number' ? raw : Number(raw ?? 0);
  }
  const all = [local, ...envs];
  for (const [k, v] of Object.entries(spec.let ?? {})) local[k] = at(`let.${k}`, () => value(v, all), null);

  const set = (name: string, v: unknown) => setState((s) => ({ ...s, [name]: v }));
  const tpl = (t: unknown) => expand(t, all);
  const check = (where: string, v: unknown) =>
    v === undefined ? false : truthy(at(where, () => value(v, all), false));
  const shown = (where: string, o: { when?: unknown }) => o.when === undefined || check(`${where}.when`, o.when);

  const outs = arr(spec.outputs).filter((o, i) => o && shown(`outputs[${i}]`, o));
  const notes = arr(spec.notes).filter((o, i) => o && shown(`notes[${i}]`, o));
  const charts = arr(spec.chart).filter((c, i) => c && shown(`chart[${i}]`, c));
  const tables = arr(spec.table).filter((t, i) => t && shown(`table[${i}]`, t));
  const boxed = inputs.length > 0 || outs.length > 0;
  const picker = openPicker ? meta.find((m) => m.name === openPicker) : null;

  const body = (
    <>
      {spec.title && <h3>{tpl(spec.title)}</h3>}
      {meta.length > 0 && (
        <div className="power-form">
          {meta.map((m) => (
            <label key={m.name} className={cx('power-field', m.inp.toggle && styles.guideToggle)}>
              <span className="faint small">{tpl(m.inp.label ?? m.name)}</span>
              {m.options ? (
                <Select value={selected[m.name]} onChange={(e) => set(m.name, e.target.value)}>
                  {m.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : m.inp.toggle ? (
                <input
                  type="checkbox"
                  checked={Boolean(local[m.name])}
                  onChange={(e) => set(m.name, e.target.checked)}
                />
              ) : (
                <span>
                  <Input
                    type="number"
                    value={local[m.name] as number}
                    min={m.min ?? undefined}
                    max={m.max ?? undefined}
                    step={m.inp.step ?? 'any'}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (e.target.value !== '' && Number.isFinite(v))
                        set(m.name, Math.min(m.max ?? Infinity, Math.max(m.min ?? -Infinity, v)));
                    }}
                  />
                  {m.inp.unit && <span className="faint small"> {m.inp.unit}</span>}
                  {m.inp.picker && pickers?.[m.inp.picker] && (
                    <Button
                      variant="ghost"
                      className={cx('small', styles.guidePick, openPicker === m.name && styles.active)}
                      onClick={() => setOpenPicker(openPicker === m.name ? null : m.name)}
                    >
                      {pickers[m.inp.picker].label}
                    </Button>
                  )}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
      {picker?.inp.picker &&
        pickers?.[picker.inp.picker]?.render((w) => {
          const v = picker.inp.unit === 'кВт' ? Math.round(w / 100) / 10 : Math.round(w);
          set(picker.name, Math.min(picker.max ?? Infinity, Math.max(picker.min ?? -Infinity, v)));
        })}
      {outs.length > 0 && (
        <div className="power-outs">
          {outs.map((o, i) => {
            const where = `outputs[${i}]`;
            const bad = check(`${where}.bad`, o.bad);
            const warn = !bad && check(`${where}.warn`, o.warn);
            const main =
              o.text !== undefined
                ? tpl(o.text)
                : formatValue(
                    at(`${where}.value`, () => value(o.value, all), null),
                    parseSpec(o.fmt),
                  );
            const hint = o.hint ? tpl(o.hint).trim() : '';
            return (
              <div key={i} className={cx('power-out', bad && styles.guideOutBad, warn && styles.guideOutWarn)}>
                {o.label && <span className="faint small">{tpl(o.label)}</span>}
                <b className={cx(bad && 'power-bad')}>
                  <Md source={main} inline />
                </b>
                {hint && (
                  <span className={cx('small', bad ? 'power-bad' : warn ? styles.guideWarn : 'faint')}>
                    <Md source={hint} inline />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {notes.map((n, i) => {
        const bad = check(`notes[${i}].bad`, n.bad);
        const text = tpl(n.text).trim();
        if (!text) return null;
        return (
          <div key={i} className={cx('small', bad ? 'power-bad' : 'faint')}>
            <Md source={text} inline />
          </div>
        );
      })}
      {charts.map((c, i) => (
        <BarChart key={i} spec={c} all={all} at={at} where={`chart[${i}]`} tpl={tpl} />
      ))}
      {tables.map((t, i) => (
        <DataTable key={i} spec={t} all={all} at={at} where={`table[${i}]`} tpl={tpl} />
      ))}
      {spec.footer && <Md source={tpl(spec.footer)} className="faint small" />}
      {errors.length > 0 && <CalcErrors list={errors} />}
    </>
  );
  return boxed ? <section className="power-calc">{body}</section> : <div className={styles.guidePlain}>{body}</div>;
}

const optionId = (v: unknown): string =>
  v !== null && typeof v === 'object'
    ? String((v as Record<string, unknown>).id ?? (v as Record<string, unknown>).name ?? '')
    : String(v ?? '');

function listOptions(v: unknown, inp: InputSpec): Option[] {
  if (!Array.isArray(v)) throw new Error('list — выражение-список (например, wires)');
  return v.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(inp.key ? r[inp.key] : optionId(row)),
      label: String(r[inp.text ?? 'label'] ?? r.name ?? r.id ?? ''),
      row,
    };
  });
}

function plainOptions(v: unknown): Option[] {
  if (Array.isArray(v))
    return v.map((o) =>
      o && typeof o === 'object'
        ? { id: String((o as Record<string, unknown>).value), label: String((o as Record<string, unknown>).label) }
        : { id: String(o), label: String(o) },
    );
  if (v && typeof v === 'object') return Object.entries(v).map(([id, label]) => ({ id, label: String(label) }));
  throw new Error('options — список или «значение: подпись»');
}

type At = <T>(where: string, f: () => T, fallback: T) => T;

/** Столбики: значение на каждом шаге (например, на каждом тике секунды) */
function BarChart({
  spec,
  all,
  at,
  where,
  tpl,
}: {
  spec: ChartSpec;
  all: Scope[];
  at: At;
  where: string;
  tpl: (t: unknown) => string;
}) {
  const values = at(`${where}.values`, () => value(spec.values, all), []);
  if (!Array.isArray(values) || !values.length) return null;
  const nums = values.map(Number);
  const max = (at(`${where}.max`, () => value(spec.max, all), null) as number | null) ?? Math.max(...nums, 1e-9);
  const w = 400;
  const h = 90;
  const bw = w / nums.length;
  return (
    <figure className="power-figure">
      <svg viewBox={`0 0 ${w} ${h + 16}`} role="img" aria-label={tpl(spec.title ?? 'График')}>
        <line x1={0} y1={h} x2={w} y2={h} className="power-axis" />
        {nums.map((s, i) => {
          const bh = max > 0 ? (Math.max(0, Math.min(s, max)) / max) * h : 0;
          return (
            <rect
              key={i}
              x={i * bw + 1}
              y={h - bh}
              width={Math.max(1, bw - 2)}
              height={Math.max(bh, 0.5)}
              className="power-bar"
            >
              <title>
                {i + 1}: {formatValue(s, parseSpec(spec.unit))}
              </title>
            </rect>
          );
        })}
        {spec.left && (
          <text x={0} y={h + 13} className="power-svg-text">
            {tpl(spec.left)}
          </text>
        )}
        {spec.right && (
          <text x={w} y={h + 13} textAnchor="end" className="power-svg-text">
            {tpl(spec.right)}
          </text>
        )}
      </svg>
      {spec.caption && (
        <figcaption className="faint small">
          <Md source={tpl(spec.caption)} inline />
        </figcaption>
      )}
    </figure>
  );
}

function DataTable({
  spec,
  all,
  at,
  where,
  tpl,
}: {
  spec: TableSpec;
  all: Scope[];
  at: At;
  where: string;
  tpl: (t: unknown) => string;
}) {
  const rows = Array.isArray(spec.rows) ? spec.rows : at(`${where}.rows`, () => value(spec.rows, all), []);
  const cols = arr(spec.columns);
  if (!Array.isArray(rows) || !cols.length) return null;
  return (
    <>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              {cols.map((c, j) => (
                <th key={j} className={cx(c.num && 'num')}>
                  {tpl(c.title ?? '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const env = [{ row, i }, ...all];
              return (
                <tr key={i}>
                  {cols.map((c, j) => {
                    const w = `${where}.columns[${j}]`;
                    const bad = c.bad !== undefined && truthy(at(`${w}.bad`, () => value(c.bad, env), false));
                    const cell =
                      c.text !== undefined
                        ? expand(c.text, env)
                        : formatValue(
                            at(`${w}.value`, () => value(c.value, env), null),
                            parseSpec(c.fmt),
                          );
                    return (
                      <td key={j} className={cx(c.num && 'num', bad && 'power-bad')}>
                        <Md source={cell} inline />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {spec.caption && <Md source={tpl(spec.caption)} className="faint small" />}
    </>
  );
}

/** Markdown подписей калькулятора: ссылки на гайды работают так же, как в тексте статьи */
function Md({ source, className, inline }: { source: string; className?: string; inline?: boolean }) {
  const link = useGuideLink();
  return <Markdown source={source} className={className} inline={inline} link={link} schemes={['guide:']} />;
}

/**
 * Ошибки формул. В редакторе — списком, как есть. Читателю — одной строкой по-человечески, подробности свёрнуты:
 * «неизвестное имя» почти всегда значит, что вкладка открыта до обновления сайта.
 */
export function CalcErrors({ list }: { list: string[] }) {
  const editing = useGuideEditing();
  if (editing)
    return (
      <div className={cx(styles.guideErrors, 'small')}>
        {list.slice(0, 12).map((e, i) => (
          <div key={i}>⚠ {e}</div>
        ))}
        {list.length > 12 && <div>…и ещё {list.length - 12}</div>}
      </div>
    );
  const stale = list.some((e) => e.includes('неизвестное имя'));
  return (
    <details className={cx(styles.guideErrors, styles.guideErrorsReader, 'small')}>
      <summary>
        {stale ? (
          <>
            Часть расчётов не показана — похоже, сайт обновился, пока вкладка была открыта.{' '}
            <button type="button" className="power-link" onClick={() => location.reload()}>
              Обновить страницу
            </button>
          </>
        ) : (
          'Часть расчётов не получилась — в статье ошибка, её можно поправить кнопкой «Править»'
        )}
      </summary>
      {list.slice(0, 12).map((e, i) => (
        <div key={i}>{e}</div>
      ))}
    </details>
  );
}
