#!/usr/bin/env node
/** Автономный контракт стенда: без Minecraft, SSH, ключей и сетевых данных (dev #418). */
import assert from 'node:assert/strict';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { runtimeStatus } from './stand-runtime.mjs';
import { selectMods } from './pack-stand.mjs';
import { addonChains, judge, judgeStep, freeze, addonStandRetry, chainResult } from './addon-stand.mjs';
import { buildProfile, badShotPrefixes } from './client-stand.mjs';
import * as remote from './stand-queue-remote.mjs';
import * as queue from './stand-queue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tfc-stand-smoke-')));
let child;
let frozen;
try {
  assert.equal(typeof queue.QUEUE, 'string');
  for (const name of ['submit', 'waitJob', 'listJobs', 'cancelJob']) assert.equal(typeof remote[name], 'function');
  assert.equal(typeof badShotPrefixes, 'function');
  fs.writeFileSync(path.join(temp, 'items.json'), JSON.stringify([{ i: 'minecraft:stone', r: 'Камень', e: 'Stone' }]));
  child = spawn(process.execPath, ['scripts/mcp/server.mjs'], {
    cwd: root,
    env: { ...process.env, TFC_PUBLIC_DIR: temp },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d;
  });
  const pending = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
  });
  let seq = 0;
  const call = async (method, params = {}) => {
    const id = ++seq;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method}: тайм-аут\n${stderr}`));
      }, 15_000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(msg);
      });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    const msg = await response;
    assert.ok(!msg.error, JSON.stringify(msg));
    return msg.result;
  };
  assert.equal((await call('initialize')).serverInfo.name, 'tfc-pack');
  await call('ping');
  const { tools } = await call('tools/list');
  for (const name of ['item_get', 'addon_stand', 'stand_submit', 'stand_wait', 'stand_jobs'])
    assert.ok(
      tools.some((t) => t.name === name),
      `Нет инструмента ${name}`,
    );
  assert.ok(tools.find((t) => t.name === 'addon_stand').inputSchema.properties.retry);
  const item = await call('tools/call', { name: 'item_get', arguments: { id: 'minecraft:stone' } });
  assert.ok(!item.isError && item.content[0].text.includes('Камень'), JSON.stringify(item));
  child.kill();

  const declaration = {
    chains: {
      demo: {
        steps: [
          { name: 'build', kind: 'server', save: true, levelType: 'tfc:overworld' },
          { name: 'photo', kind: 'client', world: 'build', scene: 'demo' },
        ],
      },
    },
  };
  const writeSpec = () => fs.writeFileSync(path.join(temp, 'stand.json'), JSON.stringify(declaration));
  writeSpec();
  assert.equal(addonChains(temp).demo.steps[1].scene, 'demo');
  declaration.chains.demo.steps[0].levelType = 'minecraft:flat';
  writeSpec();
  assert.throws(() => addonChains(temp), /tfc:overworld/);
  declaration.chains.demo.steps[0].levelType = 'tfc:overworld';
  declaration.chains.demo.steps[0].save = false;
  writeSpec();
  assert.throws(() => addonChains(temp), /не сохраняет/);

  const candidate = {
    scene: 'demo',
    spec: { shots: [] },
    main: { file: 'main.jar' },
    devtest: { file: 'devtest.jar' },
  };
  fs.writeFileSync(path.join(temp, 'summary.txt'), 'свои: main.jar, devtest.jar\n');
  fs.writeFileSync(path.join(temp, 'latest.log'), 'SCENE END PASS demo\n');
  assert.equal(judge(temp, { state: 'done', ok: true }, candidate).ok, true);
  fs.appendFileSync(path.join(temp, 'latest.log'), 'SCENE FAIL неожиданная ошибка\n');
  assert.equal(judge(temp, { state: 'done', ok: true }, candidate).ok, false);
  assert.equal(judge(temp, { state: 'cancelled' }, candidate).ok, false);
  assert.equal(judgeStep({ name: 'build', kind: 'server' }, null, { state: 'error' }, candidate).ok, false);

  const cache = path.join(temp, 'cache');
  fs.mkdirSync(path.join(cache, 'mods'), { recursive: true });
  const opticore = 'Opticores-1.0.9 - Neoforge-1.21.1.jar';
  const sodium = 'sodium-neoforge-0.8.13-beta.1+mc1.21.1.jar';
  for (const f of [opticore, sodium]) fs.writeFileSync(path.join(cache, 'mods', f), 'fixture');
  const game = path.join(temp, 'game');
  const profile = buildProfile({ game, cache, mods: [], exclude: [], copyMods: true });
  assert.deepEqual(profile.compatibility, [opticore]);
  assert.ok(!fs.existsSync(path.join(game, 'mods', opticore)));
  assert.ok(fs.existsSync(path.join(game, 'mods', sodium)));
  const jarFile = path.join(temp, 'own.jar');
  const zip = new AdmZip();
  zip.addFile('META-INF/neoforge.mods.toml', Buffer.from('[[mods]]\nmodId="smoke"\nversion="1"\n'));
  zip.writeZip(jarFile);
  const emptyMods = path.join(temp, 'empty-mods');
  fs.mkdirSync(emptyMods);
  assert.equal(selectMods({ modsDir: emptyMods, extra: [jarFile] }).use.length, 1);
  assert.throws(() => selectMods({ modsDir: emptyMods, extra: [jarFile], exclude: ['own'] }), /Свой JAR/);

  frozen = freeze(temp, { main: jarFile, devtest: jarFile }, { chain: 'smoke', addon: 'smoke' });
  const c = frozen.candidate;
  c.jobs = [
    { step: 'build', kind: 'server', job: 'source', argv: [] },
    {
      step: 'restart',
      kind: 'server',
      job: 'failed',
      argv: ['--mod', c.main.path, '--world-job', 'source'],
      worldJob: 'source',
    },
  ];
  c.steps = [
    { name: 'build', kind: 'server', save: true },
    { name: 'restart', kind: 'server', world: 'build' },
  ];
  c.job = 'failed';
  const saveCandidate = () => fs.writeFileSync(path.join(frozen.dir, 'candidate.json'), JSON.stringify(c));
  saveCandidate();
  fs.mkdirSync(path.join(temp, 'world'));
  fs.writeFileSync(path.join(temp, 'world', 'level.dat'), 'fixture');
  let state = 'running',
    submits = 0;
  const transport = {
    waitJob: async (id) => ({
      view: {
        reason: id === 'source' || state !== 'running' ? 'final' : 'timeout',
        job: { state: id === 'source' ? 'done' : state, ok: id === 'source' },
      },
      local: temp,
    }),
    submit: async (kind, args, meta) => {
      submits++;
      assert.equal(kind, 'server');
      assert.equal(args[args.indexOf('--world-job') + 1], 'source');
      assert.equal(meta.retryOf, 'failed');
      return { id: 'replacement' };
    },
  };
  await assert.rejects(addonStandRetry('failed', 'restart', { transport }), /живо|неизвестно/);
  assert.equal(submits, 0);
  state = 'error';
  const frozenBytes = fs.readFileSync(c.main.path);
  fs.appendFileSync(c.main.path, 'changed');
  await assert.rejects(addonStandRetry('failed', 'restart', { transport }), /Изменён замороженный JAR/);
  fs.writeFileSync(c.main.path, frozenBytes);
  const retried = await addonStandRetry('failed', 'restart', { transport });
  assert.equal(retried.job, 'replacement');
  const updated = JSON.parse(fs.readFileSync(path.join(frozen.dir, 'candidate.json')));
  assert.equal(updated.jobs[1].attempts[0].job, 'failed');
  assert.equal(updated.jobs[1].worldJob, 'source');
  assert.equal(updated.runtimeChecked, false);

  const accepted = path.join(temp, 'accepted');
  fs.mkdirSync(path.join(accepted, 'world'), { recursive: true });
  fs.writeFileSync(path.join(accepted, 'world', 'level.dat'), 'saved world');
  fs.writeFileSync(
    path.join(accepted, 'summary.txt'),
    `сервер загрузился за 1 с\nмир: копия source\nмир сохранён: world\nсвои: ${c.main.file} sha256 ${c.main.sha256}\n`,
  );
  fs.writeFileSync(path.join(accepted, 'latest.log'), 'No failures\n');
  const combined = await chainResult(
    { dir: frozen.dir, candidate: updated },
    {
      timeout: 0,
      wait: async (id) => ({
        view: { reason: 'final', job: { state: id === 'failed' ? 'error' : 'done', ok: id !== 'failed' } },
        local: id === 'failed' ? temp : accepted,
      }),
    },
  );
  assert.equal(combined.ok, true, combined.text);
  assert.equal(combined.verdict.steps[1].attempts[0].job, 'failed');
  assert.ok(fs.existsSync(path.join(combined.evidence, 'attempts/restart/failed/attempt.json')));
  assert.ok(fs.existsSync(path.join(combined.evidence, 'build/world/level.dat')));

  const git = (cwd, ...args) =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const upstream = path.join(temp, 'upstream.git');
  const checkout = path.join(temp, 'checkout');
  git(temp, 'init', '--bare', upstream);
  git(temp, 'clone', upstream, checkout);
  git(checkout, 'checkout', '-b', 'main');
  git(checkout, 'config', 'user.email', 'smoke@localhost');
  git(checkout, 'config', 'user.name', 'Smoke');
  fs.mkdirSync(path.join(checkout, 'scripts'));
  for (const file of ['stand-queue.mjs', 'stand-runtime.mjs'])
    fs.copyFileSync(path.join(root, 'scripts', file), path.join(checkout, 'scripts', file));
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-m', 'Начальное состояние');
  git(checkout, 'push', '-u', 'origin', 'main');
  assert.equal(runtimeStatus(checkout, { refresh: true }).ok, true);
  const queueDir = path.join(temp, 'queue');
  const queueCall = (cmd, data) =>
    spawnSync(process.execPath, [path.join(checkout, 'scripts/stand-queue.mjs'), cmd], {
      env: { ...process.env, TFC_STAND_QUEUE: queueDir },
      input: JSON.stringify(data),
      encoding: 'utf8',
    });
  let response = queueCall('add', { kind: 'server', args: [] });
  assert.equal(response.status, 0, response.stderr);
  const first = JSON.parse(response.stdout);
  const jobFile = path.join(queueDir, 'jobs', first.id, 'job.json');
  const job = JSON.parse(fs.readFileSync(jobFile));
  response = queueCall('add', { kind: 'server', args: [], retryOf: first.id });
  assert.notEqual(response.status, 0);
  job.state = 'cancelled';
  fs.writeFileSync(jobFile, JSON.stringify(job));
  response = queueCall('add', { kind: 'server', args: [], retryOf: first.id });
  assert.equal(response.status, 0, response.stderr);
  const replacement = JSON.parse(response.stdout).id;
  response = queueCall('add', { kind: 'server', args: [], retryOf: first.id });
  assert.equal(JSON.parse(response.stdout).id, replacement, 'Повторная доставка не создаёт дубликат');
  fs.writeFileSync(path.join(checkout, 'local.txt'), 'Локальный коммит');
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-m', 'Локальное изменение');
  const stale = runtimeStatus(checkout, { refresh: true });
  assert.equal(stale.ok, false);
  assert.equal(stale.ahead, 1);
  assert.notEqual(queueCall('add', { kind: 'server', args: [] }).status, 0);
  git(checkout, 'remote', 'set-url', 'origin', path.join(temp, 'missing.git'));
  assert.equal(runtimeStatus(checkout, { refresh: true }).ok, false);

  console.log(
    'Стенд smoke: MCP initialize/list/item_get, API очереди, scene+world, отрицательные вердикты, совместимость профиля — OK',
  );
} finally {
  child?.kill();
  if (frozen) fs.rmSync(frozen.dir, { recursive: true, force: true });
  fs.rmSync(temp, { recursive: true, force: true });
}
