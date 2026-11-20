/**
 * Client Stand — запуск полного клиента с паком на виртуальном дисплее (Xvfb + llvmpipe).
 * Используется для: devtest-сцен (tools/stand-scene), скриншоты, приёмка аддонов (addon_stand).
 * MCP tools: pack_devserver (dev server), addon_stand (chain acceptance), stand_submit/kind=client.
 *
 * Архитектура: хост (Mac) пушит код стенда (scripts/…) и оверлеи на test1a,
 * там worker (stand-queue.mjs) ставит джобы в очередь и запускает runClient().
 *
 * Сцена devtest (tools/stand-scene, dev #342): сама создаёт мир TFC и ведёт шаги;
 * прогон кончается строкой SCENE END (или выходом игры), а не settle, кадры scene-*
 * забираются сами, строки SCENE — в сводке.
 * scene + world (dev #358) — сцена в этом мире: стенд входит в него быстрым входом и
 * кладёт метку game/scene-world, сцена мир не создаёт и площадку не строит, а стартует по входу в мир.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync, spawn } from 'child_process';
import { rimraf } from 'rimraf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAND_DIR = path.resolve(__dirname, '../../.cache/tfc-plans/client-stand');

const SCENE_LINE = /\s(SCENE (?:OK|FAIL|NOTE|SHOT|END|START)\b.*)$/gm;
const SCENE_END = /\sSCENE END (PASS|FAIL \d+)/;
/** Сцена не начала работу за столько секунд после меню — её jar не тот или она упала при запуске */
const SCENE_START_SEC = 120;
/** То же для сцены в сохранённом мире: отсчёт от входа игрока, а «Загрузка территории…» на llvmpipe идёт минутами */
const SCENE_START_WORLD_SEC = 300;
const SCENE_NAME = /^[\w.-]+$/;
/** Имя мира стенда в saves/ */
const WORLD = 'stand';

function log(msg) { console.log(`[client-stand] ${msg}`); }

function secs() { return Math.floor((Date.now() - startTime) / 1000); }
let startTime = Date.now();

async function startDisplay(runDir, size = '1280x720') {
    // Xvfb на первом свободном дисплее :90+
    for (let d = 90; d < 200; d++) {
        const lock = path.join(runDir, `.X${d}-lock`);
        try { fs.writeFileSync(lock, '', { flag: 'wx' }); }
        catch { continue; }
        const xvfb = spawn('Xvfb', [`:${d}`, '-screen', '0', `${size}x24`, '-ac', '-nolisten', 'tcp'], {
            stdio: 'ignore', detached: true
        });
        xvfb.unref();
        await new Promise(r => setTimeout(r, 500));
        if (fs.existsSync(path.join('/tmp', `.X${d}-lock`))) {
            process.env.DISPLAY = `:${d}`;
            return d;
        }
    }
    throw new Error('No free Xvfb display');
}

function setupWorld(gameDir, worldName, parentVersion) {
    const savesDir = path.join(gameDir, 'saves', WORLD);
    if (fs.existsSync(savesDir)) {
        log(`мир ${WORLD} уже есть, использую`);
        return;
    }
    fs.mkdirSync(savesDir, { recursive: true });
    // Минимальный level.dat для быстрого входа
    fs.writeFileSync(path.join(savesDir, 'level.dat'), '');
    log(`подготовлен мир ${WORLD} (копия из ${worldName})`);
}

export async function runClient({
    mods = [],
    exclude = [],
    overlay = '',
    world = '',
    scene = '',
    shots = 2,
    settle = 30,
    size = '1280x720',
    ram = false,
    timeout = 900,
    parallel = false,
    noPack = false,
    direct = false,
    stdinWatch = false
} = {}) {
    const runId = Date.now().toString(36);
    const runDir = path.join(STAND_DIR, 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    startTime = Date.now();

    const gameDir = path.join(runDir, 'game');
    fs.mkdirSync(gameDir, { recursive: true });

    // Моды
    const modsDir = path.join(gameDir, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    // ... symlink mods from pack cache ...

    if (scene && !SCENE_NAME.test(scene)) throw new Error(`--scene: имя сцены — буквы, цифры, . _ - (${scene})`);
    if (scene) {
        fs.writeFileSync(path.join(gameDir, 'scene'), `${scene}\n`);
    }
    if (scene && world) {
        fs.writeFileSync(path.join(gameDir, 'scene-world'), `${world}\n`);
    }

    const display = await startDisplay(runDir, size);
    const env = {
        ...process.env,
        DISPLAY: `:${display}`,
        TFC_STAND_RUN: runId,
        TFC_STAND_SCENE: scene || '',
        TFC_STAND_WORLD: world || ''
    };

    // Запуск клиента (упрощённо)
    const args = [
        '-Xmx8G', '-Xms2G',
        '-Dfml.earlyProgressWindow=false',
        '-Dcustomskinloader.ignorePatchFailure=true',
        '-cp', '...', // classpath from version JSON
        'net.minecraft.client.main.Main',
        '--gameDir', gameDir,
        '--version', 'neoforge-...',
        '--assetsDir', '...',
        '--assetIndex', '...',
        '--username', 'StandBot',
        '--uuid', '00000000-0000-0000-0000-000000000000',
        '--accessToken', '0'
    ];

    if (world) args.push('--quickPlaySingleplayer', WORLD);
    if (scene) args.push('--quickPlaySingleplayer', WORLD); // quickPlay всё равно нужен

    const child = spawn('java', args, { cwd: runDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdoutBuf = '', stderrBuf = '';
    child.stdout.on('data', d => { stdoutBuf += d; });
    child.stderr.on('data', d => { stderrBuf += d; });

    const deadline = Date.now() + timeout * 1000;
    let exited = false, exitCode = null, sceneEnd = null, noStart = false;
    let readySec = null;

    while (!exited && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1000));
        const logPath = path.join(gameDir, 'logs', 'latest.log');
        if (fs.existsSync(logPath)) {
            const text = fs.readFileSync(logPath, 'utf8');
            if (readySec === null && /\b(Joining|Loaded).*world\b/.test(text)) {
                readySec = secs();
                log(`${world ? 'игрок вошёл в мир' : 'главное меню'} через ${readySec} с, сцена ${scene} идёт (до ${timeout} с от запуска)`);
            }
            if (scene) {
                sceneEnd = SCENE_END.exec(text)?.[1] ?? null;
                if (sceneEnd) break;
                if (!/\sSCENE START /.test(text) && secs() - readySec > (world ? SCENE_START_WORLD_SEC : SCENE_START_SEC)) {
                    noStart = true;
                    break;
                }
            }
        }
        try { exitCode = child.exitCode; if (exitCode !== null) exited = true; } catch {}
    }

    child.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 2000));
    if (!exited) child.kill('SIGKILL');

    let state;
    if (sceneEnd) {
        state = `сцена ${scene}: ${sceneEnd.startsWith('PASS') ? 'ПРОЙДЕНА' : `ПРОВАЛ (${sceneEnd.slice(5)})`}`;
    } else if (noStart) {
        state = `сцена ${scene} не запустилась за ${world ? SCENE_START_WORLD_SEC : SCENE_START_SEC} с после ${world ? 'входа в мир' : 'меню'} (нет SCENE START: нет её devtest-jar, аддон не запускает сцены по входу в мир (Scene.launch) или ошибка при запуске — см. latest.log)`;
    } else if (exited) {
        state = `сцена ${scene}: игра вышла без SCENE END (код ${exitCode})`;
    } else {
        state = `сцена ${scene}: нет SCENE END за ${timeout} с`;
    }

    // Собрать результаты
    const resultsDir = path.join(STAND_DIR, 'results', runId);
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(path.join(resultsDir, 'summary.txt'), state + '\n');
    fs.writeFileSync(path.join(resultsDir, 'client.log'), stdoutBuf);
    fs.writeFileSync(path.join(resultsDir, 'latest.log'), stderrBuf);

    return { runId, state, resultsDir };
}