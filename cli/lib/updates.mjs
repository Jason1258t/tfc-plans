/**
 * Предложенные обновления сборки (server/pack-server/lib/updates.mjs).
 *   tfc admin propose <папка> [--remove <путь>…] --note "…" — выложить: файлы из папки (пути как в снимке: kubejs/…,
 *     config/…) и пути, которые убрать. Так обновляет сборку Claude или администратор не с ПК хоста.
 *   tfc admin updates [list] — что ждёт; pull [id…] — забрать в папку игры (и сервера, если она в профиле), с копией
 *     для tfc undo; approve <id> — сделать из текущей сборки с этими изменениями новую текущую; reject <id>.
 */
import fs from 'node:fs';
import path from 'node:path';
import { classifyPath } from '@tfc/pack-server/paths';
import { loadState, saveState } from './plan.mjs';
import { localPath, sha256File } from './scan.mjs';
import { assertNotLocked, beginBackup, editBackup, finishBackup, toBackup } from './sync.mjs';
import { bold, confirm, cyan, date, dim, green, interactive, mb, progress, yellow } from './ui.mjs';

/** Файлы папки-накладки: [{ path, file }]; файлы в её корне (README, скрипты) — не часть сборки */
function listOverlay(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const file = path.join(d, e.name);
      if (e.isDirectory()) walk(file);
      else if (e.isFile()) out.push({ path: path.relative(dir, file).split(path.sep).join('/'), file });
    }
  };
  walk(dir);
  return out.filter((f) => f.path.includes('/'));
}

const STATUS = { pending: yellow('ждёт'), approved: green('одобрено'), rejected: dim('отклонено') };

export function printUpdate(u, { full = true } = {}) {
  console.log(
    `${bold(u.id)} ${STATUS[u.status] ?? u.status} ${dim(`${date(Date.parse(u.createdAt))}, ${u.author}`)}${u.snapshot ? dim(` → сборка ${u.snapshot}`) : ''}`,
  );
  console.log(`  ${u.note}`);
  if (!full) return;
  for (const f of u.files) console.log(`    ~ ${f.path} ${dim(mb(f.size))}`);
  for (const p of u.remove) console.log(`    − ${p}`);
  if (u.reason) console.log(dim(`  причина: ${u.reason}`));
}

export async function propose(api, { dir, remove = [], note, yes, dryRun }) {
  if (!dir && !remove.length) throw new Error('tfc admin propose <папка> [--remove <путь>…] --note "что и зачем"');
  if (!note?.trim()) throw new Error('--note "что меняется и зачем" — его увидит хост');
  if (dir && !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`нет папки ${dir}`);
  const current = await api.get('/pack/current');
  const cur = new Map(current.files.map((f) => [f.path, f.sha256]));
  const overlay = dir ? listOverlay(path.resolve(dir)) : [];
  const bad = overlay.map((f) => [f.path, classifyPath(f.path)]).filter(([, c]) => c.error);
  if (bad.length)
    throw new Error(`эти пути сервер не примет:\n${bad.map(([p, c]) => `  ${p} — ${c.error}`).join('\n')}`);
  for (const f of overlay) {
    f.size = fs.statSync(f.file).size;
    f.sha256 = await sha256File(f.file);
  }
  const files = overlay.filter((f) => cur.get(f.path) !== f.sha256);
  const unknown = remove.filter((p) => !cur.has(p));
  if (unknown.length) throw new Error(`в сборке нет: ${unknown.join(', ')}`);
  if (!files.length && !remove.length) return console.log('В сборке уже всё так — предлагать нечего.');

  console.log(`К сборке ${dim(current.id)}:`);
  for (const f of files) console.log(`    ${cur.has(f.path) ? '~' : '+'} ${f.path}`);
  for (const p of remove) console.log(`    − ${p}`);
  const same = overlay.length - files.length;
  if (same) console.log(dim(`  ещё ${same} файлов уже такие же`));
  if (dryRun) return;
  if (!yes) {
    if (!interactive()) throw new Error('подтвердите: tfc admin propose … --yes');
    if (!(await confirm('Выложить хосту на одобрение?', true))) return;
  }
  const uniq = [...new Map(files.map((f) => [f.sha256, f])).values()];
  const { missing } = uniq.length
    ? await api.post('/blobs/missing', { sha256: uniq.map((f) => f.sha256) })
    : { missing: [] };
  const need = uniq.filter((f) => missing.includes(f.sha256));
  if (need.length) {
    const bar = progress(
      'заливка',
      need.reduce((s, f) => s + f.size, 0),
    );
    for (const f of need) await api.upload(f.file, f.sha256, (n) => bar.add(n));
    bar.end();
  }
  const u = await api.post('/admin/updates', {
    note,
    files: files.map((f) => ({ path: f.path, sha256: f.sha256, size: f.size })),
    remove,
  });
  console.log(
    `${bold('Выложено:')} обновление ${u.id}. Хосту: ${cyan(`tfc admin updates pull ${u.id}`)}, проверить, ${cyan(`tfc admin updates approve ${u.id}`)}.`,
  );
  return u;
}

/** Куда класть путь снимка у хоста: папка игры и, для серверных папок, папка сервера */
function targetsOf(profile, p) {
  const out = [];
  const inst = localPath(profile, p);
  if (inst) out.push({ file: inst, main: true });
  const top = p.split('/')[0];
  const sd = profile.serverDir;
  if (sd && ['mods', 'config', 'defaultconfigs', 'kubejs'].includes(top) && fs.existsSync(path.join(sd, top))) {
    const f = path.join(sd, ...p.split('/'));
    if (f !== inst) out.push({ file: f, main: false });
  }
  return out;
}

/** Забрать обновления в папки хоста. Возвращает папку копии или null */
export async function pullUpdates(api, profile, list, { yes, dryRun }) {
  const backup = beginBackup(profile);
  let applied = 0;
  for (const u of list) {
    console.log('');
    printUpdate(u);
    const writes = [];
    const removes = [];
    for (const f of u.files)
      for (const t of targetsOf(profile, f.path)) {
        const same = fs.existsSync(t.file) && (await sha256File(t.file)) === f.sha256;
        if (!same) writes.push({ ...t, path: f.path, sha256: f.sha256 });
      }
    for (const p of u.remove)
      for (const t of targetsOf(profile, p)) if (fs.existsSync(t.file)) removes.push({ ...t, path: p });
    if (!writes.length && !removes.length) {
      console.log(dim('  У вас уже всё так.'));
      continue;
    }
    for (const w of writes) console.log(`  ${fs.existsSync(w.file) ? '~' : '+'} ${w.file}`);
    for (const r of removes) console.log(`  − ${r.file}`);
    if (dryRun) continue;
    if (!yes) {
      if (!interactive()) throw new Error('подтвердите: tfc admin updates pull --yes');
      if (!(await confirm('Забрать?', true))) continue;
    }
    assertNotLocked([...writes, ...removes].map((x) => x.file).filter((f) => fs.existsSync(f)));
    const bytes = new Map();
    for (const w of writes) if (!bytes.has(w.sha256)) bytes.set(w.sha256, await api.bytes(`/blobs/${w.sha256}`));
    for (const w of writes) {
      const exists = fs.existsSync(w.file);
      if (w.main) {
        if (exists) toBackup(backup, w.file, w.path, 'replaced');
        else backup.manifest.added.push(w.path);
      } else if (exists) editBackup(backup, w.file);
      fs.mkdirSync(path.dirname(w.file), { recursive: true });
      fs.writeFileSync(w.file, bytes.get(w.sha256));
    }
    for (const r of removes) {
      if (r.main) toBackup(backup, r.file, r.path, 'removed');
      else {
        editBackup(backup, r.file);
        fs.rmSync(r.file);
      }
    }
    applied++;
    console.log(green('  Забрано.'));
  }
  if (dryRun) return console.log(dim('\n--dry-run: ничего не менял'));
  const dir = finishBackup(profile, backup);
  if (applied)
    console.log(
      `\n${green('Готово.')}${dir ? dim(` Прежние файлы — ${dir}; вернуть: tfc undo`) : ''}\nПроверьте в игре (сервер — перезапустить или /reload), потом ${cyan('tfc admin updates approve <id>')} — или reject и tfc undo.`,
    );
  return dir;
}

/**
 * После одобрения: папка хоста, где файлы обновления уже лежат, считается синхронной с новой сборкой —
 * чтобы следующий tfc publish не принял это за чужие правки, а tfc pull — за правки хоста.
 */
export async function markApproved(profile, u, snapshot) {
  const state = loadState(profile);
  state.files ??= {};
  let all = true;
  for (const f of u.files) {
    const local = localPath(profile, f.path);
    if (local && fs.existsSync(local) && (await sha256File(local)) === f.sha256) state.files[f.path] = f.sha256;
    else all = false;
  }
  for (const p of u.remove) {
    const local = localPath(profile, p);
    if (local && fs.existsSync(local)) all = false;
    else delete state.files[p];
  }
  if (all && state.snapshot === snapshot.parent) state.snapshot = snapshot.id;
  saveState(profile, state);
  if (!all) console.log(yellow('У вас не все файлы обновления — заберите их: tfc pull'));
}
