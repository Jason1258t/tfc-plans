#!/usr/bin/env node
/**
 * Границы пакетов репозитория (dev #138, план 23): сайт (корень: src/, vite.config.ts), @tfc/core, @tfc/scripts,
 * @tfc/cli, @tfc/pack-server, @tfc/file-server. Правила:
 *   - относительный импорт не выходит из папки своего пакета — чужой код только как `@tfc/<пакет>/<модуль>`;
 *   - внешний пакет (и `@tfc/*`) объявлен в package.json своего пакета (у сайта — корневой);
 *   - `@/…` — только сайт.
 * Исключение — комментарий `граница-ок: <почему>` на строке импорта или над ней. npm run boundaries; CI.
 */
import { builtinModules } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Пакеты: папка → package.json; сайт — корень, его код — src/ и конфиги в корне */
const PACKAGES = [
  { name: 'сайт', dirs: ['src', 'vite.config.ts'], pkg: '.' },
  { name: '@tfc/core', dirs: ['packages/core'], pkg: 'packages/core' },
  { name: '@tfc/scripts', dirs: ['scripts'], pkg: 'scripts' },
  { name: '@tfc/cli', dirs: ['cli'], pkg: 'cli' },
  { name: '@tfc/pack-server', dirs: ['server/pack-server'], pkg: 'server/pack-server' },
  { name: '@tfc/file-server', dirs: ['server/file-server'], pkg: 'server/file-server' },
];
const SKIP = new Set(['node_modules', 'dist', 'data', '.cache', 'build']);
const BUILTIN = new Set(builtinModules);

const ownerOf = (rel) => PACKAGES.find((p) => p.dirs.some((d) => rel === d || rel.startsWith(`${d}/`)));

function declared(p) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, p.pkg, 'package.json'), 'utf8'));
  return new Set(
    [j.dependencies, j.devDependencies, j.peerDependencies, j.optionalDependencies].flatMap((d) =>
      Object.keys(d ?? {}),
    ),
  );
}

function* files(abs) {
  const st = fs.statSync(abs, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isFile()) {
    if (/\.(mjs|cjs|js|ts|tsx)$/.test(abs)) yield abs;
    return;
  }
  for (const e of fs.readdirSync(abs, { withFileTypes: true }))
    if (!SKIP.has(e.name) && !e.name.startsWith('.')) yield* files(path.join(abs, e.name));
}

const IMPORT_RE =
  /(?:^|[\n;])\s*(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1|(?:^|[\n;])\s*import\s*(['"])([^'"]+)\3|\bimport\(\s*(['"])([^'"]+)\5\s*\)/g;

export function checkBoundaries(root = ROOT) {
  const problems = [];
  for (const p of PACKAGES) {
    const deps = declared(p);
    for (const d of p.dirs)
      for (const f of files(path.join(root, d))) {
        const rel = path.relative(root, f);
        const txt = fs.readFileSync(f, 'utf8');
        const lines = txt.split('\n');
        for (const m of txt.matchAll(IMPORT_RE)) {
          const spec = (m[2] ?? m[4] ?? m[6]).split('?')[0];
          const at = txt.slice(0, m.index + m[0].length).split('\n').length - 1;
          if (/^\s*(\*|\/\/|\/\*)/.test(lines[at] ?? '')) continue; // пример в комментарии
          if (/граница-ок/.test(lines[at] ?? '') || /граница-ок/.test(lines[at - 1] ?? '')) continue;
          const where = `${rel}:${at + 1}`;
          if (spec.startsWith('node:') || BUILTIN.has(spec) || spec.startsWith('/') || spec.startsWith('virtual:'))
            continue;
          if (spec.startsWith('.')) {
            const target = path.relative(root, path.resolve(path.dirname(f), spec));
            const o = ownerOf(target);
            if (o !== p)
              problems.push(`${where}: ${p.name} берёт чужой файл ${target}${o ? ` — импорт ${o.name}/…` : ''}`);
          } else if (spec.startsWith('@/')) {
            if (p.name !== 'сайт') problems.push(`${where}: '@/…' — алиас сайта, в ${p.name} его нет`);
          } else {
            const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
            if (!deps.has(name)) problems.push(`${where}: ${name} не объявлен в ${p.pkg}/package.json`);
          }
        }
      }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkBoundaries();
  if (problems.length) {
    console.error(`Границы пакетов нарушены (${problems.length}):\n${problems.map((x) => `  ${x}`).join('\n')}`);
    process.exit(1);
  }
  console.log('Границы пакетов в порядке.');
}
