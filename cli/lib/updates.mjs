/**
 * Предложенные обновления сборки (server/pack-server/lib/updates.mjs).
 *   tfc admin propose [<папка>] [--jar <файл>…] [--datapack <id|имя>…] [--replace-datapack <id|имя>…]
 *                     [--remove <путь>…] --note "…" — выложить:
 *     файлы из папки (пути как в снимке: kubejs/…, config/…), jar в mods/, датапаки сайта на подтверждение и пути, которые
 *     убрать; старые версии предлагаемых jar убираются сами (--keep-old — оставить). Так обновляет сборку Claude или
 *     администратор не с ПК хоста.
 *   tfc admin updates [list] [--rejected] [--approved] — что ждёт (или отклонённые, одобренные);
 *     subscribe/unsubscribe <id…> — проверять в профиле поверх сборки (staging.mjs);
 *     pull [id…] — разово забрать файлами в папку игры (и сервера, если она в профиле), с копией для tfc undo;
 *     approve <id|all> — сделать из текущей сборки с этими изменениями новую текущую; reject <id>.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyPath } from '@tfc/pack-server/paths';
import { datapackCatalog, resolveDatapacks } from './datapacks.mjs';
import { loadState, saveState } from './plan.mjs';
import { datapackZip } from './pull.mjs';
import { isModJar, jarKey } from './staging.mjs';
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

export function printUpdate(u, { full = true, subscribed = false } = {}) {
  console.log(
    `${bold(u.id)} ${STATUS[u.status] ?? u.status}${subscribed ? cyan(' [подписан]') : ''} ${dim(`${date(Date.parse(u.createdAt))}, ${u.author}`)}${u.snapshot ? dim(` → сборка ${u.snapshot}`) : ''}`,
  );
  console.log(`  ${u.note}`);
  for (const j of u.jarConflicts ?? [])
    console.log(yellow(`  ! ${j.path}: в сборке уже ${j.current} — обновление устарело, одобрить нельзя`));
  for (const p of u.conflicts ?? []) console.log(yellow(`  ! ${p}: в сборке поменяли после предложения`));
  if (u.snapshot && u.parent)
    console.log(dim(`  откат: tfc admin use ${u.parent} (или tfc admin rollback, если сборка последняя)`));
  if (!full) return;
  for (const f of u.files) console.log(`    ~ ${f.path} ${dim(mb(f.size))}`);
  for (const p of u.remove) console.log(`    − ${p}`);
  for (const d of u.datapacks ?? [])
    console.log(
      `    ◆ датапак «${d.name}» ${dim(`→ ${d.path}, ревизия ${d.revision}, ${d.replaces ? `заменит закреплённую ${d.replaces.sha256.slice(0, 12)} при одобрении` : 'подтвердится при одобрении'}`)}`,
    );
  if (u.reason) console.log(dim(`  причина: ${u.reason}`));
  if (u.status === 'pending')
    console.log(
      dim(
        `  откат после одобрения: tfc admin rollback${u.datapacks?.length ? ' (вернёт и подтверждение датапаков)' : ''}`,
      ),
    );
}

/** Почему обновление не одобрить: текст ошибки или null. С force остаются только другие версии модов */
export function approveBlock(u, force) {
  const lines = (u.jarConflicts ?? []).map((j) => `  ! ${j.path} — в сборке уже ${j.current}`);
  if (lines.length)
    return `Обновление ${u.id} устарело: две версии одного мода не запустятся.\n${lines.join('\n')}\nОтклоните его: tfc admin updates reject ${u.id}`;
  if (force || !u.conflicts?.length) return null;
  return `Эти файлы в сборке поменяли после предложения ${u.id}:\n${u.conflicts.map((p) => `  ! ${p}`).join('\n')}\nОтклонить: tfc admin updates reject ${u.id}; поверх них — approve ${u.id} --force`;
}

/** Почему обновления не одобрить пачкой: свои конфликты и правки одного файла или мода в разных обновлениях */
export function batchProblems(list) {
  const out = list.flatMap((u) => approveBlock(u) ?? []);
  const paths = new Map();
  const jars = new Map();
  for (const u of list) {
    for (const [p, sha] of [...u.files.map((f) => [f.path, f.sha256]), ...u.remove.map((x) => [x, null])]) {
      const was = paths.get(p);
      if (was && was.sha !== sha) out.push(`${p} меняют и ${was.id}, и ${u.id}`);
      paths.set(p, { id: u.id, sha });
    }
    for (const f of u.files.filter((x) => isModJar(x.path))) {
      const was = jars.get(jarKey(f.path));
      if (was && was.path !== f.path)
        out.push(`Один мод в двух версиях: ${was.path} (${was.id}) и ${f.path} (${u.id})`);
      jars.set(jarKey(f.path), { id: u.id, path: f.path });
    }
  }
  return out;
}

/**
 * Датапаки сайта для обновления: ZIP как у tfc datapacks. → [{ id, revision, sha256, sourcePath?, name, zip?, replaces? }]
 * names — новые для сборки, replacing — закреплённые, которые надо заменить версией с карточки.
 */
async function datapackItems(api, names, replacing) {
  if ([...names, ...replacing].includes('all'))
    throw new Error('--datapack и --replace-datapack — по одному: id или имя из tfc datapacks list');
  const c = await datapackCatalog(api, { refresh: true });
  const out = [];
  // Пустой список для resolveDatapacks значит «все»
  for (const d of names.length ? await resolveDatapacks(api, c, c.items, names) : []) {
    if (d.error) throw new Error(`${d.fileName}: ${d.error}`);
    if (c.deployed.some((p) => p.id === d.id))
      throw new Error(`«${d.name}» уже в сборке. Для новой версии: --replace-datapack ${d.id}`);
    const zip = d.snapshotSource ? null : datapackZip(d);
    out.push({
      id: d.id,
      revision: d.revision,
      sha256: zip ? createHash('sha256').update(zip).digest('hex') : d.sha256,
      name: d.name,
      zip,
      ...(d.snapshotSource ? { sourcePath: d.sourcePath } : {}),
    });
  }
  for (const d of replacing.length ? await resolveDatapacks(api, c, c.items, replacing) : []) {
    const pinned = c.deployed.find((p) => p.id === d.id);
    if (!pinned) throw new Error(`«${d.name}» ещё не закреплён в сборке. Добавить: --datapack ${d.id}`);
    if (d.sourceMissing || d.snapshotSource || pinned.snapshotSource)
      throw new Error(`«${d.name}» закреплён без карточки сайта — заменить нечем`);
    if (out.some((x) => x.id === d.id)) throw new Error(`«${d.name}» указан дважды`);
    if (d.contentHash === pinned.contentHash) throw new Error(`«${d.name}»: карточка совпадает с закреплённой версией`);
    const zip = datapackZip(d);
    out.push({
      id: d.id,
      revision: d.revision,
      sha256: createHash('sha256').update(zip).digest('hex'),
      name: d.name,
      zip,
      replaces: { sha256: pinned.sha256, contentHash: pinned.contentHash, revision: pinned.revision },
    });
  }
  return out;
}

export async function propose(
  api,
  { dir, remove = [], jars = [], datapacks = [], replaceDatapacks = [], keepOld, note, yes, dryRun },
) {
  if (!dir && !remove.length && !jars.length && !datapacks.length && !replaceDatapacks.length)
    throw new Error(
      'tfc admin propose [<папка>] [--jar <файл>…] [--datapack <id|имя>…] [--replace-datapack <id|имя>…] [--remove <путь>…] --note "что и зачем"',
    );
  if (!note?.trim()) throw new Error('--note "что меняется и зачем" — его увидит хост');
  if (dir && !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`нет папки ${dir}`);
  const current = await api.get('/pack/current');
  const cur = new Map(current.files.map((f) => [f.path, f.sha256]));
  const overlay = dir ? listOverlay(path.resolve(dir)) : [];
  for (const jar of jars) {
    const file = path.resolve(jar);
    if (!/\.jar$/i.test(file) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile())
      throw new Error(`--jar: нет такого jar: ${jar}`);
    const p = `mods/${path.basename(file)}`;
    if (overlay.some((f) => f.path === p)) throw new Error(`${p} уже есть в папке ${dir} — оставьте что-то одно`);
    overlay.push({ path: p, file });
  }
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
  // Старые версии предлагаемых jar: с двумя версиями одного мода игра не запустится
  const old = new Map();
  if (!keepOld)
    for (const f of files.filter((x) => isModJar(x.path)))
      for (const c of current.files)
        if (
          c.kind === 'mod' &&
          c.path !== f.path &&
          jarKey(c.path) === jarKey(f.path) &&
          !overlay.some((x) => x.path === c.path) &&
          !remove.includes(c.path)
        )
          old.set(c.path, f.path);
  const removing = [...remove, ...old.keys()];
  const packs =
    datapacks.length || replaceDatapacks.length ? await datapackItems(api, datapacks, replaceDatapacks) : [];
  if (!files.length && !removing.length && !packs.length)
    return console.log('В сборке уже всё так — предлагать нечего.');

  console.log(`К сборке ${dim(current.id)}:`);
  for (const f of files) console.log(`    ${cur.has(f.path) ? '~' : '+'} ${f.path}`);
  for (const p of remove) console.log(`    − ${p}`);
  for (const [p, by] of old) console.log(`    − ${p} ${dim(`старая версия, вместо неё ${path.posix.basename(by)}`)}`);
  for (const d of packs)
    console.log(
      `    ◆ датапак «${d.name}» ${dim(`→ kubejs/data/tfc-plans-${d.id}.zip, ${d.replaces ? `заменит закреплённую ${d.replaces.sha256.slice(0, 12)} при одобрении` : 'подтвердится при одобрении'}`)}`,
    );
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
  for (const d of packs.filter((x) => x.zip)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfc-propose-'));
    try {
      const file = path.join(tmp, `${d.id}.zip`);
      fs.writeFileSync(file, d.zip);
      await api.upload(file, d.sha256);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const u = await api.post('/admin/updates', {
    note,
    files: files.map((f) => ({ path: f.path, sha256: f.sha256, size: f.size })),
    remove: removing,
    ...(packs.length ? { datapacks: packs.map(({ name: _name, zip: _zip, ...d }) => d) } : {}),
  });
  if (packs.length && !u.datapacks?.length)
    throw new Error('сервер не понял датапаки обновления — обновите сервер сборки; это обновление отклоните');
  console.log(
    `${bold('Выложено:')} обновление ${u.id}. Хосту: ${cyan(`tfc admin updates subscribe ${u.id}`)} (в отдельном профиле — ${cyan('--profile тест')}), проверить, ${cyan(`tfc admin updates approve ${u.id}`)}.`,
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
  // Файлы подписки теперь обычные файлы сборки
  if (state.staging) state.staging = state.staging.filter((x) => x.id !== u.id);
  if (!state.staging?.length) delete state.staging;
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
