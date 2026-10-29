/**
 * Git/workflow tools для tfc-plans-dev: ворктри, ветки, коммит, сдача. Все операции — только в репозитории проекта
 * (корень основной копии, ворктри — .claude/worktrees/<name>). Без --force; перед мутацией — превью; ship — только
 * с confirm=true. Ответ — короткий русский текст.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_TOOLS } from './devtasks.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** Корень основной копии репозитория (там живут ворктри и main); TFC_PLANS_REPO переопределяет */
function repoRoot() {
  if (process.env.TFC_PLANS_REPO) return path.resolve(process.env.TFC_PLANS_REPO);
  try {
    const common = execFileSync('git', ['-C', HERE, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.resolve(path.dirname(common));
  } catch {
    return HERE;
  }
}

function git(args, cwd) {
  try {
    return { ok: true, out: execFileSync('git', args, { cwd, encoding: 'utf8' }).trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout ?? '').toString().trim(), err: (e.stderr ?? '').toString().trim() };
  }
}

/** Запустить node-скрипт (bin) с аргументами и cwd; вернуть { ok, out, err } */
function runBin(node, args, cwd) {
  try {
    return { ok: true, out: execFileSync(node, args, { cwd, encoding: 'utf8' }).trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout ?? '').toString().trim(), err: (e.stderr ?? '').toString().trim() };
  }
}

/** Изменённые веткой файлы (от merge-base main) */
function changedFiles(root, branch) {
  const base = git(['merge-base', 'main', branch], root);
  if (!base.ok) return [];
  return git(['diff', '--name-only', base.out, branch], root)
    .out.split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Линт и формат-проверка изменённых веткой файлов. Бинарники — из node_modules основной копии
 * (TFC_LINT_TOOLS переопределяет путь к node_modules). Пусто — всё чисто.
 */
function lintGate(root, wt, branch) {
  // tools/ — submodule tfc-addons: его файлы проверяет свой репозиторий
  const files = changedFiles(root, branch).filter(
    (f) => f !== 'tools' && !f.startsWith('tools/') && fs.existsSync(path.join(wt, f)),
  );
  if (!files.length) return [];
  const node = process.execPath;
  const base = process.env.TFC_LINT_TOOLS ? path.resolve(process.env.TFC_LINT_TOOLS) : path.join(root, 'node_modules');
  const ox = path.join(base, 'oxlint', 'bin', 'oxlint');
  const pr = path.join(base, 'prettier', 'bin', 'prettier.cjs');
  const lintFiles = files.filter((f) => /^(src|scripts|packages)\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));
  const fmtFiles = files.filter(
    (f) => /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md|yaml|yml)$/.test(f) && f !== 'package-lock.json',
  );
  const problems = [];
  if (lintFiles.length) {
    if (fs.existsSync(ox)) {
      const r = runBin(node, [ox, ...lintFiles], wt);
      if (!r.ok) problems.push(`oxlint:\n${(r.err || r.out).slice(0, 1500)}`);
    } else problems.push('oxlint не установлен — npm install в основной копии');
  }
  if (fmtFiles.length) {
    if (fs.existsSync(pr)) {
      const r = runBin(node, [pr, '--check', ...fmtFiles], wt);
      if (!r.ok) problems.push(`prettier --check:\n${(r.err || r.out).slice(0, 1500)}`);
    } else problems.push('prettier не установлен — npm install в основной копии');
  }
  return problems;
}

const BRANCH_TYPES = ['feat', 'refactor', 'fix'];
const validName = (n) => /^[a-z0-9][a-z0-9-]*$/.test(n);

const worktreeDir = (root, name) => path.join(root, '.claude', 'worktrees', name);
const worktreeBranch = (root, name) => {
  const r = git(['branch', '--show-current'], worktreeDir(root, name));
  return r.ok ? r.out : '';
};

/** main должен быть чистым и на ветке main — иначе отказываемся (параллельные агенты) */
function requireMainClean(root) {
  const br = git(['branch', '--show-current'], root);
  if (!br.ok || br.out !== 'main') throw new Error(`основная копия не на main (${br.out || br.err}) — отказываюсь`);
  const st = git(['status', '--short'], root);
  if (!st.ok || st.out) throw new Error(`в основной копии есть незакоммиченное: ${st.out || st.err}`);
}

function gitState(a) {
  const root = repoRoot();
  const name = String(a.worktree ?? '').trim();
  if (!name) {
    const br = git(['branch', '--show-current'], root).out;
    const st = git(['status', '--short'], root).out || '(чисто)';
    const sync = git(['rev-list', '--left-right', '--count', 'main...origin/main'], root).out;
    const wl = git(['worktree', 'list'], root).out;
    return [
      `Репозиторий: ${root}`,
      `main: ветка ${br}; статус: ${st}`,
      `main vs origin/main (слева — только локально, справа — только origin): ${sync || '?'}`,
      `Ворктри:\n${wl}`,
    ].join('\n');
  }
  if (!validName(name)) throw new Error('worktree — kebab-case');
  const wt = worktreeDir(root, name);
  if (!fs.existsSync(wt)) return `Ворктри ${name} нет.\n${git(['worktree', 'list'], root).out}`;
  const br = git(['branch', '--show-current'], wt).out;
  const st = git(['status', '--short'], wt).out || '(чисто)';
  return `Ворктри ${name}: ветка ${br}; статус: ${st}`;
}

function worktreeAdd(a) {
  const root = repoRoot();
  const name = String(a.name ?? '').trim();
  const type = BRANCH_TYPES.includes(a.type) ? a.type : 'feat';
  if (!validName(name)) throw new Error('name — латиница, цифры, дефисы (kebab-case)');
  const branch = `${type}/${name}`;
  requireMainClean(root);
  if (fs.existsSync(worktreeDir(root, name))) throw new Error(`Ворктри ${name} уже есть`);
  const r = git(['worktree', 'add', `.claude/worktrees/${name}`, '-b', branch, 'main'], root);
  if (!r.ok) throw new Error(r.err || r.out);
  const sub = initAddons(root, worktreeDir(root, name));
  return `Создано: ворктри .claude/worktrees/${name}, ветка ${branch}. Работай только в нём.${sub ? '\n' + sub : ''}`;
}

/**
 * Аддоны — submodule tools/ (репозиторий tfc-addons, dev #138): достать в ворктри. Объекты берём из копии основной
 * папки (.git/modules/tools), чтобы не качать заново. Вернуть строку-предупреждение или ''.
 */
function initAddons(root, wt) {
  if (!fs.existsSync(path.join(wt, '.gitmodules'))) return '';
  const ref = path.join(root, '.git', 'modules', 'tools');
  const args = ['submodule', 'update', '--init', ...(fs.existsSync(ref) ? ['--reference', ref] : []), 'tools'];
  const s = git(args, wt);
  return s.ok ? '' : `⚠ аддоны (tools/) не подтянулись: ${s.err || s.out} — git submodule update --init tools`;
}

/**
 * git не удаляет ворктри с подключённым submodule. Если в tools/ нет правок и незапушенных коммитов — отключаем его
 * (deinit без -f сам откажется при правках) и убираем его .git ворктри; дальше обычный worktree remove.
 */
function addonsLocalProblem(wt) {
  const tools = path.join(wt, 'tools');
  if (!fs.existsSync(path.join(tools, '.git'))) return '';
  const dirty = git(['status', '--short'], tools);
  if (!dirty.ok || dirty.out) return `в tools/ есть незакоммиченное: ${dirty.out || dirty.err}`;
  const local = git(['log', '--branches', '--not', '--remotes', '--oneline'], tools);
  return local.out ? `в tools/ есть незапушенные коммиты tfc-addons:\n${local.out}` : '';
}

function releaseAddons(root, wt) {
  if (!fs.existsSync(path.join(wt, 'tools', '.git'))) return;
  const problem = addonsLocalProblem(wt);
  if (problem) throw new Error(problem);
  const d = git(['submodule', 'deinit', 'tools'], wt);
  if (!d.ok) throw new Error(`submodule deinit tools: ${d.err || d.out}`);
  const gd = git(['rev-parse', '--path-format=absolute', '--git-dir'], wt);
  if (gd.ok) fs.rmSync(path.join(gd.out, 'modules'), { recursive: true, force: true });
}

/** Указатель tools/ ветки должен быть в origin/main репозитория аддонов — иначе main сошлётся на чужой коммит */
function addonsPointerProblem(root, wt, branch) {
  if (!changedFiles(root, branch).includes('tools')) return '';
  const sha = git(['rev-parse', `${branch}:tools`], root);
  if (!sha.ok) return '';
  const tools = path.join(wt, 'tools');
  const f = git(['fetch', '-q', 'origin', 'main'], tools);
  if (!f.ok) return `tools/: не смог проверить ${sha.out.slice(0, 8)} в tfc-addons (${f.err || f.out})`;
  const anc = git(['merge-base', '--is-ancestor', sha.out, 'origin/main'], tools);
  return anc.ok
    ? ''
    : `tools/ указывает на ${sha.out.slice(0, 8)}, которого нет в origin/main tfc-addons — запушь и влей аддон там`;
}

function commit(a) {
  const root = repoRoot();
  const name = String(a.worktree ?? '').trim();
  const message = String(a.message ?? '').trim();
  if (!validName(name)) throw new Error('worktree — имя ворктри (kebab-case)');
  if (!message) throw new Error('message — текст коммита (одна строка: Раздел: что сделано)');
  const wt = worktreeDir(root, name);
  if (!fs.existsSync(wt)) throw new Error(`Ворктри ${name} нет`);
  const br = worktreeBranch(root, name);
  if (br === 'main') throw new Error('в main не коммитим');
  if (!git(['config', 'user.name'], wt).out) throw new Error('нет git identity (git config user.name) — задай');
  const add = git(['add', '-A'], wt);
  if (!add.ok) throw new Error(add.err || add.out);
  const st = git(['status', '--short'], wt);
  if (!st.out) return `В ворктри ${name} нечего коммитить (чисто).`;
  const r = git(['commit', '-m', message], wt);
  if (!r.ok) throw new Error(r.err || r.out);
  return `Закоммичено в ${br}: ${message}\n${r.out}`;
}

function ship(a) {
  const root = repoRoot();
  const name = String(a.worktree ?? '').trim();
  const confirm = a.confirm === true;
  if (!validName(name)) throw new Error('worktree — имя ворктри (kebab-case)');
  const wt = worktreeDir(root, name);
  if (!fs.existsSync(wt)) throw new Error(`Ворктри ${name} нет`);
  const branch = worktreeBranch(root, name);
  if (!branch) throw new Error(`Не вижу ветку ворктри ${name}`);
  if (branch === 'main') throw new Error('worktree — ветка main, нечего сливать');

  const subj = String(a.note ?? '').trim() || git(['log', '-1', '--format=%s', branch], root).out;
  const mainBr = git(['branch', '--show-current'], root).out;
  const mainSt = git(['status', '--short'], root).out;
  const wtSt = git(['status', '--short'], wt).out;
  const lint = lintGate(root, wt, branch);
  for (const p of [addonsPointerProblem(root, wt, branch), addonsLocalProblem(wt)]) if (p) lint.push(p);
  const plan = [
    `Сдача ворктри ${name} (ветка ${branch}):`,
    `  1) git merge --no-ff ${branch} -m "Слияние ${branch}: ${subj}"`,
    `  2) git push origin main`,
    `  3) git worktree remove .claude/worktrees/${name} && git branch -d ${branch}`,
    `main: ветка ${mainBr}; статус: ${mainSt || '(чисто)'}`,
    `ворктри ${name}: ${wtSt ? 'незакоммиченное: ' + wtSt : '(чисто)'}`,
    `линт/формат изменённых файлов: ${lint.length ? 'ЕСТЬ ПРОБЛЕМЫ' : 'ок'}`,
  ];
  if (!confirm)
    return [
      ...plan,
      ...(lint.length ? ['', ...lint.map((p) => `  ⚠ ${p}`)] : []),
      '',
      'Др-ран (превью). Для выполнения — confirm=true.',
    ].join('\n');

  if (mainBr !== 'main') throw new Error(`main не на ветке main (${mainBr}) — отказываюсь`);
  if (mainSt) throw new Error(`в main есть незакоммиченное: ${mainSt}`);
  if (wtSt) throw new Error(`в ворктри ${name} есть незакоммиченное: ${wtSt}`);
  if (lint.length) throw new Error(`линт/формат не прошли — почини и повтори:\n${lint.join('\n')}`);
  const m = git(['merge', '--no-ff', branch, '-m', `Слияние ${branch}: ${subj}`], root);
  if (!m.ok) throw new Error(`merge не удался: ${m.err || m.out}`);
  const p = git(['push', 'origin', 'main'], root);
  if (!p.ok) throw new Error(`push не удался: ${p.err || p.out}\n(ворктри не тронут — разберись и повтори)`);
  // merge не трогает рабочую копию submodule: аддоны в основной папке — на указатель из main
  const sub = fs.existsSync(path.join(root, '.gitmodules'))
    ? git(['submodule', 'update', '--init', 'tools'], root)
    : null;
  releaseAddons(root, wt);
  const rm = git(['worktree', 'remove', `.claude/worktrees/${name}`], root);
  if (!rm.ok) throw new Error(`worktree remove не удался: ${rm.err || rm.out}`);
  const d = git(['branch', '-d', branch], root);
  return [
    `Слито и запушено: ${branch} → main.`,
    m.out,
    p.out,
    sub && !sub.ok ? `⚠ tools/ в основной папке не обновлён: ${sub.err || sub.out}` : '',
    d.ok ? `Ветка ${branch} удалена.` : `Ветка ${branch} НЕ удалена (${d.err || d.out}).`,
  ]
    .filter(Boolean)
    .join('\n');
}

function worktreeRemove(a) {
  const root = repoRoot();
  const name = String(a.worktree ?? '').trim();
  if (!validName(name)) throw new Error('worktree — имя ворктри (kebab-case)');
  const wt = worktreeDir(root, name);
  if (!fs.existsSync(wt)) throw new Error(`Ворктри ${name} нет`);
  const branch = worktreeBranch(root, name);
  releaseAddons(root, wt);
  const r = git(['worktree', 'remove', `.claude/worktrees/${name}`], root);
  if (!r.ok) throw new Error(r.err || r.out);
  const d = git(['branch', '-d', branch], root);
  return [
    `Ворктри ${name} удалён.`,
    d.ok
      ? `Ветка ${branch} удалена.`
      : `Ветка ${branch} НЕ удалена (${d.err || d.out}) — git branch -D вручную, если уверен.`,
  ].join('\n');
}

const str = (description) => ({ type: 'string', description });

export const TOOLS = [
  {
    name: 'git_state',
    description:
      'Repo state: main branch/cleanliness, main vs origin ahead-behind, worktree list; with worktree — that worktree branch/status.',
    inputSchema: { type: 'object', properties: { worktree: str('worktree short name (optional)') } },
    handler: gitState,
  },
  {
    name: 'worktree_add',
    description:
      'Create a worktree .claude/worktrees/<name> + branch <type>/<name> from main (refuses if main is dirty or not on main).',
    inputSchema: {
      type: 'object',
      properties: {
        name: str('short name, kebab-case'),
        type: { type: 'string', enum: BRANCH_TYPES, description: 'branch prefix (default feat)' },
      },
      required: ['name'],
    },
    handler: worktreeAdd,
  },
  {
    name: 'commit',
    description: 'Stage all and commit in a worktree (refuses on main; message one line «Раздел: что сделано»).',
    inputSchema: {
      type: 'object',
      properties: { worktree: str('worktree short name'), message: str('commit message') },
      required: ['worktree', 'message'],
    },
    handler: commit,
  },
  {
    name: 'ship',
    description:
      'Merge the worktree branch into main (--no-ff), push origin/main, remove the worktree and branch. Dry-run preview unless confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        worktree: str('worktree short name'),
        note: str('merge-commit summary (default — last commit subject)'),
        confirm: { type: 'boolean', description: 'execute (default false = preview only)' },
      },
      required: ['worktree'],
    },
    handler: ship,
  },
  {
    name: 'worktree_remove',
    description: 'Remove a worktree and delete its branch (branch only if merged).',
    inputSchema: { type: 'object', properties: { worktree: str('worktree short name') }, required: ['worktree'] },
    handler: worktreeRemove,
  },
  ...DEV_TOOLS,
];

export const INSTRUCTIONS = `Git/workflow for the «TFC Планы» repo (main checkout auto-detected via git common dir; TFC_PLANS_REPO overrides). Use instead of hand-running git for the session workflow: git_state (branch/dirty/worktrees/ahead-behind), worktree_add (create .claude/worktrees/<name> + branch feat|refactor|fix/<name> from a clean main), commit (stage+commit in a worktree, refuses on main), ship (merge --no-ff into main → push origin/main → remove worktree+branch; runs oxlint + prettier --check on the branch changed files and refuses on failure; dry-run unless confirm=true), worktree_remove (remove a worktree; branch deleted only if merged). No --force; refuses on a dirty/non-main main. Dev tasks and the work log (pack server SQLite, zero Firestore reads): dev_list, dev_get → dev_update with baseRev (status, assignee, branch, report), dev_create, dev_note, dev_doc_get/dev_doc_put (plan docs). Players' site tasks stay in tfc-pack. Tool output in Russian.`;
