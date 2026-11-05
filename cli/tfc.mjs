#!/usr/bin/env node
/**
 * tfc — программа «TFC Studio» для ПК: сверяет папку игры со сборкой на сервере и сайтом, докачивает моды, аддоны,
 * конфиги, скрипты KubeJS, ресурспаки, датапаки и схемы (tfc pull); хосту — заливает сборку и собирает данные сайта. План — docs/plans/pack-cli.md,
 * инструкция для игроков — cli/README.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { deploymentsOf, isPackDatapackPath } from '@tfc/pack-server/datapacks';
import { Api } from './lib/api.mjs';
import { configFile, currentProfile, DEFAULT_SERVER, loadConfig, saveConfig } from './lib/config.mjs';
import {
  detectVersions,
  findInstances,
  findWorlds,
  gameDirOf,
  installedNeoforge,
  isDir,
  isServerDir,
  launchedElsewhere,
} from './lib/detect.mjs';
import { compareVersions, requiredNeoforge } from './lib/jarid.mjs';
import { bytesOf, changes, loadState, makePlan, PARTS, saveState, scopeOf } from './lib/plan.mjs';
import { parseParts, printJobs, PUBLISH, showJob } from './lib/jobs.mjs';
import { diffFiles, printDiff, publish } from './lib/publish.mjs';
import {
  applyPull,
  isAddonJar,
  planPull,
  pullChanges,
  recheckAddons,
  siteDatapackPaths,
  siteOwned,
} from './lib/pull.mjs';
import { scanLocal, sha256File } from './lib/scan.mjs';
import { listAddons, removeAddons, showAddons, uploadAddons } from './lib/addons.mjs';
import { confirmDatapacks, datapackCatalog, datapackIds, listDatapacks, showDatapacks } from './lib/datapacks.mjs';
import { listSchematics, publishSchematic } from './lib/schematics.mjs';
import { cmdReport as reportUpload } from './lib/reports.mjs';
import { applyChange, planChange, resultsOf } from './lib/changes.mjs';
import { applyPlan, beginBackup, editBackup, finishBackup, toBackup, undoLast } from './lib/sync.mjs';
import {
  ask,
  bold,
  choose,
  confirm,
  cyan,
  date,
  dim,
  green,
  interactive,
  mb,
  progress,
  red,
  withSpinner,
  yellow,
} from './lib/ui.mjs';
import { deleteVersions, deletableVersions, renameVersion } from './lib/profile-versions.mjs';
import { install, installedPath, isInstalled, uninstall } from './lib/install.mjs';
import {
  DEFAULT_NAME,
  defaultMemoryGb,
  defaultMinecraftDir,
  buildFatInstaller,
  installToLauncher,
  isNeoforgeInstalled,
  launcherRunning,
  neoforgeVersion,
  versionId,
} from './lib/vanilla.mjs';
import { applyStagingDrops, stagingClashes, stagingOverlay, stagingState, stagingWinsById } from './lib/staging.mjs';
import { markApproved, printUpdate, propose, pullUpdates } from './lib/updates.mjs';
import { checkUpdate } from './lib/update.mjs';
import { autoUpgrade, cleanupOld, upgrade } from './lib/upgrade.mjs';
import { BUILD, CHANNEL, IS_BINARY } from './lib/version.mjs';

const HELP = `${bold('tfc')} — сборка TFC RealWorld на вашем ПК

Настройка:
  tfc install                 поставить программу в систему: своя папка и PATH, дальше в любом терминале — tfc
                              (tfc uninstall — убрать; настройки и ключ останутся)
  tfc init                    указать папку игры (версию) и мир
  tfc init --launcher         поставить сборку в Minecraft Launcher: NeoForge, папка .minecraft/versions/TFC-RealWorld
                              и профиль лаунчера, потом скачать сборку (--memory 6 — ГБ памяти игре, --name <папка>,
                              --mc-dir <папка лаунчера>, если она не стандартная)
  tfc login <ключ>            ключ от хоста сборки (--server <адрес>, если сервер другой)
  tfc whoami                  имя и права текущего ключа на сервере, путь к настройкам (сам ключ не выводится)
  tfc profiles                профили; tfc use <профиль> — сделать текущим
  tfc rename [новое имя]      переименовать профиль; --profile <старое имя> — выбрать другой
             --name <версия>  переименовать папку и версию сборки в лаунчере
  tfc delete                  убрать программу и её запись из PATH
             --versions      также удалить папки версий tfc, включая миры в них
             --profile <имя>  с --versions удалить только указанную версию

Игрокам:
  tfc status [что]            что изменится — ничего не меняет
  tfc pull [что]              докачать и обновить всё: сборку с сервера, аддоны, датапаки и скрипты сайта, схемы
      что: ${Object.keys(PARTS).join(', ')} (без — всё, что нужно этой папке)
      --dry-run               только показать          --force   перезаписать и ваши правки (с копией)
      --yes                   не спрашивать
  tfc datapacks list          список датапаков: мир, сборка, доступные и изменённые
  tfc datapacks files         filename — название для ZIP в снимке сервера
  tfc datapacks <имя/id/filename>    источник, уровень и команда установки
  tfc datapacks pull <имя/id/filename…|all>   догрузить выбранные (install — то же); подтверждённые ставятся без мира
  tfc datapacks confirm [all|имя…]   хосту: подтвердить проверенные в мире версии для всей сборки
  tfc datapacks unconfirm [all|имя…] хосту: вернуть на уровень мира для проверки новой версии
  tfc pull datapacks|kubejs|schematics|addons <имя…>   одно названное с сайта (датапак — любой, и тестовый)
  tfc pull addons <мод>@<версия>   поставить и закрепить версию аддона (откат); <мод>@latest — снять закрепление
  tfc schematics list [поиск]    библиотека схем и состояние локальных копий
  tfc schematics local [поиск]   .nbt в schematics/ и uploaded/<ник>/ (также --server-dir профиля)
  tfc schematics <id>            схема, её ревизия и копии здесь
  tfc schematics install <id…>   загрузить выбранные схемы (= pull schematics), --dry-run — план
  tfc schematics publish <файл>  предпросмотр и публикация; --name, --author, --dry-run, --yes
  tfc schematics update <id> <файл>  обновить исходник с проверкой ревизии и сохранением настроек
                              --as-source — явно считать обработанную заменами копию исходником
  tfc addons list             аддоны сборки строками <мод>@<версия>: последняя, что стоит здесь, что закреплено
                              (--host-only — только аддоны для хоста)
  tfc addons <мод…>           все версии аддона строками <мод>@<версия> — какие можно поставить
  tfc addons install <мод>@<версия>…   поставить и закрепить версию (= tfc pull addons …); <мод>@latest — последнюю
  tfc addons install --host-only   поставить все аддоны для хоста (последние версии)
  tfc addons remove <мод…>    убрать аддон, поставленный вручную (в списке — [вручную]: обычный pull такие не ставит
                              и не убирает, только обновляет поставленные)
  tfc undo                    вернуть как было до прошлого pull
  tfc report                  загрузить на сайт лог или краш-репорт (спросит вид и какие файлы) — для агента
                              и хоста; в конце — строка «Для агента» с id tfc-report:…
  tfc report <вид> [N | имя]  без вопросов: вид — log, crash, debug, kubejs, jvm (хосту ещё server, server-crash, server-kubejs);
                              без N — последний, N — столько последних (одним zip), имя — конкретный файл
      --note "что случилось"  --task <id задачи> — приложить к задаче   --dry-run — только показать

Хосту (ключ администратора):
  tfc publish                 залить сборку из папки игры на сервер (--note "что поменял", --yes, --force)
                              --no-host-addons — без аддонов хоста (Host Tools и т. п.): они нужны только хосту
  tfc build [mods,kubejs,config,world]   собрать данные сайта локально в ./tfc-out — посмотреть до заливки
  tfc admin keys | invite <ник> [--admin] | revoke <id> | history | use <id> | rollback
  tfc admin neoforge [list | build [версия]]   установщик NeoForge с библиотеками на сервере сборки: игроки ставят
                              NeoForge без maven.neoforged.net; собирать после смены версии NeoForge
  tfc admin updates [pull [id…] | approve <id> | reject <id>]   обновления сборки от Claude: список; pull — забрать
                              в папку игры и сервера (вернуть — tfc undo); approve — сделать новой сборкой для всех
  tfc admin updates subscribe <id…>     staging: этот профиль получает обновление поверх сборки при каждом tfc pull,
                              обычные файлы сборки обновляются как всегда (--profile тест — только в нём)
  tfc admin updates unsubscribe <id…|all>   отписаться и вернуть обычное состояние; subscribed — на что подписан профиль
  tfc admin propose [<папка>] предложить обновление: файлы из папки (kubejs/…, config/…), --jar <файл> (в mods/, старые
                              версии уберёт сам; --keep-old — оставить), --datapack <id|имя> (подтвердится при одобрении),
                              --remove <путь>, --note, --dry-run
  tfc admin rebuild [mods,kubejs,config,world]   пересобрать данные сайта на сервере (--pull — свежий код,
                              --publish none|dry-run|live — что потом; по умолчанию dry-run — только показать)
  tfc admin publish           показать, что изменится на сайте; --live — выложить (текущую сборку, с вопросом);
                              --allow-removals — разрешить убрать с сайта больше 300 файлов
  tfc admin jobs [id|last]    задания сервера; с id — лог и итог (--follow — следить до конца)
  tfc admin addon upload <jar…>   залить jar новой версии аддона (id и версия — из jar; --id, --ver)
  tfc admin changes [pull [id…] | reject <id>]   правки конфигов от Claude: список; pull — внести в папку игры
                              и сервера (покажет и спросит; --dry-run, --yes; вернуть — tfc undo); reject — отклонить

Общее: --profile <имя> — другой профиль; tfc --version — версия; tfc --upgrade — обновить программу
(--force — скачать заново, даже если версия та же). Настройки: ${configFile()}`;

// ---------------------------------------------------------------- установка в систему

function printInstalled(r) {
  console.log(r.same ? `tfc уже стоит: ${r.path}` : `${green(r.updated ? 'Обновил' : 'Установил')} tfc: ${r.path}`);
  if (r.pathChange === 'added')
    console.log(
      process.platform === 'win32'
        ? `Папка ${r.dir} добавлена в PATH.`
        : `Папка ${r.dir} добавлена в PATH: ${r.files.join(', ')}.`,
    );
  if (r.pathChange === 'manual')
    console.log(
      yellow(`PATH поменять не вышло (${r.files[0]}). Добавьте папку ${r.dir} в PATH сами или пишите полный путь.`),
    );
  if (r.pathChange === 'added')
    console.log(
      `${bold('Откройте новое окно терминала')} — в нём команды пишутся просто: ${cyan('tfc init')}, ${cyan('tfc pull')}.`,
    );
  if (r.pathChange === 'already')
    console.log(`Папка уже в PATH — команды пишутся просто: ${cyan('tfc init')}, ${cyan('tfc pull')}.`);
  if (!isInstalled()) console.log(dim(`Скачанный файл (${process.execPath}) больше не нужен — его можно удалить.`));
}

async function cmdInstall(v) {
  if (CHANNEL === 'npm')
    return console.log('tfc поставлен через npm — команда tfc уже есть в PATH, ставить ещё раз не нужно.');
  if (!IS_BINARY) throw new Error('из исходников ставится через npm: npm install -g . в папке проекта (или npm link)');
  if (!v.yes && interactive() && !(await confirm(`Поставить tfc в ${installedPath()} и добавить в PATH?`, true)))
    return;
  printInstalled(install());
}

async function cmdUninstall(v) {
  if (CHANNEL === 'npm') return console.log('tfc поставлен через npm — убрать: npm uninstall -g tfc-plans');
  if (!IS_BINARY) throw new Error('это запуск из исходников — ставить и убирать нечего');
  if (!v.yes && interactive() && !(await confirm(`Убрать tfc (${installedPath()}) и его папку из PATH?`, false)))
    return;
  const r = uninstall();
  console.log(r.removed ? `${green('Убрал')} ${r.path}` : `Файла ${r.path} и так нет.`);
  if (r.files.length) console.log(`PATH: ${r.files.join(', ')} — больше без tfc.`);
  console.log(dim('Настройки и ключ остались: tfc install вернёт всё как было.'));
}

/** Запуск без команды файлом не из папки установки (двойной клик по скачанному) — предлагаем поставить */
async function offerInstall() {
  if (!IS_BINARY || !interactive() || isInstalled()) return;
  console.log('');
  try {
    const q = `${bold('Поставить tfc на этот компьютер')}, чтобы писать просто tfc в любом терминале?`;
    if (await confirm(q, true)) printInstalled(install());
  } catch (e) {
    console.error(red(`Ошибка: ${e.message ?? e}`));
  }
}

const opts = {
  profile: { type: 'string' },
  versions: { type: 'boolean' },
  server: { type: 'string' },
  instance: { type: 'string' },
  world: { type: 'string' },
  'no-world': { type: 'boolean' },
  launcher: { type: 'boolean' },
  'mc-dir': { type: 'string' },
  name: { type: 'string' },
  author: { type: 'string' },
  'as-source': { type: 'boolean' },
  memory: { type: 'string' },
  'server-dir': { type: 'string' },
  note: { type: 'string' },
  id: { type: 'string' },
  ver: { type: 'string' },
  mc: { type: 'string' },
  loader: { type: 'string' },
  out: { type: 'string' },
  yes: { type: 'boolean', short: 'y' },
  force: { type: 'boolean' },
  undo: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'no-current': { type: 'boolean' },
  remove: { type: 'string', multiple: true },
  jar: { type: 'string', multiple: true },
  datapack: { type: 'string', multiple: true },
  'keep-old': { type: 'boolean' },
  admin: { type: 'boolean' },
  pull: { type: 'boolean' },
  publish: { type: 'string' },
  live: { type: 'boolean' },
  'allow-removals': { type: 'boolean' },
  'host-only': { type: 'boolean' },
  task: { type: 'string' },
  'no-host-addons': { type: 'boolean' },
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

/** Путь с ~, $env:ИМЯ или %ИМЯ%, если оболочка не раскрыла их сама (команду из PowerShell ввели в cmd и наоборот) */
const expandPath = (dir) =>
  dir
    .replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || '~')
    .replace(/\$env:(\w+)|%(\w+)%/gi, (m, a, b) => process.env[a ?? b] ?? m);

async function cmdInit(v) {
  const cfg = loadConfig();
  if (v.launcher) return initLauncher(v, cfg);
  let dir = v.instance;
  if (!dir) {
    if (!interactive()) throw new Error('укажите папку: tfc init --instance <папка версии> (или tfc init --launcher)');
    const found = findInstances();
    console.log(found.length ? 'Нашёл версии в лаунчерах:' : 'Версий в известных лаунчерах не нашёл.');
    const fresh = { fresh: true };
    dir = await choose(
      'Какая папка — игра',
      [...found, fresh],
      (f) =>
        f.fresh
          ? `${bold('Поставить сборку заново')} ${dim(`для Minecraft Launcher и TLauncher — ${path.join(defaultMinecraftDir(), 'versions', DEFAULT_NAME)}`)}`
          : `${f.name} ${dim(`${[f.launcher, detectVersions(f.dir).loader].filter(Boolean).join(', ')} · ${f.dir}`)}`,
      { allowOther: true },
    );
    if (dir === fresh) return initLauncher(v, cfg, { fresh: true });
    if (typeof dir === 'object') dir = dir.dir;
  }
  dir = path.resolve(expandPath(dir));
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

/**
 * tfc init --launcher: своя версия в .minecraft/versions (официальный лаунчер и TLauncher; cli/lib/vanilla.mjs),
 * профиль tfc на её папку, pull
 */
async function initLauncher(v, cfg, { fresh = false } = {}) {
  if (!cfg.token) {
    if (!interactive()) throw new Error('сначала ключ: tfc login <ключ>, потом tfc init --launcher');
    const key = await ask('Ключ от хоста сборки (начинается с tfc_)');
    await cmdLogin(v, [key]);
    Object.assign(cfg, loadConfig());
  }
  const current = await api(cfg).current();
  const nf = neoforgeVersion(v.loader || current?.loader);
  if (!nf)
    throw new Error(
      current
        ? `в сборке непонятная версия загрузчика «${current.loader}» — укажите --loader 21.1.248`
        : 'на сервере ещё нет сборки',
    );
  if (current?.mc && current.mc !== '1.21.1') console.log(yellow(`Сборка для Minecraft ${current.mc}.`));
  const selected = v.profile ?? cfg.profile ?? Object.keys(cfg.profiles)[0];
  const existing = Object.hasOwn(cfg.profiles, selected) ? cfg.profiles[selected] : null;
  const instance = existing && path.resolve(existing.instance);
  const parent = instance && path.dirname(instance);
  const versionFolder = parent && path.basename(parent) === 'versions' ? path.basename(instance) : null;
  const update = existing && (v.profile || (!fresh && (!v.name || v.name === versionFolder)));
  const mcDir = path.resolve(
    v['mc-dir'] ??
      (update ? (existing.launcher?.mcDir ?? (versionFolder && path.dirname(parent))) : null) ??
      defaultMinecraftDir(),
  );
  const versions = path.join(mcDir, 'versions');
  const inRoot = update && instance === mcDir;
  if (update && (existing.side === 'server' || (!inRoot && parent !== versions)))
    throw new Error(`профиль «${selected}» находится в ${instance} — обновите NeoForge в его лаунчере`);
  const oldFolder = update ? (inRoot ? existing.launcher?.version : versionFolder) : null;
  if (oldFolder && v.name && oldFolder !== v.name)
    throw new Error(`профиль «${selected}» уже использует версию ${oldFolder}`);
  const base = oldFolder ?? v.name ?? DEFAULT_NAME;
  if (!/^[\w][\w.-]{0,60}$/.test(base) || base === versionId(nf) || base === current?.mc)
    throw new Error(`имя папки «${base}» не подходит — латиница, цифры, «-», «_», и не имя версии`);
  let folder = base;
  if (!oldFolder) {
    const occupied = new Set(Object.values(cfg.profiles).map((p) => path.resolve(p.instance)));
    const taken = (name) => {
      const dir = path.join(versions, name);
      return occupied.has(dir) || fs.existsSync(dir);
    };
    for (let i = 2; taken(folder); i++) folder = `${base.slice(0, 55)}-${i}`;
  }
  const gameDir = inRoot ? instance : path.join(versions, folder);
  let name = update || v.profile ? selected : Object.keys(cfg.profiles).length ? folder : 'main';
  if (!update && !v.profile) {
    const baseName = name;
    for (let i = 2; Object.hasOwn(cfg.profiles, name); i++) name = `${baseName}-${i}`;
  }
  if (!name || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('недопустимое имя профиля');
  let memory = v.memory === undefined ? undefined : Number(v.memory);
  if (!update && memory === undefined) {
    memory = defaultMemoryGb();
    if (interactive()) memory = Number(await ask('Сколько памяти отдать игре, ГБ', String(memory)));
  }
  if (memory !== undefined && (!Number.isInteger(memory) || memory < 2 || memory > 64))
    throw new Error('память — целое число ГБ, 2–64');

  console.log(`Папка Minecraft: ${mcDir}`);
  console.log(`  NeoForge ${nf}${isNeoforgeInstalled(mcDir, nf) ? dim(' — уже стоит') : ''}`);
  console.log(`  профиль «${name}», версия ${bold(folder)}, папка игры: ${gameDir}`);
  if (launcherRunning()) {
    console.log(yellow('Minecraft Launcher открыт — закройте его: при выходе он перепишет профили своей копией.'));
    if (!interactive()) throw new Error('закройте Minecraft Launcher и повторите');
    await ask('Закройте лаунчер и нажмите Enter');
    if (launcherRunning()) throw new Error('лаунчер всё ещё открыт — закройте его и повторите');
  }
  if (!v.yes && interactive() && !(await confirm(update ? 'Обновить профиль?' : 'Поставить?', true))) return;

  const install = (version) =>
    withSpinner('Готовлю установку', (sp) =>
      installToLauncher({
        mcDir,
        nf: version,
        name: folder,
        gameDir,
        profileId: update ? existing.launcher?.profile : undefined,
        memoryGb: memory,
        api: api(cfg),
        onStep: (s) => sp.update(s),
      }),
    );
  const r = await install(nf);
  console.log(`${green(r.installed ? 'NeoForge поставлен' : 'NeoForge уже был')}, версия ${bold(folder)} готова.`);
  if (r.profiles) {
    console.log(`Профиль Minecraft Launcher «${r.title}» — на ${gameDir}`);
    console.log(dim(`Прежние профили лаунчера — копией: ${r.backups.map((b) => path.basename(b)).join(', ')}`));
  }

  cfg.profiles[name] = {
    world: null,
    side: 'client',
    ...(update ? existing : {}),
    instance: gameDir,
    launcher: { mcDir, profile: r.profileId, version: folder },
  };
  if (!update) cfg.profile = name;
  saveConfig(cfg);
  console.log(`${green('Сохранено')} — профиль ${profileTitle({ name, ...cfg.profiles[name] })}`);
  const hint = launchHint(folder, gameDir, r.title);
  if (
    v.yes ||
    !interactive() ||
    (await confirm(update ? 'Обновить файлы сборки сейчас?' : 'Скачать сборку сейчас?', true))
  ) {
    await cmdPull({ ...v, profile: name, yes: true, 'no-neoforge-check': true }, []);
    // Моды сборки могут требовать NeoForge новее указанного в ней (аддон выпущен после заливки)
    const need = requiredNeoforge(modJars(cfg.profiles[name].instance));
    if (need && compareVersions(nf, need.version) < 0) {
      console.log(yellow(`Модам нужен NeoForge ${need.version} (${need.by.join(', ')}) — ставлю его вместо ${nf}.`));
      await install(need.version);
    }
    console.log(hint);
  } else console.log(`Дальше: ${cyan('tfc pull')}. ${hint}`);
}

const launchHint = (folder, gameDir, title) =>
  `Играть: Minecraft Launcher — профиль ${bold(title)}; другой лаунчер — версия ${bold(folder)}, папка игры должна быть ${gameDir}. После первого запуска ${cyan('tfc status')} скажет, если игра запустилась не оттуда.`;

async function cmdLogin(v, [key]) {
  if (!key) throw new Error('tfc login <ключ>');
  // Ключ сервера — латиница, цифры, «_» и «-» (tfc_…); иное (кириллица, пробелы) — опечатка при копировании
  if (!/^[\w-]{8,200}$/.test(key))
    throw new Error('ключ выглядит не так — скопируйте его целиком, он начинается с tfc_');
  const cfg = loadConfig();
  const server = v.server || cfg.server || DEFAULT_SERVER;
  const a = new Api(server, key);
  const role = await a.role();
  const who = await a.get('/auth/me').catch((e) => {
    if (e.status === 404) return null; // Совместимость с сервером до появления диагностики ключа.
    throw e;
  });
  Object.assign(cfg, { server, token: key, role });
  saveConfig(cfg);
  console.log(
    `${green('Ключ подошёл')}${who ? `: ${who.name}` : ''} — ${role === 'admin' ? 'администратор сборки' : 'игрок'}, сервер ${server}`,
  );
  console.log(`Настройки: ${configFile()}`);
}

async function cmdWhoami() {
  const cfg = loadConfig();
  const who = await api(cfg).get('/auth/me');
  console.log(`Ключ: ${who.name} (${who.role === 'admin' ? 'администратор сборки' : 'игрок'})`);
  console.log(`Сервер: ${cfg.server}`);
  console.log(`Настройки: ${configFile()}`);
}

function cmdProfiles() {
  const cfg = loadConfig();
  const names = Object.keys(cfg.profiles);
  if (!names.length) return console.log('Профилей нет — tfc init');
  for (const n of names)
    console.log(`${n === cfg.profile ? green('●') : ' '} ${profileTitle({ name: n, ...cfg.profiles[n] })}`);
}

function cmdRename(v, args) {
  const [name] = args;
  if (args.length > 1 || (!name && !v.name))
    throw new Error('tfc rename [новое имя профиля] [--profile <текущий профиль>] [--name <новая версия>]');
  const cfg = loadConfig();
  const profile = currentProfile(cfg, v.profile);
  const key = name ?? profile.name;
  if (!key.trim() || ['__proto__', 'constructor', 'prototype'].includes(key))
    throw new Error('недопустимое имя профиля');
  if (key !== profile.name && Object.hasOwn(cfg.profiles, key)) throw new Error(`профиль «${key}» уже существует`);

  const save = ({ name: old, ...next }) => {
    cfg.profiles = Object.fromEntries(Object.entries(cfg.profiles).map(([n, p]) => (n === old ? [key, next] : [n, p])));
    if (cfg.profile === old) cfg.profile = key;
    saveConfig(cfg);
  };
  if (v.name) {
    const others = Object.entries(cfg.profiles)
      .filter(([n]) => n !== profile.name)
      .map(([, p]) => p);
    renameVersion(profile, v.name, others, save);
  } else save(profile);
  console.log(`Профиль «${key}»${v.name ? `, версия ${v.name}` : ''}.`);
}

async function cmdDelete(v, args) {
  if (args.length || (v.profile && !v.versions)) throw new Error('tfc delete [--versions [--profile <имя>]] [--yes]');
  if (!v.versions) {
    if (v['dry-run']) return console.log(`Будет удалён tfc: ${installedPath()}`);
    if (!v.yes && !interactive()) throw new Error('подтвердите удаление: tfc delete --yes');
    return cmdUninstall(v);
  }
  const cfg = loadConfig();
  if (v.profile) currentProfile(cfg, v.profile);
  const targets = deletableVersions(cfg.profiles, v.profile);
  for (const { name, dir } of targets) console.log(`  «${name}» — ${dir}`);
  if (!targets.length) console.log('Отдельных версий, установленных через tfc, нет.');
  if (v['dry-run']) return console.log('Предварительный просмотр удаления завершён.');
  if (!v.yes && !interactive()) throw new Error('подтвердите удаление флагом --yes');
  if (!v.yes && !(await confirm('Удалить tfc и перечисленные папки целиком, включая миры в них?', false))) return;
  deleteVersions(targets, () => {
    for (const { name } of targets) delete cfg.profiles[name];
    if (!Object.hasOwn(cfg.profiles, cfg.profile)) cfg.profile = Object.keys(cfg.profiles)[0] ?? null;
    saveConfig(cfg);
  });
  console.log(`Удалено версий: ${targets.length}.`);
  if (IS_BINARY || CHANNEL === 'npm') return cmdUninstall({ ...v, yes: true });
}

function cmdUse(v, [name]) {
  const cfg = loadConfig();
  if (!cfg.profiles[name]) throw new Error(`нет профиля «${name}»`);
  cfg.profile = name;
  saveConfig(cfg);
  console.log(`Текущий профиль — ${name}`);
}

// ---------------------------------------------------------------- игроки

/** Хеши файлов папки игры; sp — крутилка шага (prepare), иначе своя */
async function scan(profile, sp) {
  if (!sp) return withSpinner('Сверяю файлы папки игры', (s) => scan(profile, s));
  return scanLocal(profile, { onProgress: (i, n) => sp.update(`Сверяю файлы папки игры: ${i} из ${n}`) });
}

const KIND_TITLE = {
  datapacks: 'датапаки сайта',
  kubejs: 'скрипты KubeJS сайта',
  schematics: 'схемы',
  addons: 'аддоны',
};

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
  return withSpinner('Связываюсь с сервером сборки', (sp) => prepareSteps(v, args, sp));
}

async function prepareSteps(v, args, sp) {
  let { parts, names } = splitArgs(args);
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
  if (names.length && parts.length === 1 && parts[0] === 'datapacks')
    names = await datapackIds(a, names, { hasWorld: !!profile.world });
  else if (parts.includes('datapacks')) await datapackCatalog(a, { refresh: true });
  // Подписки профиля: дальше «сборка» — текущая плюс обновления поверх (staging.mjs)
  const stagingIds = v.stagingIds ?? loadState(profile).staging ?? [];
  const staging = await stagingOverlay(a, stagingIds, current);
  if (staging?.snapshot) current = staging.snapshot;
  applyStagingDrops(staging, loadState(profile).stagingDrop);
  stagingClashes(profile, staging);
  if (staging) {
    for (const d of staging.dropped) notes.push(`Подписка на обновление ${d.id} снята: ${d.why}.`);
    notes.push(...staging.notes);
  }
  const sitePlans = [];
  for (const kind of scope.site) {
    sp.update(`Смотрю ${KIND_TITLE[kind] ?? kind}`);
    const planned = await planPull(a, profile, kind, names, { force: v.force, staging });
    if (kind === 'datapacks' && planned.snapshot && planned.snapshot !== current?.id)
      throw new Error('сборка изменилась во время сверки — повторите команду');
    sitePlans.push(planned);
  }
  stagingWinsById(
    profile,
    sitePlans.find((p) => p.kind === 'addons'),
    staging,
  );
  const state = loadState(profile);
  const owned = siteOwned(sitePlans, names.length ? null : current, state, staging?.paths);
  // Аддоны не все (названы) или снимка не знаем — прежние замены не забываем
  if (names.length || !current) owned.overrides = [...new Set([...(state.addonOverrides ?? []), ...owned.overrides])];
  const hasAddons = sitePlans.some((p) => p.kind === 'addons');
  const pulled = new Set(Object.values(state.pulled ?? {}).flatMap((m) => Object.values(m).map((r) => r.path)));
  let plan = null;
  let local = null;
  let cache = null;
  if (scope.snap.length) {
    ({ files: local, cache } = await scan(profile, sp));
    plan = makePlan(current, local, state, scope.snap, {
      force: v.force,
      hasWorld: !!profile.world,
      skip: owned.skip,
      datapacksOnly: parts.includes('datapacks') && !parts.includes('kubejs'),
      // Без частей — всё, что дают и давали подписки, даже если обычно такие файлы здесь не трогаем (моды на сервере)
      also: parts.length
        ? new Set()
        : new Set([...(staging?.paths ?? []), ...(staging?.removed ?? []), ...(state.stagingPaths ?? [])]),
    });
    plan.extra = plan.extra.filter((f) => !pulled.has(f.path));
    // jar подписки, с которой сняли: его убирает сверка со снимком, а аддон видит в нём старую версию себя
    const gone = new Set(plan.remove.map((f) => f.path));
    for (const p of sitePlans) if (p.obsolete) p.obsolete = p.obsolete.filter((x) => !gone.has(x.path));
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
    staging,
    stagingIds,
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
  line(dim('·'), 'ваши правки конфигов — в сборке эти файлы не менялись, оставляю', plan.keptLocal);
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
  for (const n of p.notes ?? []) console.log(dim(`  · ${n}`));
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
    const why = p.kind === 'datapacks' ? 'копии, скачанные вручную' : 'старые версии и то, что заменяет аддон';
    console.log(`  ${red('−')} убрать — ${why} (с копией): ${p.obsolete.length}`);
    for (const x of p.obsolete) console.log(dim(`      ${x.path} ${dim(`— ${x.name}`)}`));
  }
  if (p.update.some((x) => x.copy))
    console.log(dim('      пушка, которая уже строит схему, держит старую: вынуть схему из пушки и вставить снова'));
  line(yellow('!'), 'там ваш файл — рядом положу .tfc-new (перезаписать: --force)', p.conflict);
  line(dim('·'), 'ставил я, но вы меняли — оставляю', p.keptModified);
  line(yellow('!'), 'нужен выбранный мир: tfc init --world <мир>', p.noWorld ?? []);
  if (p.unknown.length) {
    console.log(red(`  нет на сайте: ${p.unknown.join(', ')}`));
    if (p.all.length)
      console.log(
        dim(
          `  есть: ${p.all.map((x) => `${x.name}${x.install ? (x.installTarget === 'pack' ? ' (в сборку)' : ' (в мир)') : ''}`).join(', ')}`,
        ),
      );
  }
  if (!pullChanges(p) && !p.keptModified.length) console.log(dim('  всё на месте'));
}

/** Шапка, план сборки и планы сайта; возвращает, сколько всего изменится */
/** Предупреждение: игра запускалась не из папки профиля (launchedElsewhere) */
function warnLaunch(profile, wrong) {
  console.log(yellow(`Версия ${wrong.version} запускалась ${date(wrong.at)} не из папки сборки, а из ${wrong.root}.`));
  console.log(yellow(`Сборка лежит в ${profile.instance}: её моды игра не видит, поэтому сервер не пустит.`));
  console.log(
    'Исправить: укажите эту папку как папку игры в настройках лаунчера или поставьте сборку туда, откуда он запускает:',
  );
  console.log(`  ${cyan(`tfc init --instance "${wrong.root}"`)}`);
  console.log(`  ${cyan('tfc pull')}`);
  console.log(
    `В TLauncher проще: закройте его и выполните ${cyan('tfc init --launcher')} — версия станет сборкой со своей папкой.`,
  );
}

const modJars = (instance) => {
  const dir = path.join(instance, 'mods');
  return isDir(dir)
    ? fs
        .readdirSync(dir)
        .filter((n) => n.endsWith('.jar'))
        .map((n) => path.join(dir, n))
    : [];
};

/** Предупреждение: моды папки требуют NeoForge новее установленного — игра вылетит при запуске */
function warnNeoforge(profile) {
  const have = installedNeoforge(profile.instance);
  if (!have) return;
  const need = requiredNeoforge(modJars(profile.instance));
  if (!need || compareVersions(have, need.version) >= 0) return;
  const by = need.by.slice(0, 3).join(', ') + (need.by.length > 3 ? ` и ещё ${need.by.length - 3}` : '');
  console.log(yellow(`Стоит NeoForge ${have}, а модам нужен ${need.version} (${by}) — игра вылетит при запуске.`));
  if (profile.side === 'server') console.log(`Обновите NeoForge на сервере до ${need.version}.`);
  else
    console.log(
      `Поставить нужный: ${cyan(`tfc init --launcher --profile ${JSON.stringify(profile.name)} --loader ${need.version}`)}`,
    );
}

function printAll(r, { verbose = false } = {}) {
  printHeader(r.profile, r.current);
  for (const u of r.staging?.updates ?? []) console.log(`${cyan('Staging')} ${bold(u.id)}: ${u.note}`);
  const wrong = launchedElsewhere(r.profile.instance);
  if (wrong) warnLaunch(r.profile, wrong);
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
  warnNeoforge(r.profile);
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
  if (v['dry-run']) return console.log(dim('--dry-run: ничего не менял'));
  const backup = beginBackup(profile);
  // Подписка пишется вместе с файлами: отказ от применения её не меняет, tfc undo возвращает прежнюю (prevState)
  const saveStaging = () => {
    if (!r.stagingIds.length && !r.state.staging && !r.state.stagingPaths) return;
    const state = loadState(profile);
    saveState(profile, stagingState(state, r.staging, r.stagingIds, { allParts: !r.parts.length }));
  };
  if (!n) {
    // Запомнить, что всё на месте (state.json)
    if (plan)
      await applyPlan({ api: r.api, profile, plan, snapshot: r.current, cache: r.cache, backup, onlyNew: true });
    applyPull(profile, sitePlans, backup, r.overrides);
    saveStaging();
    console.log(green('Всё уже на месте.'));
    if (!v['no-neoforge-check']) warnNeoforge(profile);
    return;
  }
  const risky =
    (plan ? plan.update.length + plan.remove.length : 0) +
    sitePlans.reduce((s, p) => s + p.update.length + p.remove.length + p.obsolete.length, 0);
  if (!v.yes) {
    if (!interactive() && risky) throw new Error('есть замены и удаления — подтвердите: tfc pull --yes');
    if (interactive() && !(await confirm('Применить?', true))) return;
  }
  try {
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
      const addons = sitePlans.find((p) => p.kind === 'addons');
      stagingWinsById(profile, addons, r.staging);
      // jar обновления только что лёг: сборка могла оставить тот же мод под другим именем
      const removing = new Set(addons?.remove.map((x) => x.path));
      const clashes = stagingClashes(profile, r.staging, removing);
      if (clashes.length) {
        const state = loadState(profile);
        for (const c of clashes) {
          toBackup(backup, c.file, c.path, 'removed');
          delete state.files[c.path];
          console.log(`  ${red('−')} ${c.path} ${dim(`— тот же мод, что ${c.by} из обновления`)}`);
        }
        saveState(profile, state);
      }
      if (r.overrides) recheckAddons(profile, sitePlans, r.overrides);
      for (const x of sitePlans.find((p) => p.kind === 'addons')?.obsolete.slice(before) ?? [])
        console.log(`  ${red('−')} ${x.path} ${dim(`— ${x.name}, вместо него аддон`)}`);
    }
    applyPull(profile, sitePlans, backup, r.overrides);
    saveStaging();
  } finally {
    finishBackup(profile, backup);
  }
  const dir = finishBackup(profile, backup);
  console.log(green('Готово.') + (dir ? dim(` Копия прежнего — ${dir}; вернуть: tfc undo`) : ''));
  if (plan?.conflict.length || sitePlans.some((p) => p.conflict.length))
    console.log(yellow('Сравните свои файлы с *.tfc-new и оставьте нужное.'));
  const changed = (kind) => sitePlans.some((p) => p.kind === kind && pullChanges(p));
  if (
    changed('datapacks') ||
    plan?.add.concat(plan.update, plan.remove).some((f) => f.kind === 'world-datapack' || isPackDatapackPath(f.path))
  )
    console.log(dim('Датапаки подхватятся после перезапуска мира или командой /reload.'));
  if (changed('addons') || plan?.add.concat(plan.update, plan.remove).some((f) => f.kind === 'mod'))
    console.log(dim('Моды поменялись — перезапустите игру (и сервер).'));
  else if (changed('kubejs')) console.log(dim('Скрипты сервера — /reload на сервере (или перезапуск).'));
  if (r.cfg.role === 'admin' && sitePlans.some((p) => p.kind !== 'schematics' && pullChanges(p)))
    console.log(dim('Хосту: чтобы сайт собрал данные с этим (рецепты, предметы) — tfc publish.'));
  if (!v['no-neoforge-check']) warnNeoforge(profile);
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
  const { files: local, skipped, state } = await scan(profile);
  // Датапаки сайта раздаёт сайт (tfc pull) — в сборку их не берём (кроме уже закреплённых в снимке через confirm)
  const confirmedPaths = new Set(deploymentsOf(current).map((d) => d.path));
  const siteDp = await siteDatapackPaths(a, profile);
  const fromSite = [];
  for (const [p, f] of local)
    if ((f.kind === 'world-datapack' || (isPackDatapackPath(p) && !confirmedPaths.has(p))) && siteDp(p)) {
      fromSite.push(`${path.posix.basename(p)} — «${siteDp(p)}»`);
      local.delete(p);
    }
  // --no-host-addons: аддоны хоста (hostOnly) нужны только ему — в сборку для всех их не берём
  const hostJars = [];
  if (v['no-host-addons']) {
    const host = (await a.get('/site/addons')).addons.filter((x) => x.hostOnly);
    for (const [p, f] of local)
      if (f.kind === 'mod' && host.some((x) => isAddonJar(x, path.basename(p)))) {
        hostJars.push(p);
        local.delete(p);
      }
  }
  // Аддоны только для ручной установки в сборку не идут: у хоста стоят, игрокам не нужны. Уже в сборке — их оставляем
  const pulledAddons = Object.values(loadState(profile).pulled?.addons ?? {});
  const manualList = (await a.get('/site/addons?v=2').catch(() => ({ addons: [] }))).addons.filter((x) => x.manual);
  const manualJars = [];
  for (const [p, f] of local)
    if (
      f.kind === 'mod' &&
      !current?.files.some((c) => c.path === p) &&
      (pulledAddons.some((r) => r.manual && r.path === p) || manualList.some((x) => isAddonJar(x, path.basename(p))))
    ) {
      manualJars.push(p);
      local.delete(p);
    }
  // Файлы staging-обновлений в заливку не идут: для них остаётся то, что в сборке на сервере
  const staging = await stagingOverlay(a, loadState(profile).staging, current);
  applyStagingDrops(staging, loadState(profile).stagingDrop);
  const stagedOut = [];
  if (staging?.snapshot) {
    const base = new Map(current.files.map((f) => [f.path, f]));
    for (const p of [...staging.paths, ...staging.removed]) {
      const f = base.get(p);
      if (f) local.set(p, { ...f, file: undefined });
      else if (!local.delete(p)) continue;
      stagedOut.push(p);
    }
  }
  if (!local.size) throw new Error(`в ${profile.instance} нечего заливать`);
  const ver = detectVersions(profile.instance);
  const { mc, loader: found } = await gameVersion(a, v, ver, current, profile.instance);
  // В снимке — NeoForge не ниже требования модов: по нему tfc init --launcher ставит игру новым игрокам
  const need = requiredNeoforge([...local.values()].filter((f) => f.kind === 'mod' && f.file).map((f) => f.file));
  const nf = neoforgeVersion(found);
  const raise = need && (!nf || compareVersions(nf, need.version) < 0);
  if (raise)
    console.log(
      yellow(
        `Модам нужен NeoForge ${need.version} (${need.by.join(', ')}), в папке указан ${found} — в сборку пишу ${need.version}.`,
      ),
    );
  if (raise) console.log(dim(`Игрокам без maven NeoForge: tfc admin neoforge build ${need.version}`));
  const loader = raise ? `neoforge-${need.version}` : found;
  console.log(`Профиль ${profileTitle(profile)}${mc ? dim(` · Minecraft ${mc}${loader ? `, ${loader}` : ''}`) : ''}`);
  if (skipped) console.log(dim(`(пропущено вне белого списка: ${skipped})`));
  if (state) console.log(dim(`(состояние модов — кеши, история JEI и т. п. — не заливаю: ${state})`));
  if (fromSite.length) {
    console.log(dim(`(датапаки сайта — их ставит tfc pull с сайта, в сборку не беру: ${fromSite.length})`));
    for (const x of fromSite) console.log(dim(`    ${x}`));
  }
  if (v['no-host-addons'])
    console.log(
      dim(
        hostJars.length
          ? `(аддоны хоста в сборку не беру: ${hostJars.map((p) => path.basename(p)).join(', ')})`
          : '(аддонов хоста в папке нет — --no-host-addons ничего не убрал)',
      ),
    );
  if (manualJars.length)
    console.log(
      dim(
        `(аддоны только для ручной установки в сборку не беру: ${manualJars.map((p) => path.basename(p)).join(', ')})`,
      ),
    );
  if (stagedOut.length) {
    console.log(dim(`(профиль подписан на обновления, их файлы в сборку не беру: ${stagedOut.length})`));
    for (const p of stagedOut.slice(0, 6)) console.log(dim(`    = ${p}`));
    if (stagedOut.length > 6) console.log(dim(`    … ещё ${stagedOut.length - 6}`));
  }
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
  if (BUILD) throw new Error(msg);
  const profile = currentProfile(loadConfig(), v.profile);
  const packModule = '@tfc/scripts/pack';
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

/** Толстый установщик NeoForge на сервере сборки: для игроков, у которых maven.neoforged.net не открывается */
async function adminNeoforge(a, v, [action, version]) {
  if (!action || action === 'list') {
    const { installers } = await a.get('/admin/neoforge');
    if (!installers.length) console.log('Установщиков на сервере нет.');
    for (const i of installers)
      console.log(`${bold(i.version)} ${i.file} ${dim(`${mb(i.size)}, ${date(i.at)}, ${i.by}`)}`);
    return;
  }
  if (action !== 'build') throw new Error('tfc admin neoforge [list | build [версия]]');
  const nf = version ?? neoforgeVersion(v.loader || (await a.current())?.loader);
  if (!nf) throw new Error('какую версию собрать? tfc admin neoforge build 21.1.251');
  const file = await withSpinner(`Собираю установщик NeoForge ${nf}`, () =>
    buildFatInstaller(nf, path.resolve(v['mc-dir'] ?? defaultMinecraftDir())),
  );
  const sha256 = await sha256File(file);
  const { missing } = await a.post('/blobs/missing', { sha256: [sha256] });
  if (missing.length) {
    const bar = progress('заливка', fs.statSync(file).size);
    await a.upload(file, sha256, (n) => bar.add(n));
    bar.end();
  }
  const r = await a.post('/admin/neoforge', { version: nf, file: path.basename(file), sha256 });
  console.log(`${green('Готово:')} установщик NeoForge ${r.version} на сервере, ${mb(r.size)}.`);
}

async function adminUpdates(a, v, [action, ...ids]) {
  const { updates } = await a.get('/admin/updates');
  const pending = updates.filter((u) => u.status === 'pending');
  const find = (id, allowRejected = false) => {
    const u = updates.find((x) => x.id === id);
    if (!u) throw new Error(`нет обновления ${id ?? ''} — список: tfc admin updates`);
    if (u.status !== 'pending' && !(allowRejected && u.status === 'rejected'))
      throw new Error(`обновление ${u.id} уже не ждёт (${u.status})`);
    return u;
  };
  const cfgNow = loadConfig();
  const subProfile = Object.keys(cfgNow.profiles ?? {}).length ? currentProfile(cfgNow, v.profile) : null;
  const subs = subProfile ? (loadState(subProfile).staging ?? []) : [];
  if (!action || action === 'list') {
    if (!pending.length) console.log('Ждущих обновлений нет.');
    for (const u of pending) printUpdate(u, { subscribed: subs.some((x) => x.id === u.id) });
    const rejected = updates.filter((u) => u.status === 'rejected');
    if (rejected.length) console.log(dim('\nОтклонённые — только явный pull по id:'));
    for (const u of rejected) printUpdate(u);
    const done = updates.filter((u) => u.status === 'approved').slice(0, 5);
    if (done.length) console.log(dim('\nНедавно одобренные:'));
    for (const u of done) printUpdate(u, { full: false });
    if (pending.length)
      console.log(
        `\nПроверить поверх сборки: ${cyan('tfc admin updates subscribe <id>')} (--profile тест — только в нём), забрать файлами: ${cyan('tfc admin updates pull')}, после проверки — ${cyan('tfc admin updates approve <id>')}`,
      );
    return;
  }
  if (action === 'subscribed') {
    if (!subProfile) throw new Error('сначала настройте папку игры: tfc init');
    if (!subs.length) return console.log(`Профиль ${subProfile.name} ни на что не подписан.`);
    console.log(`Профиль ${profileTitle(subProfile)} подписан:`);
    for (const s of subs) {
      const u = updates.find((x) => x.id === s.id);
      if (u) printUpdate(u, { full: false, subscribed: true });
      else console.log(`${bold(s.id)} ${dim('нет на сервере')}`);
    }
    return;
  }
  if (action === 'subscribe' || action === 'unsubscribe') {
    if (!subProfile) throw new Error('сначала настройте папку игры: tfc init');
    if (!ids.length) throw new Error(`tfc admin updates ${action} <id…>${action === 'unsubscribe' ? ' | all' : ''}`);
    let next;
    if (action === 'subscribe') {
      next = [...subs];
      for (const id of ids) {
        const u = find(id);
        if (!next.some((x) => x.id === u.id)) next.push({ id: u.id, note: u.note });
      }
    } else if (ids.length === 1 && ids[0] === 'all') next = [];
    else {
      const absent = ids.filter((id) => !subs.some((x) => x.id === id));
      if (absent.length) throw new Error(`профиль ${subProfile.name} не подписан на: ${absent.join(', ')}`);
      next = subs.filter((x) => !ids.includes(x.id));
    }
    console.log(
      action === 'subscribe'
        ? `Подписываю профиль ${profileTitle(subProfile)} — сборка и обновления поверх:`
        : `Отписываю профиль ${profileTitle(subProfile)} — файлы обновлений уйдут, файлы сборки вернутся:`,
    );
    return cmdPull({ ...v, stagingIds: next }, []);
  }
  if (action === 'pull') {
    const todo = ids.length ? ids.map((id) => find(id, true)) : pending.slice().reverse();
    const rejected = todo.filter((u) => u.status === 'rejected');
    if (rejected.length)
      console.log(
        yellow(
          `Явно выбраны отклонённые обновления: ${rejected.map((u) => u.id).join(', ')}. Статус останется «отклонено».`,
        ),
      );
    if (!todo.length) return console.log('Ждущих обновлений нет.');
    const profile = currentProfile(loadConfig(), v.profile);
    console.log(`Профиль ${profileTitle(profile)}${profile.serverDir ? dim(` · сервер ${profile.serverDir}`) : ''}`);
    return pullUpdates(a, profile, todo, { yes: v.yes, dryRun: v['dry-run'] });
  }
  if (action === 'approve' || action === 'reject') {
    if (ids.length !== 1) throw new Error(`tfc admin updates ${action} <id> — укажите ровно одно обновление`);
    const u = find(ids[0]);
    printUpdate(u);
    const q = action === 'approve' ? 'Сделать новой сборкой для всех игроков?' : 'Отклонить?';
    if (!v.yes) {
      if (!interactive()) throw new Error(`Для ${action} нужен --yes: статус обновления не изменён.`);
      if (!(await confirm(q, action === 'approve'))) return console.log('Статус обновления не изменён.');
    }
    if (action === 'reject') {
      const rejected = await a.post(`/admin/updates/${u.id}/reject`, { reason: v.note ?? '' });
      if (rejected.status !== 'rejected')
        throw new Error('Сервер не подтвердил статус «отклонено». Проверьте список обновлений.');
      return console.log(
        'Статус: отклонено. Общий pull его пропустит; забрать явно: tfc admin updates pull ' +
          u.id +
          '\nЕсли забирали его к себе — вернуть файлы: tfc undo',
      );
    }
    const r = await a.post(`/admin/updates/${u.id}/approve`, { force: !!v.force }).catch((e) => {
      if (e.status === 403)
        throw new Error(`${e.message}\nНастройки: ${configFile()}. Проверить текущий ключ: tfc whoami`);
      if (e.data?.conflicts)
        throw new Error(`${e.message}:\n${e.data.conflicts.map((p) => `  ! ${p}`).join('\n')}\nПоверх них — с --force`);
      throw e;
    });
    console.log(`${green('Готово:')} сборка ${r.snapshot.id} — теперь текущая, игроки получат её по tfc pull.`);
    if (r.update.datapacks?.length)
      console.log(`Подтверждены в сборке датапаки: ${r.update.datapacks.map((d) => `«${d.name}»`).join(', ')}.`);
    if (r.previous)
      console.log(
        dim(
          `Откат: tfc admin rollback (сборка ${r.snapshot.id} → ${r.previous}${r.update.datapacks?.length ? ', вернёт и подтверждение датапаков' : ''}).`,
        ),
      );
    if (r.job) console.log(dim(`Данные сайта пересобираются: tfc admin jobs ${r.job} --follow`));
    const cfg = loadConfig();
    if (Object.keys(cfg.profiles ?? {}).length)
      await markApproved(currentProfile(cfg, v.profile), r.update, r.snapshot);
    return;
  }
  throw new Error('tfc admin updates [pull [id…] | approve <id> | reject <id>]');
}

async function cmdAddons(v, [sub, ...names]) {
  // install — тот же pull, только аддоны: ставит названные версии и закрепляет их
  if (sub === 'install') {
    // --host-only — все аддоны хоста, последние версии (или закреплённые)
    if (v['host-only']) {
      const host = (await api(loadConfig()).get('/site/addons')).addons.filter((x) => x.hostOnly);
      if (!host.length) return console.log('Аддонов для хоста нет.');
      names = [...host.map((x) => x.id), ...names];
    }
    if (!names.length)
      throw new Error(
        'tfc addons install <мод>@<версия> | --host-only — строки из tfc addons list или tfc addons <мод>',
      );
    return cmdPull(v, ['addons', ...names]);
  }
  const cfg = loadConfig();
  const profile = Object.keys(cfg.profiles ?? {}).length ? currentProfile(cfg, v.profile) : null;
  if (sub === 'remove') {
    if (!profile) throw new Error('сначала настройте папку игры: tfc init');
    return removeAddons(profile, names, { yes: v.yes, dryRun: v['dry-run'] });
  }
  if (!sub || sub === 'list') {
    if (names.length) throw new Error('tfc addons list [--host-only] — без имён; версии аддона: tfc addons <мод>');
    return listAddons(api(cfg), profile, { hostOnly: v['host-only'] });
  }
  if (v['host-only']) throw new Error('--host-only — только для tfc addons list и install');
  await showAddons(api(cfg), profile, [sub, ...names]);
}

async function cmdSchematics(v, [sub = 'list', ...args]) {
  if (sub === 'install' || sub === 'pull') {
    if (!args.length) throw new Error('tfc schematics install <id…> — выберите схемы из list');
    return cmdPull(v, ['schematics', ...args]);
  }
  const cfg = loadConfig();
  const profile = v.instance
    ? { instance: path.resolve(v.instance), side: 'client' }
    : Object.keys(cfg.profiles ?? {}).length
      ? currentProfile(cfg, v.profile)
      : null;
  if (sub === 'publish' || sub === 'update') {
    if (!profile) throw new Error('Выберите папку игры: tfc init или --instance <папка>');
    const update = sub === 'update';
    if (args.length !== (update ? 2 : 1))
      throw new Error(update ? 'tfc schematics update <id> <файл>' : 'tfc schematics publish <файл>');
    return publishSchematic(api(cfg), profile, args[update ? 1 : 0], {
      id: update ? args[0] : undefined,
      name: v.name,
      author: v.author,
      dryRun: v['dry-run'],
      yes: v.yes,
      asSource: v['as-source'],
    });
  }
  if (sub === 'local' && !profile) throw new Error('Выберите папку игры: tfc init или --instance <папка>');
  return listSchematics(
    sub === 'local' ? new Api(cfg.server, cfg.token) : api(cfg),
    profile,
    ['list', 'local'].includes(sub) ? args.join(' ') : [sub, ...args].join(' '),
    sub === 'local',
  );
}

async function cmdReport(v, args) {
  const cfg = loadConfig();
  const profile = v.instance ? null : currentProfile(cfg, v.profile);
  const roots = { game: v.instance ? path.resolve(v.instance) : profile.instance, server: profile?.serverDir ?? null };
  if (profile) console.log(dim(`Профиль ${profile.name}: ${roots.game}`));
  // Логи лежат там, откуда игру реально запускали
  const wrong = profile && launchedElsewhere(profile.instance);
  if (wrong) {
    warnLaunch(profile, wrong);
    roots.game = wrong.root;
  }
  await reportUpload(v['dry-run'] ? null : api(cfg), roots, args, {
    note: v.note,
    task: v.task,
    yes: v.yes,
    dryRun: v['dry-run'],
  });
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
  } else if (sub === 'propose') {
    await propose(a, {
      dir: arg,
      remove: v.remove ?? [],
      jars: v.jar ?? [],
      datapacks: v.datapack ?? [],
      keepOld: v['keep-old'],
      note: v.note,
      yes: v.yes,
      dryRun: v['dry-run'],
    });
  } else if (sub === 'updates') {
    await adminUpdates(a, v, args);
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
    const body = {
      parts,
      pull: !!v.pull,
      publish,
      ...(v['allow-removals'] ? { allowRemovals: true } : {}),
      ...(v.snapshot ? { snapshot: v.snapshot } : {}),
    };
    const j = await a.post('/admin/rebuild', body).catch((e) => {
      throw jobError(e, v.snapshot);
    });
    await startedJob(a, j, v);
  } else if (sub === 'publish') {
    if (v.live) await confirmLive(a, v);
    const body = {
      ...(v.live ? { dryRun: false } : { dryRun: true, ...(v.snapshot ? { snapshot: v.snapshot } : {}) }),
      ...(v['allow-removals'] ? { allowRemovals: true } : {}),
    };
    const j = await a.post('/admin/publish', body).catch((e) => {
      throw jobError(e, v.snapshot);
    });
    await startedJob(a, j, v);
  } else if (sub === 'changes') {
    await adminChanges(a, v, args);
  } else if (sub === 'neoforge') {
    await adminNeoforge(a, v, args);
  } else if (sub === 'addon') {
    if (arg !== 'upload') throw new Error('tfc admin addon upload <jar…> [--id <мод>] [--ver <версия>]');
    await uploadAddons(a, args.slice(1), { id: v.id, version: v.ver });
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
      'tfc admin keys | invite <ник> | revoke <id> | history | use <id> | rollback | updates | propose | rebuild | publish | jobs | changes | addon | neoforge',
    );
}

async function cmdDatapacks(v, args) {
  const [sub = 'list', ...names] = args;
  const cfg = loadConfig();
  const a = api(cfg);
  let profile = null;
  if (Object.keys(cfg.profiles ?? {}).length) profile = currentProfile(cfg, v.profile);
  if (sub === 'list' || sub === 'files') return listDatapacks(a, profile, names.join(' '), sub === 'files');
  if (!['install', 'pull', 'confirm', 'unconfirm'].includes(sub)) return showDatapacks(a, profile, [sub, ...names]);
  if (!profile) throw new Error('сначала выберите папку игры: tfc init');
  if (sub === 'install' || sub === 'pull') {
    if (names.includes('all') && names.length > 1) throw new Error('укажите all или отдельные имена');
    return cmdPull(v, ['datapacks', ...(names.length === 1 && names[0] === 'all' ? [] : names)]);
  }
  if (sub === 'confirm' || sub === 'unconfirm') {
    const result = await confirmDatapacks(a, profile, names, { yes: v.yes, dryRun: v['dry-run'], action: sub });
    if (result) return cmdPull({ ...v, yes: true, force: false }, ['datapacks', ...result.ids]);
    return;
  }
  throw new Error(
    'tfc datapacks list [поиск] | files [поиск] | pull|install [all|имя…] | <имя> | confirm [all|имя…] | unconfirm [all|имя…]',
  );
}

// ---------------------------------------------------------------- main

const COMMANDS = {
  init: cmdInit,
  login: cmdLogin,
  whoami: cmdWhoami,
  profiles: cmdProfiles,
  use: cmdUse,
  status: cmdStatus,
  pull: cmdPull,
  install: cmdInstall,
  uninstall: cmdUninstall,
  delete: cmdDelete,
  rename: cmdRename,
  undo: cmdUndo,
  sync: cmdSync,
  publish: cmdPublish,
  build: cmdBuild,
  admin: cmdAdmin,
  addons: cmdAddons,
  schematics: cmdSchematics,
  datapacks: cmdDatapacks,
  report: cmdReport,
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
    if (!cmd) await offerInstall();
    // Двойной клик по tfc.exe: окно консоли закрылось бы сразу после справки
    if (!cmd && IS_BINARY && process.platform === 'win32' && interactive())
      await ask(dim('\nЭто программа для командной строки (PowerShell). Enter — закрыть'));
    return;
  }
  const fn = COMMANDS[cmd];
  if (!fn) throw new Error(`нет команды «${cmd}» — tfc help`);
  // Сначала — новая версия программы, если вышла (раз за сеанс терминала); команду выполнит уже она
  const code = await autoUpgrade(argv);
  if (code !== null) {
    process.exitCode = code;
    return;
  }
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
  // Даём сетевым и консольным дескрипторам закрыться: принудительный exit может обрушить libuv на Windows.
  process.exitCode = 1;
});
