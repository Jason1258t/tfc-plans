import { parse as parseYaml } from 'yaml';
import { CalcError, errorText, evalExpr, parseExpr, type Expr, type Scope } from '../../lib/calcExpr';
import { formatValue, parseSpec, splitSpec, TEMPLATE } from '../../lib/guideFormat';

/**
 * Разбор текста гайда: определения (```define), живые значения {{…}}, строки виджетов «::имя параметры».
 * Сам показ — GuideBody.tsx.
 */

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)(.*)$/;

export interface Prepared {
  /** Markdown для показа: {{…}} → ссылки gv:, «::виджет» → блоки ```widget */
  markdown: string;
  /** Имена из блоков ```define, по порядку */
  defs: Scope;
  /** Ошибки блоков define — по их тексту */
  defErrors: Map<string, string[]>;
}

const cache = new Map<string, Expr | CalcError>();

/** Разобрать с кешем: одно и то же выражение в статье считается каждый раз при правке ввода */
export function compile(src: string): Expr {
  let e = cache.get(src);
  if (!e) {
    try {
      e = parseExpr(src);
    } catch (err) {
      e = err instanceof CalcError ? err : new CalcError(String(err));
    }
    if (cache.size > 5000) cache.clear();
    cache.set(src, e);
  }
  if (e instanceof CalcError) throw e;
  return e;
}

/** Значение поля спецификации: число как есть, строку — как выражение */
export function value(v: unknown, envs: Scope[]): unknown {
  if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return v ?? null;
  if (typeof v !== 'string') throw new CalcError('ожидалось выражение');
  return evalExpr(compile(v), ...envs);
}

/** Подставить {{выражение | формат}} в строку */
export function expand(tpl: unknown, envs: Scope[]): string {
  if (tpl === null || tpl === undefined) return '';
  return String(tpl).replace(TEMPLATE, (_, inner: string) => {
    const { expr, spec } = splitSpec(inner);
    try {
      return formatValue(evalExpr(compile(expr.trim()), ...envs), parseSpec(spec));
    } catch (e) {
      return `⚠ ${errorText(e, expr.trim())}`;
    }
  });
}

/** Блок YAML → объект; ошибка — с номером строки */
export function yaml(text: string): unknown {
  try {
    return parseYaml(text);
  } catch (e) {
    const m = e instanceof Error ? e.message.split('\n')[0] : String(e);
    throw new CalcError(
      `${m}. Подсказка: значения, которые начинаются с {{ или [, и формулы с «: » (a ? b : c) берите в кавычки`,
    );
  }
}

/** Выполнить блоки ```define по порядку, подготовить Markdown */
export function prepare(source: string, scope: Scope): Prepared {
  const lines = source.split('\n');
  const out: string[] = [];
  const defs: Scope = {};
  const defErrors = new Map<string, string[]>();
  let chunk: string[] = [];
  const flush = () => {
    if (chunk.length) out.push(inlineValues(chunk.join('\n')));
    chunk = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (m) {
      flush();
      const fence = m[2];
      const lang = m[3];
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trimStart().startsWith(fence)) body.push(lines[j++]);
      const text = body.join('\n');
      if (lang === 'define') runDefine(text, defs, scope, defErrors);
      out.push(lines[i], ...body, fence);
      i = j;
      continue;
    }
    const w = /^::([a-z0-9-]+)(.*)$/.exec(lines[i].trim());
    if (w) {
      flush();
      out.push('```widget', `${w[1]}${w[2]}`, '```');
      continue;
    }
    chunk.push(lines[i]);
  }
  flush();
  return { markdown: out.join('\n'), defs, defErrors };
}

function runDefine(text: string, defs: Scope, scope: Scope, errors: Map<string, string[]>) {
  const list: string[] = [];
  try {
    const spec = yaml(text);
    if (!spec || typeof spec !== 'object' || Array.isArray(spec))
      throw new CalcError('define — это «имя: формула» по строкам');
    for (const [k, v] of Object.entries(spec)) {
      try {
        defs[k] = value(v, [defs, scope]);
      } catch (e) {
        defs[k] = null;
        list.push(`${k}: ${errorText(e, String(v))}`);
      }
    }
  } catch (e) {
    list.push(errorText(e));
  }
  if (list.length) errors.set(text, list);
}

/** {{…}} вне `кода` → [v](gv:…) — показ разбирает ссылку */
function inlineValues(md: string) {
  return md.replace(/(`+)[\s\S]*?\1|\{\{([\s\S]+?)\}\}/g, (all, tick: string | undefined, inner: string | undefined) =>
    tick ? all : `[v](gv:${encodeURIComponent(inner!)})`,
  );
}

/** «bridge-diagram legs=3 cap» → имя и параметры */
export function widgetCall(text: string): { name: string; params: Record<string, string | number | boolean> } {
  const [name, ...rest] = text.trim().split(/\s+/);
  const params: Record<string, string | number | boolean> = {};
  for (const p of rest) {
    const [k, v] = p.split('=');
    params[k] = v === undefined ? true : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return { name, params };
}
