/**
 * Инструменты MCP: прогон сервера разработки аддона (tools/<мод>/test-server.sh). Запускает gradlew runServer с
 * модами из libs/, ждёт готовности, шлёт команды через RCON и возвращает ответы и ошибки из лога. Долгий (минута-две)
 * — вызывать только напрямую, не в фоне. Работает на любой ОС (на Windows — через gradlew.bat) и не требует python.
 * pack_devserver — стенд всей сборки (scripts/pack-stand.mjs): production-сервер со снимком и полным KubeJS.
 * pack_client — клиентский стенд на test1a (scripts/client-stand-remote.mjs): полный клиент, меню или мир, PNG.
 * stand_submit / stand_wait / stand_log / stand_jobs — очередь стенда на test1a (scripts/stand-queue-remote.mjs,
 * dev #310): прогон ставится в очередь, агент ждёт итог одним вызовом вместо опроса журнала.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isWin, javaHome, killTree, runRcon, sleep, stopWithProcess } from '../../mc-server.mjs';
import { PACK_CACHE } from '../../pack-cache.mjs';
import { clientStand, worldKeyword } from '../../client-stand-remote.mjs';
import { runStand } from '../../pack-stand.mjs';
import { cancelJob, jobLog, listJobs, listText, submit, viewText, waitJob } from '../../stand-queue-remote.mjs';
import { NICK, str, num } from '../fmt.mjs';
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
  for (const p of lines(a.gameShots)) out.push('--game-shots', p);
  return out;
}

/** Флаги pack-stand.mjs из параметров инструмента (прогон на test1a через очередь) */
function serverArgs(a) {
  const out = [];
  for (const c of lines(a.commands)) out.push('--cmd', c);
  for (const m of lines(a.mods)) out.push('--mod', path.resolve(m));
  for (const x of lines(a.exclude)) out.push('--exclude', x);
  for (const x of lines(a.include)) out.push('--include', x);
  if (a.overlay) out.push('--overlay', path.resolve(String(a.overlay)));
  if (a.keep) out.push('--keep');
  if (a.timeout) out.push('--timeout', String(Math.max(60, Number(a.timeout) | 0)));
  if (a.memory) out.push('--memory', String(a.memory));
  if (a.levelType) out.push('--level-type', String(a.levelType));
  if (a.untilLog) {
    out.push('--until', String(a.untilLog));
    if (a.untilFile) out.push('--until-file', String(a.untilFile));
    if (a.untilTimeout) out.push('--until-timeout', String(Number(a.untilTimeout) | 0));
  }
  return out;
}

/** Итог ожидания: текст + последние PNG (снимки стенда, затем игровые — их показываем первыми) */
function waitAnswer(r, images = 2) {
  const max = Math.min(4, Math.max(0, Number(images ?? 2) | 0));
  const all = [...r.pngs, ...r.gameShots];
  const shown = max ? all.slice(-max) : [];
  return { text: viewText(r), images: shown.map((f) => fs.readFileSync(f)) };
}

async function standSubmit(a) {
  const kind = String(a.kind ?? '');
  const argv = kind === 'client' ? clientArgs(a) : kind === 'server' ? serverArgs(a) : null;
  if (!argv) throw new Error('kind: server | client');
  const r = await submit(kind, argv, { note: a.note ? String(a.note) : '', by: NICK });
  const wait = Number(a.wait ?? 0) | 0;
  if (wait > 0) return waitAnswer(await waitJob(r.id, { timeout: wait, until: a.until ?? null }), a.images);
  return [
    `Задание ${r.id} поставлено: место в очереди ${r.position}.`,
    `Ждать итог одним вызовом: stand_wait id=${r.id} (в фоне из shell: node scripts/mcp-call.mjs tfc-pack stand_wait '{"id":"${r.id}"}' --timeout 1800).`,
  ].join('\n');
}

async function packClient(a) {
  if (!a.direct) {
    const r = await submit('client', clientArgs(a), { note: a.note ? String(a.note) : 'pack_client', by: NICK });
    return waitAnswer(await waitJob(r.id, { timeout: Math.max(600, (Number(a.timeout ?? 900) | 0) + 900) }), a.images);
  }
  const r = await clientStand('run', clientArgs(a), { noPack: Boolean(a.noPack) });
  const summary = r.local ? path.join(r.local, 'summary.txt') : null;
  const text =
    summary && fs.existsSync(summary)
      ? fs.readFileSync(summary, 'utf8').trim()
      : r.out.replace(/^RESULT .*$/m, '').trim() || `прогон не дал сводки (код ${r.code})`;
  const max = Math.min(4, Math.max(0, Number(a.images ?? 2) | 0));
  // Игровые снимки идут после снимков стенда: просили их — показываем их первыми
  const all = [...r.pngs, ...r.gameShots];
  const shown = max ? all.slice(-max) : [];
  return {
    text: [
      text,
      ...(r.local
        ? [
            `На Mac: ${r.local}${all.length ? ` (PNG: ${r.pngs.length}${r.gameShots.length ? ` + игровых ${r.gameShots.length} в screenshots/` : ''}, здесь последние ${shown.length})` : ''}`,
          ]
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
      'Run the full pack client (NeoForge, current snapshot, all mods incl. client-only) on the remote Linux stand test1a (Xvfb, software GL): wait for the title screen or, with world, join a singleplayer world; PNG screenshots (returned as images), clean exit, then a summary — KubeJS script counts, deduplicated latest.log errors, crash report; logs copied to the Mac. For client-side checks: textures/models/GUI of an addon, client crashes, KubeJS client scripts. Goes through the stand queue (stand_submit kind=client + stand_wait in one call; waits its turn behind other agents). Slow (4–8 min + queue) — call directly only, or use stand_submit and wait in the background. direct=true — old path: own working-tree stand code over SSH, syncs the local pack cache (noPack skips); only for editing the stand itself.',
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
        gameShots: {
          type: 'array',
          items: { type: 'string' },
          description:
            'file name prefixes of in-game PNGs in game/screenshots (made by the overlay/KubeJS during the run) to copy into results/<id>/screenshots on the Mac; plain names only',
        },
        noPack: { type: 'boolean', description: 'direct only: skip syncing the pack cache (already on the host)' },
        direct: {
          type: 'boolean',
          description: 'bypass the queue: run working-tree stand code over SSH (stand development)',
        },
        note: str('what the run checks (shown in the queue)'),
        images: num('how many last PNGs to return as images (2, max 4)'),
      },
    },
    handler: packClient,
  },
  {
    name: 'stand_submit',
    description:
      'Queue a whole-pack stand run on test1a (scripts/stand-queue-remote.mjs; one run at a time, agents before background print checks) and return the job id at once. kind=server — production NeoForge dedicated server (like pack_devserver, but on test1a, snapshot staged in RAM): RCON commands, KubeJS counts/errors, deduped latest.log errors, crash. kind=client — full client (like pack_client). The host pulls the current snapshot itself; own jars/overlay/world are uploaded. Then stand_wait id=… — one call until the result instead of polling logs. wait=N waits right here up to N s.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['server', 'client'], description: 'server or client stand' },
        note: str('what the run checks (shown in the queue)'),
        wait: num('seconds to wait for the result in this call (0 — return the id at once)'),
        until: str('with wait: also return early when a progress line matches this regex'),
        images: num('client: how many last PNGs to return as images (2, max 4)'),
        commands: {
          type: 'array',
          items: { type: 'string' },
          description: 'server: RCON commands once up ("sleep N" — pause)',
        },
        mods: { type: 'array', items: { type: 'string' }, description: 'own jar paths (server: replace same modId)' },
        overlay: str('local folder copied over the run/game dir (kubejs/…, config/…)'),
        exclude: { type: 'array', items: { type: 'string' }, description: 'mods to drop: modId or file name part' },
        include: { type: 'array', items: { type: 'string' }, description: 'server: keep even if client-only' },
        keep: { type: 'boolean', description: 'server: keep world/ (only within one staged run — usually useless)' },
        levelType: str('server: level type (minecraft:flat; tfc:overworld — real TFC generation)'),
        untilLog: str('server: after commands wait for this regex in untilFile (logs/kubejs/server.log)'),
        untilFile: str('server: file for untilLog, relative to the run dir'),
        untilTimeout: num('server: max seconds for untilLog (1800)'),
        world: str(
          'join a singleplayer world: "new" — fresh creative world (cheats on) from the pack default preset (tfc:overworld; "new:<preset id>" — another), "flat" — vanilla flat, or a local save folder with level.dat; omit — title screen only',
        ),
        shots: num('screenshots (1)'),
        interval: num('seconds between screenshots (10)'),
        settle: num('seconds after ready before the first screenshot (20)'),
        load: num('with world: max seconds after login to wait for the loading screen to go (300)'),
        ready: str('regex on client.log that means ready'),
        ram: { type: 'boolean', description: 'run from /dev/shm' },
        gameShots: {
          type: 'array',
          items: { type: 'string' },
          description: 'file name prefixes of in-game PNGs in game/screenshots to bring back',
        },
        memory: str('-Xmx (server 6G, client 8G)'),
        timeout: num('max seconds to boot / reach menu or world (900)'),
      },
      required: ['kind'],
    },
    handler: standSubmit,
  },
  {
    name: 'stand_wait',
    description:
      'Wait for a stand queue job on test1a (long-poll on the host) until it finishes, or until a progress line matches until, or timeout. Returns state, queue place, new progress lines (stand stages, not the raw game log) and, when finished, the summary + PNGs; logs are copied to ~/.cache/tfc-plans/stand-queue/<id> on the Mac. One call per wait — do not poll. From a shell in the background: node scripts/mcp-call.mjs tfc-pack stand_wait \'{"id":"…"}\' --timeout 1800.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('job id from stand_submit'),
        timeout: num('max seconds to wait (600, max 3600)'),
        since: num('progress seq already seen (from the previous answer)'),
        until: str('return early when a progress line matches this regex'),
        images: num('how many last PNGs to return as images (2, max 4)'),
      },
      required: ['id'],
    },
    handler: async (a) =>
      waitAnswer(
        await waitJob(String(a.id), { timeout: a.timeout ?? 600, since: Number(a.since ?? 0), until: a.until ?? null }),
        a.images,
      ),
  },
  {
    name: 'stand_log',
    description:
      'Targeted read of a stand queue job output on test1a (stand + server/client process output): last lines or lines matching grep. For the game log of a finished job use log_analyze on the copied latest.log.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('job id'),
        grep: str('regex filter (case-insensitive)'),
        tail: num('last N lines (80, max 400)'),
      },
      required: ['id'],
    },
    handler: async (a) => {
      const r = await jobLog(String(a.id), { grep: a.grep ?? null, tail: Number(a.tail ?? 80) });
      return [
        `Задание ${a.id}: строк${a.grep ? ` по «${a.grep}»` : ''} ${r.total}, последние ${r.lines.length}:`,
        ...r.lines,
      ].join('\n');
    },
  },
  {
    name: 'stand_jobs',
    description:
      'Stand queue on test1a: what runs now and the last 20 jobs (state, place, who, note). cancel=<id> — cancel a job.',
    inputSchema: {
      type: 'object',
      properties: { cancel: str('job id to cancel (queued — dropped, running — stopped)') },
    },
    handler: async (a) => {
      if (a.cancel) {
        const r = await cancelJob(String(a.cancel));
        return `Задание ${a.cancel}: ${r.state === 'cancelling' ? 'останавливается' : r.state === 'cancelled' ? 'отменено' : `уже ${r.state}`}`;
      }
      return listText(await listJobs());
    },
  },
];
