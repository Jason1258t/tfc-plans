#!/usr/bin/env node
/**
 * Исполнитель фоновой проверки печати схем (dev #305) на машине со стендом (test1a): берёт у сервера сборки пачку
 * схем (POST /print-checks/claim), подтягивает снимок и выпущенные аддоны, печатает их пушкой на стенде
 * (schematic_print_check, scripts/mcp/tools/printcheck.mjs) и отдаёт итог (POST /print-checks/result). Стенд упал
 * или не уложился в срок — итог «неясное» с хвостом лога; сам исполнитель пропал — пачку закроет сервер.
 *
 *   node scripts/print-worker.mjs            — пачки, пока очередь не пуста (cron: scripts/print-worker.sh)
 *   node scripts/print-worker.mjs --once     — одна пачка
 *   --max N — схем в пачке (8); --memory 6G
 *
 * Ключ роли worker (или администратора) — TFC_PACK_URL / TFC_PACK_TOKEN (окружение или .env.local). Снимок и сервер NeoForge
 * копируются на время прогона в /dev/shm (на HDD стенд грузится заметно дольше), если там хватает места.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);
const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const log = (...a) => console.log(`[print-worker ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- ребёнок: сам прогон стенда

if (argv[0] === '--child') {
  // Отдельный процесс: TFC_PACK_CACHE и TFC_STAND_DIR читаются модулями при загрузке
  const [inFile, outFile] = argv.slice(1);
  const a = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const { printCheck } = await import('./mcp/tools/printcheck.mjs');
  const r = await printCheck({ ...a, onLog: (l) => console.log(`[stand] ${l}`) });
  fs.writeFileSync(outFile, JSON.stringify(r));
  console.log(r.text);
  process.exit(0);
}

// ---------------------------------------------------------------- исполнитель

const { packServer, fetchPack } = await import('./pack-fetch.mjs');
const { PACK_CACHE } = await import('./pack-cache.mjs');
const { STAND } = await import('./pack-stand.mjs');
const srv = packServer();
if (!srv) throw new Error('нет TFC_PACK_URL / TFC_PACK_TOKEN (ключ роли worker)');

async function api(p, body) {
  const res = await fetch(srv.url + p, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${srv.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${p}: ${res.status} ${j.error ?? ''}`);
  return j;
}

const tail = (text, n = 4000) => (text.length > n ? text.slice(-n) : text);

/** Jar выпущенных аддонов среды → кеш ~/.cache/tfc-plans/print-addons (по sha256) */
async function addonJars(addons) {
  const dir = path.join(path.dirname(PACK_CACHE), 'print-addons');
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const a of addons) {
    const f = path.join(dir, `${a.sha256.slice(0, 12)}-${a.file}`);
    if (!fs.existsSync(f)) {
      const res = await fetch(`${srv.url}/blobs/${a.sha256}`, { headers: { Authorization: `Bearer ${srv.token}` } });
      if (!res.ok) throw new Error(`аддон ${a.id}@${a.version}: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (createHash('sha256').update(buf).digest('hex') !== a.sha256) throw new Error(`аддон ${a.id}: хеш не сошёлся`);
      fs.writeFileSync(f, buf);
    }
    out.push(f);
  }
  return out;
}

/** Снимок и сервер NeoForge → /dev/shm; → { pack, stand, clean } */
function stage(loader) {
  const free = (() => {
    try {
      const s = fs.statfsSync('/dev/shm');
      return s.bavail * s.bsize;
    } catch {
      return 0;
    }
  })();
  const need = 2 * 1024 ** 3;
  if (free < need) return { pack: PACK_CACHE, stand: STAND, clean: () => {} };
  const ram = fs.mkdtempSync('/dev/shm/tfc-print.');
  fs.cpSync(PACK_CACHE, path.join(ram, 'pack'), { recursive: true });
  fs.mkdirSync(path.join(ram, 'stand'));
  const nf = path.join(STAND, loader);
  if (loader && fs.existsSync(nf)) fs.cpSync(nf, path.join(ram, 'stand', loader), { recursive: true });
  return {
    pack: path.join(ram, 'pack'),
    stand: path.join(ram, 'stand'),
    clean: () => fs.rmSync(ram, { recursive: true, force: true }),
  };
}

async function runBatch(b) {
  const beat = (st, note = '') => api('/print-checks/progress', { batch: b.id, stage: st, note }).catch(() => {});
  log(`пачка ${b.id}: ${b.items.map((s) => `${s.name} (${s.blocks})`).join(', ')}; срок ${b.timeoutSec} с`);
  let lines = [];
  let staged = null;
  try {
    await beat('fetch', `снимок ${b.env.snapshot}`);
    const meta = () => {
      try {
        return JSON.parse(fs.readFileSync(path.join(PACK_CACHE, '.tfc-fetch.json'), 'utf8'));
      } catch {
        return {};
      }
    };
    if (meta().snapshot !== b.env.snapshot) await fetchPack();
    const mods = await addonJars(b.env.addons);
    staged = stage(meta().loader);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfc-print-worker-'));
    const inFile = path.join(dir, 'in.json');
    const outFile = path.join(dir, 'out.json');
    fs.writeFileSync(
      inFile,
      JSON.stringify({
        ids: b.ids,
        mode: 'survival',
        restart: true,
        mods,
        timeout: b.timeoutSec,
        memory: opt('--memory') ?? '6G',
      }),
    );
    await beat('stand', `аддоны: ${b.env.addons.map((a) => `${a.id}@${a.version}`).join(', ') || 'нет'}`);
    const child = spawn(process.execPath, [SELF, '--child', inFile, outFile], {
      env: { ...process.env, TFC_PACK_CACHE: staged.pack, TFC_STAND_DIR: staged.stand },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const take = (d) => {
      for (const l of String(d).split('\n'))
        if (l.trim()) {
          lines.push(l);
          if (lines.length > 400) lines = lines.slice(-300);
          if (l.startsWith('[stand]')) log(l);
        }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const hard = setTimeout(() => child.kill('SIGKILL'), (b.timeoutSec + 900) * 1000);
    const timer = setInterval(() => {
      const last = lines.filter((l) => l.startsWith('[stand]')).at(-1) ?? '';
      beat('stand', last.replace('[stand] ', ''));
    }, 60_000);
    const code = await new Promise((r) => child.on('close', (c, sig) => r(sig ?? c)));
    clearTimeout(hard);
    clearInterval(timer);
    if (code === 0 && fs.existsSync(outFile)) {
      const { result, text } = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      await api('/print-checks/result', { batch: b.id, result, log: tail(text) });
      log(`пачка ${b.id} готова:`, result.schematics.map((s) => `${s.name} — ${s.status}`).join(', '));
    } else {
      const latest = path.join(staged.stand, 'run', 'logs', 'latest.log');
      const lt = fs.existsSync(latest) ? tail(fs.readFileSync(latest, 'utf8'), 2000) : '';
      await api('/print-checks/result', {
        batch: b.id,
        error: `стенд упал или убит (код ${code})`,
        log: tail(`${lines.join('\n')}\n--- latest.log ---\n${lt}`),
      });
      log(`пачка ${b.id}: стенд упал (код ${code})`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    log(`пачка ${b.id}: ошибка ${e.stack ?? e}`);
    await api('/print-checks/result', {
      batch: b.id,
      error: `ошибка исполнителя: ${e.message}`,
      log: tail(lines.join('\n')),
    }).catch((e2) => log(`итог не отправлен: ${e2.message}`));
  } finally {
    staged?.clean();
  }
}

const worker = `${os.hostname()}:${process.pid}`;
for (;;) {
  const { batch, reason } = await api('/print-checks/claim', { worker, max: Number(opt('--max') ?? 8) });
  if (!batch) {
    log(`пачки нет: ${reason}`);
    break;
  }
  await runBatch(batch);
  if (argv.includes('--once')) break;
  await sleep(5_000);
}
