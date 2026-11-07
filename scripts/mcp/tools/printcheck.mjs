/**
 * Инструмент MCP schematic_print_check: печать схем библиотеки пушкой Create на стенде всей сборки (pack_devserver).
 * Пишет оверлей (схемы в schematics/uploaded/Test/, харнесс ../print-check.kubejs.js с настройками сверху), шлёт
 * `ct start`, ждёт «[CT] ВСЁ» в logs/kubejs/server.log и раскладывает строки «[CT] R {json}» по причинам (статусы
 * #305): 1 печатается полностью, 2 нет в сборке, 3 битое, чего редактор не видит, 4 неясное. printCheck — то же для
 * фоновой проверки: { text, result }.
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

/** Группы итога (худшая — итог схемы) */
export const PRINT_STATUS = {
  1: { status: 'ok', text: 'печатается полностью' },
  2: { status: 'not_in_pack', text: 'нет в сборке' },
  3: { status: 'broken', text: 'битое, чего редактор не видит' },
  4: { status: 'unclear', text: 'неясное — нужно разобраться' },
};

/** Причины: группа и текст для игрока */
export const PRINT_CODES = {
  not_in_pack: [2, 'блока нет в сборке — замените его в редакторе схем'],
  not_loaded: [3, 'схема не загружается в пушку — пересохраните схему (старые или битые данные блоков)'],
  no_item: [3, 'у блока нет своего предмета — пушка его не ставит; замените блок'],
  wrong_state: [3, 'блок встаёт с другими свойствами'],
  lost_data: [3, 'теряются данные блок-сущности'],
  restart_replaces: [3, 'повторный запуск ставит блок заново — пушка считает готовый блок неверным'],
  missing: [4, 'блок не поставлен, причина неизвестна'],
  other_block: [4, 'на месте другой блок'],
  stuck: [4, 'пушка застряла'],
  overspend: [4, 'потрачено больше, чем нужно по схеме'],
  not_finished: [4, 'проверка не завершилась'],
  stand_error: [4, 'ошибка стенда или харнесса'],
};

let busy = false;

const list = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[\r\n,]+/)).map((x) => String(x).trim()).filter(Boolean);
const readText = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);

/** Строки «[CT] …» лога KubeJS: { events, plain, done, started } */
function readCt(run) {
  const events = [];
  const plain = [];
  for (const line of readText(path.join(run, 'logs', 'kubejs', 'server.log')).split('\n')) {
    const i = line.indexOf('[CT] ');
    if (i < 0) continue;
    const rest = line.slice(i + 5).trim();
    if (rest.startsWith('R {')) {
      try {
        events.push(JSON.parse(rest.slice(2)));
        continue;
      } catch {
        /* строка оборвана — как текст */
      }
    }
    plain.push(rest);
  }
  return {
    events,
    plain,
    done: plain.some((l) => /^(ВСЁ|ОШИБКА)/.test(l)),
    started: plain.some((l) => l === 'старт' || l.startsWith('ОШИБКА старта')),
  };
}

/** Куски логов стенда для причин группы 4 и not_loaded */
function logExcerpts(run) {
  const latest = readText(path.join(run, 'logs', 'latest.log')).split('\n');
  const at = latest.findIndex((l) => l.includes('Failed to load Schematic for Printing'));
  const kjs = readText(path.join(run, 'logs', 'kubejs', 'server.log'))
    .split('\n')
    .filter((l) => /zz_print_check/.test(l) && /ERROR|Error|error/.test(l))
    .slice(0, 5);
  return {
    load:
      at < 0
        ? ''
        : latest
            .slice(at, at + 6)
            .join('\n')
            .slice(0, 1500),
    harness: kjs.join('\n').slice(0, 1500),
  };
}

function problem(code, fields) {
  const [group, text] = PRINT_CODES[code];
  return { group, code, text, block: null, cells: 0, example: '', ...fields };
}

/** Итог площадки (схема × режим) из событий харнесса */
function classify(site, evs, ctx) {
  const start = evs.find((e) => e.ev === 'start');
  const reports = evs.filter((e) => e.ev === 'report');
  const print = reports.find((e) => e.label !== 'restart');
  const again = reports.find((e) => e.label === 'restart');
  const problems = [];
  const out = {
    mode: site.creative ? 'creative' : 'survival',
    anchor: start?.anchor ?? null,
    required: start?.required ?? null,
    invalid: start?.invalid ?? null,
    placed: print?.placed ?? null,
    toPlace: print?.toPlace ?? null,
    sec: print?.sec ?? null,
    mismatch: print?.mismatch ?? null,
    spent: print?.spent ?? null,
    reset: evs.find((e) => e.ev === 'reset') ?? null,
    restart: again
      ? { placed: again.placed, sec: again.sec, mismatch: again.mismatch, spent: again.spent ?? null }
      : null,
    problems,
  };

  for (const [block, cells] of Object.entries(start?.unknown ?? {}))
    problems.push(problem('not_in_pack', { block, cells }));
  if (!start) {
    problems.push(
      problem(ctx.booted ? 'not_finished' : 'stand_error', {
        text: ctx.booted ? 'площадка не запустилась' : 'стенд не поднялся',
        example: ctx.harness || ctx.standErr,
      }),
    );
  } else if (start.notLoaded) {
    problems.push(problem('not_loaded', { example: ctx.load }));
  } else {
    const invalid = { ...(start.invalid ?? {}) };
    for (const [block, cells] of Object.entries(invalid))
      problems.push(
        block === 'entity'
          ? problem('no_item', {
              text: 'сущности схемы (рамки, стойки, вагонетки) без своего предмета — пушка их не ставит',
              cells,
            })
          : problem('no_item', { block, cells }),
      );
    if (!print) problems.push(problem('not_finished', { example: ctx.done ? '' : `не дождался за ${ctx.timeout} с` }));
    if (print?.stall) {
      const s = print.stall;
      const msg = `${s.sec} с без новых блоков, состояние ${s.state} «${s.msg}»${s.missing ? `, не хватает ${s.missing}` : ''}`;
      problems.push(
        /^schematic/i.test(s.msg)
          ? problem('not_loaded', { text: `${PRINT_CODES.not_loaded[1]}: ${msg}`, example: ctx.load })
          : problem('stuck', { text: `${PRINT_CODES.stuck[1]}: ${msg}`, block: s.missing || null }),
      );
    }
    for (const g of print?.groups ?? []) {
      let cells = g.n;
      if (g.kind === 'missing' && invalid[g.block]) {
        // клетки без предмета пушка и не ставит — это уже no_item
        const take = Math.min(cells, invalid[g.block]);
        invalid[g.block] -= take;
        cells -= take;
        if (!cells) continue;
      }
      const code = { missing: 'missing', state: 'wrong_state', data: 'lost_data', other: 'other_block' }[g.kind];
      problems.push(problem(code, { block: g.block, ...(g.from ? { from: g.from } : {}), cells, example: g.ex }));
    }
    if (print?.moreGroups)
      problems.push(problem('missing', { text: `ещё групп расхождений: ${print.moreGroups} (не показаны)` }));
    if (print?.spent && start.required) {
      const over = Object.entries(print.spent)
        .map(([id, n]) => [id, n - (start.required[id] ?? 0)])
        .filter(([, d]) => d > 0);
      for (const [block, cells] of over) problems.push(problem('overspend', { block, cells }));
    }
    if (again?.placed > 0) {
      const partly = print?.mismatch ? ' (часть — недостающие с первого прохода)' : '';
      const spent = Object.entries(again.spent ?? {}).filter(([, n]) => n > 0);
      if (spent.length)
        for (const [block, cells] of spent)
          problems.push(problem('restart_replaces', { text: PRINT_CODES.restart_replaces[1] + partly, block, cells }));
      else
        problems.push(
          problem('restart_replaces', { text: PRINT_CODES.restart_replaces[1] + partly, cells: again.placed }),
        );
    }
    if (again?.stall) problems.push(problem('stuck', { text: `повторный запуск застрял: «${again.stall.msg}»` }));
  }
  if (ctx.harnessError) problems.push(problem('stand_error', { text: ctx.harnessError, example: ctx.harness }));
  const group = Math.max(1, ...problems.map((p) => p.group));
  return { ...out, group, status: PRINT_STATUS[group].status };
}

const blockName = (id) => (id ? named(id) : '');

function siteText(r) {
  const out = [];
  const req = { ...(r.required ?? {}) };
  if (r.placed != null)
    out.push(
      `  печать: поставлено ${r.placed} из ${r.toPlace}, ${r.sec} с; не совпадает со схемой ${r.mismatch}` +
        (r.reset ? `; сброс на ${r.reset.placed}` : ''),
    );
  if (r.spent) out.push(`  расход: ${sum(r.spent)} из нужных по схеме ${sum(req)}`);
  if (r.restart)
    out.push(
      `  повторный запуск: поставлено ${r.restart.placed}` +
        (r.restart.spent ? `, потрачено ${sum(r.restart.spent)}` : '') +
        `, не совпадает ${r.restart.mismatch}`,
    );
  for (const g of [2, 3, 4]) {
    const ps = r.problems.filter((p) => p.group === g);
    if (!ps.length) continue;
    out.push(`  ${g} · ${PRINT_STATUS[g].text}:`);
    for (const p of ps.slice(0, 15)) {
      out.push(
        `    [${p.code}] ${p.block ? `${blockName(p.block)}${p.from ? ` ← ${blockName(p.from)}` : ''}: ` : ''}${p.text}` +
          (p.cells ? ` — ${p.cells}` : ''),
      );
      if (p.example) out.push(`      пример: ${p.example.replace(/\n/g, '\n      ').slice(0, 600)}`);
    }
    if (ps.length > 15) out.push(`    … ещё ${ps.length - 15}`);
  }
  return out;
}

const STAND_LINE =
  /^(Стенд|сервер |моды:|KubeJS:|  Loaded|  итоговых|  ошибки|Краш|Лог:|клиентские|Ошибки latest|Ошибок в latest)/;

/**
 * Оверлей проверки в папку overlay (схемы, харнесс с настройками). opts: ids, mode (survival|creative|both),
 * restart, reset, resetAt, edited, mods, prefill, prefillHeight, replaceMode, delay, stall, timeout.
 * → prep для printCheckReport; сам стенд — runStand или `npm run stand -- --overlay … --cmd "ct start" --until …`
 * (PRINT_DONE) на другой машине.
 */
export async function printCheckPrepare(a, overlay) {
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

  const schemDir = path.join(overlay, 'schematics', 'uploaded', 'Test');
  fs.mkdirSync(schemDir, { recursive: true });
  const sites = [];
  const schems = [];
  let cursor = 200;
  for (const [n, id] of ids.entries()) {
    const f = await schematicFile(id, { edited: a.edited !== false });
    const file = `s${n + 1}.nbt`;
    fs.writeFileSync(path.join(schemDir, file), f.bytes);
    schems.push({ id: f.entry.id, name: f.entry.name, revision: f.entry.revision ?? null, size: f.size, sites: [] });
    for (const m of modes) {
      const x = cursor + 8;
      cursor = x + f.size[0] + 16;
      sites.push({ schem: n, file, size: f.size, blocks: f.blocks, x, z: 200, creative: m === 'creative' });
    }
  }
  const cfg = { delay, stall, sites: sites.map((s) => ({ ...s, restart, reset, replaceMode, prefill })) };
  const scripts = path.join(overlay, 'kubejs', 'server_scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(
    path.join(scripts, 'zz_print_check.js'),
    `var CT_CFG = ${JSON.stringify(cfg)}\n` + fs.readFileSync(HARNESS, 'utf8'),
  );
  const timeout = Math.max(120, Number(a.timeout ?? 2400) | 0);
  return {
    mode,
    replaceMode,
    reset,
    restart,
    delay,
    prefill,
    mods,
    edited: a.edited !== false,
    timeout,
    sites,
    schems,
  };
}

/** Конец харнесса в logs/kubejs/server.log (для `npm run stand -- --until`) */
export const PRINT_DONE = '\\[CT\\] (ВСЁ|ОШИБКА)';

/**
 * Проверка печати на этой машине: printCheckPrepare + runStand + printCheckReport. Ещё: exclude, memory, port, onLog.
 * → { text, result } (result — машиночитаемый итог)
 */
export async function printCheck(a) {
  if (busy) throw new Error('Стенд уже занят другим прогоном schematic_print_check — дождитесь его.');
  busy = true;
  const overlay = fs.mkdtempSync(path.join(os.tmpdir(), 'tfc-print-check-'));
  let prep;
  let r;
  try {
    prep = await printCheckPrepare(a, overlay);
    r = await runStand({
      commands: ['ct start'],
      mods: prep.mods,
      exclude: list(a.exclude),
      overlay,
      memory: a.memory ? String(a.memory) : undefined,
      ...(a.port ? { port: Number(a.port) | 0, rconPort: (Number(a.port) | 0) + 1 } : {}),
      onLog: a.onLog,
      waitFor: {
        timeout: prep.timeout,
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
  return printCheckReport(prep, r);
}

/**
 * Итог по логам прогона. r — { booted, run (папка с logs/), text (сводка стенда), waited }. → { text, result }
 */
export function printCheckReport(prep, r) {
  const { mode, replaceMode, reset, restart, delay, prefill, mods, timeout, sites } = prep;
  const schems = prep.schems.map((s) => ({ ...s, sites: [] }));
  const ct = r.booted ? readCt(r.run) : { events: [], plain: [], done: false, started: false };
  const logs = r.booted ? logExcerpts(r.run) : { load: '', harness: '' };
  const harnessError =
    ct.plain.find((l) => /^ОШИБКА/.test(l)) ?? (r.booted && !ct.started ? 'харнесс не стартовал' : '');
  const standLines = r.text.split('\n').filter((l) => STAND_LINE.test(l));
  const ctx = {
    booted: r.booted,
    done: ct.done,
    timeout,
    load: logs.load,
    harness: logs.harness,
    harnessError,
    standErr: standLines.join('\n').slice(0, 1500),
  };
  for (const [i, s] of sites.entries())
    schems[s.schem].sites.push(
      classify(
        s,
        ct.events.filter((e) => e.site === i),
        ctx,
      ),
    );
  for (const s of schems) {
    s.group = Math.max(...s.sites.map((x) => x.group));
    s.status = PRINT_STATUS[s.group].status;
  }
  const result = {
    version: 1,
    checkedAt: new Date().toISOString(),
    snapshot: r.text.match(/снимок (\S+?),/)?.[1] ?? null,
    params: {
      mode,
      restart,
      reset,
      replaceMode,
      delay,
      edited: prep.edited,
      mods: mods.map((m) => path.basename(m)),
      prefill,
    },
    stand: { booted: r.booted, waited: r.waited ?? null },
    schematics: schems,
  };

  const out = [
    `Печать схем пушкой Create на стенде (снимок ${result.snapshot ?? '?'}): задержка ${delay} тик., режим замены ${replaceMode} (${REPLACE_MODES[replaceMode]})` +
      `${restart ? ', повторный запуск' : ''}${reset ? `, сброс на ${Math.round(reset * 100)}%` : ''}` +
      `${prefill ? `, заливка ${prefill.block} ×${prefill.height} слоя` : ''}${mods.length ? `, свои jar: ${result.params.mods.join(', ')}` : ''}`,
  ];
  if (!r.booted) out.push('Сервер не поднялся — проверки нет.');
  else if (!ct.done) out.push(`Не дождался конца печати (${r.waited}) — ниже то, что успело.`);
  if (harnessError) out.push(`Харнесс: ${harnessError}`);
  for (const s of schems) {
    out.push('', `— ${s.name} (${s.id}, ${s.size.join('×')}): ${s.group} · ${PRINT_STATUS[s.group].text}`);
    for (const x of s.sites) {
      if (s.sites.length > 1 || x.mode === 'creative')
        out.push(` ${x.mode === 'creative' ? 'творческий ящик' : 'выживание'}: ${PRINT_STATUS[x.group].text}`);
      out.push(...siteText(x));
    }
  }
  out.push('', 'Стенд:', ...standLines.map((l) => '  ' + l));
  return { text: out.join('\n'), result };
}

async function schematicPrintCheck(a) {
  const { text, result } = await printCheck(a);
  const tail = [];
  if (a.save) {
    const f = path.resolve(String(a.save));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(result, null, 2));
    tail.push(`Итог JSON: ${f}`);
  }
  if (a.json) tail.push('JSON:', JSON.stringify(result));
  return [text, ...tail].join('\n');
}

export const TOOLS = [
  {
    name: 'schematic_print_check',
    description:
      'Print library schematics with the Create schematicannon on the whole-pack stand (pack_devserver, flat world, one cannon per schematic×mode in a row) and classify every problem by cause, worst group = schematic status: 1 ok (world matches, spend = materials, restart places nothing); 2 not_in_pack (blocks missing from the pack); 3 broken in ways the editor does not show (not_loaded, no_item, wrong_state, lost_data, restart_replaces); 4 unclear (missing, other_block, stuck, overspend, not_finished, stand_error) — each with block, cell count and an example cell or log excerpt. Survival mode tops up barrels from an exact bank and compares spend with requirements; restart re-runs the schematic over the finished build; reset presses «Стоп»→«Пуск» mid-print. Waits for completion (stall detection), not fixed sleeps. Machine-readable result: json=true or save=<path>. Slow: ~2 min boot + print time; one stand run at a time; call directly only. Needs npm run pack:fetch.',
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
        port: num(
          'server port, RCON = port+1 (default 25617/25616); with TFC_STAND_DIR — a second stand next to a running one',
        ),
        json: { type: 'boolean', description: 'append the machine-readable result (JSON) to the text' },
        save: str('write the machine-readable result (JSON) to this path'),
      },
      required: ['ids'],
    },
    handler: schematicPrintCheck,
  },
];
