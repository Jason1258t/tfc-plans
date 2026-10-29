#!/usr/bin/env node
/**
 * Разбор сохранения мира → Firestore config (scope world): то, что живёт не в конфигах, а в самом мире.
 * Сейчас — календарь TFC (data/tfc_calendar.dat): длину месяца на сервере меняют командой, и в конфиге её нет.
 *
 *   npm run world -- <папка мира | world/data | tfc_calendar.dat | zip с любым из них>
 *   … --dry-run   — показать, что будет записано, без записи
 *
 * Документ config/world__<имя файла>: { scope: 'world', path, mod, values (NBT как обычный объект), … }.
 * Берутся только файлы из списка WANTED: в data/ мира лежит много лишнего и личного (игроки, команды, карты).
 * Из кода: worldDocs(вход) — документы без записи, importWorld({ input, dryRun }) — разбор и запись.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { fileURLToPath } from 'node:url';
import { deployer, writeConfigDocs } from './firestore-rest.mjs';
import { readNbt, T } from '@tfc/core/nbt';

const log = (...a) => console.log('[world]', ...a);

/** Какие файлы сохранения читаем: имя файла → мод */
export const WANTED = { 'tfc_calendar.dat': 'tfc' };

function readInput(input) {
  const files = [];
  if (fs.statSync(input).isDirectory()) {
    const walk = (dir, depth) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        // Глубже data/ не ходим: регионы и игроки не нужны
        if (e.isDirectory()) {
          if (depth < 2 && !/^(region|entities|poi|playerdata|stats|advancements)$/.test(e.name)) walk(full, depth + 1);
        } else if (e.name in WANTED) files.push({ name: e.name, data: fs.readFileSync(full) });
      }
    };
    walk(input, 0);
  } else if (/\.zip$/i.test(input)) {
    const entries = unzipSync(new Uint8Array(fs.readFileSync(input)), {
      filter: (f) => path.basename(f.name) in WANTED,
    });
    for (const [name, data] of Object.entries(entries)) files.push({ name: path.basename(name), data });
  } else if (path.basename(input) in WANTED) files.push({ name: path.basename(input), data: fs.readFileSync(input) });
  return files;
}

/** NBT → обычный объект; длинные целые — числом, если помещаются, иначе строкой */
function plain(tag) {
  const v = tag.value;
  if (tag.type === T.Compound) return Object.fromEntries([...v].map(([k, x]) => [k, plain(x)]));
  if (tag.type === T.List) return v.map(plain);
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : String(v);
  if (ArrayBuffer.isView(v)) return Array.from(v, (x) => (typeof x === 'bigint' ? Number(x) : x));
  return v;
}

/** Документы config/world__… из папки мира, data/, файла или zip; [] — если нужных файлов нет */
export async function worldDocs(input) {
  const files = readInput(input);
  const by = deployer('import');
  const docs = [];
  for (const f of files) {
    const { root } = await readNbt(new Uint8Array(f.data));
    const values = plain({ type: T.Compound, value: root.value });
    docs.push({
      id: `world__${f.name}`,
      data: {
        scope: 'world',
        path: f.name,
        mod: WANTED[f.name],
        values,
        sha1: createHash('sha1').update(f.data).digest('hex'),
        source: path.basename(input),
        importedBy: by,
        importedAt: Date.now(),
      },
    });
    log(`${f.name}: ${JSON.stringify(values).slice(0, 600)}`);
  }
  return docs;
}

export async function importWorld({ input, dryRun = false }) {
  const docs = await worldDocs(input);
  if (!docs.length)
    throw new Error(`не найдено ни одного файла из списка: ${Object.keys(WANTED).join(', ')} (лежат в <мир>/data/)`);
  if (dryRun) {
    log('--dry-run, ничего не записываю');
    return docs;
  }
  await writeConfigDocs(docs);
  log(`записано документов: ${docs.length}`);
  return docs;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const input = argv.find((a) => !a.startsWith('--'));
  (input
    ? importWorld({ input, dryRun: argv.includes('--dry-run') })
    : Promise.reject(new Error('укажите папку мира, файл или zip: npm run world -- <путь>'))
  ).catch((e) => {
    console.error('[world]', e.message ?? e);
    process.exit(1);
  });
}
