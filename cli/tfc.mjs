#!/usr/bin/env node
/**
 * tfc — программа «TFC Планы» для ПК: сверяет папку игры со сборкой на сервере, докачивает моды, конфиги,
 * скрипты KubeJS и ресурспаки; хосту — заливает сборку и собирает данные сайта. План — docs/plans/pack-cli.md,
 * инструкция для игроков — cli/README.md.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Api } from './lib/api.mjs';
import { configFile, currentProfile, DEFAULT_SERVER, loadConfig, saveConfig } from './lib/config.mjs';
import { detectVersions, findInstances, findWorlds, gameDirOf, isDir, isServerDir } from './lib/detect.mjs';
import { bytesOf, changes, GROUPS, kindsOf, loadState, makePlan } from './lib/plan.mjs';
import { diffFiles, printDiff, publish } from './lib/publish.mjs';
import { scanLocal } from './lib/scan.mjs';
import { applyPlan, undoLast } from './lib/sync.mjs';
import { ask, bold, choose, confirm, cyan, date, dim, green, interactive, mb, red, yellow } from './lib/ui.mjs';
import { checkUpdate } from './lib/update.mjs';
import { BUILD, IS_BINARY } from './lib/version.mjs';

const HELP = `${bold('tfc')} — сборка TFC RealWorld на вашем ПК

Настройка:
  tfc init                    указать папку игры (версию) и мир
  tfc login <ключ>            ключ от хоста сборки (--server <адрес>, если сервер другой)
  tfc profiles                профили; tfc use <профиль> — сделать текущим

Игрокам:
  tfc status [что]            чем папка отличается от сборки — ничего не меняет
  tfc sync [что]              докачать и обновить; что: ${Object.keys(GROUPS).join(', ')}
      --dry-run               только показать          --force   перезаписать и ваши правки (с копией)
      --yes                   не спрашивать            --undo    вернуть как было до прошлой синхронизации

Хосту (ключ администратора):
  tfc publish                 залить сборку из папки игры на сервер (--note "что поменял", --yes, --force)
  tfc build [mods,kubejs,config,world]   собрать данные сайта локально в ./tfc-out — посмотреть до заливки
  tfc admin keys | invite <ник> [--admin] | revoke <id> | history | use <id> | rollback

Общее: --profile <имя> — другой профиль; tfc --version — версия. Настройки: ${configFile()}`;

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
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
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
        ? 'Это папка сервера: моды по умолчанию не трогаю (tfc sync mods — явно).'
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

async function prepare(v, groups) {
  const cfg = loadConfig();
  const profile = currentProfile(cfg, v.profile);
  const a = api(cfg);
  const current = await a.current();
  if (!current) throw new Error('на сервере ещё нет сборки — хост заливает её командой tfc publish');
  const { files: local, cache, skipped } = await scan(profile);
  const kinds = kindsOf(groups, profile.side);
  const state = loadState(profile);
  const plan = makePlan(current, local, state, kinds, { force: v.force, hasWorld: !!profile.world });
  return { cfg, profile, api: a, current, local, cache, kinds, plan, skipped, state };
}

function printHeader(profile, current) {
  console.log(`Профиль ${profileTitle(profile)}`);
  console.log(
    `Сборка на сервере: ${bold(current.id)} от ${date(current.createdAt)}${current.author ? `, ${current.author}` : ''}${current.note ? ` — ${current.note}` : ''}`,
  );
}

async function cmdStatus(v, groups) {
  const { cfg, profile, current, local, plan, state } = await prepare(v, groups);
  printHeader(profile, current);
  if (state.snapshot && state.snapshot !== current.id)
    console.log(yellow('Сборку обновили после вашей прошлой синхронизации.'));
  if (!changes(plan)) console.log(green('Папка совпадает со сборкой.'));
  printPlan(plan, { verbose: false });
  if (changes(plan)) console.log(`Применить: ${cyan(`tfc sync${groups.length ? ` ${groups.join(' ')}` : ''}`)}`);
  if (cfg.role === 'admin') {
    const d = diffFiles(current.files, [...local.values()]);
    const n = d.added.length + d.changed.length + d.removed.length;
    if (n) {
      console.log(
        dim(`\nХосту: ваша папка отличается от сборки на сервере на ${n} файлов (все разделы) — tfc publish:`),
      );
      printDiff(d, { limit: 5 });
    }
  }
}

async function cmdSync(v, groups) {
  if (v.undo) {
    const cfg = loadConfig();
    const profile = currentProfile(cfg, v.profile);
    const m = undoLast(profile);
    if (!m) return console.log('Отменять нечего: копий прошлых синхронизаций нет.');
    console.log(
      `${green('Вернул')} как было ${date(m.at)}: убрал добавленные ${m.added.length}, вернул заменённые ${m.replaced.length} и убранные ${m.removed.length}.`,
    );
    return;
  }
  const { profile, api: a, current, plan, cache } = await prepare(v, groups);
  printHeader(profile, current);
  if (!changes(plan)) {
    printPlan(plan);
    await applyPlan({ api: a, profile, plan, snapshot: current, cache, onlyNew: true }); // запомнить, что всё на месте
    return console.log(green('Всё уже как в сборке.'));
  }
  printPlan(plan, { verbose: v['dry-run'] });
  if (v['dry-run']) return console.log(dim('--dry-run: ничего не менял'));
  const risky = plan.update.length + plan.remove.length;
  if (!v.yes) {
    if (!interactive() && risky) throw new Error('есть замены и удаления — подтвердите: tfc sync --yes');
    if (interactive() && !(await confirm('Применить?', true))) return;
  }
  const res = await applyPlan({ api: a, profile, plan, snapshot: current, cache });
  for (const d of res.duplicates)
    console.log(`  ${red('−')} старая версия мода ${d.ids.join(', ')}: ${d.path} ${dim(`(в сборке — ${d.by})`)}`);
  console.log(green('Готово.') + (res.backup ? dim(` Копия прежнего — ${res.backup}; вернуть: tfc sync --undo`) : ''));
  if (plan.conflict.length)
    console.log(yellow(`Сравните свои файлы с *.tfc-new (${plan.conflict.length}) и оставьте нужное.`));
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
  const mc = v.mc ?? ver.mc ?? current?.mc ?? null;
  const loader = v.loader ?? ver.loader ?? current?.loader ?? null;
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

async function cmdAdmin(v, [sub, arg]) {
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
  } else throw new Error('tfc admin keys | invite <ник> | revoke <id> | history | use <id> | rollback');
}

// ---------------------------------------------------------------- main

const COMMANDS = {
  init: cmdInit,
  login: cmdLogin,
  profiles: cmdProfiles,
  use: cmdUse,
  status: cmdStatus,
  sync: cmdSync,
  publish: cmdPublish,
  build: cmdBuild,
  admin: cmdAdmin,
};

async function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: opts, allowPositionals: true, strict: true });
  const [cmd, ...rest] = positionals;
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
