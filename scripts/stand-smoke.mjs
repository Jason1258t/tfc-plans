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
import { createServer } from 'node:http';
import { fetchPack } from './pack-fetch.mjs';
import { createHash } from 'node:crypto';
import { selectSnapshot, verifySnapshot, manifestHash } from './stand-snapshot.mjs';
import { transferArgs } from './client-stand-remote.mjs';
import { freezeCode, installCode } from './stand-code.mjs';
import { runtimeStatus, indexLockStatus, recoverIndexLock } from './stand-runtime.mjs';
import { selectMods } from './pack-stand.mjs';
import { addonChains, judge, judgeStep, freeze, addonStandRetry, chainResult } from './addon-stand.mjs';
import { buildProfile, badShotPrefixes, menuFrameReady } from './client-stand.mjs';
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
  const savedCandidate = { ...candidate, worldJob: 'source-id' };
  assert.equal(judge(temp, { state: 'done', ok: true }, savedCandidate).ok, false);
  fs.appendFileSync(path.join(temp, 'summary.txt'), 'мир: копия /jobs/source-id/logs/world\n');
  assert.equal(judge(temp, { state: 'done', ok: true }, savedCandidate).ok, true);
  fs.appendFileSync(path.join(temp, 'latest.log'), 'SCENE FAIL неожиданная ошибка\n');
  assert.equal(judge(temp, { state: 'done', ok: true }, candidate).ok, false);
  assert.equal(judge(temp, { state: 'cancelled' }, candidate).ok, false);
  assert.equal(judgeStep({ name: 'build', kind: 'server' }, null, { state: 'error' }, candidate).ok, false);

  const cache = path.join(temp, 'cache');
  fs.mkdirSync(path.join(cache, 'mods'), { recursive: true });
  const opticore = 'Opticores-1.0.9 - Neoforge-1.21.1.jar';
  const sodium = 'sodium-neoforge-0.8.13-beta.1+mc1.21.1.jar';
  for (const f of [opticore, sodium, 'voxy-0.2.16-beta+1.21.11.jar'])
    fs.writeFileSync(path.join(cache, 'mods', f), 'fixture');
  fs.mkdirSync(path.join(cache, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(cache, 'config', 'voxy-config.json'),
    JSON.stringify({ enabled: true, section_render_distance: 32 }),
  );
  const game = path.join(temp, 'game');
  const profile = buildProfile({ game, cache, mods: [], exclude: [], copyMods: true });
  assert.deepEqual(profile.compatibility, [opticore]);
  assert.equal(profile.visualProfile.voxyEnabled, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(game, 'config', 'voxy-config.json'))).section_render_distance, 32);
  assert.match(profile.visualProfile.options, /renderDistance:4/);
  assert.match(profile.visualProfile.options, /simulationDistance:4/);
  assert.match(profile.visualProfile.options, /maxFps:30/);
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
  for (const file of ['stand-queue.mjs', 'stand-runtime.mjs', 'stand-snapshot.mjs', 'stand-code.mjs'])
    fs.copyFileSync(path.join(root, 'scripts', file), path.join(checkout, 'scripts', file));
  for (const file of ['package-lock.json', 'package.json', '.gitignore'])
    fs.copyFileSync(path.join(root, file), path.join(checkout, file));
  let dependencies = root;
  while (!fs.existsSync(path.join(dependencies, 'node_modules'))) dependencies = path.dirname(dependencies);
  fs.symlinkSync(path.join(dependencies, 'node_modules'), path.join(checkout, 'node_modules'));
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-m', 'Начальное состояние');
  git(checkout, 'push', '-u', 'origin', 'main');
  assert.equal(runtimeStatus(checkout, { refresh: true }).ok, true);
  const queueDir = path.join(temp, 'queue');
  fs.mkdirSync(path.join(queueDir, 'jobs', '20260101-000000-abcd'), { recursive: true });
  const bytes = Buffer.from('pack fixture');
  const manifest = {
    id: 'snapshot-A',
    files: [{ path: 'mods/a.jar', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }],
  };
  const pinned = { id: manifest.id, manifest, sha256: manifestHash(manifest) };
  fs.writeFileSync(
    path.join(queueDir, 'jobs/20260101-000000-abcd/job.json'),
    JSON.stringify({ id: '20260101-000000-abcd', state: 'done', ok: true, snapshot: pinned }),
  );
  const queueCall = (cmd, data) =>
    spawnSync(process.execPath, [path.join(checkout, 'scripts/stand-queue.mjs'), cmd], {
      env: { ...process.env, TFC_STAND_QUEUE: queueDir },
      input: JSON.stringify({ after: '20260101-000000-abcd', ...data }),
      encoding: 'utf8',
    });
  let response = queueCall('add', { kind: 'server', args: [] });
  assert.equal(response.status, 0, response.stderr);
  const first = JSON.parse(response.stdout);
  const jobFile = path.join(queueDir, 'jobs', first.id, 'job.json');
  const job = JSON.parse(fs.readFileSync(jobFile));
  assert.equal(job.snapshot.id, 'snapshot-A');
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

  // Старый lock диагностируется отдельно от dirty/ahead; восстановление не сбрасывает локальный коммит.
  const indexLock = path.join(checkout, '.git/index.lock');
  fs.writeFileSync(indexLock, '');
  const oldTime = new Date(Date.now() - 7200_000);
  fs.utimesSync(indexLock, oldTime, oldTime);
  assert.ok(indexLockStatus(checkout).ageSeconds >= 7200);
  fs.writeFileSync(path.join(queueDir, 'current.json'), 'null');
  assert.throws(() => recoverIndexLock(checkout, queueDir), /dirty|diverged|неизвестен/);
  assert.ok(fs.existsSync(indexLock));
  fs.rmSync(indexLock);
  const clean = path.join(temp, 'clean');
  git(temp, 'clone', '--branch', 'main', upstream, clean);
  fs.writeFileSync(path.join(clean, '.git/index.lock'), '');
  assert.throws(() => recoverIndexLock(clean, queueDir), /старой/);
  fs.utimesSync(path.join(clean, '.git/index.lock'), oldTime, oldTime);
  fs.writeFileSync(path.join(queueDir, 'current.json'), JSON.stringify({ id: 'busy' }));
  assert.throws(() => recoverIndexLock(clean, queueDir), /занята/);
  fs.writeFileSync(path.join(queueDir, 'current.json'), 'null');
  const activeGit = spawn('git', ['-C', clean, 'hash-object', '--stdin'], { stdio: ['pipe', 'ignore', 'ignore'] });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(indexLockStatus(clean).gitProcesses.some((p) => p.pid === activeGit.pid));
    assert.throws(() => recoverIndexLock(clean, queueDir), /старой/);
  } finally {
    activeGit.stdin.end();
    await new Promise((resolve) => activeGit.once('close', resolve));
  }
  const repaired = recoverIndexLock(clean, queueDir);
  assert.ok(fs.existsSync(repaired.backup));
  assert.equal(repaired.runtime.ok, true);

  const snapshots = { 'snapshot-A': manifest, 'snapshot-B': { ...manifest, id: 'snapshot-B' } };
  let currentSnapshot = 'snapshot-A';
  const apiServer = createServer((req, res) => {
    if (req.url.startsWith('/blobs/')) {
      res.end(bytes);
      return;
    }
    const value = req.url === '/pack/current' ? snapshots[currentSnapshot] : snapshots[req.url.split('/').at(-1)];
    res.writeHead(value ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value ?? { error: 'нет снимка' }));
  });
  await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  try {
    const srv = { url: `http://127.0.0.1:${apiServer.address().port}`, token: 'fixture' };
    const server = { TFC_PACK_URL: srv.url, TFC_PACK_TOKEN: srv.token };
    const atSubmit = await selectSnapshot([], null, server);
    currentSnapshot = 'snapshot-B';
    assert.equal((await selectSnapshot([], null, server)).id, 'snapshot-B');
    assert.equal((await selectSnapshot([{ snapshot: atSubmit }], null, server)).id, 'snapshot-A');
    const fetched = path.join(temp, 'fetched');
    await fetchPack({ into: fetched, snapshot: atSubmit.id, srv });
    assert.equal(verifySnapshot(fetched, atSubmit), true);
    const seeded = path.join(temp, 'seeded');
    await fetchPack({
      into: seeded,
      snapshot: atSubmit.id,
      manifest: atSubmit.manifest,
      srv: { url: 'http://127.0.0.1:1', token: 'offline' },
      seedRoot: fetched,
      copySeeds: true,
    });
    assert.equal(verifySnapshot(seeded, atSubmit), true);
    fs.writeFileSync(path.join(fetched, 'mods/a.jar'), 'изменён общий кеш');
    assert.equal(verifySnapshot(seeded, atSubmit), true);
    await assert.rejects(fetchPack({ into: path.join(temp, 'missing'), snapshot: 'missing', srv }), /404/);
  } finally {
    await new Promise((resolve) => apiServer.close(resolve));
  }
  const snapshotDir = path.join(temp, 'pinned-pack');
  fs.mkdirSync(path.join(snapshotDir, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, 'mods/a.jar'), bytes);
  assert.equal(verifySnapshot(snapshotDir, pinned), true);
  fs.writeFileSync(path.join(snapshotDir, 'mods/a.jar'), 'changed');
  assert.equal(verifySnapshot(snapshotDir, pinned), false);
  fs.writeFileSync(path.join(snapshotDir, 'mods/a.jar'), bytes);
  fs.mkdirSync(path.join(snapshotDir, 'config'));
  fs.writeFileSync(path.join(snapshotDir, 'config/stale'), 'old root');
  assert.equal(verifySnapshot(snapshotDir, pinned), false);
  assert.equal((await selectSnapshot([{ id: 'source', snapshot: pinned }], null)).id, 'snapshot-A');
  await assert.rejects(selectSnapshot([{ id: 'legacy' }], null), /нет закреплённого/);
  await assert.rejects(selectSnapshot([{ id: 'source', snapshot: pinned }], 'snapshot-B'), /разные снимки/);
  for (const host of [
    'master@100.109.147.20',
    'master@test1a',
    'master@fd7a:115c:a1e0::d31:9315',
    'master@[fd7a:115c:a1e0::d31:9315]',
  ]) {
    const args = transferArgs([`${host}:/remote/path with spaces/`, '/local path/'], host);
    assert.equal(args.at(-2), "tfc-stand-transfer:'/remote/path with spaces/'");
    assert.ok(args[2].includes('HostName='));
    assert.ok(args[2].includes('StrictHostKeyChecking=yes'));
  }
  assert.equal(menuFrameReady('ScreenCustomizationLayer registered: title_screen'), false);
  assert.equal(
    menuFrameReady('TFC MENU PROBE APPLIED render-return\nTFC MENU FRAME 9000\nTFC MENU FRAME 10000', 11000),
    true,
  );
  assert.equal(
    menuFrameReady('TFC MENU PROBE APPLIED render-return\nTFC MENU FRAME 9000\nTFC MENU FRAME 10000', 16000),
    false,
  );
  assert.equal(
    menuFrameReady('TFC MENU PROBE APPLIED render-return\nTFC MENU FRAME 9000\nTFC MENU BLOCKED 10000', 11000),
    false,
  );
  const codeBundle = freezeCode(root);
  try {
    const installed = path.join(temp, 'runtime');
    const info = installCode(codeBundle.dir, installed, root);
    assert.equal(info.source, 'worktree');
    assert.ok(fs.existsSync(path.join(installed, 'scripts/client-stand.mjs')));
    fs.appendFileSync(path.join(codeBundle.dir, 'scripts/client-stand.mjs'), '//changed');
    assert.throws(() => installCode(codeBundle.dir, path.join(temp, 'bad-runtime'), root), /Изменились исходники/);
  } finally {
    fs.rmSync(codeBundle.dir, { recursive: true, force: true });
  }
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
