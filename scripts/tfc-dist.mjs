#!/usr/bin/env node
/**
 * tfc одним файлом для игроков (docs/plans/pack-cli.md, этап 6): esbuild собирает cli/tfc.mjs в один скрипт,
 * Node SEA (Single Executable Applications) вшивает его в официальный бинарник Node для каждой ОС.
 *
 *   npm run tfc:dist [-- --only macos-arm64,win-x64] [--out dist-tfc] [--no-public]
 *
 * Результат — dist-tfc/: tfc-<ос>-<арх>[.exe] (сам файл), tfc-<ос>-<арх>.zip (его же сжатым — так он лежит на сайте)
 * и version.json; всё это копируется в public/tfc/ (вне git, уходит на хостинг при деплое).
 * Node для других ОС скачивается с nodejs.org той же версии, что запускает скрипт (блоб SEA привязан к версии),
 * сверяется с SHASUMS256.txt и кешируется в .cache/node-dist/.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { inject } from 'postject';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NODE_VERSION = process.versions.node;
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

/** Цели: имя (как в cli/lib/version.mjs targetName) → файл Node в дистрибутиве nodejs.org */
const TARGETS = {
  'win-x64': { dist: 'win-x64/node.exe', exe: '.exe' },
  'macos-arm64': { dist: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, macho: true },
  'macos-x64': { dist: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, macho: true },
  'linux-x64': { dist: `node-v${NODE_VERSION}-linux-x64.tar.gz` },
};

const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    out: { type: 'string', default: 'dist-tfc' },
    'no-public': { type: 'boolean' },
  },
});

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} МБ`;
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

/** Версия — последний коммит, менявший программу (и общие модули сайта в ней): пересборка без правок не заставит игроков обновляться */
function buildVersion() {
  const srcs = [
    'cli',
    'server/pack-server/lib/paths.mjs',
    'src/lib/datapackFiles.ts',
    'src/lib/schematicFile.ts',
    'src/lib/nbt.ts',
  ];
  const [ct, hash] = git('log', '-1', '--format=%ct %h', '--', ...srcs).split(' ');
  const time = Number(ct) * 1000;
  const day = new Date(time).toISOString().slice(0, 10).replaceAll('-', '.');
  const dirty = git('status', '--porcelain', '--', ...srcs) !== '';
  if (dirty) console.warn('[tfc:dist] в cli/ есть незакоммиченные правки — версия помечена -dirty');
  return { version: `${day}-${hash}${dirty ? '-dirty' : ''}`, time };
}

// ---------------------------------------------------------------- Node с nodejs.org

const cacheDir = path.join(ROOT, '.cache', 'node-dist', `v${NODE_VERSION}`);

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

let shasums;
async function officialSum(name) {
  shasums ??= (await download(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`)).toString('utf8');
  const line = shasums.split('\n').find((l) => l.trim().split(/\s+/)[1] === name);
  if (!line) throw new Error(`в SHASUMS256.txt v${NODE_VERSION} нет ${name}`);
  return line.split(/\s+/)[0];
}

/** Бинарник Node для цели: из кеша или с nodejs.org; хеш скачанного сверяется с SHASUMS256.txt */
async function nodeBinary(target) {
  const { dist, exe = '' } = TARGETS[target];
  const bin = path.join(cacheDir, target, `node${exe}`);
  if (fs.existsSync(bin)) return bin;
  const archive = path.join(cacheDir, path.basename(dist));
  const want = await officialSum(dist);
  if (!fs.existsSync(archive) || sha256(fs.readFileSync(archive)) !== want) {
    console.log(`[tfc:dist] скачиваю ${dist} с nodejs.org`);
    const buf = await download(`https://nodejs.org/dist/v${NODE_VERSION}/${dist}`);
    if (sha256(buf) !== want) throw new Error(`${dist}: хеш не совпал с SHASUMS256.txt — файл не тот, не использую`);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(archive, buf);
  }
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  if (dist.endsWith('.tar.gz')) {
    const inner = `${path.basename(dist, '.tar.gz')}/bin/node`;
    execFileSync('tar', ['-xzf', archive, '-C', path.dirname(bin), '--strip-components=2', inner]);
  } else fs.copyFileSync(archive, bin);
  return bin;
}

// ---------------------------------------------------------------- сборка

async function bundle(work, version) {
  const outfile = path.join(work, 'tfc.cjs');
  const res = await build({
    entryPoints: [path.join(ROOT, 'cli/tfc.mjs')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs', // SEA в Node 24 запускает только CommonJS
    target: `node${NODE_VERSION.split('.')[0]}`,
    define: { __TFC_BUILD__: JSON.stringify(version) },
    metafile: true,
    logLevel: 'warning',
    legalComments: 'none',
  });
  // Разборщики сайта (scripts/) в файл игроков попадать не должны: tfc build — команда только из проекта.
  // Из сайта — только общие модули без импортов (tfc pull) и fflate
  const foreign = Object.keys(res.metafile.inputs).filter(
    (f) =>
      !/^(cli|server\/pack-server\/lib)\/|^src\/lib\/(datapackFiles|schematicFile|nbt)\.ts$|^node_modules\/fflate\/|^<define:/.test(
        f,
      ),
  );
  if (foreign.length) throw new Error(`в сборку попали лишние файлы: ${foreign.join(', ')}`);
  return outfile;
}

function seaBlob(work, script) {
  const blob = path.join(work, 'sea.blob');
  const config = path.join(work, 'sea-config.json');
  fs.writeFileSync(
    config,
    JSON.stringify({
      main: script,
      output: blob,
      disableExperimentalSEAWarning: true,
      // Без снимка и кеша кода блоб не зависит от ОС: один на все цели (версия Node — та же)
      useSnapshot: false,
      useCodeCache: false,
    }),
  );
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
  return fs.readFileSync(blob);
}

async function makeBinary(target, blob, outDir) {
  const { exe = '', macho } = TARGETS[target];
  const file = path.join(outDir, `tfc-${target}${exe}`);
  fs.rmSync(file, { force: true });
  fs.copyFileSync(await nodeBinary(target), file);
  fs.chmodSync(file, 0o755);
  const canSign = process.platform === 'darwin';
  if (macho && canSign) execFileSync('codesign', ['--remove-signature', file]);
  await inject(file, 'NODE_SEA_BLOB', blob, {
    sentinelFuse: SEA_FUSE,
    ...(macho ? { machoSegmentName: 'NODE_SEA' } : {}),
  });
  // Mac на Apple Silicon не запускает файл без подписи; своя (ad-hoc) подпись — без сертификата Apple
  if (macho && canSign) execFileSync('codesign', ['--sign', '-', file]);
  else if (macho)
    console.warn(`[tfc:dist] ${target}: подписать можно только на macOS — на Apple Silicon не запустится`);
  return file;
}

/** zip с одним файлом: tfc.exe / tfc; бит «исполняемый» сохраняется (unzip, Архиватор macOS) */
function zipOne(file, name) {
  const data = fs.readFileSync(file);
  const zip = zipSync({ [name]: [data, { level: 9, os: 3, attrs: (0o100755 << 16) >>> 0 }] });
  const out = file.replace(/(\.exe)?$/, '.zip');
  fs.writeFileSync(out, zip);
  return out;
}

async function main() {
  const targets = args.only ? args.only.split(',') : Object.keys(TARGETS);
  for (const t of targets) if (!TARGETS[t]) throw new Error(`нет цели ${t}; есть: ${Object.keys(TARGETS).join(', ')}`);
  const outDir = path.resolve(ROOT, args.out);
  const work = path.join(ROOT, '.cache', 'tfc-dist');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(work, { recursive: true });

  const version = buildVersion();
  console.log(`[tfc:dist] tfc ${version.version}, Node ${NODE_VERSION}`);
  const blob = seaBlob(work, await bundle(work, version));

  const files = {};
  for (const t of targets) {
    const bin = await makeBinary(t, blob, outDir);
    const zip = zipOne(bin, `tfc${TARGETS[t].exe ?? ''}`);
    const z = fs.readFileSync(zip);
    files[t] = { file: path.basename(zip), size: z.length, sha256: sha256(z) };
    console.log(`  ${path.basename(bin)} ${mb(fs.statSync(bin).size)} → ${path.basename(zip)} ${mb(z.length)}`);
  }
  // Сайт держит все цели: собранные сейчас не должны стереть остальные из прежнего version.json
  const vfile = path.join(outDir, 'version.json');
  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(vfile, 'utf8'));
  } catch {}
  const keep = prev.version === version.version ? prev.files : {};
  fs.writeFileSync(
    vfile,
    `${JSON.stringify({ ...version, node: NODE_VERSION, files: { ...keep, ...files } }, null, 2)}\n`,
  );

  if (!args['no-public']) {
    const pub = path.join(ROOT, 'public', 'tfc');
    fs.rmSync(pub, { recursive: true, force: true });
    fs.mkdirSync(pub, { recursive: true });
    for (const f of [...Object.values({ ...keep, ...files }).map((x) => x.file), 'version.json'])
      fs.copyFileSync(path.join(outDir, f), path.join(pub, f));
    console.log(`[tfc:dist] zip и version.json — в public/tfc/ (уйдут на сайт при деплое)`);
  }
}

main().catch((e) => {
  console.error(`[tfc:dist] ${e.message}`);
  process.exit(1);
});
