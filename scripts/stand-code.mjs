/** Доставка исходников стенда из текущего worktree без ручного git на удалённом хосте. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function freezeCode(repo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfc-stand-code-'));
  try {
    const files = execFileSync(
      'git',
      [
        '-C',
        repo,
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        'scripts',
        'cli',
        'packages',
        'server',
        'package.json',
        'package-lock.json',
      ],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    const manifest = {
      head: execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      files: [],
    };
    for (const name of [...new Set(files)].sort()) {
      const from = path.join(repo, name);
      if (!fs.existsSync(from)) continue;
      if (!fs.lstatSync(from).isFile()) throw new Error(`Исходник не обычный файл: ${name}`);
      const to = path.join(dir, name);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      manifest.files.push({ path: name, sha256: hash(to) });
    }
    for (const entry of manifest.files)
      if (hash(path.join(repo, entry.path)) !== entry.sha256)
        throw new Error('Исходники менялись при подготовке runtime; повторите постановку');
    fs.writeFileSync(path.join(dir, 'stand-code.json'), JSON.stringify(manifest));
    return { dir, manifest };
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
export function installCode(source, dest, repo) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'stand-code.json')));
  for (const file of manifest.files) {
    if (
      !/^(scripts|cli|packages|server)\/|^package(?:-lock)?\.json$/.test(file.path) ||
      file.path.split('/').includes('..')
    )
      throw new Error('Недопустимый путь исходника');
    const from = path.join(source, file.path);
    if (!fs.lstatSync(from).isFile() || hash(from) !== file.sha256)
      throw new Error(`Изменились исходники: ${file.path}`);
    const to = path.join(dest, file.path);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  if (hash(path.join(dest, 'package-lock.json')) !== hash(path.join(repo, 'package-lock.json')))
    throw new Error('Зависимости runtime отличаются: сначала ship с npm ci на стенде');
  fs.writeFileSync(path.join(dest, 'stand-code.json'), JSON.stringify(manifest));
  const modules = path.join(dest, 'node_modules');
  fs.mkdirSync(path.join(modules, '@tfc'), { recursive: true });
  let dependencies = repo;
  while (!fs.existsSync(path.join(dependencies, 'node_modules'))) {
    const parent = path.dirname(dependencies);
    if (parent === dependencies) throw new Error('Не найдены установленные зависимости runtime');
    dependencies = parent;
  }
  for (const name of fs.readdirSync(path.join(dependencies, 'node_modules'))) {
    if (name === '@tfc' || name === '.bin') continue;
    fs.symlinkSync(path.join(dependencies, 'node_modules', name), path.join(modules, name));
  }
  for (const [name, folder] of Object.entries({
    core: 'packages/core',
    cli: 'cli',
    scripts: 'scripts',
    'pack-server': 'server/pack-server',
    'file-server': 'server/file-server',
  }))
    fs.symlinkSync(path.join(dest, folder), path.join(modules, '@tfc', name));
  return { head: manifest.head, sha256: hash(path.join(dest, 'stand-code.json')), source: 'worktree' };
}

/** Полный список байтов пользовательских JAR, overlay и входного мира. */
export function describeInputs(args) {
  const files = [];
  const walk = (file) => {
    const st = fs.lstatSync(file);
    if (st.isDirectory()) for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name));
    else if (st.isFile()) files.push({ path: file, size: st.size, sha256: hash(file) });
    else throw new Error(`Вход не обычный файл/каталог: ${file}`);
  };
  for (let i = 0; i < args.length; i++) {
    if (
      ['--mod', '--overlay'].includes(args[i]) ||
      (args[i] === '--world' &&
        args[i + 1] !== 'flat' &&
        args[i + 1] !== 'new' &&
        !String(args[i + 1]).startsWith('new:'))
    )
      walk(path.resolve(args[++i]));
  }
  return files;
}

export function verifyCode(dir, expected) {
  const file = path.join(dir, 'stand-code.json');
  if (hash(file) !== expected.sha256) throw new Error('Изменён manifest runtime');
  const manifest = JSON.parse(fs.readFileSync(file));
  for (const entry of manifest.files) {
    if (hash(path.join(dir, entry.path)) !== entry.sha256) throw new Error(`Изменён runtime: ${entry.path}`);
  }
}
