/**
 * Инструмент MCP schematic_print_check: печать схем библиотеки пушкой Create на стенде всей сборки (pack_devserver).
 * Пишет оверлей (схемы в schematics/uploaded/Test/, харнесс ../print-check.kubejs.js с настройками сверху), шлёт
 * `ct start`, ждёт «[CT] ВСЁ» в logs/kubejs/server.log и сводит строки «[CT] R {json}» в отчёт по-русски.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStand } from '../../pack-stand.mjs';
import { named, num, str } from '../fmt.mjs';
import { schematicFile } from './schematics.mjs';

const HARNESS = fileURLToPath(new URL('../print-check.kubejs.js', import.meta.url));
const REPLACE_MODES = ['не заменять', 'твёрдое на твёрдое', 'твёрдое на любое', 'твёрдое на любое и пустоту'];
let busy = false;

const list = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[\r\n,]+/)).map((x) => String(x).trim()).filter(Boolean);

/** Строки «[CT] …» лога KubeJS: { events, last, done } */
function readCt(run) {
  const f = path.join(run, 'logs', 'kubejs', 'server.log');
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const events = [];
  const plain = [];
  for (const line of text.split('\n')) {
    const i = line.indexOf('[CT] ');
    if (i < 0) continue;
    const rest = line.slice(i + 5).trim();
    if (rest.startsWith('R {')) {
      try {
        events.push(JSON.parse(rest.slice(2)));
      } catch {
        plain.push(rest);
      }
    } else plain.push(rest);
  }
  const done = plain.some((l) => /^(ВСЁ|ОШИБКА)/.test(l));
  return { events, plain, done, started: plain.some((l) => l === 'старт') };
}

const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);

function spendLines(spent, required) {
  const out = [];
  const total = sum(spent);
  if (!required) return [`  потрачено ${total}`];
  const need = { ...required };
  delete need.INVALID;
  out.push(`  расход: потрачено ${total} из нужных по схеме ${sum(need)}`);
  const more = [];
  const less = [];
  for (const id of new Set([...Object.keys(need), ...Object.keys(spent ?? {})])) {
    const d = (spent?.[id] ?? 0) - (need[id] ?? 0);
    if (d > 0) more.push([id, d]);
    else if (d < 0) less.push([id, -d]);
  }
  const fmt = (a) =>
    a
      .sort((x, y) => y[1] - x[1])
      .slice(0, 12)
      .map(([id, n]) => `${named(id)} ${n}`)
      .join('; ') + (a.length > 12 ? `; … ещё ${a.length - 12}` : '');
  if (more.length) out.push(`    больше нужного: ${fmt(more)}`);
  if (less.length) out.push(`    меньше нужного: ${fmt(less)}`);
  if (!more.length && !less.length) out.push('    совпадает с нужным');
  return out;
}

function reportLines(r, site, start) {
  const title =
    r.label === 'restart'
      ? 'повторный запуск поверх готовой'
      : r.label === 'print-reset'
        ? 'печать (со сбросом посреди)'
        : 'печать';
  const out = [`  ${title}: поставлено ${r.placed} из ${r.toPlace}, ${r.sec} с; не совпадает со схемой ${r.mismatch}`];
  if (r.stall)
    out.push(
      `    ЗАСТРЯЛА: ${r.stall.sec} с без новых блоков, состояние ${r.stall.state} «${r.stall.msg}»` +
        (r.stall.missing ? `, не хватает ${named(r.stall.missing)}` : ''),
    );
  for (const g of r.groups ?? []) out.push(`    ${g.n} × ${g.key} — пример: ${g.ex}`);
  if (r.moreGroups) out.push(`    … ещё групп ${r.moreGroups}`);
  if (!site.creative && r.spent) {
    if (r.label === 'restart') {
      const s = Object.entries(r.spent).sort((a, b) => b[1] - a[1]);
      out.push(
        `  расход повторного запуска: ${sum(r.spent)}${s.length ? ` — ${s.map(([id, n]) => `${named(id)} ${n}`).join('; ')}` : ''}`,
      );
    } else out.push(...spendLines(r.spent, start?.required));
  }
  return out;
}

const STAND_LINE =
  /^(Стенд|сервер |моды:|KubeJS:|  Loaded|  итоговых|  ошибки|    |Краш|Лог:|клиентские|Ошибки latest|Ошибок в latest)/;

async function schematicPrintCheck(a) {
  const ids = list(a.ids ?? a.id);
  if (!ids.length) throw new Error('ids — id или названия схем библиотеки (schematics_list)');
  const mode = String(a.mode ?? 'survival');
  if (!['creative', 'survival', 'both'].includes(mode)) throw new Error('mode — creative, survival или both');
  const modes = mode === 'both' ? ['creative', 'survival'] : [mode];
  const replaceMode = a.replaceMode == null ? 2 : Number(a.replaceMode) | 0;
  if (replaceMode < 0 || replaceMode > 3) throw new Error('replaceMode — 0…3');
  const reset = a.reset ? Math.min(0.95, Math.max(0.05, Number(a.resetAt ?? 0.5))) : 0;
  const restart = a.restart !== false;
  const delay = Math.min(10, Math.max(1, Number(a.delay ?? 1) | 0));
  const stall = Math.max(30, Number(a.stall ?? 180) | 0);
  const prefill = a.prefill
    ? { block: String(a.prefill), height: Math.max(1, Number(a.prefillHeight ?? 4) | 0) }
    : null;
  const mods = list(a.mods).map((m) => path.resolve(m));
  for (const m of mods) if (!fs.existsSync(m)) throw new Error(`нет jar ${m}`);
  if (busy) throw new Error('Стенд уже занят другим прогоном schematic_print_check — дождитесь его.');

  // оверлей: схемы, харнесс с настройками
  const overlay = fs.mkdtempSync(path.join(os.tmpdir(), 'tfc-print-check-'));
  const schemDir = path.join(overlay, 'schematics', 'uploaded', 'Test');
  fs.mkdirSync(schemDir, { recursive: true });
  const sites = [];
  const files = [];
  let cursor = 200;
  for (const [n, id] of ids.entries()) {
    const f = await schematicFile(id, { edited: a.edited !== false });
    const file = `s${n + 1}.nbt`;
    fs.writeFileSync(path.join(schemDir, file), f.bytes);
    files.push({ ...f, file });
    for (const m of modes) {
      const x = cursor + 8;
      cursor = x + f.size[0] + 16;
      sites.push({
        name: `${f.entry.name} · ${m === 'creative' ? 'творческий ящик' : 'выживание'}`,
        id: f.entry.id,
        file,
        size: f.size,
        x,
        z: 200,
        creative: m === 'creative',
        restart,
        reset,
        replaceMode,
        prefill,
      });
    }
  }
  const cfg = { delay, stall, sites };
  const scripts = path.join(overlay, 'kubejs', 'server_scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(
    path.join(scripts, 'zz_print_check.js'),
    `var CT_CFG = ${JSON.stringify(cfg)}\n` + fs.readFileSync(HARNESS, 'utf8'),
  );

  const timeout = Math.max(120, Number(a.timeout ?? 2400) | 0);
  busy = true;
  let r;
  try {
    r = await runStand({
      commands: ['ct start'],
      mods,
      exclude: list(a.exclude),
      overlay,
      memory: a.memory ? String(a.memory) : undefined,
      waitFor: {
        timeout,
        // «старт» должен появиться сразу после команды: иначе харнесс не загрузился — ждать нечего
        check: (run, sec) => {
          const c = readCt(run);
          return c.done || (sec >= 60 && !c.started);
        },
      },
    });
  } finally {
    busy = false;
    fs.rmSync(overlay, { recursive: true, force: true });
  }

  const ct = r.booted ? readCt(r.run) : { events: [], plain: [], done: false };
  const out = [
    `Печать схем пушкой Create на стенде: задержка ${delay} тик., режим замены ${replaceMode} (${REPLACE_MODES[replaceMode]})` +
      `${restart ? ', повторный запуск' : ''}${reset ? `, сброс на ${Math.round(reset * 100)}%` : ''}` +
      `${prefill ? `, заливка ${prefill.block} ×${prefill.height} слоя` : ''}${mods.length ? `, свои jar: ${mods.map((m) => path.basename(m)).join(', ')}` : ''}`,
  ];
  if (!r.booted) out.push('Сервер не поднялся — отчёта нет.');
  else if (!ct.started) out.push('Харнесс не стартовал: команда ct не сработала (ошибка KubeJS?) — см. ниже.');
  else if (!ct.done) out.push(`Не дождался конца печати за ${timeout} с (timeout=…) — ниже то, что успело.`);
  for (const l of ct.plain.filter((l) => /^ОШИБКА/.test(l))) out.push(`Харнесс: ${l}`);
  for (const [i, s] of sites.entries()) {
    const evs = ct.events.filter((e) => e.site === i);
    const start = evs.find((e) => e.ev === 'start');
    out.push('', `— ${s.name} (${s.id}, ${s.size.join('×')}${start ? `, якорь ${start.anchor}` : ''})`);
    if (!start) {
      out.push('  не запускалась');
      continue;
    }
    if (start.required) {
      const req = { ...start.required };
      const bad = req.INVALID ?? 0;
      delete req.INVALID;
      out.push(
        `  нужно по схеме: ${sum(req)} предметов, видов ${Object.keys(req).length}` +
          (bad ? `; клеток без предмета (пушка их не ставит): ${bad}` : ''),
      );
    }
    for (const e of evs) {
      if (e.ev === 'reset') out.push(`  сброс («Стоп» → «Пуск») на ${e.placed} из ${e.toPlace}`);
      else if (e.ev === 'report') out.push(...reportLines(e, s, start));
      else if (e.ev === 'error') out.push(`  ошибка: ${e.msg}`);
    }
  }
  out.push(
    '',
    'Стенд:',
    ...r.text
      .split('\n')
      .filter((l) => STAND_LINE.test(l))
      .map((l) => '  ' + l),
  );
  return out.join('\n');
}

export const TOOLS = [
  {
    name: 'schematic_print_check',
    description:
      'Print library schematics with the Create schematicannon on the whole-pack stand (pack_devserver, flat world, one cannon per schematic×mode in a row) and compare the world with the schematic: cells still different (missing block, same block other properties, other block, block-entity data) grouped with an example, blocks placed, items spent vs required (survival: barrels topped up from an exact bank), optional restart of the same schematic over the finished build (should place and spend 0) and a reset («Стоп»→«Пуск») mid-print. Waits for the print to finish (stall detection) instead of fixed sleeps. Slow: ~2 min boot + print time; one run at a time; call directly only. Needs npm run pack:fetch.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'schematic ids, names or site links (schematics_list)',
        },
        mode: {
          type: 'string',
          enum: ['survival', 'creative', 'both'],
          description: 'survival — barrels with exact items, counts spend (default); creative — creative crate',
        },
        restart: {
          type: 'boolean',
          description: 'after printing, run the same schematic again over it (default true)',
        },
        reset: { type: 'boolean', description: 'stop and start the cannon mid-print (default false)' },
        resetAt: { type: 'number', description: 'reset at this fraction of blocks placed (0.5)' },
        edited: {
          type: 'boolean',
          description: 'file after replacements and shape, as the site downloads it (default true)',
        },
        mods: {
          type: 'array',
          items: { type: 'string' },
          description: 'extra/own jar paths, e.g. a built addon (replace pack jars with the same modId)',
        },
        exclude: {
          type: 'array',
          items: { type: 'string' },
          description: 'pack mods to drop: modId or file name part',
        },
        prefill: str('block id to fill the bottom layers of each schematic box with before printing (e.g. an ore)'),
        prefillHeight: num('layers to prefill (4)'),
        replaceMode: num('cannon replace mode 0–3: 0 none, 1 solid→solid, 2 solid→any (default), 3 solid→any+air'),
        delay: num('schematicannonDelay ticks (1; Create default 10)'),
        stall: num('seconds without a new block before a print counts as stuck (180)'),
        timeout: num('max seconds to wait for all prints after boot (2400)'),
        memory: str('-Xmx (6G)'),
      },
      required: ['ids'],
    },
    handler: schematicPrintCheck,
  },
];
