/**
 * Инструмент MCP ee_circuit: прогон цепи Create: Electroenergetics вне игры на настоящих классах мода (dev #355).
 *
 * Сам расчёт — scripts/mcp/ee/EeCircuit.java (java <файл>.java, без сборки): элементы и решатели из jar EE сборки,
 * сборка матрицы и порядок микрошага повторяют Network.formMatrix и SimulationTicker. Classpath: jar EE из кеша
 * снимка (npm run pack:fetch) + библиотеки NeoForge стенда (~/.cache/tfc-plans/stand/neoforge-*\/libraries: fastutil,
 * а для диода — Minecraft и всё, что тянет net.minecraft.util.Mth). Без стенда — fastutil из кеша Gradle, диода нет.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODS } from '../data.mjs';
import { num, str } from '../fmt.mjs';
import { javaBin } from './code.mjs';

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ee', 'EeCircuit.java');
const STAND = path.resolve(process.env.TFC_STAND_DIR ?? path.join(os.homedir(), '.cache', 'tfc-plans', 'stand'));

const verKey = (v) => v.split(/[.-]/).map((x) => Number(x) || 0);
const newer = (a, b) => {
  const x = verKey(a);
  const y = verKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

function walkJars(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJars(p, out);
    else if (e.name.endsWith('.jar')) out.push(p);
  }
  return out;
}

/** Classpath: { cp, ee, libs, diode } или ошибка с подсказкой */
function classpath() {
  const ee = fs.existsSync(MODS) ? fs.readdirSync(MODS).find((f) => /^electroenergetics-.*\.jar$/.test(f)) : null;
  if (!ee) throw new Error(`нет jar Create: Electroenergetics в ${MODS} — скачайте снимок сборки: npm run pack:fetch`);
  const cp = [path.join(MODS, ee)];
  // Библиотеки самого свежего NeoForge стенда: сервер Minecraft (srg = имена Mojang) и его зависимости
  const stands = fs.existsSync(STAND)
    ? fs
        .readdirSync(STAND)
        .filter((d) => /^neoforge-[\d.]+$/.test(d) && fs.existsSync(path.join(STAND, d, 'libraries')))
        .sort((a, b) => newer(a.slice(9), b.slice(9)))
    : [];
  if (stands.length) {
    const libs = path.join(STAND, stands.at(-1), 'libraries');
    const jars = walkJars(libs).filter((f) => !f.includes(`${path.sep}neoforged${path.sep}`));
    // из сервера Minecraft — только srg (имена Mojang, как в игре), без slim/extra/unpacked
    const mc = jars.filter((f) => f.includes(`${path.sep}net${path.sep}minecraft${path.sep}server${path.sep}`));
    const srg = mc.find((f) => f.endsWith('-srg.jar'));
    cp.push(...jars.filter((f) => !mc.includes(f)), ...(srg ? [srg] : []));
    return { cp, ee, libs: `стенд ${stands.at(-1)}`, diode: Boolean(srg) };
  }
  const gradle = path.join(os.homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'it.unimi.dsi', 'fastutil');
  const fu = fs.existsSync(gradle) ? walkJars(gradle).filter((f) => /fastutil-8\.[\d.]+\.jar$/.test(f)) : [];
  if (!fu.length)
    throw new Error(
      'нет fastutil: нужны библиотеки NeoForge стенда (~/.cache/tfc-plans/stand, ставит npm run stand) или кеш Gradle аддонов',
    );
  cp.push(fu.sort((a, b) => newer(path.basename(a).slice(9, -4), path.basename(b).slice(9, -4))).at(-1));
  return { cp, ee, libs: 'fastutil из кеша Gradle', diode: false };
}

function run(cmd, args, input, timeout) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { maxBuffer: 16 << 20, timeout }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const msg = String(stderr || err.message).trim();
      // своя ошибка раннера (код 2) — одна строка; иначе — хвост стека
      if (err.code === 2) return reject(new Error(msg));
      if (err.killed) return reject(new Error(`прогон дольше ${timeout / 1000} с — уменьшите seconds или n`));
      return reject(new Error(msg.split('\n').slice(0, 8).join('\n')));
    });
    child.stdin.end(input);
  });
}

async function eeCircuit(a) {
  const circuit = String(a.circuit ?? '').trim();
  if (!circuit) throw new Error('нет цепи: circuit — элементы по строке, «ТИП a b значение [ключ=значение]»');
  const { cp, ee, libs, diode } = classpath();
  if (/^\s*(\w+:\s*)?D\s/im.test(circuit) && !diode)
    throw new Error(
      'диоду EE нужен Minecraft (net.minecraft.util.Mth) — нет библиотек стенда в ~/.cache/tfc-plans/stand',
    );
  const params = { n: a.n, seconds: a.seconds, measure_from: a.measure_from, probes: a.probes, ground: a.ground };
  if (a.samples) params.samples = Math.min(200, Math.max(0, a.samples));
  const head = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${String(v).replace(/\n/g, ' ')}`);
  const input = [...head, '---', ...circuit.split(/\r?\n|;/)].join('\n');
  const out = await run(javaBin(), ['-cp', cp.join(path.delimiter), RUNNER], input, 120_000);
  return `Классы ${ee} (${libs}).\n${out}`;
}

export const TOOLS = [
  {
    name: 'ee_circuit',
    description:
      'Run a Create: Electroenergetics circuit outside the game on the real mod classes (Inductor/Capacitor/DiodeProperties, SparseMatrix, Cholesky/LU solver; matrix and micro-tick order as Network.formMatrix + SimulationTicker; ungrounded network gets 1000 S on one node like dfsAndGround). Returns per-probe end/min/max/amplitude/mean/RMS/frequency over the measure window, L+C energy (growth check and decay without sources), optional time series. Elements, one per line or «;»: «[name:] TYPE a b value [key=val]». R ohm; L henry (i0=A, r=series ohm — the EE inductor block is r=0.1); C farad (v0=V, r=0.1 for the block); D anode cathode (needs the stand libraries); V emf a−b volts, Thevenin (r=1 default); E ideal voltage source a−b (LU solver); I amps from a through the source into b. Sources: sin=Hz phase=deg offset=…, hold=tick (value held for the whole tick like blocks) or micro (default, per micro-step). SI suffixes p n u m k M meg. Node «gnd» is grounded by default.',
    inputSchema: {
      type: 'object',
      properties: {
        circuit: str('elements, one per line or «;»; comments after # or //'),
        n: num('micro-ticks per game tick (default 8 — pack electroenergetics-server.toml simulation.microTicks)'),
        seconds: { type: 'number', description: 'simulated time, s (default 10; 20 game ticks per second)' },
        measure_from: { type: 'number', description: 'measure window start, s (default — last third)' },
        probes: str(
          'space/«;» list: V(node), V(node,node), U(element), I(element), E (L+C energy); default — U and I of every element',
        ),
        ground: str('nodes grounded with 1000 S, comma-separated (default «gnd» if present)'),
        samples: num('time-series rows over the whole run (0–200, default 0)'),
      },
      required: ['circuit'],
    },
    handler: eeCircuit,
  },
];
