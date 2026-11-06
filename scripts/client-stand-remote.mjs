#!/usr/bin/env node
/**
 * Клиентский стенд на test1a с Mac (dev #284): заливает по ssh код стенда, снимок сборки и толстый установщик NeoForge,
 * запускает scripts/client-stand.mjs там и забирает результаты прогона (журналы, PNG) сюда.
 *
 *   npm run client-stand -- prepare [--assets base|all|none]   — Xvfb, Minecraft, NeoForge на хосте (один раз на версию)
 *   npm run client-stand -- run [--mod <jar>]… [--overlay <папка>] [--world new|flat|<папка мира>] [--exclude …]
 *        [--timeout …] [--shots N] [--ram] …
 *   npm run client-stand -- clean [--results 10]                — брошенные прогоны, лишние Xvfb, старые результаты
 *   --no-pack — не синхронизировать снимок (уже залит); остальные флаги run — как у client-stand.mjs
 *
 *   TFC_CLIENT_HOST       — ssh-адрес (по умолчанию master@100.109.147.20, test1a в Tailscale владельца)
 *   TFC_CLIENT_HOST_ALIAS — HostKeyAlias для known_hosts (по умолчанию 192.168.0.101 — ключ записан под адресом в
 *                           локальной сети; проверку ключа не отключаем)
 *   TFC_CLIENT_OPT        — где на хосте Node и Java (по умолчанию ~/.local/opt/tfc-stand: node/, java/)
 *
 * Результаты — в ~/.cache/tfc-plans/client-stand/results/<id> на Mac (summary.txt, latest.log, PNG).
 * Библиотека для MCP pack_client — clientStand(); в stdout она сама не пишет (там протокол MCP).
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Api } from '@tfc/cli/api';
import { fetchInstaller, neoforgeVersion } from '@tfc/cli/vanilla';
import { PACK_CACHE } from './pack-cache.mjs';
import { packServer } from './pack-fetch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.TFC_CLIENT_HOST ?? 'master@100.109.147.20';
const ALIAS = process.env.TFC_CLIENT_HOST_ALIAS ?? '192.168.0.101';
const OPT = process.env.TFC_CLIENT_OPT ?? '~/.local/opt/tfc-stand';
/** Код стенда на хосте: только эти файлы, без node_modules */
const CODE = ['client-stand.mjs', 'mc-server.mjs', 'pack-cache.mjs', 'client-stand/Capture.java'];
const REMOTE_CODE = '~/tfc-stand/client-stand-code';
const REMOTE_STAND = '.cache/tfc-plans/client-stand';
const LOCAL = path.join(os.homedir(), '.cache', 'tfc-plans', 'client-stand');
const DEFAULT_NF = '21.1.251';

const SSH = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `HostKeyAlias=${ALIAS}`];
const log = (s) => console.error(`[client-stand] ${s}`);
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function ssh(script) {
  const r = spawnSync('ssh', [...SSH, '-o', 'ConnectTimeout=15', HOST, 'bash -se'], {
    input: script,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`ssh ${HOST}: ${(r.stderr || r.stdout || r.error?.message || '').trim()}`);
  return r.stdout;
}

function rsync(args) {
  const r = spawnSync('rsync', ['-a', '-e', ['ssh', ...SSH].join(' '), ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`rsync ${args.at(-1)}: код ${r.status} ${(r.stderr ?? '').trim()}`);
}

/** Код стенда — каждый раз заново, из рабочей копии (проверяем ровно то, что лежит здесь) */
function pushCode() {
  ssh(`rm -rf ${REMOTE_CODE} && mkdir -p ${REMOTE_CODE}/scripts`);
  const tar = spawnSync('tar', ['-cf', '-', '-C', HERE, ...CODE], { maxBuffer: 1 << 26 });
  if (tar.status !== 0) throw new Error(`tar: ${tar.stderr}`);
  const r = spawnSync('ssh', [...SSH, HOST, `tar -xf - -C ${REMOTE_CODE}/scripts`], { input: tar.stdout });
  if (r.status !== 0) throw new Error(`код стенда не залился: ${r.stderr}`);
}

/** Снимок как на Mac: --delete убирает jar прошлых снимков */
function pushPack() {
  if (!fs.existsSync(path.join(PACK_CACHE, 'mods'))) throw new Error(`нет ${PACK_CACHE}/mods — npm run pack:fetch`);
  log(`синхронизирую снимок ${PACK_CACHE} → ${HOST}`);
  ssh('mkdir -p ~/.cache/tfc-plans/pack');
  rsync(['--delete', `${PACK_CACHE}/`, `${HOST}:.cache/tfc-plans/pack/`]);
}

function packNf() {
  try {
    return neoforgeVersion(JSON.parse(fs.readFileSync(path.join(PACK_CACHE, '.tfc-fetch.json'), 'utf8')).loader);
  } catch {
    return null;
  }
}

/** Толстый установщик с сервера сборки → хост (maven.neoforged.net оттуда не открывается) */
async function pushInstaller(nf) {
  const have = ssh(`ls ~/${REMOTE_STAND}/installers/neoforge-${nf}-installer-fat.jar 2>/dev/null || :`).trim();
  if (have) return;
  const server = packServer();
  if (!server) throw new Error('нет ключа сервера сборки (TFC_PACK_URL/TFC_PACK_TOKEN или вход в tfc)');
  const dir = path.join(LOCAL, 'installers');
  log(`беру установщик NeoForge ${nf} с сервера сборки`);
  const jar = await fetchInstaller(nf, dir, { api: new Api(server.url, server.token) });
  ssh(`mkdir -p ~/${REMOTE_STAND}/installers`);
  rsync([jar, `${HOST}:${REMOTE_STAND}/installers/`]);
}

/**
 * Команда client-stand.mjs на хосте; stdout — в onOutput потоком, журнал хоста — в stderr. stdin держим открытым:
 * закрыли (signal, обрыв) — хост штатно останавливает игру и убирает прогон.
 */
function remote(args, { onOutput, signal }) {
  const cmd = [
    `export JAVA_HOME=${OPT}/java PATH=${OPT}/node/bin:${OPT}/java/bin:$PATH`,
    `cd ${REMOTE_CODE}`,
    `exec node scripts/client-stand.mjs ${args.map(q).join(' ')} --stdin-watch`,
  ].join(' && ');
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [...SSH, '-o', 'ServerAliveInterval=30', HOST, cmd], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      onOutput?.(d);
    });
    if (signal?.aborted) child.stdin.end();
    else signal?.addEventListener('abort', () => child.stdin.end(), { once: true });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, out }));
  });
}

/** --world new, new:<пресет>, flat — мир создаёт стенд; иное — локальная папка мира */
export const worldKeyword = (v) => v === 'flat' || v === 'new' || String(v).startsWith('new:');

/** Свои jar, оверлей и папка мира — в папку входов прогона на хосте; аргументы — уже с путями там */
function pushInputs(argv) {
  const inputs = `${REMOTE_STAND}/inputs/${Date.now()}`;
  let home = null;
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--mod' || a === '--overlay' || (a === '--world' && !worldKeyword(argv[i + 1]))) && argv[i + 1]) {
      const local = path.resolve(argv[++i]);
      if (!fs.existsSync(local)) throw new Error(`нет ${local}`);
      home ??= ssh(`mkdir -p ~/${inputs} && printf %s "$HOME"`);
      // Своя подпапка на каждый вход: имя jar в профиле игры остаётся прежним
      const name = `${out.length}/${path.basename(local)}`;
      ssh(`mkdir -p ~/${inputs}/${out.length}`);
      rsync([fs.statSync(local).isDirectory() ? `${local}/` : local, `${HOST}:${inputs}/${name}`]);
      out.push(a, `${home}/${inputs}/${name}`);
    } else out.push(a);
  }
  return { args: out, inputs: home ? inputs : null };
}

/**
 * prepare | run | clean на хосте. argv — флаги client-stand.mjs с локальными путями (--mod, --overlay, --world).
 * → { code, out (stdout хоста), local (папка результатов на Mac или null), pngs (пути на Mac) }
 */
export async function clientStand(cmd, argv = [], { noPack = false, onOutput = null, signal = null } = {}) {
  if (!['prepare', 'run', 'clean'].includes(cmd))
    throw new Error('команда: prepare | run | clean (см. начало scripts/client-stand-remote.mjs)');
  const io = { onOutput, signal };
  const done = (r) => ({ code: r.code, out: r.out, local: null, pngs: [] });
  pushCode();
  if (cmd === 'clean') {
    const r = await remote(['clean', ...argv], io);
    ssh(`rm -rf ~/${REMOTE_STAND}/inputs`);
    return done(r);
  }
  if (!noPack) pushPack();
  if (cmd === 'prepare') {
    const i = argv.indexOf('--neoforge');
    const nf = (i >= 0 && argv[i + 1]) || packNf() || DEFAULT_NF;
    await pushInstaller(nf);
    return done(await remote(['prepare', ...argv], io));
  }
  const { args, inputs } = pushInputs(argv);
  let r;
  try {
    r = await remote(['run', ...args], io);
  } finally {
    if (inputs) ssh(`rm -rf ~/${inputs}`);
  }
  const res = /^RESULT (.+)$/m.exec(r.out)?.[1];
  if (!res) return done(r);
  const local = path.join(LOCAL, 'results', path.basename(res));
  fs.mkdirSync(local, { recursive: true });
  rsync([`${HOST}:${res}/`, `${local}/`]);
  const pngs = fs
    .readdirSync(local)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => path.join(local, f));
  return { code: r.code, out: r.out, local, pngs };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, ...rest] = process.argv.slice(2);
  const abort = new AbortController();
  for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => abort.abort());
  clientStand(
    cmd,
    rest.filter((a) => a !== '--no-pack'),
    { noPack: rest.includes('--no-pack'), onOutput: (d) => process.stdout.write(d), signal: abort.signal },
  ).then(
    (r) => {
      if (r.local) console.log(`\nНа Mac: ${r.local}${r.pngs.length ? `\n  ${r.pngs.join('\n  ')}` : ''}`);
      process.exitCode = r.code ?? 1;
    },
    (e) => {
      console.error(e.message);
      process.exitCode = 1;
    },
  );
}
