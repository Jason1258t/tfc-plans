#!/usr/bin/env node
// Границы слоёв FSD: кто кого может импортировать.
//
//   node scripts/ui/boundaries.mjs             — проверка (код выхода 1, если есть нарушения)
//   node scripts/ui/boundaries.mjs --json      — машинный вывод
//   node scripts/ui/boundaries.mjs --list      — какая папка к какому слою отнесена
//
// Порядок слоёв (справа налево): app → pages → entities → shared. Слой может импортировать только
// себя и то, что справа. Старые папки (components/, lib/, data/, types/) — переходные: им можно всё,
// но их импорты в слои FSD отмечаются в отчёте (--legacy), чтобы видеть, что осталось разобрать.
//
// Исключения — scripts/ui/boundaries.allow.json: { "file": "src/shared/x.ts", "target": "@/entities/task",
// "note": "почему" }. Исключение живёт, пока код не починили; пустой список — цель.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const root = resolve('src');

/** Слой по пути файла: у старого кода — legacy, у слоя FSD — его имя */
function layerOf(file) {
  const rel = file.slice(root.length + 1);
  const [first] = rel.split('/');
  if (first === 'app' || rel === 'App.tsx' || rel === 'main.tsx') return 'app';
  if (first === 'pages') return 'pages';
  if (first === 'entities') return 'entities';
  if (first === 'shared') return 'shared';
  if (['components', 'lib', 'data', 'types'].includes(first)) return 'legacy';
  return 'other';
}

const PRIO = { shared: 0, entities: 1, pages: 2, app: 3 };

const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
/** Файлы, которые собирает Vite: обход без node_modules, dist и служебных папок */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXT.has(name.slice(name.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

/** Импорты файла: from '…', import('…'), export … from '…' — и куда они ведут */
function importsOf(file) {
  const text = readFileSync(file, 'utf8');
  const found = [];
  const re =
    /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[^.\w])import\s*\(\s*['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(re)) found.push(m[1] ?? m[2]);
  return found;
}

/** Разрешить спецификатор в файл проекта: '@/x' → src/x, './x' → рядом; внешние — null */
function resolveSpec(spec, file) {
  let base = null;
  if (spec.startsWith('@/')) base = join(root, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(file), spec);
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  // импорт в несуществующий путь ловит tsc; здесь не наша забота
  return null;
}

const allowFile = join(import.meta.dirname, 'boundaries.allow.json');
const allow = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')) : [];
const isAllowed = (file, target) =>
  allow.some((a) => a.file === relative(resolve('.'), file).replaceAll('\\', '/') && target.startsWith(a.target));

const files = walk(root);
const violations = [];
const legacyEdges = [];

for (const file of files) {
  const from = layerOf(file);
  if (from === 'other') continue;
  for (const spec of importsOf(file)) {
    const target = resolveSpec(spec, file);
    if (!target) continue;
    const to = layerOf(target);
    if (to === 'other' || to === 'legacy') {
      if (from !== 'legacy') legacyEdges.push({ file, spec, to });
      continue;
    }
    if (from === 'legacy') {
      if (to === 'pages' || to === 'entities') legacyEdges.push({ file, spec, to });
      continue;
    }
    if (PRIO[to] > PRIO[from] && !isAllowed(file, spec)) violations.push({ file, spec, from, to });
  }
}

const R = (p) => relative(resolve('.'), p).replaceAll('\\', '/');
const json = flag('--json');

if (flag('--list')) {
  const byLayer = new Map();
  for (const f of files) {
    const l = layerOf(f);
    byLayer.set(l, (byLayer.get(l) ?? 0) + 1);
  }
  for (const [l, n] of [...byLayer].sort((a, b) => PRIO[a[0]] - PRIO[b[0]])) console.log(`${l.padEnd(9)} ${n} файлов`);
  process.exit(0);
}

if (json) {
  console.log(
    JSON.stringify(
      { violations: violations.map((v) => ({ ...v, file: R(v.file) })), legacyEdges: legacyEdges.length },
      null,
      2,
    ),
  );
} else {
  if (violations.length) {
    console.log(`Импорты «снизу вверх» (слой берёт то, что слева от него): ${violations.length}\n`);
    for (const v of violations) console.log(`✗ ${R(v.file)}  →  ${v.spec}  (${v.from} → ${v.to})`);
    console.log(`\nЧинится переносом кода вниз или исключением в src/ui/boundaries.allow.json с причиной.`);
  } else console.log('Границы слоёв в порядке.');
  if (flag('--legacy')) {
    if (legacyEdges.length) {
      console.log(`\nПереходные папки (components/, lib/, data/, types/) ходят в слои FSD: ${legacyEdges.length}`);
      for (const e of legacyEdges.slice(0, 20)) console.log(`· ${R(e.file)} → ${e.spec}`);
    } else console.log('\nПереходных импортов из старых папок в слои FSD нет.');
  }
  if (violations.length) process.exitCode = 1;
}
