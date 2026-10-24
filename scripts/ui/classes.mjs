#!/usr/bin/env node
// Где используются CSS-классы — перед тем как переносить или вырезать стили.
//
//   node scripts/ui/classes.mjs btn primary            — определения и использования классов
//   node scripts/ui/classes.mjs --css src/pages/TasksPage.css   — все классы файла: свой / общий / мёртвый
//   node scripts/ui/classes.mjs --unused [--dir src/pages]      — классы без единого использования
//   node scripts/ui/classes.mjs --dupes [--min 3] [--dir …]     — одинаковые наборы объявлений (кандидаты в shared/ui)
//   node scripts/ui/classes.mjs --component src/pages/TasksPage.tsx — какие классы файл берёт и из каких CSS
//   node scripts/ui/classes.mjs --check  — styles.x без класса в .module.css (код выхода 1); лишние классы модулей
//   --json — машинный вывод; --root src — корень исходников (по умолчанию src)
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildIndex, checkModules, dynamicMatches, libraryHits, moduleKey, rel } from './css-index.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const VALUE_FLAGS = new Set(['--css', '--dir', '--min', '--root', '--component']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1]));

const root = resolve(opt('--root', 'src'));
if (!existsSync(root)) {
  console.error(`Нет папки ${root}`);
  process.exit(1);
}
const index = buildIndex(root);
const R = (p) => rel(process.cwd(), p);
const json = flag('--json');
const out = (data, text) => console.log(json ? JSON.stringify(data, null, 2) : text());

const STRONG = new Set(['class', 'selector', 'module']);

/** Использования класса, относящиеся к определению: модульные — только к своему .module.css */
function usesFor(name, def) {
  if (def?.module)
    return (index.uses.get(moduleKey(name)) ?? []).filter((u) => u.kind === 'module' && u.module === def.file);
  const list = index.uses.get(name) ?? [];
  return list.filter((u) => u.kind !== 'module' && u.kind !== 'dynamic');
}

// Классы без использований в нашем коде — один проход по библиотекам на запуск
let libs;
function libraryOf(name) {
  if (!libs) {
    const orphans = [...index.defs.keys()].filter((n) => !(index.uses.get(n) ?? []).some((u) => STRONG.has(u.kind)));
    libs = libraryHits(orphans, process.cwd());
  }
  return libs.get(name);
}

// file — CSS-файл, о котором спрашивают: для .module.css считаются только styles.x из его импортёров
function classify(name, defs, file) {
  const def = defs.find((d) => d.file === file) ?? defs.find((d) => !d.module) ?? defs[0];
  if (def?.module) defs = defs.filter((d) => d.file === def.file);
  const uses = usesFor(name, def);
  const strong = uses.filter((u) => STRONG.has(u.kind));
  const weak = uses.filter((u) => u.kind === 'string');
  const dyn = def?.module ? [] : dynamicMatches(index, name);
  const cssFiles = [...new Set(defs.map((d) => d.file))];
  const codeFiles = [...new Set(strong.map((u) => u.file))];
  const library = strong.length || dyn.length || def?.module ? undefined : libraryOf(name);
  let verdict;
  if (strong.length) verdict = 'used';
  else if (dyn.length) verdict = 'dynamic';
  else if (library) verdict = 'library';
  else if (weak.length) verdict = 'weak';
  else verdict = 'unused';
  return { name, verdict, defs, strong, weak, dynamic: dyn, library, cssFiles, codeFiles };
}

const VERDICT = {
  used: 'используется',
  dynamic: 'возможно, собирается шаблоном — не вырезать без проверки',
  weak: 'только как слово в строке — проверить глазами',
  library: 'рисует сторонняя библиотека — не вырезать',
  unused: 'не найден в коде',
};

const fmtUse = (u) => `${R(u.file)}:${u.line}${u.kind === 'class' ? '' : ` (${KIND[u.kind]})`}`;
const KIND = { class: 'className', selector: 'селектор', module: 'модуль', string: 'строка', dynamic: 'шаблон' };

function grouped(list, max = 12) {
  const byFile = new Map();
  for (const u of list) {
    const k = `${R(u.file)}${u.kind === 'class' ? '' : ` (${KIND[u.kind]})`}`;
    byFile.set(k, [...(byFile.get(k) ?? []), u.line]);
  }
  const lines = [...byFile].map(([f, ls]) => `${f}:${[...new Set(ls)].join(',')}`);
  return lines.length > max ? [...lines.slice(0, max), `… ещё ${lines.length - max} файлов`] : lines;
}

// ── классы по именам ─────────────────────────────────────────────
function cmdNames(names) {
  const res = names.map((n) => classify(n.replace(/^\./, ''), index.defs.get(n.replace(/^\./, '')) ?? []));
  out(res, () =>
    res
      .map((c) => {
        const lines = [`.${c.name} — ${VERDICT[c.verdict]}${c.library ? ` (${c.library})` : ''}`];
        if (!c.defs.length) lines.push('  определений в CSS нет');
        for (const d of c.defs)
          lines.push(`  css  ${R(d.file)}:${d.line}  ${d.selector}${d.at.length ? `  [${d.at.join(' › ')}]` : ''}`);
        for (const l of grouped(c.strong)) lines.push(`  код  ${l}`);
        for (const l of grouped(c.weak, 6)) lines.push(`  ?    ${l}`);
        for (const d of c.dynamic) lines.push(`  ~    ${fmtUse(d)}  \`${d.name}\${…}\``);
        return lines.join('\n');
      })
      .join('\n\n'),
  );
}

// ── все классы CSS-файла ─────────────────────────────────────────
function cmdCss(file) {
  const abs = resolve(file);
  const entry = index.css.find((c) => c.file === abs);
  if (!entry) {
    console.error(`CSS-файл не найден под ${R(root)}: ${file}`);
    process.exit(1);
  }
  const importers = index.importers.get(abs) ?? [];
  const names = [...new Set(entry.rules.flatMap((r) => r.classes))];
  const res = names.map((n) => {
    const c = classify(n, index.defs.get(n) ?? [], abs);
    const foreign = c.codeFiles.filter((f) => !importers.includes(f));
    const otherCss = entry.module ? [] : c.cssFiles.filter((f) => f !== abs);
    const home = homeOf(n);
    let scope = c.verdict === 'used' ? (foreign.length ? 'shared' : 'local') : c.verdict;
    if (!entry.module && home.length && !home.includes(abs)) scope = 'alien';
    return { ...c, scope, foreign, otherCss, home };
  });
  const order = { unused: 0, weak: 1, dynamic: 2, library: 3, shared: 4, local: 5, alien: 6 };
  res.sort((a, b) => order[a.scope] - order[b.scope] || a.name.localeCompare(b.name));
  out({ file: R(abs), importers: importers.map(R), classes: res }, () => {
    const lines = [
      `${R(abs)} — ${names.length} классов; подключают: ${importers.map(R).join(', ') || 'никто напрямую'}`,
    ];
    const SCOPE = {
      unused: 'НЕ НАЙДЕН — кандидат на удаление',
      weak: 'только слово в строке — проверить',
      dynamic: 'шаблонный класс — проверить',
      library: 'рисует сторонняя библиотека — не вырезать',
      shared: 'ОБЩИЙ — используют файлы, не подключающие этот CSS',
      local: 'свой',
      alien: 'ЧУЖОЙ — основное определение в другом файле, здесь только переопределение',
    };
    let cur;
    for (const c of res) {
      if (c.scope !== cur) lines.push(`\n${SCOPE[(cur = c.scope)]}:`);
      let s = `  .${c.name}`;
      if (c.scope === 'alien') s += `  ← ${c.home.map(R).join(', ')}`;
      else {
        if (c.scope === 'shared') s += `  ← ${short(c.foreign)}`;
        if (c.otherCss.length) s += `  [стилизуется ещё в ${short(c.otherCss)}]`;
      }
      if (c.scope === 'dynamic') s += `  ← ${c.dynamic.map(fmtUse).join(', ')}`;
      if (c.scope === 'weak') s += `  ← ${grouped(c.weak, 3).join('; ')}`;
      if (c.scope === 'library') s += `  ← ${c.library}`;
      lines.push(s);
    }
    return lines.join('\n');
  });
}

// «Дом» класса — файлы, где он стоит сам по себе: `.x`, `.x:hover`, `.x.mod`, без предков
function homeOf(name) {
  const re = new RegExp(`^\\.${name.replace(/[-]/g, '\\-')}((\\.[\\w-]+)|(::?[\\w-]+(\\([^)]*\\))?))*$`);
  const files = new Set();
  for (const d of index.defs.get(name) ?? [])
    if (d.selector.split(', ').some((s) => re.test(s.trim()))) files.add(d.file);
  return [...files];
}

const short = (files, max = 4) =>
  files.length > max ? `${files.slice(0, max).map(R).join(', ')} и ещё ${files.length - max}` : files.map(R).join(', ');

// ── мёртвые классы ───────────────────────────────────────────────
function cmdUnused(dir) {
  const base = dir ? resolve(dir) : root;
  const res = [];
  for (const [name, defs] of index.defs) {
    const inDir = defs.filter((d) => d.file.startsWith(base));
    if (!inDir.length) continue;
    const c = classify(name, defs);
    if (c.verdict !== 'used') res.push(c);
  }
  res.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.defs[0].file.localeCompare(b.defs[0].file));
  out(res, () => {
    if (!res.length) return 'Мёртвых классов не найдено.';
    return res
      .map(
        (c) =>
          `${c.verdict.padEnd(7)} .${c.name}  ${short(c.defs.map((d) => `${d.file}:${d.line}`))}${c.library ? `  ← ${c.library}` : ''}`,
      )
      .join('\n');
  });
}

// ── дубли объявлений ─────────────────────────────────────────────
function cmdDupes(dir, min) {
  const base = dir ? resolve(dir) : root;
  const rules = index.css
    .filter((c) => c.file.startsWith(base))
    .flatMap((c) => c.rules.map((r) => ({ ...r, file: c.file })))
    .filter((r) => r.decls.length >= min);
  const key = (r) => [...r.decls].sort().join('; ');
  const exact = new Map();
  for (const r of rules) exact.set(key(r), [...(exact.get(key(r)) ?? []), r]);
  const exactGroups = [...exact.values()].filter((g) => g.length > 1);
  // Почти одинаковые: ≥80% общих объявлений, в разных файлах
  const near = [];
  const sets = rules.map((r) => new Set(r.decls));
  for (let a = 0; a < rules.length; a++)
    for (let b = a + 1; b < rules.length; b++) {
      if (rules[a].file === rules[b].file || key(rules[a]) === key(rules[b])) continue;
      let common = 0;
      for (const d of sets[a]) if (sets[b].has(d)) common++;
      const sim = common / Math.max(sets[a].size, sets[b].size);
      if (sim >= 0.8) near.push({ sim, a: rules[a], b: rules[b], common });
    }
  near.sort((x, y) => y.sim - x.sim || y.common - x.common);
  const show = (r) => `${R(r.file)}:${r.line}  ${r.selector}`;
  const data = {
    exact: exactGroups.map((g) => ({ decls: g[0].decls, rules: g.map(show) })),
    near: near.map((n) => ({ similarity: +n.sim.toFixed(2), a: show(n.a), b: show(n.b) })),
  };
  out(data, () => {
    const lines = [`Одинаковые наборы объявлений (≥${min}): ${exactGroups.length}`];
    for (const g of exactGroups.sort((x, y) => y.length - x.length || y[0].decls.length - x[0].decls.length)) {
      lines.push(`\n× ${g.length}  { ${g[0].decls.join('; ')} }`);
      for (const r of g) lines.push(`    ${show(r)}`);
    }
    lines.push(`\nПочти одинаковые (≥80% общих, разные файлы): ${near.length}`);
    for (const n of near.slice(0, 60)) lines.push(`  ${Math.round(n.sim * 100)}%  ${show(n.a)}\n        ${show(n.b)}`);
    if (near.length > 60) lines.push(`  … ещё ${near.length - 60} (--json для полного списка)`);
    return lines.join('\n');
  });
}

// ── что берёт компонент ──────────────────────────────────────────
function cmdComponent(file) {
  const abs = resolve(file);
  const used = new Map();
  for (const list of index.uses.values())
    for (const u of list)
      if (u.file === abs && STRONG.has(u.kind)) used.set(u.name, [...(used.get(u.name) ?? []), u.line]);
  const ownCss = index.importers.size
    ? [...index.importers].filter(([, codes]) => codes.includes(abs)).map(([css]) => css)
    : [];
  const res = [...used].map(([name, lines]) => {
    const defs = index.defs.get(name) ?? [];
    return { name, lines, from: [...new Set(defs.map((d) => d.file))] };
  });
  res.sort((a, b) => (a.from[0] ?? '').localeCompare(b.from[0] ?? '') || a.name.localeCompare(b.name));
  out({ file: R(abs), imports: ownCss.map(R), classes: res }, () => {
    const lines = [`${R(abs)} — подключает CSS: ${ownCss.map(R).join(', ') || 'ничего'}`];
    const byCss = new Map();
    for (const c of res) {
      const k = c.from.length
        ? c.from.map(R).join(' + ')
        : '(нет определения — опечатка, класс из пропсов или мёртвый)';
      byCss.set(k, [...(byCss.get(k) ?? []), c]);
    }
    for (const [k, list] of byCss) {
      const foreign = list[0].from.length && !list[0].from.some((f) => ownCss.includes(f));
      lines.push(`\n${k}${foreign ? '  ← чужой CSS' : ''}:`);
      lines.push('  ' + list.map((c) => `.${c.name}`).join(' '));
    }
    return lines.join('\n');
  });
}

// ── проверка CSS-модулей ──────────────────────────────────────────
function cmdCheck() {
  const { missing, unused } = checkModules(index);
  out(
    { missing: missing.map((u) => ({ key: u.name, at: `${R(u.file)}:${u.line}`, module: R(u.module) })), unused },
    () => {
      const lines = [];
      if (missing.length) {
        lines.push(`Ключей нет в модуле (опечатка или класс не перенесён) — ${missing.length}:`);
        for (const u of missing) lines.push(`  styles.${u.name}  ${R(u.file)}:${u.line}  → ${R(u.module)}`);
      }
      if (unused.length) {
        lines.push(`${lines.length ? '\n' : ''}Классы модулей, которые никто не берёт — ${unused.length}:`);
        for (const u of unused) lines.push(`  .${u.name}  ${R(u.file)}`);
      }
      return lines.join('\n') || 'CSS-модули в порядке.';
    },
  );
  if (missing.length) process.exitCode = 1;
}

if (flag('--check')) cmdCheck();
else if (opt('--css')) cmdCss(opt('--css'));
else if (flag('--unused')) cmdUnused(opt('--dir'));
else if (flag('--dupes')) cmdDupes(opt('--dir'), Number(opt('--min', 3)));
else if (opt('--component')) cmdComponent(opt('--component'));
else if (positional.length) cmdNames(positional);
else {
  console.log(
    [
      'Где используются CSS-классы (корень — src):',
      '  node scripts/ui/classes.mjs <класс…>            определения и использования',
      '  node scripts/ui/classes.mjs --css <файл.css>    классы файла: свой / общий / мёртвый',
      '  node scripts/ui/classes.mjs --component <.tsx>  какие классы файл берёт и откуда',
      '  node scripts/ui/classes.mjs --unused [--dir d]  классы без использований',
      '  node scripts/ui/classes.mjs --dupes [--min 3]   одинаковые наборы объявлений',
      '  node scripts/ui/classes.mjs --check             styles.x без класса в .module.css; лишние классы модулей',
      '  --json  --root <папка>',
    ].join('\n'),
  );
}
