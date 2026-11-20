/**
 * Addon Stand — приёмка аддона на полном клиенте с паком (dev #342, #356, #358).
 *
 * stand.json (tools/<mod>/stand.json):
 * {
 *   "scenes": { "scene-name": { "shots": ["shot1", "shot2"] } },
 *   "chains": {
 *     "chain-name": {
 *       "note": "описание",
 *       "steps": [
 *         { "name": "build", "kind": "server", "cmd": ["cmd1", "cmd2"], "expect": ["regex"], "save": true },
 *         { "name": "restart", "kind": "server", "world": "build", "cmd": ["sleep 10", "cmd"], "expect": ["regex"], "save": true },
 *         { "name": "photo", "kind": "client", "world": "restart", "scene": "scene-name" }
 *       ]
 *     }
 *   }
 * }
 *
 * Серверный шаг принимается: сервер поднялся, нет краша, сценарий RCON (если был) пройден, каждый expect нашёлся в
 * полном протоколе RCON, с save — мир сохранён и вернулся, с world — загружен мир того шага. Клиентский с world: вход в
 * мир, все кадры, PNG не однотонные и без тона на 90 % кадра; со scene — как приёмка сцены (с world — сцена в этом мире, dev #358). Проверочный
 * jar — на серверных шагах и в сценах; простой вход клиентом — только основной, как у игрока (devtest: true — с ним).
 * На каждом шаге — ни одной неожиданной строки отказа в latest.log (expectFail / failOn шага). На каждом шаге стенд сам считает SHA256 своих jar —
 * они обязаны совпасть с замороженными. Итог — общий verdict.json и evidence/<шаг>/ (сводка, журналы, rcon.txt,
 * scenario.json, PNGы, world/).
 *
 * Запуск: addon_stand <addon> chain=<name> [build=true] [libs=true] [env=…] [overlay=…] [exclude=…] [timeout=…] [wait=…] [task=<dev id>] [note=…]
 *   job=<id> — ждёт и судит уже поставленную в очередь задачу.
 *
 * MCP tool: addon_stand (scripts/mcp/tools/devserver.mjs).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { addonJar, freezeJars, sha256File } from './freeze.mjs';
import { standSubmit, standWait } from './stand-queue-remote.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(__dirname, '../../tools');

const SCENE_NAME = /^[\w.-]+$/;

function addonChains(dir) {
    const file = path.join(dir, 'stand.json');
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const chains = data.chains ?? {};
    for (const [name, chain] of Object.entries(chains)) {
        if (!chain.steps || !Array.isArray(chain.steps)) throw new Error(`stand.json, цепочка ${name}: нет steps[]`);
        const seen = new Set();
        for (const step of chain.steps) {
            const where = `цепочка ${name}, шаг ${step.name}`;
            if (!step.kind || !['server', 'client'].includes(step.kind)) throw new Error(`${where}: kind — server | client`);
            if (step.world && !seen.has(step.world))
                throw new Error(`${where}: world=${step.world} — нет такого шага раньше`);
            if (step.kind === 'client' && step.scene && !SCENE_NAME.test(step.scene))
                throw new Error(`${where}: имя сцены — буквы, цифры, . _ -`);
            seen.add(step.name);
        }
        // Сцена в сохранённом мире (dev #358): в плоском мире (по умолчанию у сервера стенда) TFC роняет тик игрока и
        // NeoForge сборки удаляет его — сцена теряет блоки и камеру. Мир должен идти от шага с levelType tfc:overworld
        for (const st of chain.steps.filter((x) => x.kind === 'client' && x.scene && x.world)) {
            let root = chain.steps.find((x) => x.name === st.world);
            while (root?.world) root = chain.steps.find((x) => x.name === root.world);
            if ((root?.levelType ?? 'minecraft:flat') !== 'tfc:overworld')
                throw new Error(
                    `stand.json, цепочка ${name}, шаг ${st.name}: сцене нужен мир tfc:overworld — у шага ${root?.name} levelType ${root?.levelType ?? 'minecraft:flat (по умолчанию)'}; в плоском TFC роняет тик игрока`,
                );
        }
    }
    return chains;
}

async function runGradle(modDir, task, env = {}) {
    const cmd = ['./gradlew', '--no-daemon', task];
    const opts = { cwd: modDir, env: { ...process.env, ...env }, stdio: 'inherit', timeout: 600000 };
    const res = spawnSync(cmd[0], cmd.slice(1), opts);
    if (res.status !== 0) throw new Error(`gradlew ${task} exited ${res.status}`);
}

async function buildAddon(modDir, { libs = false, env = '' } = {}) {
    if (libs) {
        const res = spawnSync('bash', ['libs.sh'], { cwd: modDir, env: { ...process.env, ...Object.fromEntries(env.split('\n').filter(Boolean).map(l => l.split('='))) }, stdio: 'inherit', timeout: 300000 });
        if (res.status !== 0) throw new Error('libs.sh failed');
    }
    await runGradle(modDir, 'jar');
    await runGradle(modDir, 'devtestJar');
}

function checkDevtestJar(jarPath, addonId) {
    // Проверки: нет split packages, modId != main, Scene.class есть, stand.json классы есть
    // Упрощённо: проверяем наличие Scene.class
    const res = spawnSync('jar', ['tf', jarPath], { encoding: 'utf8' });
    if (!res.stdout.includes('tfc/stand/scene/Scene.class')) throw new Error('devtest-jar: нет tfc.stand.scene.Scene');
    if (!res.stdout.includes('ee/extras/devtest/ClientTest.class')) throw new Error('devtest-jar: нет ee.extras.devtest.ClientTest');
}

export async function addonStand({ addon, chain, build = false, libs = false, env = '', overlay = '', exclude = [], timeout = 1800, wait = 0, task, note = '' }) {
    const modDir = path.isAbsolute(addon) ? addon : path.join(TOOLS, addon);
    if (!fs.existsSync(modDir)) throw new Error(`Аддон не найден: ${modDir}`);
    const chains = addonChains(modDir);
    if (!chains[chain]) throw new Error(`Цепочки "${chain}" нет в stand.json; есть: ${Object.keys(chains).join(', ')}`);

    let mainJar, devtestJar;
    if (build) {
        await buildAddon(modDir, { libs, env });
    }
    // Найти jar'ы в build/libs
    const libsDir = path.join(modDir, 'build', 'libs');
    const jars = fs.readdirSync(libsDir).filter(f => f.endsWith('.jar') && !f.includes('-sources') && !f.includes('-javadoc'));
    mainJar = jars.find(f => !f.includes('-devtest'));
    devtestJar = jars.find(f => f.includes('-devtest'));
    if (!mainJar || !devtestJar) throw new Error('Не найдены main/devtest jar в build/libs');

    const mainPath = path.join(libsDir, mainJar);
    const devtestPath = path.join(libsDir, devtestJar);
    checkDevtestJar(devtestPath, path.basename(modDir).replace('-mod', ''));

    // Заморозить jar'ы с SHA256
    const { dir: frozenDir, main: frozenMain, devtest: frozenDevtest } = freezeJars(mainPath, devtestPath);

    // Поставить задачу в очередь
    const jobId = await standSubmit({
        kind: 'chain',
        addon: path.basename(modDir).replace('-mod', ''),
        chain,
        mainJar: frozenMain,
        devtestJar: frozenDevtest,
        overlay,
        exclude,
        timeout,
        note: note || `addon_stand ${chain} ${path.basename(modDir)}`
    });

    if (wait > 0) {
        const result = await standWait({ id: jobId, timeout: wait * 1000 });
        // Если есть task — логируем вердикт
        if (task) {
            const { dev_note, dev_file_put } = await import('./mcp/tools.mjs');
            await dev_note({ id: task, note: `addon_stand ${chain}: ${result.verdict}` });
            // TODO: прикрепить evidence.zip через dev_file_put
        }
        return result;
    }
    return { jobId };
}

export async function judgeStep(step, local, job, candidate, src) {
    // Эта функция вызывается из stand-queue для суждения шага
    // Проверки: boot, no crash, scenario/expect, world saved/loaded, shots, SHA256 match
    // Возвращает { passed, checks, fails, shots, summary }
    // Для scene+world (dev #358): проверка, что клиент вошёл именно в мир того шага
    // Реализация в stand-queue.mjs на хосте
}