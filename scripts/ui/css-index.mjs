// Индекс стилей проекта: какие классы определены в CSS и где их используют в TS/TSX.
// Библиотека для scripts/ui/classes.mjs; корень исходников — параметр.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import ts from 'typescript';

const CSS_EXT = /\.(s?css)$/;
const CODE_EXT = /\.(tsx?|jsx?|mjs)$/;
const MODULE_EXT = /\.module\.s?css$/;

export function walk(dir, re, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, re, out);
    else if (re.test(e.name)) out.push(p);
  }
  return out;
}

const lineAt = (text, pos) => {
  let n = 1;
  for (let i = 0; i < pos; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
};

// Комментарии заменяем пробелами той же длины, чтобы позиции строк не съезжали
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(
      /(^|[^:])\/\/[^\n]*/g,
      (m, p) =>
        // `//` — только SCSS-комментарии; в url(http://…) перед ним стоит двоеточие
        p + ' '.repeat(m.length - p.length),
    );
}

const CLASS_IN_SELECTOR = /\.(-?[_a-zA-Z][\w-]*)/g;

export function selectorClasses(selector) {
  // Строки и [атрибуты] не трогаем: в [href$=".css"] нет классов
  const clean = selector.replace(/"[^"]*"|'[^']*'/g, '""').replace(/\[[^\]]*\]/g, '[]');
  return [...new Set([...clean.matchAll(CLASS_IN_SELECTOR)].map((m) => m[1]))];
}

/**
 * Разбор CSS/SCSS в список правил: { selector, classes, decls, line, at } —
 * at — цепочка @media/@supports снаружи. @keyframes и @font-face пропускаются.
 * Вложенность (SCSS и нативная, `&`) раскрывается в полный селектор.
 */
export function parseCss(source) {
  const text = stripComments(source);
  const rules = [];
  let i = 0;
  function block(parents, at) {
    let start = i;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"' || ch === "'") {
        const end = text.indexOf(ch, i + 1);
        i = end < 0 ? text.length : end + 1;
        continue;
      }
      if (ch === '{') {
        const prelude = text.slice(start, i).trim();
        const preludeLine = lineAt(
          text,
          start + (text.slice(start, i).length - text.slice(start, i).trimStart().length),
        );
        // Объявления, накопленные до вложенного блока, принадлежат родителю — их разберёт родитель по `;`
        const lastSemi = prelude.lastIndexOf(';');
        const head = lastSemi >= 0 ? prelude.slice(lastSemi + 1).trim() : prelude;
        i++;
        if (/^@(keyframes|-webkit-keyframes|font-face|property|page)\b/.test(head)) {
          skip();
        } else if (head.startsWith('@')) {
          block(parents, [...at, head]);
        } else {
          const selectors = expand(parents, head);
          const rule = { selector: selectors.join(', '), selectors, classes: [], decls: [], line: preludeLine, at };
          rule.classes = [...new Set(selectors.flatMap(selectorClasses))];
          rules.push(rule);
          const declStart = i;
          block(selectors, at);
          rule.decls = ownDecls(text.slice(declStart, i - 1));
        }
        start = i;
        continue;
      }
      if (ch === '}') {
        i++;
        return;
      }
      if (ch === ';') start = i + 1;
      i++;
    }
  }
  function skip() {
    let depth = 1;
    while (i < text.length && depth) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
  }
  block([], []);
  return rules;
}

// Объявления правила без вложенных блоков: «свойство: значение», нормализованные для сравнения
function ownDecls(body) {
  let flat = '';
  let depth = 0;
  for (const ch of body) {
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      flat += ';';
      continue;
    }
    if (!depth) flat += ch;
  }
  return (
    flat
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d.includes(':') && !d.startsWith('@') && !/[{}]/.test(d))
      .map((d) => {
        const k = d.indexOf(':');
        return `${d.slice(0, k).trim().toLowerCase()}: ${d
          .slice(k + 1)
          .trim()
          .replace(/\s+/g, ' ')}`;
      })
      // Селектор с вложенным блоком попадает сюда как «a:hover» без значения — отсекаем по виду свойства
      .filter((d) => /^(--[\w-]+|-?[a-z][a-z-]*): /.test(d))
  );
}

function splitSelectors(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && !depth) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function expand(parents, head) {
  const own = splitSelectors(head.replace(/\s+/g, ' '));
  if (!parents.length) return own;
  return parents.flatMap((p) => own.map((s) => (s.includes('&') ? s.replaceAll('&', p) : `${p} ${s}`)));
}

/** Все CSS-файлы под root: { file, rules, module } */
export function loadCss(root) {
  return walk(root, CSS_EXT).map((file) => ({
    file,
    module: MODULE_EXT.test(file),
    rules: parseCss(readFileSync(file, 'utf8')),
  }));
}

/**
 * Использования классов в коде. Для каждого файла — список
 * { name, line, kind, file, module? }:
 *  kind = 'class'    — строка в className / cx() / classList / clsx-подобном вызове;
 *         'selector' — селектор в querySelector/closest/matches (`.name`);
 *         'module'   — styles.name / styles['name'] из импорта *.module.css (module = путь CSS);
 *         'string'   — просто слово в строке (слабое совпадение: может быть и не классом);
 *         'dynamic'  — префикс шаблона `name-${…}`: класс собирается на лету (name = префикс).
 */
export function loadUsages(root) {
  const files = walk(root, CODE_EXT).filter((f) => !f.endsWith('.d.ts'));
  const all = [];
  const imports = new Map(); // файл кода → [путь CSS]
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('x') ? ts.ScriptKind.TSX : undefined,
    );
    const modules = new Map(); // локальное имя → путь *.module.css
    const cssImports = [];
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const spec = st.moduleSpecifier.text;
      if (!CSS_EXT.test(spec)) continue;
      const abs = resolve(dirname(file), spec);
      cssImports.push(abs);
      const name = st.importClause?.name?.text;
      if (name && MODULE_EXT.test(spec)) modules.set(name, abs);
    }
    imports.set(file, cssImports);
    const push = (name, node, kind, extra) =>
      all.push({ name, kind, file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, ...extra });

    const visit = (node) => {
      if (
        ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        const kind = classContext(node);
        const raw = node.text;
        if (kind === 'selector') {
          for (const name of selectorClasses(raw)) push(name, node, 'selector');
        } else if (kind !== 'import') {
          // Хвост `foo-` перед ${…} — динамический класс
          const tailDynamic =
            (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) && /(^|\s)([_a-zA-Z][\w-]*-)$/.exec(raw);
          for (const m of raw.matchAll(/(?<![\w-])-?[_a-zA-Z][\w-]*/g)) {
            if (tailDynamic && m.index + m[0].length === raw.length) continue;
            push(m[0], node, kind);
          }
          if (tailDynamic) push(tailDynamic[2], node, 'dynamic');
        }
      } else if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        modules.has(node.expression.text)
      ) {
        push(node.name.text, node.name, 'module', { module: modules.get(node.expression.text) });
      } else if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        modules.has(node.expression.text) &&
        ts.isStringLiteralLike(node.argumentExpression)
      ) {
        push(node.argumentExpression.text, node.argumentExpression, 'module', {
          module: modules.get(node.expression.text),
        });
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { usages: all, imports, files };
}

const CLASS_CALLS = /^(cx|clsx|classnames|classNames|cn)$/;
const SELECTOR_CALLS = /^(querySelector|querySelectorAll|closest|matches)$/;
const CLASSLIST = /^(add|remove|toggle|contains|replace)$/;

function classContext(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return 'import';
    if (ts.isJsxAttribute(p)) return /^(className|class)$/.test(p.name.getText()) ? 'class' : 'string';
    if (ts.isPropertyAssignment(p) && /^(className|class)$/.test(p.name.getText())) return 'class';
    if (ts.isCallExpression(p)) {
      const callee = p.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      if (CLASS_CALLS.test(name)) return 'class';
      if (SELECTOR_CALLS.test(name)) return 'selector';
      if (
        CLASSLIST.test(name) &&
        ts.isPropertyAccessExpression(callee) &&
        /classList$/.test(callee.expression.getText())
      )
        return 'class';
      return 'string';
    }
    if (
      ts.isBinaryExpression(p) &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      /\.className$/.test(p.left.getText())
    )
      return 'class';
    if (ts.isBlock(p) || ts.isSourceFile(p)) return 'string';
  }
  return 'string';
}

/** Полный индекс: определения и использования по имени класса */
export function buildIndex(root) {
  const css = loadCss(root);
  const { usages, imports, files } = loadUsages(root);
  const defs = new Map(); // класс → [{ file, line, selector, at, module }]
  for (const { file, rules, module } of css)
    for (const r of rules)
      for (const c of r.classes) {
        if (!defs.has(c)) defs.set(c, []);
        defs.get(c).push({ file, line: r.line, selector: r.selector, at: r.at, module });
      }
  const uses = new Map();
  const dynamic = [];
  for (const u of usages) {
    if (u.kind === 'dynamic') dynamic.push(u);
    if (!uses.has(u.name)) uses.set(u.name, []);
    uses.get(u.name).push(u);
  }
  // Кто подключает CSS-файл (прямой импорт)
  const importers = new Map();
  for (const [code, list] of imports)
    for (const c of list) {
      if (!importers.has(c)) importers.set(c, []);
      importers.get(c).push(code);
    }
  return { root, css, defs, uses, dynamic, importers, files };
}

/** Ключ класса в объекте CSS-модуля: vite css.modules.localsConvention = 'camelCaseOnly' */
export const moduleKey = (name) => name.replace(/[-_]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());

/**
 * Проверка CSS-модулей: styles.x, которого нет в .module.css (опечатка → пустой класс без ошибки),
 * и классы модуля, которые никто не берёт. Возвращает { missing, unused }.
 */
export function checkModules(index) {
  const keys = new Map(); // путь модуля → Set ключей
  for (const { file, module, rules } of index.css)
    if (module) keys.set(file, new Set(rules.flatMap((r) => r.classes).map(moduleKey)));
  const used = new Map();
  const missing = [];
  for (const list of index.uses.values())
    for (const u of list) {
      if (u.kind !== 'module') continue;
      if (!used.has(u.module)) used.set(u.module, new Set());
      used.get(u.module).add(u.name);
      if (!keys.get(u.module)?.has(u.name)) missing.push(u);
    }
  const unused = [];
  for (const [file, set] of keys) for (const k of set) if (!used.get(file)?.has(k)) unused.push({ file, name: k });
  return { missing, unused };
}

/** Динамические префиксы, под которые подходит класс (`tab-${x}` → tab-active) */
export function dynamicMatches(index, name) {
  return index.dynamic.filter((d) => name.startsWith(d.name) && name !== d.name);
}

export const rel = (root, p) => relative(root, p) || p;

/**
 * Классы, которые рисуют сторонние библиотеки (CodeMirror, remark-gfm, cm-live-markdown…):
 * в нашем коде их нет, но вырезать стили нельзя. Ищем слова в JS/CSS runtime-зависимостей
 * (dependencies из package.json и их зависимости). Возвращает Map класс → имя пакета.
 */
export function libraryHits(names, projectDir) {
  const hits = new Map();
  if (!names.length) return hits;
  let nm = null;
  for (let d = resolve(projectDir); !nm; d = dirname(d)) {
    if (existsSync(join(d, 'node_modules'))) nm = join(d, 'node_modules');
    else if (dirname(d) === d) return hits;
  }
  const pkgJson = (dir) => {
    try {
      return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      return null;
    }
  };
  const seen = new Set();
  const queue = Object.keys(pkgJson(projectDir)?.dependencies ?? {});
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name) || !existsSync(join(nm, name))) continue;
    seen.add(name);
    queue.push(...Object.keys(pkgJson(join(nm, name))?.dependencies ?? {}));
  }
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'));
  const re = new RegExp(`(?<![\\w-])(${escaped.join('|')})(?![\\w-])`, 'g');
  let text;
  for (const name of seen)
    for (const f of walk(join(nm, name), /\.(c?js|mjs|css)$/)) {
      for (const m of (text = readFileSync(f, 'utf8')).matchAll(re)) {
        // Только похожее на класс: селектор `.name` или слово рядом с class/className —
        // иначе общие слова (text, side, full) находятся в любой библиотеке
        if (hits.has(m[1])) continue;
        const before = text.slice(Math.max(0, m.index - 60), m.index);
        const after = text[m.index + m[0].length] ?? '';
        const css = f.endsWith('.css');
        // В JS: селектор внутри строки (".x", "& .x") или строка-класс рядом со словом class
        const inString = /["'`]$/.test(before) && /["'` ]/.test(after);
        const selector = css ? before.endsWith('.') : /["'` &>]\.$/.test(before);
        if (selector || (!css && inString && /class/i.test(before))) hits.set(m[1], name);
      }
      if (hits.size === names.length) return hits;
    }
  return hits;
}
