#!/usr/bin/env node
/**
 * Приёмка аддона на клиентском стенде всей сборки (dev #311): одной командой собрать основной и проверочный jar,
 * проверить их состав, заморозить с SHA256, поставить сцену devtest в очередь test1a, строго принять итог и сложить
 * комплект доказательств. Раньше всё это делали руками: jar паковали из папки классов параллельно с Gradle (вышел
 * неполный jar без Power.class), забывали optional-классы, принимали «экран открыт» за успех.
 *
 *   npm run addon-stand -- run <аддон> --scene <имя> [--no-build] [--libs] [--env K=V]… [--overlay <папка>]
 *        [--exclude <часть имени>]… [--timeout 1500] [--note …] [--task <dev id>] [--wait <с>]
 *   npm run addon-stand -- run <аддон> --chain <имя> […те же флаги]   — цепочка шагов из stand.json (dev #356)
 *   npm run addon-stand -- result <id задания> [--timeout 1800] [--task <dev id>]
 *   npm run addon-stand -- scenes <аддон>   — сцены и цепочки
 *
 * <аддон> — путь к папке мода (можно в ворктри) или имя в tools/. Шаги run:
 *  1. сборка: при --libs, --env или пустой libs/ — ./libs.sh с этими переменными; затем один вызов
 *     ./gradlew jar devtestJar (Gradle сам компилирует всё до упаковки; JDK 21 — javaHome() из mc-server.mjs);
 *  2. проверка jar: modId основного = id карточки addon.json, у проверочного — свой; каждый класс из
 *     build/classes/java/{main,devtest} есть в своём jar и только там; ни одного общего пакета (split package
 *     ломает загрузку); в проверочном — tfc/stand/scene/Scene.class и классы из stand.json; сцена есть в исходниках;
 *  3. заморозка: копии в ~/.cache/tfc-plans/addon-stand/<id>/ с SHA в имени и candidate.json (released=false);
 *  4. задание клиентского стенда: оба jar, jar аддона из снимка убран (--exclude по имени из карточки), --scene.
 * result ждёт задание и принимает: SCENE END PASS этой сцены, нет краша, на стенде были ровно замороженные jar, ни
 * одной неожиданной строки отказа (SCENE FAIL, …CLIENT … FAIL, ASSERTFAIL), каждая ожидаемая (отрицательный контроль)
 * — была, каждый SCENE SHOT дал PNG, кадр не однотонный, обязательные кадры есть. Итог — verdict.json и evidence/ в
 * папке заморозки; с --task — запись в журнал dev-задачи.
 *
 * Необязательный tools/<мод>/stand.json — объявление сцен:
 *   { "scenes": { "<имя>": { "note": "…", "timeout": 1500, "env": { "DESTROY": "1" }, "classes": ["a.b.C"],
 *     "shots": ["front"], "expectFail": ["регэксп отказа, который обязан случиться"], "failOn": ["ещё отказ"] } } }
 * Без него сцены находятся в devtest по new Scene("…") / Scene.requested("…").
 *
 * Цепочка (dev #356) — несколько заданий очереди на одних и тех же замороженных jar, каждое после прошедшего прошлого
 * (иначе хост снимает остальные): сервер строит и сохраняет мир → новый процесс сервера на этом мире → клиент входит в
 * него (или своя сцена). Мир передаётся на хосте (--world-job), на Mac он приезжает артефактом каждого шага.
 *   "chains": { "<имя>": { "note", "env", "classes", "steps": [
 *     { "name": "build", "kind": "server", "cmd": ["rectest build", "sleep 5", "rectest report"], "save": true,
 *       "levelType": "minecraft:flat", "failFast": true, "failOn": ["…"], "expect": ["регэксп по rcon.txt"] },
 *     { "name": "restart", "kind": "server", "world": "build", "cmd": […], "expect": […], "save": true },
 *     { "name": "client", "kind": "client", "world": "restart", "shots": 2, "save": true } ] } }
 * Серверный шаг принимается: сервер поднялся, нет краша, сценарий RCON (если был) пройден, каждый expect нашёлся в
 * полном протоколе RCON, с save — мир сохранён и вернулся, с world — загружен мир того шага. Клиентский с world: вход в
 * мир, все кадры, PNG не однотонные и без тона на 90 % кадра; со scene (без world) — как приёмка сцены. Проверочный
 * jar — на серверных шагах и в сценах; простой вход клиентом — только основной, как у игрока (devtest: true — с ним).
 * На каждом шаге — ни одной неожиданной строки отказа в latest.log (expectFail / failOn шага). На каждом шаге стенд сам считает SHA256 своих jar —
 * они обязаны совпасть с замороженными. Итог — общий verdict.json и evidence/<шаг>/ (сводка, журналы, rcon.txt,
 * scenario.json, кадры, world/).
 * Библиотека для MCP addon_stand (scripts/mcp/tools/devserver.mjs): в stdout сама не пишет.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { javaHome } from './mc-server.mjs';
import { zipEntries, zipRead } from './mcp/jars.mjs';
import { submit, waitJob } from './stand-queue-remote.mjs';

export const FREEZE_DIR = path.join(os.homedir(), '.cache', 'tfc-plans', 'addon-stand');
const SCENE_CLASS = 'tfc/stand/scene/Scene.class';
/** Строки отказа проверок: сцена, старые маркеры клиентских тестов (EECLIENT FAIL, BTCLIENT FAIL …), ASSERTFAIL */
const FAIL_LINE = /\b(?:SCENE FAIL|[A-Z]{2,}CLIENT(?: [^\s:]+)? FAIL|ASSERTFAIL)\b.*$/gm;
const SCENE_NAME = /^[\w.-]+$/;

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** Папка аддона: путь к моду (можно в ворктри) или имя в toolsDir (с -mod или без) */
export function resolveAddonDir(q, toolsDir) {
  const s = String(q ?? '').trim();
  if (!s) throw new Error('аддон — путь к папке мода или имя в tools/ (ee-extras-mod)');
  for (const p of [path.resolve(s), path.join(toolsDir, s), path.join(toolsDir, s + '-mod')])
    if (fs.existsSync(path.join(p, 'build.gradle'))) return path.resolve(p);
  throw new Error(`Аддон «${s}» не найден: нет build.gradle ни по пути, ни в ${toolsDir}`);
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Сцены аддона: из исходников devtest (new Scene("…"), Scene.requested("…")) и stand.json → { имя: объявление } */
export function addonScenes(dir) {
  const declared = readJson(path.join(dir, 'stand.json'))?.scenes ?? {};
  const found = new Map();
  for (const f of walk(path.join(dir, 'src', 'devtest', 'java')).filter((p) => p.endsWith('.java')))
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:new Scene|Scene\.requested)\(\s*"([\w.-]+)"/g))
      found.set(m[1], path.relative(dir, f));
  const out = {};
  for (const name of new Set([...found.keys(), ...Object.keys(declared)]))
    out[name] = { ...declared[name], source: found.get(name) ?? null };
  return out;
}

/** Цепочки из stand.json → { имя: { note, env, classes, steps: [{ name, kind, … }] } } (шаги проверены) */
export function addonChains(dir) {
  const chains = readJson(path.join(dir, 'stand.json'))?.chains ?? {};
  for (const [name, c] of Object.entries(chains)) {
    if (!SCENE_NAME.test(name)) throw new Error(`stand.json: имя цепочки — буквы, цифры, . _ - (${name})`);
    const seen = new Set();
    c.steps = (c.steps ?? []).map((st, i) => {
      const step = { ...st, name: st.name ?? `s${i + 1}` };
      const where = `stand.json, цепочка ${name}, шаг ${step.name}`;
      if (!SCENE_NAME.test(step.name)) throw new Error(`${where}: имя шага — буквы, цифры, . _ -`);
      if (seen.has(step.name)) throw new Error(`${where}: имя шага повторяется`);
      if (!['server', 'client'].includes(step.kind)) throw new Error(`${where}: kind — server | client`);
      if (step.world && !seen.has(step.world))
        throw new Error(`${where}: world=${step.world} — нет такого шага раньше`);
      if (step.kind === 'client' && step.scene && step.world)
        throw new Error(`${where}: сцена сама создаёт мир — scene вместе с world пока не поддерживается`);
      if (step.kind === 'client' && step.scene && !SCENE_NAME.test(step.scene))
        throw new Error(`${where}: имя сцены — буквы, цифры, . _ -`);
      seen.add(step.name);
      return step;
    });
    if (!c.steps.length) throw new Error(`stand.json, цепочка ${name}: нет шагов`);
    for (const st of c.steps)
      if (st.world && !c.steps.find((x) => x.name === st.world).save)
        throw new Error(`stand.json, цепочка ${name}, шаг ${st.name}: шаг ${st.world} не сохраняет мир (save: true)`);
  }
  return chains;
}

/** Имя архива и версия из build.gradle / gradle.properties */
function gradleNames(dir) {
  const build = fs.readFileSync(path.join(dir, 'build.gradle'), 'utf8');
  const props = fs.existsSync(path.join(dir, 'gradle.properties'))
    ? fs.readFileSync(path.join(dir, 'gradle.properties'), 'utf8')
    : '';
  return {
    base: build.match(/archivesName\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? path.basename(dir).replace(/-mod$/, ''),
    version: props.match(/^mod_version\s*=\s*(\S+)/m)?.[1] ?? null,
    devtestJar: /register\(\s*['"]devtestJar['"]/.test(build),
  };
}

function run(cmd, args, { cwd, env }) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) {
    const tail = out.trim().split('\n').slice(-25).join('\n');
    throw new Error(
      `${path.basename(cmd)} ${args.join(' ')}: код ${r.status ?? r.signal ?? r.error?.message}\n${tail}`,
    );
  }
  return out;
}

/** Сборка: libs.sh при нужде, затем один вызов Gradle jar devtestJar (последовательно, без ручной упаковки) */
export function buildJars(dir, { env = {}, libs = false } = {}) {
  const names = gradleNames(dir);
  if (!names.devtestJar)
    throw new Error(
      `${path.basename(dir)}: нет задачи devtestJar в build.gradle — добавь как в ee-extras-mod (Jar из sourceSets.devtest.output)`,
    );
  const steps = [];
  const libsDir = path.join(dir, 'libs');
  const empty = !fs.existsSync(libsDir) || !fs.readdirSync(libsDir).some((f) => f.endsWith('.jar'));
  if (fs.existsSync(path.join(dir, 'libs.sh')) && (libs || empty || Object.keys(env).length)) {
    run('bash', ['libs.sh'], { cwd: dir, env });
    steps.push(
      `libs.sh${
        Object.keys(env).length
          ? ' (' +
            Object.entries(env)
              .map(([k, v]) => `${k}=${v}`)
              .join(' ') +
            ')'
          : ''
      }`,
    );
  }
  const jh = javaHome();
  const gradlew = path.join(dir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const t0 = Date.now();
  run(gradlew, ['--no-daemon', '-q', 'jar', 'devtestJar'], {
    cwd: dir,
    env: { ...env, ...(jh ? { JAVA_HOME: jh } : {}) },
  });
  steps.push(`gradlew jar devtestJar за ${Math.round((Date.now() - t0) / 1000)} с${jh ? ` (JDK ${jh})` : ''}`);
  return { steps, ...findJars(dir, names, true) };
}

/**
 * Jar в build/libs: основной без классификатора и -devtest. fresh — jar не старше своих скомпилированных классов
 * (Gradle с задачами up-to-date jar не переписывает, это нормально; старее классов — упаковка не та)
 */
function findJars(dir, names = gradleNames(dir), fresh = false) {
  const libs = path.join(dir, 'build', 'libs');
  const want = names.version
    ? [`${names.base}-${names.version}.jar`, `${names.base}-${names.version}-devtest.jar`]
    : [];
  const pick = (re, exact) => {
    if (exact && fs.existsSync(path.join(libs, exact))) return path.join(libs, exact);
    const all = fs.existsSync(libs) ? fs.readdirSync(libs).filter((f) => re.test(f)) : [];
    return all.map((f) => path.join(libs, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  };
  const main = pick(new RegExp(`^${names.base}-[^-]+(?<!-devtest)\\.jar$`), want[0]);
  const devtest = pick(new RegExp(`^${names.base}-.*-devtest\\.jar$`), want[1]);
  if (!main || !devtest) throw new Error(`в ${libs} нет основного или -devtest jar (соберите без --no-build)`);
  for (const [f, set] of [
    [main, 'main'],
    [devtest, 'devtest'],
  ]) {
    if (!fresh) continue;
    const newest = Math.max(
      0,
      ...walk(path.join(dir, 'build', 'classes', 'java', set)).map((c) => fs.statSync(c).mtimeMs),
    );
    if (fs.statSync(f).mtimeMs < newest - 2000)
      throw new Error(
        `${path.basename(f)} старее своих классов build/classes/java/${set} — проверь задачи jar/devtestJar`,
      );
  }
  return { main, devtest };
}

/** modId из секций [[mods]] META-INF/neoforge.mods.toml (в [[dependencies.*]] тоже modId: neoforge, minecraft…) */
function modIds(jar, entries) {
  const e = entries.find((x) => x.name === 'META-INF/neoforge.mods.toml');
  if (!e) return [];
  return zipRead(jar, e)
    .toString('utf8')
    .split(/^\s*(?=\[)/m)
    .filter((sec) => sec.startsWith('[[mods]]'))
    .flatMap((sec) => [...sec.matchAll(/^\s*modId\s*=\s*"([^"]+)"/gm)].map((m) => m[1]));
}

const pkg = (cls) => cls.slice(0, cls.lastIndexOf('/') + 1);

/**
 * Проверка состава: что лежит в jar против того, что скомпилировал Gradle. → { ok, lines[], fails[] }
 * scene — имя сцены (Scene.class обязателен), spec — объявление из stand.json.
 */
export function preflight(dir, { main, devtest }, { scene = null, spec = {}, card = null } = {}) {
  const lines = [];
  const fails = [];
  const fail = (s) => fails.push(s);
  const eMain = zipEntries(main);
  const eDev = zipEntries(devtest);
  const classes = (es) => new Set(es.filter((e) => e.name.endsWith('.class')).map((e) => e.name));
  const cMain = classes(eMain);
  const cDev = classes(eDev);
  const compiled = (set) =>
    new Set(
      walk(path.join(dir, 'build', 'classes', 'java', set))
        .filter((p) => p.endsWith('.class'))
        .map((p) =>
          path
            .relative(path.join(dir, 'build', 'classes', 'java', set), p)
            .split(path.sep)
            .join('/'),
        ),
    );
  for (const [label, jarSet, built] of [
    ['основной', cMain, compiled('main')],
    ['проверочный', cDev, compiled('devtest')],
  ]) {
    if (!built.size) fail(`${label}: нет build/classes/java — не собран`);
    const missing = [...built].filter((c) => !jarSet.has(c));
    const extra = [...jarSet].filter((c) => !built.has(c));
    if (missing.length)
      fail(`${label} jar неполный: нет ${missing.length} скомпилированных классов (${missing.slice(0, 5).join(', ')})`);
    if (extra.length) fail(`${label} jar: ${extra.length} классов не из этой сборки (${extra.slice(0, 5).join(', ')})`);
    lines.push(`${label}: классов ${jarSet.size}, скомпилировано ${built.size}`);
  }
  for (const [label, es] of [
    ['основной', eMain],
    ['проверочный', eDev],
  ])
    if (!es.some((e) => e.name === 'META-INF/MANIFEST.MF')) fail(`${label} jar: нет META-INF/MANIFEST.MF`);
  const idMain = modIds(main, eMain);
  const idDev = modIds(devtest, eDev);
  if (!idMain.length) fail('основной jar: нет modId в META-INF/neoforge.mods.toml');
  if (card?.id && !idMain.includes(card.id))
    fail(`основной jar: modId ${idMain.join(', ')}, а в addon.json — ${card.id}`);
  if (!idDev.length) fail('проверочный jar: нет своего META-INF/neoforge.mods.toml');
  const clash = idDev.filter((id) => idMain.includes(id));
  if (clash.length) fail(`проверочный jar повторяет modId основного: ${clash.join(', ')}`);
  lines.push(`modId: ${idMain.join(', ') || '—'} + ${idDev.join(', ') || '—'}`);
  const pMain = new Set([...cMain].map(pkg));
  const split = [...new Set([...cDev].map(pkg))].filter((p) => pMain.has(p));
  if (split.length) fail(`split package — общие пакеты основного и проверочного jar: ${split.slice(0, 5).join(', ')}`);
  if (cMain.has(SCENE_CLASS)) fail('основной jar содержит tfc.stand.scene — заготовка сцены только для devtest');
  if (scene && !cDev.has(SCENE_CLASS))
    fail('проверочный jar без tfc/stand/scene/Scene.class (srcDir ../stand-scene/src)');
  for (const c of spec.classes ?? []) {
    const name = c.replaceAll('.', '/') + (c.endsWith('.class') ? '' : '.class');
    if (!cDev.has(name)) fail(`проверочный jar: нет обязательного ${c} (stand.json)`);
  }
  if (scene && !spec.source && !spec.declared) fail(`сцены «${scene}» нет в исходниках devtest`);
  return { ok: !fails.length, lines, fails };
}

/** Заморозка: копии jar с SHA в имени + candidate.json; дальше работаем только с ними */
export function freeze(dir, jars, meta) {
  const id = `${meta.scene ?? meta.chain ?? path.basename(dir)}-${stamp()}`;
  const out = path.join(FREEZE_DIR, id);
  fs.mkdirSync(out, { recursive: true });
  const one = (src) => {
    const sha = sha256(src);
    const name = path.basename(src).replace(/\.jar$/, `-${sha.slice(0, 8)}.jar`);
    fs.copyFileSync(src, path.join(out, name));
    return { file: name, path: path.join(out, name), sha256: sha, size: fs.statSync(src).size, from: src };
  };
  const git = (args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).stdout?.trim() ?? '';
  const candidate = {
    id,
    ...meta,
    addonDir: dir,
    git: {
      commit: git(['rev-parse', 'HEAD']),
      dirty: git(['status', '--porcelain', '--', '.']).split('\n').filter(Boolean).length,
    },
    main: one(jars.main),
    devtest: one(jars.devtest),
    createdAt: new Date().toISOString(),
    released: false,
    runtimeChecked: false,
    job: null,
  };
  fs.writeFileSync(path.join(out, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n');
  return { dir: out, candidate };
}

/** Найти заморозку по id задания стенда */
export function candidateByJob(job) {
  if (!fs.existsSync(FREEZE_DIR)) return null;
  for (const d of fs.readdirSync(FREEZE_DIR)) {
    const c = readJson(path.join(FREEZE_DIR, d, 'candidate.json'));
    if (c?.job === job || c?.jobs?.some((j) => j.job === job)) return { dir: path.join(FREEZE_DIR, d), candidate: c };
  }
  return null;
}

/**
 * Полный путь run: сборка → проверка → заморозка → задание. → { text, job, dir, candidate }
 * a: { addon, scene, build, libs, env, overlay, exclude, timeout, note, by, toolsDir }
 */
export async function addonStandRun(a) {
  const dir = resolveAddonDir(a.addon, a.toolsDir ?? path.join(process.cwd(), 'tools'));
  if (a.chain) return chainRun(dir, a);
  const scenes = addonScenes(dir);
  const scene = String(a.scene ?? '').trim() || (Object.keys(scenes).length === 1 ? Object.keys(scenes)[0] : '');
  if (!scene)
    throw new Error(
      `сцена не указана; у ${path.basename(dir)}: ${Object.keys(scenes).join(', ') || 'сцен нет (tools/stand-scene, dev #342)'}`,
    );
  if (!SCENE_NAME.test(scene)) throw new Error(`имя сцены — буквы, цифры, . _ - (${scene})`);
  const spec = { ...(scenes[scene] ?? {}), declared: Boolean(readJson(path.join(dir, 'stand.json'))?.scenes?.[scene]) };
  const env = { ...(spec.env ?? {}), ...(a.env ?? {}) };
  const card = readJson(path.join(dir, 'addon.json'));
  const text = [`Аддон ${path.basename(dir)} (${dir}), сцена ${scene}${spec.source ? ` — ${spec.source}` : ''}`];
  let jars;
  if (a.build === false) {
    jars = findJars(dir);
    text.push('сборка: пропущена (--no-build), берутся jar из build/libs');
  } else {
    const b = buildJars(dir, { env, libs: Boolean(a.libs) });
    jars = b;
    text.push(`сборка: ${b.steps.join('; ')}`);
  }
  const pf = preflight(dir, jars, { scene, spec, card });
  text.push(...pf.lines.map((l) => `  ${l}`));
  if (!pf.ok) {
    text.push('Проверка jar: ПРОВАЛ — на стенд не отправлено:', ...pf.fails.map((f) => `  ✗ ${f}`));
    return { text: text.join('\n'), ok: false };
  }
  text.push('Проверка jar: пройдена (классы полные, split package нет, modId различны)');
  const names = gradleNames(dir);
  const prefix = card?.jar && card?.version ? card.jar.replace(`${card.version}.jar`, '') : `${names.base}-`;
  const fz = freeze(dir, jars, {
    scene,
    addon: path.basename(dir),
    modId: card?.id ?? null,
    version: names.version,
    exclude: prefix,
    spec: { ...spec, source: undefined, declared: undefined },
    preflight: pf.lines,
  });
  text.push(`Заморожено: ${fz.dir}`, `  ${fz.candidate.main.file} sha256 ${fz.candidate.main.sha256}`);
  text.push(`  ${fz.candidate.devtest.file} sha256 ${fz.candidate.devtest.sha256}`);
  if (fz.candidate.git.dirty) text.push(`  внимание: в папке аддона ${fz.candidate.git.dirty} незакоммиченных файлов`);
  const argv = [
    '--mod',
    fz.candidate.main.path,
    '--mod',
    fz.candidate.devtest.path,
    '--exclude',
    prefix,
    '--scene',
    scene,
  ];
  for (const x of a.exclude ?? []) argv.push('--exclude', x);
  if (a.overlay) argv.push('--overlay', path.resolve(String(a.overlay)));
  argv.push('--timeout', String(Number(a.timeout ?? spec.timeout ?? 1500) | 0));
  const note = a.note || spec.note || `приёмка ${scene} (${fz.candidate.main.file})`;
  const r = await submit('client', argv, { note, by: a.by });
  fz.candidate.job = r.id;
  fz.candidate.task = a.task ?? null;
  fs.writeFileSync(path.join(fz.dir, 'candidate.json'), JSON.stringify(fz.candidate, null, 2) + '\n');
  text.push(`Задание стенда ${r.id}: место в очереди ${r.position}.`);
  return { text: text.join('\n'), ok: true, job: r.id, dir: fz.dir, candidate: fz.candidate };
}

/** Сборка (или готовые jar) и проверка состава → { jars, pf, text[] } */
function buildAndCheck(dir, a, { env, scene, spec, card }) {
  const text = [];
  let jars;
  if (a.build === false) {
    jars = findJars(dir);
    text.push('сборка: пропущена (--no-build), берутся jar из build/libs');
  } else {
    jars = buildJars(dir, { env, libs: Boolean(a.libs) });
    text.push(`сборка: ${jars.steps.join('; ')}`);
  }
  const pf = preflight(dir, jars, { scene, spec, card });
  text.push(...pf.lines.map((l) => `  ${l}`));
  return { jars, pf, text };
}

/**
 * Проверочный jar на шаге: серверу он даёт команды, сцене — себя; простой вход клиентом — как у игрока, только основной
 * jar (автоматика devtest вроде старого ClientTest ee-extras иначе сама ведёт игру и закрывает её); devtest: true — с ним
 */
const withDevtest = (st) => st.kind === 'server' || Boolean(st.scene) || st.devtest === true;

/** Флаги стенда для шага цепочки (без --world-job: его ставит chainRun, когда известен id шага-источника) */
function stepArgs(step, fz, prefix, a) {
  const argv = ['--mod', fz.candidate.main.path];
  if (withDevtest(step)) argv.push('--mod', fz.candidate.devtest.path);
  // Клиент убирает --exclude только jar снимка; сервер — и свои, а копию из снимка он и так заменяет своей по modId
  if (step.kind === 'client') argv.push('--exclude', prefix);
  for (const x of a.exclude ?? []) argv.push('--exclude', x);
  if (a.overlay) argv.push('--overlay', path.resolve(String(a.overlay)));
  if (step.save) argv.push('--save-world');
  if (step.kind === 'server') {
    for (const c of step.cmd ?? []) argv.push('--cmd', String(c));
    if (step.levelType && !step.world) argv.push('--level-type', step.levelType);
    if (step.failFast) argv.push('--fail-fast');
    for (const r of step.failOn ?? []) argv.push('--fail-on', r);
    argv.push('--timeout', String(Number(step.timeout ?? 900) | 0));
  } else {
    if (step.scene) argv.push('--scene', step.scene);
    else if (!step.world) argv.push('--world', 'new');
    if (!step.scene) argv.push('--shots', String(Number(step.shots ?? 2) | 0), '--interval', '5');
    argv.push('--timeout', String(Number(step.timeout ?? (step.scene ? 1500 : 1200)) | 0));
  }
  return argv;
}

/** Цепочка: сборка → проверка → заморозка → все шаги в очередь (каждый после прошлого) → { text, ok, job, jobs } */
async function chainRun(dir, a) {
  const chains = addonChains(dir);
  const name = String(a.chain).trim();
  const chain = chains[name];
  if (!chain)
    throw new Error(`цепочки «${name}» нет в stand.json; есть: ${Object.keys(chains).join(', ') || 'ни одной'}`);
  const scenes = addonScenes(dir);
  const sceneSteps = chain.steps.filter((st) => st.scene);
  const card = readJson(path.join(dir, 'addon.json'));
  const env = { ...(chain.env ?? {}), ...(a.env ?? {}) };
  const text = [`Аддон ${path.basename(dir)} (${dir}), цепочка ${name}: ${chain.steps.map(stepLabel).join(' → ')}`];
  const spec = { classes: chain.classes ?? [], source: true };
  const b = buildAndCheck(dir, a, { env, scene: sceneSteps[0]?.scene ?? null, spec, card });
  text.push(...b.text);
  for (const st of sceneSteps)
    if (!scenes[st.scene]) b.pf.fails.push(`шаг ${st.name}: сцены «${st.scene}» нет в исходниках devtest`);
  if (b.pf.fails.length) {
    text.push('Проверка jar: ПРОВАЛ — на стенд не отправлено:', ...b.pf.fails.map((f) => `  ✗ ${f}`));
    return { text: text.join('\n'), ok: false };
  }
  text.push('Проверка jar: пройдена (классы полные, split package нет, modId различны)');
  const names = gradleNames(dir);
  const prefix = card?.jar && card?.version ? card.jar.replace(`${card.version}.jar`, '') : `${names.base}-`;
  const fz = freeze(dir, b.jars, {
    scene: null,
    chain: name,
    addon: path.basename(dir),
    modId: card?.id ?? null,
    version: names.version,
    exclude: prefix,
    spec: { note: chain.note ?? null, classes: chain.classes ?? [] },
    steps: chain.steps.map((st) => ({
      ...st,
      ...(st.scene ? { sceneSpec: { ...(scenes[st.scene] ?? {}), source: undefined } } : {}),
    })),
    preflight: b.pf.lines,
  });
  text.push(`Заморожено: ${fz.dir}`, `  ${fz.candidate.main.file} sha256 ${fz.candidate.main.sha256}`);
  text.push(`  ${fz.candidate.devtest.file} sha256 ${fz.candidate.devtest.sha256}`);
  if (fz.candidate.git.dirty) text.push(`  внимание: в папке аддона ${fz.candidate.git.dirty} незакоммиченных файлов`);
  const ids = {};
  let prev = null;
  const label = `${path.basename(dir)}/${name}`;
  fz.candidate.jobs = [];
  fz.candidate.task = a.task ?? null;
  const save = () =>
    fs.writeFileSync(path.join(fz.dir, 'candidate.json'), JSON.stringify(fz.candidate, null, 2) + '\n');
  for (const [i, st] of chain.steps.entries()) {
    const argv = stepArgs(st, fz, prefix, a);
    if (st.world) argv.push('--world-job', ids[st.world]);
    const note = `${a.note || chain.note || `цепочка ${name}`} — шаг ${i + 1}/${chain.steps.length} ${st.name}`;
    const r = await submit(st.kind, argv, { note, by: a.by, after: prev, chain: label });
    ids[st.name] = r.id;
    prev = r.id;
    fz.candidate.jobs.push({ step: st.name, kind: st.kind, job: r.id });
    fz.candidate.job = r.id;
    save();
    text.push(
      `Шаг ${i + 1} ${stepLabel(st)}: задание ${r.id}${i ? ` (после ${fz.candidate.jobs[i - 1].job})` : `, место в очереди ${r.position}`}`,
    );
  }
  return { text: text.join('\n'), ok: true, job: prev, jobs: fz.candidate.jobs, dir: fz.dir, candidate: fz.candidate };
}

const stepLabel = (st) =>
  `${st.name} (${st.kind === 'server' ? 'сервер' : st.scene ? `клиент, сцена ${st.scene}` : 'клиент, вход'}${st.world ? `, мир ${st.world}` : ''}${st.save ? ', сохранить мир' : ''})`;

/** SHA256 своих jar, которые стенд посчитал сам: строки «свои: x.jar sha256 <hex>» / «свои sha256: x.jar <hex>» */
export function standShas(summary) {
  const out = new Map();
  for (const line of String(summary)
    .split('\n')
    .filter((l) => /^свои[ :]/.test(l)))
    for (const m of line.matchAll(/([\w.+-]+\.jar)(?: sha256)? ([0-9a-f]{64})\b/g)) out.set(m[1], m[2]);
  return out;
}

/**
 * Кадры входа в мир: не однотонные и без преобладающего тона (чёрный экран с полоской меню FancyMenu даёт разброс
 * яркости, но 95 % его пикселей — один тон) → [{ file, w, h, std, dominant, sha256 }], провалы — в check
 */
function judgePngs(files, check, what) {
  const out = [];
  for (const f of files) {
    const st = pngStats(f);
    out.push({ shot: path.basename(f, '.png'), file: f, sha256: sha256(f), ...st });
    if (!st.ok) check(false, `${what} ${path.basename(f)}: ${st.error}`);
    else if (st.std !== null && st.std < 2)
      check(false, `${what} ${path.basename(f)}: однотонный (разброс яркости ${st.std.toFixed(2)})`);
    else if (st.dominant >= 0.9)
      check(
        false,
        `${what} ${path.basename(f)}: ${Math.round(st.dominant * 100)} % пикселей одного тона — пустой экран`,
      );
    else if (st.std !== null)
      check(
        true,
        `${what} ${path.basename(f)}: разброс яркости ${st.std.toFixed(1)}, один тон — ${Math.round(st.dominant * 100)} %`,
      );
  }
  return out;
}

/** Строки отказа в журнале шага (FAIL_LINE и failOn) против ожидаемых expectFail → проверки в check */
function failLines(latest, { expectFail = [], failOn = [] } = {}, check, checks) {
  const expected = expectFail.map((r) => new RegExp(r));
  const found = [...latest.matchAll(FAIL_LINE)].map((m) => m[0].trim());
  for (const r of failOn) for (const m of latest.match(new RegExp(r, 'gm')) ?? []) found.push(m.trim());
  const unexpected = [...new Set(found)].filter((l) => !expected.some((re) => re.test(l)));
  check(!unexpected.length, `неожиданных строк отказа в журнале: ${unexpected.length}`);
  for (const l of unexpected.slice(0, 10)) checks.push(`    ${l.slice(0, 220)}`);
  for (const re of expected)
    check(
      found.some((l) => re.test(l)),
      `ожидаемый отказ /${re.source}/ случился`,
    );
}

/** Приёмка одного шага цепочки → { ok, fails, checks, shots } */
export function judgeStep(step, local, job, candidate, src) {
  const fails = [];
  const checks = [];
  const check = (ok, what) => {
    checks.push(`${ok ? '✓' : '✗'} ${what}`);
    if (!ok) fails.push(what);
  };
  if (job.state === 'cancelled') {
    check(false, `шаг снят: ${job.error ?? 'отменён'}`);
    return { ok: false, fails, checks, shots: [] };
  }
  const read = (f) => (local && fs.existsSync(path.join(local, f)) ? fs.readFileSync(path.join(local, f), 'utf8') : '');
  const summary = read('summary.txt');
  const shas = standShas(summary);
  for (const j of withDevtest(step) ? [candidate.main, candidate.devtest] : [candidate.main]) {
    const got = shas.get(j.file);
    check(
      got === j.sha256,
      `SHA256 ${j.file} на стенде ${got ? (got === j.sha256 ? 'совпал' : `другой: ${got}`) : 'не найден в сводке'}`,
    );
  }
  if (!withDevtest(step))
    check(!shas.has(candidate.devtest.file), `проверочного ${candidate.devtest.file} на шаге нет (как у игрока)`);
  let shots = [];
  if (step.scene) {
    const spec = { ...step.sceneSpec };
    for (const k of ['expectFail', 'failOn']) if (step[k]) spec[k] = step[k];
    if (Array.isArray(step.shots)) spec.shots = step.shots;
    const v = judge(local ?? '', job, { ...candidate, scene: step.scene, spec });
    checks.push(...v.checks);
    fails.push(...v.fails);
    shots = v.shots;
  } else if (step.kind === 'server') {
    check(
      job.state === 'done' && job.ok !== false,
      `прогон кончился штатно (${job.state}${job.ok === false ? `, код ${job.code}` : ''})`,
    );
    check(/^сервер загрузился за \d+ с/m.test(summary), 'сервер загрузился');
    check(!/^Краш: /m.test(summary) && !(local && fs.existsSync(path.join(local, 'crash-reports'))), 'нет краш-отчёта');
    if (step.world) check(/^мир: копия /m.test(summary), `сервер запущен на мире шага ${step.world} (${src ?? '?'})`);
    const scen = read('scenario.json');
    if (scen) {
      const rep = JSON.parse(scen);
      check(rep.ok, `сценарий RCON: ${rep.ok ? 'пройден' : `провалов ${rep.failures.length}`}`);
      for (const f of (rep.failures ?? []).slice(0, 10)) checks.push(`    шаг ${f.n} «${f.command}»: ${f.reason}`);
    }
    const rcon = read('rcon.txt');
    if (step.cmd?.length) check(Boolean(rcon), `полный протокол RCON вернулся (rcon.txt, ${rcon.length} симв.)`);
    for (const re of step.expect ?? []) check(new RegExp(re, 'm').test(rcon), `в ответах RCON есть /${re}/`);
    failLines(read('latest.log'), { expectFail: step.expectFail }, check, checks);
  } else {
    check(
      job.state === 'done' && job.ok !== false,
      `прогон кончился штатно (${job.state}${job.ok === false ? `, код ${job.code}` : ''})`,
    );
    check(/^итог: в мире/m.test(summary), `клиент вошёл в мир${step.world ? ` шага ${step.world}` : ''}`);
    check(!/^Краш: /m.test(summary), 'нет краш-отчёта');
    if (step.world) check(/^мир: копия /m.test(summary), `загружена копия мира шага ${step.world}`);
    const pngs = local
      ? fs
          .readdirSync(local)
          .filter((f) => /^world-\d+\.png$/.test(f))
          .map((f) => path.join(local, f))
      : [];
    const want = Number(step.shots ?? 2);
    check(pngs.length >= want, `кадров в мире: ${pngs.length} из ${want}`);
    shots = judgePngs(pngs, check, 'кадр');
    failLines(read('latest.log'), step, check, checks);
  }
  if (step.save)
    check(
      /^мир сохранён: /m.test(summary) && Boolean(local) && fs.existsSync(path.join(local, 'world', 'level.dat')),
      'стенд сохранил мир, он вернулся (world/level.dat)',
    );
  return { ok: !fails.length, fails, checks, shots };
}

/** Комплект шага: evidence/<шаг>/ — сводка, журналы, протокол RCON, сценарий, кадры, мир */
function bundleStep(evDir, step, local) {
  const to = path.join(evDir, step.name);
  fs.mkdirSync(to, { recursive: true });
  if (!local) return to;
  for (const f of ['summary.txt', 'latest.log', 'client.log', 'rcon.txt', 'rcon.json', 'scenario.json'])
    if (fs.existsSync(path.join(local, f))) fs.copyFileSync(path.join(local, f), path.join(to, f));
  for (const f of fs.readdirSync(local).filter((x) => x.endsWith('.png')))
    fs.copyFileSync(path.join(local, f), path.join(to, f));
  for (const d of ['screenshots', 'world', 'crash-reports'])
    if (fs.existsSync(path.join(local, d))) fs.cpSync(path.join(local, d), path.join(to, d), { recursive: true });
  return to;
}

/** Дождаться последнего шага цепочки и принять все → как addonStandResult */
async function chainResult(fz, { timeout }) {
  const c = fz.candidate;
  const last = c.jobs.at(-1).job;
  const r = await waitJob(last, { timeout });
  if (r.view.reason !== 'final') {
    const j = r.view.job;
    return {
      ok: null,
      text: `Цепочка ${c.chain}: последний шаг ${last} ещё ${j.state === 'queued' ? `в очереди (место ${r.view.position}; ждёт предыдущие)` : 'идёт'}; ждать дальше — тот же вызов.`,
      images: [],
    };
  }
  const ev = path.join(fz.dir, 'evidence');
  fs.rmSync(ev, { recursive: true, force: true });
  const steps = [];
  for (const [i, js] of c.jobs.entries()) {
    const w = js.job === last ? r : await waitJob(js.job, { timeout: 60 });
    const step = c.steps[i];
    const src = step.world ? c.jobs.find((x) => x.step === step.world)?.job : null;
    const v = judgeStep(step, w.local, w.view.job, c, src);
    bundleStep(ev, step, w.local);
    steps.push({
      step: step.name,
      kind: step.kind,
      job: js.job,
      ok: v.ok,
      checks: v.checks,
      fails: v.fails,
      shots: v.shots,
      results: w.local,
    });
  }
  const ok = steps.every((s) => s.ok);
  const verdict = {
    ok,
    chain: c.chain,
    jobs: c.jobs,
    main: { file: c.main.file, sha256: c.main.sha256 },
    devtest: { file: c.devtest.file, sha256: c.devtest.sha256 },
    git: c.git,
    steps: steps.map(({ shots, ...s }) => ({
      ...s,
      shots: shots.map(({ shot, sha256: sha, w, h, std }) => ({ shot, sha256: sha, w, h, std })),
    })),
    judgedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(fz.dir, 'verdict.json'), JSON.stringify(verdict, null, 2) + '\n');
  c.runtimeChecked = ok;
  fs.writeFileSync(path.join(fz.dir, 'candidate.json'), JSON.stringify(c, null, 2) + '\n');
  const head = `Приёмка ${c.addon}, цепочка ${c.chain}: ${ok ? 'ПРИНЯТО' : 'НЕ ПРИНЯТО'} (задания ${c.jobs.map((j) => j.job).join(' → ')})`;
  const text = [
    head,
    `jar: ${c.main.file} (${c.main.sha256.slice(0, 16)}…), ${c.devtest.file} (${c.devtest.sha256.slice(0, 16)}…) — один и тот же на всех шагах`,
    ...steps.flatMap((s, i) => [
      `Шаг ${i + 1} ${stepLabel(c.steps[i])}, задание ${s.job}: ${s.ok ? 'принят' : 'НЕ принят'}`,
      ...s.checks.map((l) => `  ${l}`),
    ]),
    `Комплект: ${fz.dir} (candidate.json, verdict.json, evidence/<шаг>/: сводка, журналы, rcon.txt, кадры, world/)`,
  ].join('\n');
  const note = [
    `${head}. jar ${c.main.file} sha256 ${c.main.sha256}, devtest ${c.devtest.file} sha256 ${c.devtest.sha256}` +
      `${c.git.commit ? `, коммит аддона ${c.git.commit.slice(0, 10)}${c.git.dirty ? ` (+${c.git.dirty} незакоммич.)` : ''}` : ''}.`,
    ok
      ? `Шагов ${steps.length}, проверок ${steps.reduce((n, s) => n + s.checks.filter((l) => l.startsWith('✓')).length, 0)}.`
      : `Провалы: ${steps
          .filter((s) => !s.ok)
          .map((s) => `${s.step}: ${s.fails.join('; ')}`)
          .join(' | ')}.`,
    `Комплект на Mac: ${fz.dir}.`,
  ].join(' ');
  const images = steps
    .flatMap((s) => s.shots)
    .slice(-2)
    .map((s) => s.file);
  const attachName = `addon-stand-${c.addon}-${c.chain}-${last}.zip`.replace(/[^\w.-]+/g, '_');
  return { ok, text, images, verdict, note, evidence: ev, attachName, task: c.task ?? null };
}

/** PNG: заголовок и разброс яркости по выборке пикселей (однотонный кадр — пустой снимок) */
export function pngStats(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 33 || buf.toString('latin1', 1, 4) !== 'PNG') return { ok: false, error: 'не PNG' };
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const depth = buf[24];
  const type = buf[25];
  const interlace = buf[28];
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || !ch || interlace) return { ok: true, w, h, std: null };
  const idat = [];
  for (let p = 8; p + 8 <= buf.length;) {
    const len = buf.readUInt32BE(p);
    const t = buf.toString('latin1', p + 4, p + 8);
    if (t === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  let prev = Buffer.alloc(stride);
  let n = 0;
  let sum = 0;
  let sq = 0;
  const hist = new Array(32).fill(0);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? row[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = row[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 255;
    }
    if (y % 4 === 0)
      for (let x = 0; x < w; x += 4) {
        const o = x * ch;
        const l = ch >= 3 ? 0.299 * row[o] + 0.587 * row[o + 1] + 0.114 * row[o + 2] : row[o];
        sum += l;
        sq += l * l;
        hist[Math.min(31, l >> 3)]++;
        n++;
      }
    prev = row;
  }
  const mean = sum / n;
  return { ok: true, w, h, std: Math.sqrt(Math.max(0, sq / n - mean * mean)), dominant: Math.max(...hist) / n };
}

/**
 * Приёмка по результатам прогона (папка stand-queue/<id>) → { ok, fails[], checks[], shots[] }.
 * job — задание очереди (state, ok), candidate — заморозка.
 */
export function judge(local, job, candidate) {
  const fails = [];
  const checks = [];
  const scene = candidate.scene;
  const spec = candidate.spec ?? {};
  const read = (f) => (fs.existsSync(path.join(local, f)) ? fs.readFileSync(path.join(local, f), 'utf8') : '');
  const latest = read('latest.log');
  const summary = read('summary.txt');
  const check = (ok, what) => {
    checks.push(`${ok ? '✓' : '✗'} ${what}`);
    if (!ok) fails.push(what);
  };
  check(
    job.state === 'done' && job.ok !== false,
    `прогон кончился штатно (${job.state}${job.ok === false ? `, код ${job.code}` : ''})`,
  );
  check(Boolean(latest), 'latest.log забран со стенда');
  const end = latest.match(new RegExp(`SCENE END (PASS|FAIL \\d+) ${scene.replace(/[.]/g, '\\.')}\\b`))?.[1];
  check(end === 'PASS', `SCENE END ${end ?? 'нет'} ${scene}`);
  check(!/^Краш: /m.test(summary) && !fs.existsSync(path.join(local, 'crash-reports')), 'нет краш-отчёта');
  const used = summary.match(/свои: (.*)$/m)?.[1] ?? '';
  check(
    used.includes(candidate.main.file) && used.includes(candidate.devtest.file),
    `на стенде замороженные jar (${candidate.main.file}, ${candidate.devtest.file})`,
  );
  const expected = (spec.expectFail ?? []).map((r) => new RegExp(r));
  const extraFail = (spec.failOn ?? []).map((r) => new RegExp(r, 'm'));
  const failLines = [...latest.matchAll(FAIL_LINE)].map((m) => m[0].trim());
  for (const re of extraFail) for (const m of latest.match(new RegExp(re.source, 'gm')) ?? []) failLines.push(m.trim());
  const unexpected = [...new Set(failLines)].filter((l) => !expected.some((re) => re.test(l)));
  check(!unexpected.length, `неожиданных отказов: ${unexpected.length}`);
  for (const l of unexpected.slice(0, 15)) checks.push(`    ${l.slice(0, 220)}`);
  for (const re of expected)
    check(
      failLines.some((l) => re.test(l)),
      `ожидаемый отказ (отрицательный контроль) /${re.source}/ случился`,
    );
  const shotDir = path.join(local, 'screenshots');
  const shots = [...latest.matchAll(/SCENE SHOT ([\w.-]+):/g)].map((m) => m[1]);
  check(shots.length > 0 || spec.shots?.length === 0, `кадров сцены: ${shots.length}`);
  const files = [];
  const seen = new Map();
  for (const s of new Set(shots)) {
    const f = path.join(shotDir, `scene-${scene}-${s}.png`);
    if (!fs.existsSync(f)) {
      check(false, `кадр ${s}: PNG не вернулся`);
      continue;
    }
    const st = pngStats(f);
    const sha = sha256(f);
    files.push({ shot: s, file: f, sha256: sha, ...st });
    if (!st.ok) check(false, `кадр ${s}: ${st.error}`);
    else if (st.std !== null && st.std < 2)
      check(false, `кадр ${s}: однотонный (разброс яркости ${st.std.toFixed(2)})`);
    if (seen.has(sha)) checks.push(`  ! кадр ${s} побайтно совпадает с ${seen.get(sha)}`);
    seen.set(sha, s);
  }
  for (const s of spec.shots ?? []) check(shots.includes(s), `обязательный кадр ${s} (stand.json)`);
  return { ok: !fails.length, fails, checks, shots: files };
}

/** Комплект доказательств рядом с заморозкой: evidence/ (сводка, журналы, кадры), verdict.json */
function bundle(fz, local, verdict, jobId) {
  const ev = path.join(fz.dir, 'evidence');
  fs.mkdirSync(ev, { recursive: true });
  for (const f of ['summary.txt', 'latest.log', 'client.log'])
    if (fs.existsSync(path.join(local, f))) fs.copyFileSync(path.join(local, f), path.join(ev, f));
  for (const s of verdict.shots) fs.copyFileSync(s.file, path.join(ev, path.basename(s.file)));
  const out = {
    ok: verdict.ok,
    job: jobId,
    scene: fz.candidate.scene,
    main: { file: fz.candidate.main.file, sha256: fz.candidate.main.sha256 },
    devtest: { file: fz.candidate.devtest.file, sha256: fz.candidate.devtest.sha256 },
    git: fz.candidate.git,
    checks: verdict.checks,
    fails: verdict.fails,
    shots: verdict.shots.map(({ shot, sha256: sha, w, h, std }) => ({ shot, sha256: sha, w, h, std })),
    results: local,
    judgedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(fz.dir, 'verdict.json'), JSON.stringify(out, null, 2) + '\n');
  fz.candidate.runtimeChecked = verdict.ok;
  fs.writeFileSync(path.join(fz.dir, 'candidate.json'), JSON.stringify(fz.candidate, null, 2) + '\n');
  return ev;
}

/**
 * Дождаться задания и принять. → { text, ok|null (ещё идёт), images[], verdict, note } ; note — текст для журнала.
 */
export async function addonStandResult(jobId, { timeout = 1800 } = {}) {
  const fz = candidateByJob(jobId);
  if (!fz) throw new Error(`задание ${jobId} не из addon-stand: нет заморозки с ним в ${FREEZE_DIR}`);
  if (fz.candidate.chain) return chainResult(fz, { timeout });
  const r = await waitJob(jobId, { timeout });
  const job = r.view.job;
  if (r.view.reason !== 'final')
    return {
      ok: null,
      text: `Задание ${jobId} ещё ${job.state === 'queued' ? `в очереди (место ${r.view.position})` : 'идёт'}; ждать дальше — тот же вызов.`,
      images: [],
    };
  if (!r.local) throw new Error(`задание ${jobId}: результаты не забраны со стенда (${job.error ?? job.state})`);
  const verdict = judge(r.local, job, fz.candidate);
  const ev = bundle(fz, r.local, verdict, jobId);
  const c = fz.candidate;
  const head = `Приёмка ${c.addon}, сцена ${c.scene}: ${verdict.ok ? 'ПРИНЯТО' : 'НЕ ПРИНЯТО'} (задание ${jobId})`;
  const text = [
    head,
    `jar: ${c.main.file} (${c.main.sha256.slice(0, 16)}…), ${c.devtest.file} (${c.devtest.sha256.slice(0, 16)}…)`,
    ...verdict.checks,
    `Кадры: ${verdict.shots.map((s) => `${s.shot} ${s.w}×${s.h}`).join(', ') || '—'}`,
    `Комплект: ${fz.dir} (candidate.json, verdict.json, evidence/)`,
  ].join('\n');
  const note = [
    `${head}. jar ${c.main.file} sha256 ${c.main.sha256}, devtest ${c.devtest.file} sha256 ${c.devtest.sha256}` +
      `${c.git.commit ? `, коммит аддона ${c.git.commit.slice(0, 10)}${c.git.dirty ? ` (+${c.git.dirty} незакоммич.)` : ''}` : ''}.`,
    verdict.ok
      ? `Проверок ${verdict.checks.filter((l) => l.startsWith('✓')).length}, кадров ${verdict.shots.length}.`
      : `Провалы: ${verdict.fails.join('; ')}.`,
    `Комплект на Mac: ${fz.dir}.`,
  ].join(' ');
  const images = verdict.shots.slice(-2).map((s) => s.file);
  const attachName = `addon-stand-${c.addon}-${c.scene}-${jobId}.zip`.replace(/[^\w.-]+/g, '_');
  return { ok: verdict.ok, text, images, verdict, note, evidence: ev, attachName, task: c.task ?? null };
}

/** Запись итога в журнал dev-задачи (сервер сборки, как dev_note) */
export async function noteToTask(task, text) {
  const { api } = await import('./mcp-dev/devtasks.mjs');
  const r = await api('POST', `tasks/${task}/notes`, { text, kind: 'note' });
  return `note:${r.notes.at(-1).id} в #${task}`;
}

/**
 * Итог приёмки в dev-задачу: запись в журнал и вложение — zip с evidence/ и verdict.json (dev_file_put). Вложение
 * не удалось — запись всё равно остаётся, ошибка — в ответе.
 */
export async function verdictToTask(task, v) {
  const out = [`журнал: ${await noteToTask(task, v.note)}`];
  try {
    const { devFilePut } = await import('./mcp-dev/files.mjs');
    const dir = path.dirname(v.evidence);
    const r = await devFilePut({
      task,
      path: [v.evidence, path.join(dir, 'verdict.json')],
      zip: true,
      name: v.attachName,
    });
    out.push(
      r
        .split('\n')
        .slice(1)
        .join('\n')
        .replace(/^[+=] (уже было )?/, 'вложение: '),
    );
  } catch (e) {
    out.push(`вложение: не приложено — ${e.message}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- CLI

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, target, ...rest] = process.argv.slice(2);
  const opt = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const many = (name) => rest.flatMap((v, i) => (rest[i - 1] === name ? [v] : []));
  const main = async () => {
    if (cmd === 'scenes') {
      const dir = resolveAddonDir(target, path.join(process.cwd(), 'tools'));
      console.log(JSON.stringify({ scenes: addonScenes(dir), chains: addonChains(dir) }, null, 2));
    } else if (cmd === 'run') {
      const r = await addonStandRun({
        addon: target,
        scene: opt('--scene'),
        chain: opt('--chain'),
        build: !rest.includes('--no-build'),
        libs: rest.includes('--libs'),
        env: Object.fromEntries(many('--env').map((kv) => kv.split(/=(.*)/s).slice(0, 2))),
        overlay: opt('--overlay'),
        exclude: many('--exclude'),
        timeout: opt('--timeout'),
        note: opt('--note'),
        task: opt('--task') ? Number(opt('--task')) : null,
        by: process.env.TFC_AGENT_NICK || os.userInfo().username,
      });
      console.log(r.text);
      if (!r.ok) process.exit(1);
      if (opt('--wait')) {
        const v = await addonStandResult(r.job, { timeout: Number(opt('--wait')) });
        console.log(v.text);
        if (v.note && opt('--task')) console.log(await verdictToTask(Number(opt('--task')), v));
        process.exit(v.ok ? 0 : v.ok === null ? 2 : 1);
      }
    } else if (cmd === 'result') {
      const v = await addonStandResult(target, { timeout: Number(opt('--timeout') ?? 1800) });
      console.log(v.text);
      const task = opt('--task') ?? v.task;
      if (v.note && task) console.log(await verdictToTask(Number(task), v));
      process.exit(v.ok ? 0 : v.ok === null ? 2 : 1);
    } else {
      console.error('npm run addon-stand -- run <аддон> --scene <имя>|--chain <имя> … | result <id> | scenes <аддон>');
      process.exit(2);
    }
  };
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
