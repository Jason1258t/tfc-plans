#!/usr/bin/env node
/**
 * tfc — программа «TFC Планы» для ПК: сверяет папку игры со сборкой на сервере и сайтом, докачивает моды, аддоны,
 * конфиги, скрипты KubeJS, ресурспаки, датапаки и схемы (tfc pull); хосту — заливает сборку и собирает данные сайта. План — docs/plans/pack-cli.md,
 * инструкция для игроков — cli/README.md.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Api } from './lib/api.mjs';
import { configFile, currentProfile, DEFAULT_SERVER, loadConfig, saveConfig } from './lib/config.mjs';
import { detectVersions, findInstances, findWorlds, gameDirOf, isDir, isServerDir } from './lib/detect.mjs';
import { bytesOf, changes, loadState, makePlan, PARTS, scopeOf } from './lib/plan.mjs';
import { parseParts, printJobs, PUBLISH, showJob } from './lib/jobs.mjs';
import { diffFiles, printDiff, publish } from './lib/publish.mjs';
import { applyPull, planPull, pullChanges, recheckAddons, siteOwned } from './lib/pull.mjs';
import { scanLocal } from './lib/scan.mjs';
import { applyChange, planChange, resultsOf } from './lib/changes.mjs';
import { applyPlan, beginBackup, editBackup, finishBackup, undoLast } from './lib/sync.mjs';
import { ask, bold, choose, confirm, cyan, date, dim, green, interactive, mb, red, yellow } from './lib/ui.mjs';
import { checkUpdate } from './lib/update.mjs';
import { cleanupOld, upgrade } from './lib/upgrade.mjs';
import { BUILD, IS_BINARY } from './lib/version.mjs';

const HELP = `${bold('tfc')} — сборка TFC RealWorld на вашем ПК

Настройка:
  tfc init                    указать папку игры (версию) и мир
  tfc login <ключ>            ключ от хоста сборки (--server <адрес>, если сервер другой)
  tfc profiles                профили; tfc use <профиль> — сделать текущим

Игрокам:
  tfc status [что]            что изменится — ничего не меняет
  tfc pull [что]              докачать и обновить всё: сборку с сервера, аддоны, датапаки и скрипты сайта, схемы
      что: ${Object.keys(PARTS).join(', ')} (без — всё, что нужно этой папке)
      --dry-run               только показать          --force   перезаписать и ваши правки (с копией)
      --yes                   не спрашивать
  tfc pull datapacks|kubejs|schematics|addons <имя…>   одно названное с сайта (датапак — любой, и тестовый)
  tfc undo                    вернуть как было до прошлого pull

Хосту (ключ администратора):
  tfc publish                 залить сборку из папки игры на сервер (--note "что поменял", --yes, --force)
  tfc build [mods,kubejs,config,world]   собрать данные сайта локально в ./tfc-out — посмотреть до заливки
  tfc admin keys | invite <ник> [--admin] | revoke <id> | history | use <id> | rollback
  tfc admin rebuild [mods,kubejs,config,world]   пересобрать данные сайта на сервере (--pull — свежий код,
                              --publish none|dry-run|live — что потом; по умолчанию dry-run — только показать)
  tfc admin publish           показать, что изменится на сайте; --live — выложить (текущую сборку, с вопросом)
  tfc admin jobs [id|last]    задания сервера; с id — лог и итог (--follow — следить до конца)
  tfc admin changes [pull [id…] | reject <id>]   правки конфигов от Claude: список; pull — внести в папку игры
                              и сервера (покажет и спросит; --dry-run, --yes; вернуть — tfc undo); reject — отклонить

Общее: --profile <имя> — другой профиль; tfc --version — версия; tfc --upgrade — обновить программу
(--force — скачать заново, даже если версия та же). Настройки: ${configFile()}`;

const opts = {
  profile: { type: 'string' },
  server: { type: 'string' },
  instance: { type: 'string' },
  world: { type: 'string' },
  'no-world': { type: 'boolean' },
  'server-dir': { type: 'string' },
  note: { type: 'string' },
  mc: { type: 'string' },
  loader: { type: 'string' },
  out: { type: 'string' },
  yes: { type: 'boolean', short: 'y' },
  force: { type: 'boolean' },
  undo: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'no-current': { type: 'boolean' },
  admin: { type: 'boolean' },
  pull: { type: 'boolean' },
  publish: { type: 'string' },
  live: { type: 'boolean' },
  snapshot: { type: 'string' },
  follow: { type: 'boolean', short: 'f' },
  'no-follow': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  upgrade: { type: 'boolean' },
};

function api(cfg) {
  if (!cfg.token) throw new Error('нет ключа — tfc login <ключ> (ключ выдаёт хост сборки)');
  return new Api(cfg.server || DEFAULT_SERVER, cfg.token);
}

const profileTitle = (p) => `${bold(p.name)}: ${p.instance}${p.world ? dim(` · мир ${path.basename(p.world)}`) : ''}`;

// ---------------------------------------------------------------- настройка

async function cmdInit(v) {
  const cfg = loadConfig();
  let dir = v.instance;
  if (!dir) {
    if (!interactive()) throw new Error('укажите папку: tfc init --instance <папка версии>');
    const found = findInstances();
    console.log(found.length ? 'Нашёл версии в лаунчерах:' : 'Версий в известных лаунчерах не нашёл.');
    dir = found.length
      ? await choose('Какая папка — игра', found, (f) => `${f.name} ${dim(`${f.launcher} · ${f.dir}`)}`, {
          allowOther: true,
        })
      : await ask('Путь к папке версии (там, где mods/)');
    if (typeof dir === 'object') dir = dir.dir;
  }
  dir = path.resolve(dir.replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || '~'));
  const inst = gameDirOf(dir);
  if (!inst) throw new Error(`в ${dir} нет mods/, config/ или kubejs/ — это не папка версии`);
  const side = isServerDir(inst) ? 'server' : 'client';

  let world = null;
  if (v.world) {
    world = [v.world, path.join(inst, v.world), path.join(inst, 'saves', v.world)]
      .map((p) => path.resolve(p))
      .find(isDir);
    if (!world) throw new Error(`нет мира ${v.world}`);
  } else if (!v['no-world']) {
    const worlds = findWorlds(inst);
    if (worlds.length === 1 || (worlds.length && !interactive())) world = worlds[0].dir;
    else if (worlds.length) {
      console.log('Миры:');
      const w = await choose('В каком мире играете', [...worlds, { name: 'без мира', dir: null }], (w) =>
        w.dir ? `${w.name}${w.mtime ? dim(` · ${date(w.mtime)}`) : ''}` : dim('без мира (только моды и конфиги)'),
      );
      world = w.dir;
    }
  }
  const name = v.profile || cfg.profile || 'main';
  const serverDir = v['server-dir'] ? path.resolve(v['server-dir']) : cfg.profiles[name]?.serverDir;
  cfg.profiles[name] = { instance: inst, world, side, ...(serverDir ? { serverDir } : {}) };
  cfg.profile ??= name;
  if (!cfg.profiles[cfg.profile]) cfg.profile = name;
  saveConfig(cfg);
  console.log(`${green('Сохранено')} — профиль ${profileTitle({ name, ...cfg.profiles[name] })}`);
  console.log(
    dim(
      side === 'server'
        ? 'Это папка сервера: моды сборки по умолчанию не трогаю (tfc pull mods — явно), аддоны ставлю.'
        : 'Это папка клиента.',
    ),
  );
  if (!cfg.token) console.log(`Дальше: ${cyan('tfc login <ключ>')} — ключ выдаёт хост сборки.`);
}

async function cmdLogin(v, [key]) {
  if (!key) throw new Error('tfc login <ключ>');
  // Ключ сервера — латиница, цифры, «_» и «-» (tfc_…); иное (кириллица, пробелы) — опечатка при копировании
  if (!/^[\w-]{8,200}$/.test(key))
    throw new Error('ключ выглядит не так — скопируйте его целиком, он начинается с tfc_');
  const cfg = loadConfig();
  const server = v.server || cfg.server || DEFAULT_SERVER;
  const role = await new Api(server, key).role();
  Object.assign(cfg, { server, token: key, role });
  saveConfig(cfg);
  console.log(`${green('Ключ подошёл')} — ${role === 'admin' ? 'администратор сборки' : 'игрок'}, сервер ${server}`);
}

function cmdProfiles() {
  const cfg = loadConfig();
  const names = Object.keys(cfg.profiles);
  if (!names.length) return console.log('Профилей нет — tfc init');
  for (const n of names)
    console.log(`${n === cfg.profile ? green('●') : ' '} ${profileTitle({ name: n, ...cfg.profiles[n] })}`);
}

function cmdUse(v, [name]) {
  const cfg = loadConfig();
  if (!cfg.profiles[name]) throw new Error(`нет профиля «${name}»`);
  cfg.profile = name;
  saveConfig(cfg);
  console.log(`Текущий профиль — ${name}`);
}

// ---------------------------------------------------------------- игроки

async function scan(profile) {
  const t = Date.now();
  const res = await scanLocal(profile, {
    onProgress: (i, n) =>
      process.stdout.isTTY && Date.now() - t > 1500 && process.stdout.write(`\r  читаю файлы ${i}/${n}   `),
  });
  if (process.stdout.isTTY && Date.now() - t > 1500) process.stdout.write('\r'.padEnd(40) + '\r');
  return res;
}

/** Аргументы pull/status: сначала части (mods, kubejs…), дальше — имена с сайта (tfc pull datapacks "Фикс") */
function splitArgs(args) {
  const i = args.findIndex((a) => !(a in PARTS) && a !== 'all');
  const parts = (i < 0 ? args : args.slice(0, i)).filter((a) => a !== 'all');
  const names = i < 0 ? [] : args.slice(i);
  if (names.length) {
    const site = parts.flatMap((p) => PARTS[p].site ?? []);
    if (parts.length !== 1 || new Set(site).size !== 1)
      throw new Error(
        parts.length
          ? 'имена — для одного вида с сайта: tfc pull datapacks|kubejs|schematics|addons <имя…>'
          : `не знаю «${names[0]}» — можно: ${Object.keys(PARTS).join(', ')}`,
      );
  }
  return { parts, names };
}

/**
 * План pull: снимок сборки с сервера + контент сайта, без споров за файл (siteOwned). С именами — только
 * названное с сайта, сборку не трогаем.
 */
async function prepare(v, args) {
  const { parts, names } = splitArgs(args);
  const cfg = loadConfig();
  const profile = currentProfile(cfg, v.profile);
  const scope = scopeOf(parts, profile);
  if (names.length) scope.snap = [];
  // Ключ нужен всему, кроме аддонов (статика сайта); без ключа только аддоны и тянем
  const a = cfg.token || scope.snap.length || scope.site.some((k) => k !== 'addons') ? api(cfg) : null;
  let current = a ? await a.current() : null;
  const notes = [];
  if (!current && scope.snap.length) {
    if (!scope.site.length) throw new Error('на сервере ещё нет сборки — хост заливает её командой tfc publish');
    notes.push('на сервере ещё нет сборки — беру только контент сайта');
    scope.snap = [];
  }
  const sitePlans = [];
  for (const kind of scope.site) {
    if (kind === 'datapacks' && !profile.world) {
      if (parts.length) notes.push(`датапаки сайта: мир не выбран — пропускаю (tfc init --world <мир>)`);
      continue;
    }
    sitePlans.push(await planPull(a, profile, kind, names, { force: v.force }));
  }
  const state = loadState(profile);
  const owned = siteOwned(sitePlans, names.length ? null : current, state);
  // Аддоны не все (названы) или снимка не знаем — прежние замены не забываем
  if (names.length || !current) owned.overrides = [...new Set([...(state.addonOverrides ?? []), ...owned.overrides])];
  const hasAddons = sitePlans.some((p) => p.kind === 'addons');
  const pulled = new Set(Object.values(state.pulled ?? {}).flatMap((m) => Object.values(m).map((r) => r.path)));
  let plan = null;
  let local = null;
  let cache = null;
  if (scope.snap.length) {
    ({ files: local, cache } = await scan(profile));
    plan = makePlan(current, local, state, scope.snap, { force: v.force, hasWorld: !!profile.world, skip: owned.skip });
    plan.extra = plan.extra.filter((f) => !pulled.has(f.path));
  }
  return {
    cfg,
    profile,
    api: a,
    current,
    local,
    cache,
    plan,
    sitePlans,
    names,
    parts,
    notes,
    state,
    skip: new Set([...owned.skip, ...pulled]),
    overrides: hasAddons ? owned.overrides : undefined,
  };
}

function printHeader(profile, current) {
  console.log(`Профиль ${profileTitle(profile)}`);
  if (current)
    console.log(
      `Сборка на сервере: ${bold(current.id)} от ${date(current.createdAt)}${current.author ? `, ${current.author}` : ''}${current.note ? ` — ${current.note}` : ''}`,
    );
}

function printPlan(plan, { verbose = false } = {}) {
  const line = (mark, title, list, extra = '') => {
    if (!list.length) return;
    console.log(`  ${mark} ${title}: ${list.length}${extra}`);
    const limit = verbose ? Infinity : 8;
    for (const f of list.slice(0, limit)) console.log(dim(`      ${f.path}`));
    if (list.length > limit) console.log(dim(`      … ещё ${list.length - limit}`));
  };
  line(green('+'), 'докачать', plan.add, dim(` (${mb(bytesOf(plan.add))})`));
  line(yellow('~'), 'обновить', plan.update, dim(` (${mb(bytesOf(plan.update))}, старые — в копию)`));
  line(red('−'), 'убрать (больше нет в сборке)', plan.remove);
  line(yellow('!'), 'вы меняли — рядом положу .tfc-new (перезаписать: --force)', plan.conflict);
  line(dim('·'), 'клиентские конфиги отличаются — оставляю ваши', plan.keepClient);
  line(dim('·'), 'убраны из сборки, но вы их меняли — оставляю', plan.keptModified);
  const extraMods = plan.extra.filter((f) => f.kind === 'mod');
  line(dim('·'), 'ваши моды не из сборки — не трогаю', extraMods);
  if (plan.noWorld.length) console.log(dim(`  · файлов мира ${plan.noWorld.length} — мир не выбран (tfc init)`));
}

const PULL_TITLE = {
  datapacks: 'Датапаки сайта',
  kubejs: 'Скрипты KubeJS сайта',
  schematics: 'Схемы',
  addons: 'Аддоны сборки',
};

function printSite(p, names) {
  const total = p.add.length + p.update.length + p.same.length + p.conflict.length;
  console.log(`${bold(PULL_TITLE[p.kind])}: ${names.length ? `названо ${names.length}` : `с сайта ${total}`}`);
  const line = (mark, title, list) => {
    if (!list.length) return;
    console.log(`  ${mark} ${title}: ${list.length}`);
    for (const x of list) {
      console.log(dim(`      ${x.name ?? x.id} → ${x.path.replace(/^world\//, '<мир>/')}`));
      if (x.note) console.log(dim(`        ставить: ${x.note}`));
    }
  };
  line(green('+'), 'поставить', p.add);
  line(yellow('~'), 'обновить (старое — в копию)', p.update);
  line(
    red('−'),
    p.kind === 'addons'
      ? 'убрать (старая версия или аддон убран с сайта)'
      : 'убрать (сняли отметку или убрали с сайта)',
    p.remove,
  );
  if (p.obsolete.length) {
    console.log(`  ${red('−')} убрать — старые версии и то, что заменяет аддон (с копией): ${p.obsolete.length}`);
    for (const x of p.obsolete) console.log(dim(`      ${x.path} ${dim(`— ${x.name}`)}`));
  }
  line(yellow('!'), 'там ваш файл — рядом положу .tfc-new (перезаписать: --force)', p.conflict);
  line(dim('·'), 'ставил я, но вы меняли — оставляю', p.keptModified);
  if (p.unknown.length) {
    console.log(red(`  нет на сайте: ${p.unknown.join(', ')}`));
    if (p.all.length)
      console.log(dim(`  есть: ${p.all.map((x) => `${x.name}${x.install ? ' (в мир)' : ''}`).join(', ')}`));
  }
  if (!pullChanges(p) && !p.keptModified.length) console.log(dim('  всё на месте'));
}

/** Шапка, план сборки и планы сайта; возвращает, сколько всего изменится */
function printAll(r, { verbose = false } = {}) {
  printHeader(r.profile, r.current);
  for (const n of r.notes) console.log(yellow(n));
  if (r.plan) {
    if (r.state.snapshot && r.state.snapshot !== r.current.id && !r.names.length)
      console.log(yellow('Сборку обновили после вашего прошлого pull.'));
    console.log(bold('Сборка'));
    if (!changes(r.plan)) console.log(dim('  всё на месте'));
    printPlan(r.plan, { verbose });
  }
  for (const p of r.sitePlans) printSite(p, r.names);
  return (r.plan ? changes(r.plan) : 0) + r.sitePlans.reduce((s, p) => s + pullChanges(p), 0);
}

async function cmdStatus(v, args) {
  const r = await prepare(v, args);
  const n = printAll(r);
  if (!n) console.log(green('Папка совпадает со сборкой и сайтом.'));
  else console.log(`Применить: ${cyan(`tfc pull${args.length ? ` ${args.join(' ')}` : ''}`)}`);
  if (r.cfg.role === 'admin' && r.local) {
    const d = diffFiles(r.current.files, [...r.local.values()]);
    const k = d.added.length + d.changed.length + d.removed.length;
    if (k) {
      console.log(
        dim(`\nХосту: ваша папка отличается от сборки на сервере на ${k} файлов (все разделы) — tfc publish:`),
      );
      printDiff(d, { limit: 5 });
    }
  }
}

async function cmdPull(v, args) {
  if (v.undo) return cmdUndo(v);
  const r = await prepare(v, args);
  const { profile, plan, sitePlans } = r;
  const n = printAll(r, { verbose: v['dry-run'] });
  const backup = beginBackup(profile);
  if (!n) {
    // Запомнить, что всё на месте (state.json)
    if (plan)
      await applyPlan({ api: r.api, profile, plan, snapshot: r.current, cache: r.cache, backup, onlyNew: true });
    applyPull(profile, sitePlans, backup, r.overrides);
    return console.log(green('Всё уже на месте.'));
  }
  if (v['dry-run']) return console.log(dim('--dry-run: ничего не менял'));
  const risky =
    (plan ? plan.update.length + plan.remove.length : 0) +
    sitePlans.reduce((s, p) => s + p.update.length + p.remove.length + p.obsolete.length, 0);
  if (!v.yes) {
    if (!interactive() && risky) throw new Error('есть замены и удаления — подтвердите: tfc pull --yes');
    if (interactive() && !(await confirm('Применить?', true))) return;
  }
  if (plan) {
    const res = await applyPlan({
      api: r.api,
      profile,
      plan,
      snapshot: r.current,
      cache: r.cache,
      backup,
      skip: r.skip,
    });
    for (const d of res.duplicates)
      console.log(`  ${red('−')} старая версия мода ${d.ids.join(', ')}: ${d.path} ${dim(`(в сборке — ${d.by})`)}`);
    const before = sitePlans.find((p) => p.kind === 'addons')?.obsolete.length ?? 0;
    if (r.overrides) recheckAddons(profile, sitePlans, r.overrides);
    for (const x of sitePlans.find((p) => p.kind === 'addons')?.obsolete.slice(before) ?? [])
      console.log(`  ${red('−')} ${x.path} ${dim(`— ${x.name}, вместо него аддон`)}`);
  }
  applyPull(profile, sitePlans, backup, r.overrides);
  const dir = finishBackup(profile, backup);
  console.log(green('Готово.') + (dir ? dim(` Копия прежнего — ${dir}; вернуть: tfc undo`) : ''));
  if (plan?.conflict.length || sitePlans.some((p) => p.conflict.length))
    console.log(yellow('Сравните свои файлы с *.tfc-new и оставьте нужное.'));
  const changed = (kind) => sitePlans.some((p) => p.kind === kind && pullChanges(p));
  if (changed('datapacks') || plan?.add.concat(plan.update, plan.remove).some((f) => f.kind === 'world-datapack'))
    console.log(dim('Датапаки подхватятся после перезапуска мира или командой /reload.'));
  if (changed('addons') || plan?.add.concat(plan.update, plan.remove).some((f) => f.kind === 'mod'))
    console.log(dim('Моды поменялись — перезапустите игру (и сервер).'));
  else if (changed('kubejs')) console.log(dim('Скрипты сервера — /reload на сервере (или перезапуск).'));
  if (r.cfg.role === 'admin' && sitePlans.some((p) => p.kind !== 'schematics' && pullChanges(p)))
    console.log(dim('Хосту: чтобы сайт собрал данные с этим (рецепты, предметы) — tfc publish.'));
}

function cmdUndo(v) {
  const cfg = loadConfig();
  const profile = currentProfile(cfg, v.profile);
  const m = undoLast(profile);
  if (!m) return console.log('Отменять нечего: копий прошлых pull нет.');
  console.log(
    `${green('Вернул')} как было ${date(m.at)}: убрал добавленные ${m.added.length}, вернул заменённые ${m.replaced.length} и убранные ${m.removed.length}${m.edited?.length ? `, правленые конфиги ${m.edited.length}` : ''}.`,
  );
}

/** Старое имя pull — пока подсказываем */
async function cmdSync(v, args) {
  console.log(dim(v.undo ? 'tfc sync --undo теперь называется tfc undo.' : 'tfc sync теперь называется tfc pull.'));
  return cmdPull(v, args);
}

// ---------------------------------------------------------------- хост

async function cmdPublish(v) {
  const cfg = loadConfig();
  const profile = currentProfile(cfg, v.profile);
  const a = api(cfg);
  const current = await a.current();
  const { files: local, skipped } = await scan(profile);
  if (!local.size) throw new Error(`в ${profile.instance} нечего заливать`);
  const ver = detectVersions(profile.instance);
  const { mc, loader } = await gameVersion(a, v, ver, current, profile.instance);
  console.log(`Профиль ${profileTitle(profile)}${mc ? dim(` · Minecraft ${mc}${loader ? `, ${loader}` : ''}`) : ''}`);
  if (skipped) console.log(dim(`(пропущено вне белого списка: ${skipped})`));
  if (!profile.world) console.log(yellow('Мир не выбран — датапаки и календарь мира не попадут в сборку (tfc init).'));
  await publish({
    api: a,
    profile,
    local,
    current,
    note: v.note,
    mc,
    loader,
    yes: v.yes,
    force: v.force,
    setCurrent: !v['no-current'],
  });
}

/**
 * Версия игры для снимка: --mc/--loader, из папки (лаунчер), из прошлых снимков, иначе спросить.
 * Сервер принимает только строки — без версии заливка падала на «mc — строка до 40 символов».
 */
async function gameVersion(a, v, ver, current, dir) {
  let mc = v.mc || ver.mc || current?.mc || null;
  let loader = v.loader || ver.loader || current?.loader || null;
  if (!mc || !loader) {
    const { snapshots } = await a.get('/pack/snapshots');
    const prev = snapshots.find((s) => (mc || s.mc) && (loader || s.loader));
    if (prev) {
      mc ||= prev.mc;
      loader ||= prev.loader;
      console.log(dim(`Версию игры в папке не нашёл — беру из прошлой сборки ${prev.id}: ${mc}, ${loader}`));
    }
  }
  if (!mc || !loader) {
    const hint = 'укажите её: tfc publish --mc 1.21.1 --loader neoforge';
    if (!interactive() || v.yes) throw new Error(`не определилась версия игры в ${dir} — ${hint}`);
    console.log(yellow('Версию Minecraft и загрузчика в папке не нашёл (лаунчер её не записал).'));
    mc ||= await ask('Версия Minecraft', '1.21.1');
    loader ||= await ask('Загрузчик (как в лаунчере: neoforge или neoforge-21.1.219)', 'neoforge');
  }
  if (mc.length > 40 || loader.length > 80)
    throw new Error('версия игры слишком длинная — --mc 1.21.1 --loader neoforge');
  return { mc, loader };
}

async function cmdBuild(v, parts) {
  // Разборщики живут в репозитории сайта (scripts/); в одном файле tfc для игроков их нет — это команда хоста.
  // Импорт — по пути из переменной, чтобы сборщик (npm run tfc:dist) не тянул scripts/ в файл
  const msg = 'сборка данных доступна только из папки проекта сайта (npm run tfc -- build)';
  if (IS_BINARY) throw new Error(msg);
  const profile = currentProfile(loadConfig(), v.profile);
  const packModule = '../scripts/pack.mjs';
  let runPack;
  try {
    ({ runPack } = await import(packModule));
  } catch (e) {
    throw new Error(`${msg}: ${e.message}`);
  }
  const outDir = path.resolve(v.out ?? 'tfc-out');
  await runPack({
    input: profile.instance,
    world: profile.world ?? undefined,
    only: parts.flatMap((p) => p.split(',')).filter(Boolean),
    outDir,
    instanceDir: path.join(outDir, 'instance'),
    dryRun: true,
  });
  console.log(`${green('Собрано')} в ${outDir} — в Firestore ничего не записано.`);
}

/** Перед настоящей выкладкой: только текущая сборка и явное «да» */
async function confirmLive(a, v) {
  const { current, snapshots } = await a.get('/pack/snapshots');
  if (!current) throw new Error('текущей сборки нет — выкладывать нечего');
  if (v.snapshot && v.snapshot !== current)
    throw new Error(
      `выкладывать можно только текущую сборку (${current}); сделать текущей — tfc admin use ${v.snapshot}`,
    );
  const s = snapshots.find((x) => x.id === current);
  console.log(
    `Выложить на сайт данные сборки ${bold(current)}${s ? dim(` от ${date(s.createdAt)}${s.author ? `, ${s.author}` : ''}${s.note ? ` — ${s.note}` : ''}`) : ''}.`,
  );
  console.log(
    dim('Обновятся предметы, рецепты, карта и справочник на сайте, настройки сборки в базе и запись в «Обновлениях».'),
  );
  console.log(dim('Что именно изменится — без --live (пробно).'));
  if (v.yes) return;
  if (!interactive()) throw new Error('подтвердите выкладку: --live --yes');
  if (!(await confirm('Выкладывать?', false))) throw new Error('отменено — на сайте ничего не менялось');
}

/** Задание поставлено: следить за ним (по умолчанию) или подсказать, как посмотреть */
async function startedJob(a, j, v) {
  console.log(`Задание ${bold(j.id)} ${j.state === 'queued' ? 'в очереди' : j.state}.`);
  if (v['no-follow']) return console.log(dim(`Посмотреть: tfc admin jobs ${j.id} --follow`));
  const done = await showJob(a, j.id, { follow: true });
  if (done.state === 'failed') process.exitCode = 1;
}

/** Ответ 409 на сборку/публикацию — по-человечески */
function jobError(e, snapshot) {
  if (e.status === 404)
    return new Error(
      snapshot
        ? `на сервере нет сборки ${snapshot} — список: tfc admin history`
        : 'на сервере нет текущей сборки — сначала tfc publish (или tfc admin use <id>)',
    );
  if (e.status !== 409) return e;
  if (/не собран/.test(e.data?.error))
    return new Error('данные этой сборки на сервере ещё не собраны — tfc admin rebuild');
  if (/текущий/.test(e.data?.error))
    return new Error('выкладывать на сайт можно только текущую сборку — сначала tfc admin use <id>');
  return e;
}

// ---------------------------------------------------------------- правки конфигов от агента

const CHANGE_STATUS = {
  pending: yellow('ждёт'),
  applied: green('применено'),
  rejected: red('отклонено'),
  cancelled: dim('отменено'),
};

function printChange(c, { full = true } = {}) {
  console.log(
    `${bold(c.id)} ${CHANGE_STATUS[c.status] ?? c.status} ${dim(`${c.author ?? '?'}, ${date(c.createdAt)}${c.appliedAt ? ` · ${c.appliedBy ?? '?'} ${date(c.appliedAt)}` : ''}`)}`,
  );
  if (!full) return;
  if (c.note) console.log(`  ${c.note}`);
  for (const e of c.edits ?? [])
    console.log(`  ${e.path}: ${bold(e.key)} ${JSON.stringify(e.from)} → ${cyan(JSON.stringify(e.to))}`);
  for (const r of c.results ?? []) console.log(dim(`  ${r.ok ? '✓' : '✗'} ${r.key}: ${r.msg}`));
}

/** Путь для вывода: от папки игры, папки сервера или мира */
function shortPath(profile, file) {
  const rel = (base, label) => {
    const r = base && path.relative(base, file);
    return r && !r.startsWith('..') && !path.isAbsolute(r) ? `${label}${r.split(path.sep).join('/')}` : null;
  };
  return rel(profile.world, '<мир>/') ?? rel(profile.instance, '') ?? rel(profile.serverDir, '<сервер>/') ?? file;
}

const ITEM_MARK = {
  change: green('~'),
  drift: yellow('~'),
  add: green('+'),
  same: dim('='),
  error: red('✗'),
  overridden: yellow('!'),
};

function printItem(profile, it) {
  const where = it.file ? shortPath(profile, it.file) : '';
  const e = it.edit;
  const text = {
    change: `${where}: ${e.key} ${JSON.stringify(it.cur)} → ${JSON.stringify(e.to)}`,
    drift: `${where}: ${e.key} ${JSON.stringify(it.cur)} → ${JSON.stringify(e.to)} ${yellow(`(Claude видел ${JSON.stringify(e.from)} — файл меняли после выкладки сборки)`)}`,
    add: `${where}: ${e.key} = ${JSON.stringify(e.to)} ${dim('(ключа в файле нет — допишу)')}`,
    same: dim(`${where}: ${e.key} уже ${JSON.stringify(e.to)}`),
    error: red(`${where ? `${where}: ` : ''}${e.key} — ${it.msg}`),
    overridden: yellow(`${where} задаёт ${e.key} сам и перекрывает эту правку — поправьте и там`),
  }[it.state];
  console.log(`  ${ITEM_MARK[it.state]} ${text}`);
}

async function adminChanges(a, v, [action, ...ids]) {
  const { changes } = await a.get('/admin/changes');
  const pending = changes.filter((c) => c.status === 'pending');
  if (!action || action === 'list') {
    if (!pending.length) console.log('Неприменённых правок нет.');
    for (const c of pending) printChange(c);
    const done = changes.filter((c) => c.status !== 'pending').slice(0, 5);
    if (done.length) console.log(dim('\nНедавние:'));
    for (const c of done) printChange(c, { full: false });
    if (pending.length)
      console.log(`\nВнести: ${cyan('tfc admin changes pull')} (покажет, что где поменяется, и спросит)`);
    return;
  }
  if (action === 'reject') {
    const c = changes.find((x) => x.id === ids[0]);
    if (!c) throw new Error('tfc admin changes reject <id> — id из tfc admin changes');
    if (c.status !== 'pending') throw new Error(`правка ${c.id} уже не ждёт (${c.status})`);
    printChange(c);
    if (!v.yes && !(interactive() && (await confirm('Отклонить?', false)))) return console.log('Ничего не менял.');
    await a.post(`/admin/changes/${c.id}`, { status: 'rejected', results: [], updateTime: c.updateTime });
    return console.log('Отклонено — Claude увидит это в config_changes.');
  }
  if (action !== 'pull') throw new Error('tfc admin changes [pull [id…] | reject <id>]');
  const unknown = ids.filter((id) => !changes.some((c) => c.id === id));
  if (unknown.length) throw new Error(`нет правки ${unknown.join(', ')} — список: tfc admin changes`);
  const todo = ids.length ? pending.filter((c) => ids.includes(c.id)) : pending.slice().reverse();
  if (!todo.length) return console.log(ids.length ? 'Эти правки уже не ждут.' : 'Неприменённых правок нет.');
  const profile = currentProfile(loadConfig(), v.profile);
  console.log(`Профиль ${profileTitle(profile)}${profile.serverDir ? dim(` · сервер ${profile.serverDir}`) : ''}`);
  const backup = beginBackup(profile);
  let applied = 0;
  for (const c of todo) {
    console.log('');
    printChange(c);
    const plan = planChange(profile, c);
    for (const it of plan.items) printItem(profile, it);
    const results = resultsOf(plan, (f) => shortPath(profile, f));
    if (!plan.texts.size) {
      if (results.every((r) => r.ok)) {
        console.log(dim('  Всё уже так — отмечаю как применённую.'));
        if (!v['dry-run'])
          await a.post(`/admin/changes/${c.id}`, { status: 'applied', results, updateTime: c.updateTime });
      } else console.log(red('  Внести нечего — правка остаётся ждать (отклонить: tfc admin changes reject).'));
      continue;
    }
    if (v['dry-run']) continue;
    if (!v.yes) {
      if (!interactive()) throw new Error('подтвердите: tfc admin changes pull --yes');
      if (!(await confirm('Внести?', true))) {
        console.log(dim('  Пропустил — правка остаётся ждать.'));
        continue;
      }
    }
    applyChange(plan, backup, editBackup);
    applied++;
    await a.post(`/admin/changes/${c.id}`, { status: 'applied', results, updateTime: c.updateTime }).catch((e) => {
      console.log(yellow(`  Файлы поправил, но отметить на сервере не вышло: ${e.message}`));
    });
    console.log(green('  Внесено.'));
  }
  if (v['dry-run']) return console.log(dim('\n--dry-run: ничего не менял'));
  const dir = finishBackup(profile, backup);
  if (!applied) return;
  console.log(`\n${green('Готово.')}${dir ? dim(` Прежние файлы — ${dir}; вернуть: tfc undo`) : ''}`);
  console.log('Дальше: перезапустите сервер Minecraft, чтобы он перечитал настройки, и залейте сборку —');
  console.log(
    `${cyan('tfc publish')} (игроки получат конфиг), ${cyan('tfc admin publish --live')} (сайт и Claude увидят новые значения).`,
  );
}

async function cmdAdmin(v, [sub, ...args]) {
  const arg = args[0];
  const a = api(loadConfig());
  if (sub === 'keys') {
    const res = await a.get('/admin/keys');
    for (const k of Array.isArray(res) ? res : res.keys)
      console.log(
        `  ${k.id}  ${bold(k.name)} ${k.role === 'admin' ? yellow('admin') : 'player'} ${dim(`${date(k.createdAt)}${k.createdBy ? `, выдал ${k.createdBy}` : ''}`)}`,
      );
  } else if (sub === 'invite') {
    if (!arg) throw new Error('tfc admin invite <ник> [--admin]');
    const k = await a.post('/admin/keys', { name: arg, role: v.admin ? 'admin' : 'player' });
    console.log(`Ключ для ${bold(arg)} (${k.role}) — передайте ему, больше он нигде не покажется:\n\n  ${k.key}\n`);
    console.log(dim(`У игрока: tfc login ${k.key}`));
  } else if (sub === 'revoke') {
    if (!arg) throw new Error('tfc admin revoke <id> — id из tfc admin keys');
    await a.del(`/admin/keys/${encodeURIComponent(arg)}`);
    console.log('Ключ отозван.');
  } else if (sub === 'history') {
    const { current, snapshots } = await a.get('/pack/snapshots');
    for (const s of snapshots)
      console.log(
        `${s.id === current ? green('●') : ' '} ${s.id}  ${date(s.createdAt)}  ${s.author ?? ''} ${dim(`${s.fileCount} файлов, ${mb(s.totalSize)}`)} ${s.note ?? ''}`,
      );
  } else if (sub === 'use') {
    if (!arg) throw new Error('tfc admin use <id снимка>');
    await a.post('/pack/current', { id: arg });
    console.log(`Текущая сборка — ${arg}.`);
  } else if (sub === 'rollback') {
    const r = await a.post('/pack/current', { rollback: true });
    console.log(`Откатил: текущая сборка — ${r.current} (была ${r.previous}).`);
  } else if (sub === 'rebuild') {
    const parts = parseParts(args);
    // По умолчанию — пробно, даже если на сервере включена автоматическая выкладка (AUTO_PUBLISH=live)
    const publish = v.publish ?? 'dry-run';
    if (!PUBLISH.includes(publish)) throw new Error(`--publish — ${PUBLISH.join(', ')}`);
    if (publish === 'live') await confirmLive(a, v);
    const body = { parts, pull: !!v.pull, publish, ...(v.snapshot ? { snapshot: v.snapshot } : {}) };
    const j = await a.post('/admin/rebuild', body).catch((e) => {
      throw jobError(e, v.snapshot);
    });
    await startedJob(a, j, v);
  } else if (sub === 'publish') {
    if (v.live) await confirmLive(a, v);
    const body = v.live ? { dryRun: false } : { dryRun: true, ...(v.snapshot ? { snapshot: v.snapshot } : {}) };
    const j = await a.post('/admin/publish', body).catch((e) => {
      throw jobError(e, v.snapshot);
    });
    await startedJob(a, j, v);
  } else if (sub === 'changes') {
    await adminChanges(a, v, args);
  } else if (sub === 'jobs') {
    if (!arg) return printJobs(a);
    let id = arg;
    if (id === 'last') {
      id = (await a.get('/jobs')).jobs[0]?.id;
      if (!id) return console.log('Заданий ещё не было.');
    }
    const j = await showJob(a, id, { follow: v.follow }).catch((e) => {
      throw e.status === 404 ? new Error(`нет задания ${id} — список: tfc admin jobs`) : e;
    });
    if (j.state === 'failed') process.exitCode = 1;
  } else
    throw new Error(
      'tfc admin keys | invite <ник> | revoke <id> | history | use <id> | rollback | rebuild | publish | jobs | changes',
    );
}

// ---------------------------------------------------------------- main

const COMMANDS = {
  init: cmdInit,
  login: cmdLogin,
  profiles: cmdProfiles,
  use: cmdUse,
  status: cmdStatus,
  pull: cmdPull,
  undo: cmdUndo,
  sync: cmdSync,
  publish: cmdPublish,
  build: cmdBuild,
  admin: cmdAdmin,
};

async function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: opts, allowPositionals: true, strict: true });
  const [cmd, ...rest] = positionals;
  cleanupOld();
  if (values.upgrade || cmd === 'upgrade') {
    const r = await upgrade({ force: values.force });
    if (!r) return console.log(green(`У вас последняя версия tfc: ${BUILD.version}.`));
    return console.log(`${green('Обновил')} tfc: ${r.from} → ${bold(r.to)} (${r.path}).`);
  }
  if (values.version || cmd === 'version') {
    console.log(BUILD ? `tfc ${BUILD.version}` : 'tfc из исходников (node cli/tfc.mjs) — версия не задана');
    const hint = await checkUpdate({ force: true });
    if (hint) console.log(hint);
    return;
  }
  if (!cmd || values.help || cmd === 'help') {
    console.log(HELP);
    // Двойной клик по tfc.exe: окно консоли закрылось бы сразу после справки
    if (!cmd && IS_BINARY && process.platform === 'win32' && interactive())
      await ask(dim('\nЭто программа для командной строки (PowerShell). Enter — закрыть'));
    return;
  }
  const fn = COMMANDS[cmd];
  if (!fn) throw new Error(`нет команды «${cmd}» — tfc help`);
  // Проверка новой версии идёт параллельно с командой, подсказка — в конце (и после ошибки)
  const update = checkUpdate();
  try {
    await fn(values, rest);
  } finally {
    const hint = await update;
    if (hint) console.log(`\n${hint}`);
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(red(`Ошибка: ${e.message ?? e}`));
  process.exit(1);
});
