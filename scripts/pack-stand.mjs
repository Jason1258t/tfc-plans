/**
 * Стенд сборки: выделенный сервер NeoForge (обычный production-запуск, не gradle runServer) с серверной частью
 * текущего снимка — mods/ без клиентских модов, config/, kubejs/, world/ — для проверки полного KubeJS и модов
 * вместе. Поднимает сервер, шлёт команды по RCON, гасит и сводит ошибки KubeJS и лога. Игровые jar не меняет.
 *
 * Почему не runServer: в dev-окружении TFC Registry API падает на папках исходников, а KubeJS TFC при
 * !isProduction() бросает AssertionError (dev #133). Production-запуск обходит оба.
 *
 *   TFC_STAND_DIR — где стенд (по умолчанию ~/.cache/tfc-plans/stand): neoforge-<версия>/ — установленный сервер,
 *                   run/ — папка запуска, пересоздаётся каждый раз (world/ — по keep).
 *
 * Клиентские моды отбрасываются: из pack-stand-client.json, Fabric с environment=client и всё, что обязательно от
 * них зависит (Roxy → Sodium; Roxy своим общим миксином делает CommandSourceStack клиентским источником команд, и
 * на сервере падают команды Create/FTB с BootstrapMethodError → LocalPlayer).
 *
 *   npm run stand -- --cmd "kubejs hand" --mod tools/x/build/libs/x.jar --overlay <папка> --keep --list
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { parse as parseToml } from 'smol-toml';
import { fetchInstaller, neoforgeVersion } from '@tfc/cli/vanilla';
import { isWin, javaHome, killTree, runRcon, sleep } from './mc-server.mjs';
import { PACK_CACHE, PACK_MODS } from './pack-cache.mjs';

export const STAND = path.resolve(process.env.TFC_STAND_DIR ?? path.join(os.homedir(), '.cache', 'tfc-plans', 'stand'));
/** Версия NeoForge, если снимок её не знает (как у хоста) */
const DEFAULT_NF = '21.1.251';
const CLIENT_LIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pack-stand-client.json');
/** Шум выделенного сервера в latest.log: клиентские классы, которые моды трогают и обходят сами */
const NOISE = [/invalid dist DEDICATED_SERVER/, /Access transformer file .* does not exist/];

/** Версия снимка из .tfc-fetch.json (кладёт npm run pack:fetch) */
function packVersion(cache) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cache, '.tfc-fetch.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** modId мода и его обязательные зависимости (любой стороны): neoforge.mods.toml или fabric.mod.json */
export function modInfo(file) {
  const info = { file, ids: [], deps: [], client: false };
  let zip;
  try {
    zip = new AdmZip(file);
  } catch {
    return info;
  }
  const toml = zip.getEntry('META-INF/neoforge.mods.toml');
  if (toml) {
    const text = toml.getData().toString('utf8');
    try {
      const t = parseToml(text);
      info.ids = (t.mods ?? []).map((m) => m.modId).filter(Boolean);
      for (const list of Object.values(t.dependencies ?? {}))
        for (const d of Array.isArray(list) ? list : [])
          // side=CLIENT тоже: мод, которому на клиенте нужен Sodium, сам клиентский (Roxy)
          if ((d.type ?? (d.mandatory ? 'required' : 'optional')) === 'required') info.deps.push(d.modId);
    } catch {
      // Кривой TOML у мода: хотя бы modId
      info.ids = [...text.matchAll(/^\s*modId\s*=\s*"([^"]+)"/gm)].map((m) => m[1]).slice(0, 1);
    }
  }
  const fabric = zip.getEntry('fabric.mod.json');
  if (fabric) {
    try {
      const j = JSON.parse(
        fabric
          .getData()
          .toString('utf8')
          .replace(/[\r\n\t]/g, ' '),
      );
      if (j.id) info.ids.push(j.id);
      if (j.environment === 'client') info.client = true;
      info.deps.push(...Object.keys(j.depends ?? {}));
    } catch {
      /* без описания Fabric */
    }
  }
  info.ids = [...new Set(info.ids)];
  return info;
}

const matches = (m, q) => m.ids.includes(q) || path.basename(m.file).toLowerCase().includes(q.toLowerCase());

/**
 * Какие jar ставить на стенд. extra — свои jar (заменяют jar сборки с тем же modId), exclude/include — modId или
 * часть имени файла, skip — { modId: почему } найденные при запуске. → { use, skipped: [{ …, why }], replaced }
 */
export function selectMods({ modsDir = PACK_MODS, extra = [], exclude = [], include = [], skip = {} } = {}) {
  const listed = JSON.parse(fs.readFileSync(CLIENT_LIST, 'utf8'));
  const own = extra.map((f) => modInfo(path.resolve(f)));
  for (const m of own) if (!fs.existsSync(m.file)) throw new Error(`нет jar ${m.file}`);
  const ownIds = new Set(own.flatMap((m) => m.ids));
  const replaced = [];
  const pack = [];
  for (const f of fs
    .readdirSync(modsDir)
    .filter((n) => n.endsWith('.jar'))
    .sort()) {
    const m = modInfo(path.join(modsDir, f));
    if (m.ids.some((id) => ownIds.has(id))) replaced.push(f);
    else pack.push(m);
  }
  const all = [...pack, ...own];
  const why = new Map();
  for (const m of all) {
    if (include.some((q) => matches(m, q))) continue;
    const id = m.ids.find((i) => i in listed && i !== '_');
    const found = m.ids.find((i) => i in skip);
    if (id) why.set(m, listed[id]);
    else if (found) why.set(m, skip[found]);
    else if (m.client) why.set(m, 'Fabric, только клиент');
    else {
      const q = exclude.find((x) => matches(m, x));
      if (q) why.set(m, 'исключён вручную');
    }
  }
  // Зависит от исключённого — тоже вон (до неподвижной точки)
  for (let changed = true; changed;) {
    changed = false;
    const gone = new Set([...why.keys()].flatMap((m) => m.ids));
    for (const m of all) {
      if (why.has(m) || include.some((q) => matches(m, q))) continue;
      const dep = m.deps.find((d) => gone.has(d));
      if (dep) {
        why.set(m, `нужен ${dep}`);
        changed = true;
      }
    }
  }
  return {
    use: all.filter((m) => !why.has(m)),
    skipped: all.filter((m) => why.has(m)).map((m) => ({ ...m, why: why.get(m) })),
    replaced,
  };
}

/** Сервер NeoForge nf в STAND/neoforge-<nf> (ставит его установщик, один раз) */
export async function ensureServer(nf, java, onLog = () => {}) {
  const dir = path.join(STAND, `neoforge-${nf}`);
  const args = path.join(
    dir,
    'libraries',
    'net',
    'neoforged',
    'neoforge',
    nf,
    isWin ? 'win_args.txt' : 'unix_args.txt',
  );
  if (fs.existsSync(args)) return dir;
  onLog(`ставлю сервер NeoForge ${nf} в ${dir}`);
  const installer = await fetchInstaller(nf, path.join(STAND, 'installers'));
  fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync(java, ['-jar', installer, '--install-server', dir], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 600_000,
    windowsHide: true,
  });
  if (!fs.existsSync(args))
    throw new Error(`установщик NeoForge ${nf} не поставил сервер: ${(r.stderr || r.stdout || '').slice(-800)}`);
  return dir;
}

/** Убрать всё из run/, кроме keepNames */
function clean(dir, keepNames) {
  fs.mkdirSync(dir, { recursive: true });
  for (const n of fs.readdirSync(dir))
    if (!keepNames.includes(n)) fs.rmSync(path.join(dir, n), { recursive: true, force: true, maxRetries: 3 });
}

/** Ссылка на файл/папку (на Windows — копия файла, папка — junction) */
function link(target, dest) {
  const dir = fs.statSync(target).isDirectory();
  if (isWin && !dir) fs.copyFileSync(target, dest);
  else fs.symlinkSync(target, dest, dir && isWin ? 'junction' : undefined);
}

/** Строки ошибок без повторов: «×N» у повторяющихся, шум отдельно счётчиком */
function errorLines(text, re, limit) {
  const counts = new Map();
  let noise = 0;
  for (const l of text.split(/\r?\n/)) {
    if (!re.test(l)) continue;
    if (NOISE.some((n) => n.test(l))) {
      noise++;
      continue;
    }
    // Без метки времени, JSON рецепта и id: однотипные ошибки (16 цветов цемента, таблицы добычи) — одна группа
    const msg = l.replace(/^\[[^\]]*\]\s*/, '').trim();
    const key = msg.replace(/ from json \{.*$/, ' from json …').replace(/[a-z0-9_.-]+:[a-z0-9_/.-]+/g, '<id>');
    const g = counts.get(key);
    if (g) g.n++;
    else counts.set(key, { n: 1, first: msg.length > 300 ? msg.slice(0, 300) + '…' : msg });
  }
  const lines = [...counts.values()].map(({ n, first }) => (n > 1 ? `${first} ×${n}` : first));
  return { lines: lines.slice(0, limit), more: Math.max(0, lines.length - limit), noise };
}

const RCON_PASSWORD = 'check';
const readText = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

/** Папка запуска: ссылки на сервер и моды, копии config/kubejs/world снимка, оверлей, server.properties */
function prepare({ run, server, cache, sel, overlay, keep, memory, port, rconPort }) {
  clean(run, keep ? ['world'] : []);
  link(path.join(server, 'libraries'), path.join(run, 'libraries'));
  fs.mkdirSync(path.join(run, 'mods'));
  for (const m of sel.use) link(m.file, path.join(run, 'mods', path.basename(m.file)));
  for (const d of ['config', 'kubejs', 'defaultconfigs'])
    if (fs.existsSync(path.join(cache, d))) fs.cpSync(path.join(cache, d), path.join(run, d), { recursive: true });
  if (!fs.existsSync(path.join(run, 'world')) && fs.existsSync(path.join(cache, 'world')))
    fs.cpSync(path.join(cache, 'world'), path.join(run, 'world'), { recursive: true });
  if (overlay) {
    if (!fs.existsSync(overlay)) throw new Error(`нет папки ${overlay}`);
    fs.cpSync(path.resolve(overlay), run, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(run, 'eula.txt'), 'eula=true\n');
  fs.writeFileSync(
    path.join(run, 'server.properties'),
    [
      'level-type=minecraft\\:flat',
      'online-mode=false',
      'spawn-protection=0',
      'generate-structures=false',
      'spawn-monsters=false',
      'view-distance=4',
      'simulation-distance=4',
      'max-tick-time=-1',
      `server-port=${port}`,
      'enable-rcon=true',
      `rcon.port=${rconPort}`,
      `rcon.password=${RCON_PASSWORD}`,
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(run, 'user_jvm_args.txt'), `-Xmx${memory}\n`);
}

/** Запуск: ждать «Done» (или падения), RCON-команды, stop. → { booted, exited, crashed, bootSec, rconText } */
async function launch({ run, java, nf, timeout, rconPort, commands, onLog }) {
  const out = path.join(run, 'stand.log');
  const fd = fs.openSync(out, 'w');
  const argsFile = path.join('libraries', 'net', 'neoforged', 'neoforge', nf, isWin ? 'win_args.txt' : 'unix_args.txt');
  const child = spawn(java, ['@user_jvm_args.txt', `@${argsFile}`, 'nogui'], {
    cwd: run,
    stdio: ['ignore', fd, fd],
    detached: !isWin,
    windowsHide: true,
  });
  fs.closeSync(fd);
  let exited = false;
  child.on('exit', () => (exited = true));
  const t0 = Date.now();

  let booted = false;
  let crashed = false;
  let seen = 0;
  while (Date.now() - t0 < timeout * 1000) {
    await sleep(2000);
    const size = fs.statSync(out).size;
    if (size > seen) {
      // хвост с запасом: строка могла разорваться на границе
      const back = Math.min(seen, 200);
      const chunk = Buffer.alloc(size - seen + back);
      const rfd = fs.openSync(out, 'r');
      fs.readSync(rfd, chunk, 0, chunk.length, seen - back);
      fs.closeSync(rfd);
      seen = size;
      const s = chunk.toString('utf8');
      if (/Done \([^)]*\)!/.test(s)) {
        booted = true;
        break;
      }
      if (/Crash report saved|Failed to start the minecraft server|Encountered an unexpected exception/.test(s))
        crashed = true;
    }
    if (exited || crashed) break;
  }
  const bootSec = Math.round((Date.now() - t0) / 1000);

  let rconText = '';
  if (booted && commands.length) {
    onLog('сервер поднялся, шлю команды');
    try {
      rconText = await runRcon(rconPort, RCON_PASSWORD, commands.map(String));
    } catch (e) {
      rconText = 'RCON: ' + e.message;
    }
  }
  if (booted && !exited)
    try {
      await runRcon(rconPort, RCON_PASSWORD, ['stop']);
    } catch {
      /* уже не отвечает */
    }
  for (let i = 0; i < 30 && !exited; i++) await sleep(1000);
  if (!exited) killTree(child.pid);
  return { booted, exited, crashed, bootSec, rconText };
}

/** Последний краш-отчёт в run/ или null */
function lastCrash(run) {
  const dir = path.join(run, 'crash-reports');
  if (!fs.existsSync(dir)) return null;
  return (
    fs
      .readdirSync(dir)
      .map((n) => path.join(dir, n))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null
  );
}

/** modId из краш-отчёта загрузки, у которых главный класс есть только на клиенте */
function clientOnlyFailures(run) {
  const crash = lastCrash(run);
  if (!crash) return [];
  const text = readText(crash);
  return [...text.matchAll(/-- Mod loading issue for: (\S+) --([\s\S]*?)(?=\n-- |$)/g)]
    .filter((m) => /invalid dist DEDICATED_SERVER/.test(m[2]))
    .map((m) => m[1]);
}

/**
 * Прогон стенда. → { ok, booted, text } — text по-русски, для человека и агента.
 * commands — RCON-команды после загрузки («sleep N» — пауза), mods — свои jar, overlay — папка поверх run/
 * (как оверлей tfc admin propose: kubejs/…, config/…), keep — оставить world/ прошлого прогона.
 */
export async function runStand({
  commands = [],
  mods = [],
  exclude = [],
  include = [],
  overlay = null,
  keep = false,
  timeout = 900,
  memory = '6G',
  neoforge = null,
  rconPort = 25616,
  port = 25617,
  cache = PACK_CACHE,
  onLog = () => {},
} = {}) {
  const ver = packVersion(cache);
  const nf = neoforge || neoforgeVersion(ver.loader) || DEFAULT_NF;
  const home = javaHome();
  const java = home ? path.join(home, 'bin', isWin ? 'java.exe' : 'java') : 'java';
  const modsDir = path.join(cache, 'mods');
  if (!fs.existsSync(modsDir)) throw new Error(`нет ${modsDir} — сначала npm run pack:fetch`);
  const server = await ensureServer(nf, java, onLog);
  const run = path.join(STAND, 'run');
  // Клиентский мод, который видно только при запуске (главный класс — клиентский), исключаем и запускаем снова
  const found = {};
  let sel;
  let r;
  for (let attempt = 0; ; attempt++) {
    sel = selectMods({ modsDir, extra: mods, exclude, include, skip: found });
    prepare({ run, server, cache, sel, overlay, keep, memory, port, rconPort });
    onLog(`запускаю сервер: модов ${sel.use.length}, исключено ${sel.skipped.length}`);
    r = await launch({ run, java, nf, timeout, rconPort, commands, onLog });
    if (r.booted || attempt >= 4) break;
    const bad = clientOnlyFailures(run).filter((id) => !(id in found));
    if (!bad.length) break;
    for (const id of bad) found[id] = 'клиентский главный класс (найден при запуске)';
    onLog(`клиентские моды: ${bad.join(', ')} — исключаю и запускаю снова`);
  }
  const { booted, exited, crashed, bootSec, rconText } = r;

  // ------------------------------------------------------------ сводка
  const latest = readText(path.join(run, 'logs', 'latest.log')) || readText(out);
  const kjs = [...latest.matchAll(/Loaded \d+\/\d+ KubeJS (startup|server) scripts[^\n]*/g)].map((m) => m[0]);
  const kjsLast = ['startup', 'server'].map((t) => kjs.filter((l) => l.includes(` ${t} `)).at(-1)).filter(Boolean);
  const kjsErr = ['startup', 'server']
    .map((t) => ({ t, ...errorLines(readText(path.join(run, 'logs', 'kubejs', `${t}.log`)), /\[ERROR\]/, 20) }))
    .filter((e) => e.lines.length);
  const logErr = errorLines(latest, /\/(ERROR|FATAL)\]/, 25);
  const crash = lastCrash(run);
  const text = [
    `Стенд сборки: снимок ${ver.snapshot ?? '?'}, NeoForge ${nf}, ${run}`,
    booted
      ? `сервер загрузился за ${bootSec} с`
      : crashed || exited
        ? `сервер упал при запуске (${bootSec} с)`
        : `сервер не поднялся за ${timeout} с`,
    `моды: ${sel.use.length} на стенде${sel.replaced.length ? `, заменены своими: ${sel.replaced.join(', ')}` : ''}`,
    ...(Object.keys(found).length
      ? [
          `клиентские, найдены при запуске (добавьте в scripts/pack-stand-client.json): ${Object.keys(found).join(', ')}`,
        ]
      : []),
    `исключены (${sel.skipped.length}): ` +
      sel.skipped.map((m) => `${m.ids[0] ?? path.basename(m.file)} — ${m.why}`).join('; '),
    'KubeJS:',
    ...(kjsLast.length ? kjsLast.map((l) => '  ' + l) : ['  итоговых строк «Loaded N/N KubeJS … scripts» нет']),
    ...kjsErr.flatMap((e) => [
      `  ошибки ${e.t} (logs/kubejs/${e.t}.log):`,
      ...e.lines.map((l) => '    ' + l),
      ...(e.more ? [`    … ещё ${e.more}`] : []),
    ]),
    `RCON ${rconPort}:`,
    ...(rconText ? rconText.split('\n').map((l) => '  ' + l) : ['  (команд не было)']),
    logErr.lines.length ? 'Ошибки latest.log (без повторов):' : 'Ошибок в latest.log нет.',
    ...logErr.lines.map((l) => '  ' + l),
    ...(logErr.more ? [`  … ещё ${logErr.more}`] : []),
    ...(logErr.noise ? [`  (+ ${logErr.noise} строк шума выделенного сервера: клиентские классы, AT)`] : []),
    ...(crash ? [`Краш: ${crash} (log_analyze path=${crash})`] : []),
    `Лог: ${path.join(run, 'logs', 'latest.log')} (log_analyze path=…)`,
  ].join('\n');
  return { ok: booted && !crash, booted, text };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const many = (f) => argv.flatMap((a, i) => (a === f && argv[i + 1] ? [argv[i + 1]] : []));
  const one = (f) => many(f).at(-1);
  const opts = {
    commands: many('--cmd'),
    mods: many('--mod'),
    exclude: many('--exclude'),
    include: many('--include'),
    overlay: one('--overlay') ?? null,
    keep: argv.includes('--keep'),
    timeout: Number(one('--timeout') ?? 900),
    memory: one('--memory') ?? '6G',
    neoforge: one('--neoforge') ?? null,
    onLog: (s) => console.error(s),
  };
  if (argv.includes('--list')) {
    const sel = selectMods(opts);
    console.log(`на стенд: ${sel.use.length}`);
    for (const m of sel.skipped) console.log(`  − ${path.basename(m.file)} (${m.ids.join(', ')}): ${m.why}`);
    for (const f of sel.replaced) console.log(`  ↻ ${f}`);
  } else
    runStand(opts).then(
      (r) => {
        console.log(r.text);
        process.exitCode = r.ok ? 0 : 1;
      },
      (e) => {
        console.error(e.message);
        process.exitCode = 1;
      },
    );
}
