/**
 * Инструменты MCP: прогон сервера разработки аддона (tools/<мод>/test-server.sh). Запускает gradlew runServer с
 * модами из libs/, ждёт готовности, шлёт команды через RCON и возвращает ответы и ошибки из лога. Долгий (минута-две)
 * — вызывать только напрямую, не в фоне. Работает на любой ОС (на Windows — через gradlew.bat) и не требует python.
 * pack_devserver — стенд всей сборки (scripts/pack-stand.mjs): production-сервер со снимком и полным KubeJS.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isWin, javaHome, killTree, runRcon, sleep } from '../../mc-server.mjs';
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

/** Моды в run/mods — как в test-server.sh: по cp-строкам (libs/<glob>), иначе все jar из libs/ */
function copyLibs(dir, runMods) {
  const libs = path.join(dir, 'libs');
  if (!fs.existsSync(libs)) return [];
  const ts = path.join(dir, 'test-server.sh');
  let patterns = [];
  if (fs.existsSync(ts)) {
    for (const line of fs.readFileSync(ts, 'utf8').split(/\r?\n/)) {
      const m = line.match(/cp\s+([^;\n]+?)\s+run\/mods\//);
      if (m) for (const arg of m[1].trim().split(/\s+/)) if (arg.startsWith('libs/')) patterns.push(arg.slice(5));
    }
  }
  if (!patterns.length) patterns = ['*.jar'];
  const copied = [];
  for (const f of fs.readdirSync(libs))
    if (f.endsWith('.jar') && patterns.some((p) => globMatch(p, f))) {
      fs.copyFileSync(path.join(libs, f), path.join(runMods, f));
      copied.push(f);
    }
  return copied;
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
  const copied = copyLibs(dir, path.join(run, 'mods'));
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

  const childEnv = { ...process.env, JAVA_HOME: javaHome(), ...env };
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
  const t0 = Date.now();

  const tail = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  let booted = false;
  let crashed = false;
  while (Date.now() - t0 < timeout * 1000) {
    const text = tail();
    if (/Done\s*\([^)]*\)!/.test(text)) {
      booted = true;
      break;
    }
    if (/ERROR|Exception|Caused by|Failed to start/.test(text)) {
      crashed = true;
      break;
    }
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
  await sleep(3000);
  if (child.exitCode === null) killTree(child.pid);

  const errLines = tail()
    .split(/\r?\n/)
    .filter((l) => /ERROR|Exception|Caused by/.test(l))
    .slice(0, 30);
  const mods = copied.length ? copied.join(', ') : '—';

  const out = [
    'Сервер разработки ' + path.basename(dir) + ' (' + dir + '):',
    booted
      ? 'загрузился за ' + Math.round((Date.now() - t0) / 1000) + ' с'
      : crashed
        ? 'упал при запуске'
        : 'не поднялся за ' + timeout + ' с',
    'моды в run/mods: ' + mods,
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

export const TOOLS = [
  {
    name: 'addon_devserver',
    description:
      'Run an addon test server (tools/<mod>/test-server.sh) — gradlew runServer with the mods from libs/, wait for it, send RCON commands and return their replies plus error lines from run/check.log. Long (1–2 min), call directly only. Cross-platform (gradlew.bat on Windows), no python.',
    inputSchema: {
      type: 'object',
      properties: {
        addon: str('addon folder: name in tools/ (ee-extras-mod) or a path to the mod folder'),
        commands: {
          type: 'array',
          items: { type: 'string' },
          description: 'RCON commands to run once the server is up ("sleep N" — pause, seconds)',
        },
        env: str('extra env KEY=VALUE per line (IE=1, KEEP=1, NO_EE=1, OLD_JAR=…, MODS=…, MICROTICKS=…)'),
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
];
