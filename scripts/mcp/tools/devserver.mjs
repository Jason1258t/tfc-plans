/**
 * Инструменты MCP: прогон сервера разработки аддона (tools/<мод>/test-server.sh). Запускает gradlew runServer с
 * модами из libs/, ждёт готовности, шлёт команды через RCON и возвращает ответы и ошибки из лога. Долгий (минута-две)
 * — вызывать только напрямую, не в фоне. Работает на любой ОС (на Windows — через gradlew.bat) и не требует python.
 * pack_devserver — стенд всей сборки (scripts/pack-stand.mjs): production-сервер со снимком и полным KubeJS.
 * pack_client — клиентский стенд на test1a (scripts/client-stand-remote.mjs): полный клиент, меню или мир, PNG.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isWin, javaHome, killTree, runRcon, sleep, stopWithProcess } from '../../mc-server.mjs';
import { PACK_CACHE } from '../../pack-cache.mjs';
import { clientStand, worldKeyword } from '../../client-stand-remote.mjs';
import { runStand } from '../../pack-stand.mjs';
import { str, num } from '../fmt.mjs';
import { TOOLS_DIR } from '../resources.mjs';

/** Папка аддона: путь или имя в tools/ (с -mod или без) */
function resolveAddon(a) {
  const q = String(a ?? '').trim();
  if (!q) throw new Error('addon — имя в tools/ (ee-extras-mod) или путь к папке мода');
  for (const p of [path.resolve(q), path.join(TOOLS_DIR, q), path.join(TOOLS_DIR, q + '-mod')]) {
    if (fs.existsSync(path.join(p, 'gradle.properties')) || fs.existsSync(path.join(p, 'build.gradle'))) return p;
  }
  throw new Error('Аддон «' + q + '» не найден: нет gradle.properties ни по пути, ни в ' + TOOLS_DIR);
}

/** rcon.port / rcon.password из test-server.sh (иначе 25599 / check) */
function rconParams(dir) {
  const ts = path.join(dir, 'test-server.sh');
  let port = 25599;
  let password = 'check';
  if (fs.existsSync(ts)) {
    const s = fs.readFileSync(ts, 'utf8');
    port = Number(s.match(/rcon\.port\s*=\s*(\d+)/)?.[1] ?? port);
    password = s.match(/rcon\.password\s*=\s*(\S+)/)?.[1] ?? password;
  }
  return { port, password };
}

/** Простой глоб с одной «*» (cp-строки test-server.sh: create-1.21.1-*.jar) */
function globMatch(pattern, name) {
  const idx = pattern.indexOf('*');
  if (idx < 0) return pattern === name;
  return name.startsWith(pattern.slice(0, idx)) && name.endsWith(pattern.slice(idx + 1));
}

/** Условие if из test-server.sh: true / false, null — такого вида инструмент не разбирает */
function shellCondition(line, env) {
  const m = line.match(/^if \[ (-[nz] )?"\$\{(\w+):-([^}]*)\}"(?: = "?(\w+)"?)? \]; then/);
  if (!m) return null;
  const value = env[m[2]] ?? m[3];
  if (m[1] === '-n ') return Boolean(value);
  if (m[1] === '-z ') return !value;
  return m[4] === undefined ? null : value === m[4];
}

/** Источник из строки cp: путь с раскрытыми MODS и переменными окружения; null — переменная неизвестна */
function shellSource(word, dir, modsDir, env) {
  let unknown = false;
  const p = word
    .replace(/^"?\$\{MODS:-.*\}"?/, modsDir)
    .replace(/\$\{?(\w+)\}?/g, (_, name) => {
      if (name === 'MODS') return modsDir;
      if (env[name] === undefined) unknown = true;
      return env[name] ?? '';
    })
    .replaceAll('"', '');
  return unknown ? null : path.resolve(dir, p);
}

/**
 * Моды в run/mods — как в test-server.sh: строки cp с учётом условий на переменные (IE=1, NO_EE=1, DESTROY=1…), иначе
 * все jar из libs/. Остальные шаги скрипта не выполняются: что пропущено в условных блоках — в notes.
 */
function copyMods(dir, runMods, env) {
  for (const f of fs.readdirSync(runMods)) if (f.endsWith('.jar')) fs.rmSync(path.join(runMods, f));
  const modsDir = env.MODS ?? env.TFC_MODS_DIR ?? path.join(PACK_CACHE, 'mods');
  const ts = path.join(dir, 'test-server.sh');
  const script = fs.existsSync(ts) ? fs.readFileSync(ts, 'utf8') : '';
  const lines = script.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/);
  const sources = [];
  const notes = [];
  const stack = [];
  let heredoc = null;
  let found = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (heredoc) {
      if (line === heredoc) heredoc = null;
      continue;
    }
    heredoc = line.match(/<<-?\s*'?"?(\w+)'?"?/)?.[1] ?? null;
    let body = line;
    if (line.startsWith('if ')) {
      stack.push(shellCondition(line, env));
      const oneLine = line.match(/; then (.*); fi$/);
      if (!oneLine) continue;
      body = oneLine[1];
    } else if (line === 'else') {
      const cond = stack.pop();
      stack.push(cond === null ? null : !cond);
      continue;
    } else if (line === 'fi') {
      stack.pop();
      continue;
    }
    const known = !stack.includes(null);
    const active = known && !stack.includes(false);
    const cp = body.match(/^cp\s+(.+?)\s+\S*mods\/"?$/);
    if (cp) {
      found = true;
      if (!known) notes.push('условие не разобрано, пропущено: ' + body);
      else if (active)
        for (const word of cp[1].split(/\s+/)) {
          const src = shellSource(word, dir, modsDir, env);
          if (src && !src.includes('$')) sources.push(src);
          else notes.push('не раскрыто, пропущено: ' + word);
        }
    } else if (active && stack.length && /\brun\//.test(body) && !/^(mkdir|rm) /.test(body)) {
      notes.push('шаг скрипта не выполнен: ' + body);
    }
    if (line.startsWith('if ') && body !== line) stack.pop();
  }
  if (!found) sources.push(path.join(dir, 'libs', '*.jar'));

  const copied = new Set();
  for (const src of sources) {
    const from = path.dirname(src);
    const names = fs.existsSync(from)
      ? fs.readdirSync(from).filter((f) => f.endsWith('.jar') && globMatch(path.basename(src), f))
      : [];
    if (!names.length && found) notes.push('нет jar: ' + src);
    for (const f of names) {
      fs.copyFileSync(path.join(from, f), path.join(runMods, f));
      copied.add(f);
    }
  }
  return { copied: [...copied], notes };
}

/** Вывод самого сервера: всё после начала задачи runServer; null — gradle до неё не дошёл */
function serverOutput(text) {
  const i = text.search(/^> Task :runServer/m);
  return i < 0 ? null : text.slice(i);
}

/** Причина неудачной сборки из вывода gradle: упавшая задача, ошибки javac без повторов, блок What went wrong */
function buildFailure(text, dir) {
  const rows = text.split(/\r?\n/);
  const tasks = rows.filter((l) => /^> Task \S+ FAILED/.test(l));
  const errors = [
    ...new Set(rows.filter((l) => /\.java:\d+: error: /.test(l)).map((l) => l.trim().replaceAll(dir + path.sep, ''))),
  ];
  const out = [...tasks];
  if (errors.length) {
    out.push('Ошибки компиляции (' + errors.length + '):', ...errors.slice(0, 15).map((l) => '  ' + l));
    if (errors.length > 15) out.push('  … и ещё ' + (errors.length - 15));
  } else {
    const start = rows.findIndex((l) => /What went wrong/.test(l));
    if (start >= 0) {
      const end = rows.findIndex((l, i) => i > start && /^\* Try:/.test(l));
      const block = rows.slice(start + 1, end < 0 ? undefined : end).filter((l) => l.trim());
      out.push('Что сломалось:', ...block.slice(0, 20).map((l) => '  ' + l.trim()));
    }
  }
  if (errors.some((l) => /error: package \S+ does not exist/.test(l)) && fs.existsSync(path.join(dir, 'libs.sh')))
    out.push(
      'Похоже, в libs/ не хватает jar: выполни ./libs.sh в папке аддона (кеш модов — npm run pack:fetch; необязательные наборы — см. переменные в начале скрипта).',
    );
  return out;
}

async function devServer(a) {
  const dir = resolveAddon(a.addon);
  const gradlew = path.join(dir, isWin ? 'gradlew.bat' : 'gradlew');
  if (!fs.existsSync(gradlew)) throw new Error(dir + ': нет ' + path.basename(gradlew));
  const { port, password } = rconParams(dir);
  const timeout = Math.max(10, Number(a.timeout ?? 240) | 0);
  const env = Object.fromEntries(
    String(a.env ?? '')
      .split(/[\r\n]+/)
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf('=');
        return i < 0 ? [l, '1'] : [l.slice(0, i), l.slice(i + 1)];
      }),
  );
  const keep = 'KEEP' in env;
  const run = path.join(dir, 'run');
  const log = path.join(run, 'check.log');

  if (!keep) {
    try {
      fs.rmSync(run, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      /* предыдущий сервер мог оставить заблокированные файлы — продолжим */
    }
  }
  fs.mkdirSync(path.join(run, 'mods'), { recursive: true });
  const childEnv = { ...process.env, JAVA_HOME: javaHome(), ...env };
  const { copied, notes } = copyMods(dir, path.join(run, 'mods'), childEnv);
  fs.writeFileSync(path.join(run, 'eula.txt'), 'eula=true');
  fs.writeFileSync(
    path.join(run, 'server.properties'),
    [
      'level-type=minecraft:flat',
      'online-mode=false',
      'spawn-protection=0',
      'generate-structures=false',
      'enable-rcon=true',
      'rcon.port=' + port,
      'rcon.password=' + password,
    ].join('\n'),
  );

  const fd = fs.openSync(log, 'w');
  // На Windows .bat запускается через cmd.exe (spawn его сам не исполнит)
  const cmd = isWin ? 'cmd.exe' : './gradlew';
  const args = isWin ? ['/c', 'gradlew.bat runServer --console=plain'] : ['runServer', '--console=plain'];
  const child = spawn(cmd, args, {
    cwd: dir,
    env: childEnv,
    stdio: ['ignore', fd, fd],
    detached: !isWin,
  });
  fs.closeSync(fd);
  stopWithProcess(child);
  const t0 = Date.now();

  const tail = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  let booted = false;
  let crashed = false;
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  while (Date.now() - t0 < timeout * 1000) {
    // Выход читается до лога: всё, что процесс успел написать, уже попадёт в эту проверку
    const over = exited();
    const server = serverOutput(tail());
    if (server !== null && /Done\s*\([^)]*\)!/.test(server)) {
      booted = true;
      break;
    }
    // Только явный сбой: ERROR и Exception бывают и у живого сервера (предупреждения миксинов о необязательных модах)
    if (server !== null && /Failed to start the minecraft server|crash report has been saved/i.test(server)) {
      crashed = true;
      break;
    }
    if (over) break;
    await sleep(1000);
  }

  let rconText = '';
  if (booted && Array.isArray(a.commands) && a.commands.length) {
    try {
      rconText = await runRcon(port, password, a.commands.map(String));
    } catch (e) {
      rconText = 'RCON: ' + e.message;
    }
  }

  if (booted) {
    try {
      await runRcon(port, password, ['stop']);
    } catch {
      /* уже не отвечает */
    }
  }
  if (!exited()) {
    await sleep(3000);
    if (!exited()) killTree(child.pid);
  }

  const seconds = Math.round((Date.now() - t0) / 1000);
  const text = tail();
  if (exited() && !booted && serverOutput(text) === null) {
    return [
      'Сервер разработки ' + path.basename(dir) + ' (' + dir + '):',
      'сборка не удалась за ' +
        seconds +
        ' с (gradle: код ' +
        (child.exitCode ?? child.signalCode) +
        '), сервер не запускался',
      ...buildFailure(text, dir),
      'Полный лог: ' + log,
    ].join('\n');
  }

  const errLines = (serverOutput(text) ?? text)
    .split(/\r?\n/)
    .filter((l) => /ERROR|FATAL|Exception|Caused by|^\s+Mod ID:/.test(l) && !/\/(WARN|INFO|DEBUG)\]/.test(l))
    .slice(0, 30);
  const mods = copied.length ? copied.join(', ') : '—';

  const out = [
    'Сервер разработки ' + path.basename(dir) + ' (' + dir + '):',
    booted
      ? 'загрузился за ' + seconds + ' с'
      : crashed
        ? 'упал при запуске'
        : exited()
          ? 'сервер завершился за ' + seconds + ' с, не загрузившись (код ' + (child.exitCode ?? child.signalCode) + ')'
          : 'не поднялся за ' + timeout + ' с',
    'моды в run/mods: ' + mods,
    ...notes.map((l) => 'test-server.sh: ' + l),
    'RCON ' + port + ' (' + password + '):',
    ...(rconText ? rconText.split('\n').map((l) => '  ' + l) : ['  (команд не было)']),
    errLines.length ? 'Ошибки из лога:' : 'Ошибок в логе нет.',
    ...errLines.map((l) => '  ' + l),
    'Полный лог: ' + log + ' (log_analyze path=' + log + ')',
  ].join('\n');
  return out;
}

/** Строки параметра: массив или текст по строкам */
const lines = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[\r\n]+/)).map((x) => String(x).trim()).filter(Boolean);

async function packDevServer(a) {
  const r = await runStand({
    commands: lines(a.commands),
    mods: lines(a.mods),
    exclude: lines(a.exclude),
    include: lines(a.include),
    overlay: a.overlay ? String(a.overlay) : null,
    keep: Boolean(a.keep),
    timeout: Math.max(60, Number(a.timeout ?? 900) | 0),
    memory: a.memory ? String(a.memory) : undefined,
  });
  return r.text;
}

/** Флаги client-stand.mjs из параметров инструмента */
function clientArgs(a) {
  const out = [];
  for (const m of lines(a.mods)) out.push('--mod', path.resolve(m));
  for (const x of lines(a.exclude)) out.push('--exclude', x);
  if (a.overlay) out.push('--overlay', path.resolve(String(a.overlay)));
  if (a.world) out.push('--world', worldKeyword(String(a.world)) ? String(a.world) : path.resolve(String(a.world)));
  for (const k of ['timeout', 'settle', 'load', 'shots', 'interval'])
    if (a[k] !== undefined && a[k] !== null) out.push(`--${k}`, String(Math.max(0, Number(a[k]) | 0)));
  if (a.memory) out.push('--memory', String(a.memory));
  if (a.ready) out.push('--ready', String(a.ready));
  if (a.ram) out.push('--ram');
  return out;
}

async function packClient(a) {
  const r = await clientStand('run', clientArgs(a), { noPack: Boolean(a.noPack) });
  const summary = r.local ? path.join(r.local, 'summary.txt') : null;
  const text =
    summary && fs.existsSync(summary)
      ? fs.readFileSync(summary, 'utf8').trim()
      : r.out.replace(/^RESULT .*$/m, '').trim() || `прогон не дал сводки (код ${r.code})`;
  const max = Math.min(4, Math.max(0, Number(a.images ?? 2) | 0));
  const shown = max ? r.pngs.slice(-max) : [];
  return {
    text: [
      text,
      ...(r.local
        ? [`На Mac: ${r.local}${r.pngs.length ? ` (PNG: ${r.pngs.length}, здесь последние ${shown.length})` : ''}`]
        : []),
      ...(r.local ? [`Журнал: log_analyze path=${path.join(r.local, 'latest.log')}`] : []),
    ].join('\n'),
    images: shown.map((f) => fs.readFileSync(f)),
  };
}

export const TOOLS = [
  {
    name: 'addon_devserver',
    description:
      'Run an addon test server (tools/<mod>/test-server.sh) — gradlew runServer with the mods its cp lines select under env (other script steps are reported, not run), wait for it, send RCON commands and return their replies plus error lines from run/check.log. A failed gradle build returns at once with the cause. Long (1–2 min), call directly only. Cross-platform (gradlew.bat on Windows), no python.',
    inputSchema: {
      type: 'object',
      properties: {
        addon: str('addon folder: name in tools/ (ee-extras-mod) or a path to the mod folder'),
        commands: {
          type: 'array',
          items: { type: 'string' },
          description: 'RCON commands to run once the server is up ("sleep N" — pause, seconds)',
        },
        env: str(
          'extra env KEY=VALUE per line, selects cp lines of test-server.sh (IE=1, CC=1, DESTROY=1, NO_EE=1, OLD_JAR=…, MODS=…); KEEP=1 keeps the world',
        ),
        timeout: num('max seconds to wait for the server (240)'),
      },
      required: ['addon'],
    },
    handler: devServer,
  },
  {
    name: 'pack_devserver',
    description:
      'Run the whole pack on a production NeoForge dedicated server (scripts/pack-stand.mjs, stand in ~/.cache/tfc-plans/stand): current snapshot mods minus client-only ones, config, full KubeJS, flat world; RCON commands, then a summary — KubeJS script counts and errors, deduplicated latest.log errors, crash report. For checking KubeJS/datapack/addon changes against the full pack without the game. Slow (3–6 min, first run also installs NeoForge) — call directly only. Needs npm run pack:fetch.',
    inputSchema: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          items: { type: 'string' },
          description:
            'RCON commands once the server is up ("sleep N" — pause, seconds), e.g. "reload", "kubejs reload server_scripts"',
        },
        mods: {
          type: 'array',
          items: { type: 'string' },
          description: 'own jar paths; replace pack jars with the same modId',
        },
        overlay: str('folder copied over the run dir (kubejs/…, config/… — like a tfc admin propose overlay)'),
        exclude: {
          type: 'array',
          items: { type: 'string' },
          description: 'more mods to drop: modId or file name part',
        },
        include: { type: 'array', items: { type: 'string' }, description: 'keep these even if listed as client-only' },
        keep: { type: 'boolean', description: 'keep world/ from the previous run' },
        memory: str('-Xmx (6G)'),
        timeout: num('max seconds to boot (900)'),
      },
    },
    handler: packDevServer,
  },
  {
    name: 'pack_client',
    description:
      'Run the full pack client (NeoForge, current snapshot, all mods incl. client-only) on the remote Linux stand test1a over SSH (scripts/client-stand-remote.mjs; Xvfb, software GL): wait for the title screen or, with world, join a singleplayer world; PNG screenshots (returned as images), clean exit, then a summary — KubeJS script counts, deduplicated latest.log errors, crash report; logs copied to ~/.cache/tfc-plans/client-stand/results/<id> on the Mac. For client-side checks: textures/models/GUI of an addon, client crashes, KubeJS client scripts. Syncs the local pack cache first (npm run pack:fetch; noPack skips). Slow (4–8 min) — call directly only; stand must be prepared once (npm run client-stand -- prepare). One run at a time.',
    inputSchema: {
      type: 'object',
      properties: {
        world: str(
          'join a singleplayer world: "new" — fresh creative world (cheats on) from the pack default preset (tfc:overworld; "new:<preset id>" — another), "flat" — vanilla flat (TFC Eratosthenes errors there: no map projection), or a local save folder with level.dat (a server world works); omit — title screen only',
        ),
        mods: {
          type: 'array',
          items: { type: 'string' },
          description: 'own jar paths added to mods/ (drop the pack version with exclude)',
        },
        exclude: { type: 'array', items: { type: 'string' }, description: 'drop snapshot jars by file name part' },
        overlay: str('local folder copied over the game dir (config/…, kubejs/…, resourcepacks/…)'),
        shots: num('screenshots (1)'),
        interval: num('seconds between screenshots (10)'),
        settle: num('seconds after ready (with world: after the world shows up) before the first screenshot (20)'),
        load: num(
          'with world: max seconds after login to wait for the loading screen to go (picture changes; 300 — software GL is slow)',
        ),
        timeout: num('max seconds to reach the menu/world (900)'),
        ready: str('regex on client.log that means ready (default: title screen, or player login with world)'),
        memory: str('-Xmx (8G)'),
        ram: { type: 'boolean', description: 'run from /dev/shm (copies mods to RAM; faster load)' },
        noPack: { type: 'boolean', description: 'skip syncing the pack cache (already on the host)' },
        images: num('how many last PNGs to return as images (2, max 4)'),
      },
    },
    handler: packClient,
  },
];
