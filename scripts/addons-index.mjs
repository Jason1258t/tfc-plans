#!/usr/bin/env node
/**
 * Список аддонов для программы tfc (`tfc pull addons`): src/lib/addons.ts + sha256 и размер jar из public/addons/
 * → public/addons/index.json. Запускается перед dev/build (после ensure-mods: в worktree jar берутся из основной копии).
 * Jar нет — аддон в список не попадает (предупреждение), сборка сайта не останавливается.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADDONS } from '../src/lib/addons.ts';

const DIR = fileURLToPath(new URL('../public/addons', import.meta.url));

export function addonsIndex(dir = DIR) {
  const addons = [];
  const missing = [];
  for (const a of ADDONS) {
    const file = path.basename(a.file);
    const jar = path.join(dir, file);
    if (!fs.existsSync(jar)) {
      missing.push(file);
      continue;
    }
    const bytes = fs.readFileSync(jar);
    addons.push({
      id: a.id,
      name: a.name,
      version: a.version,
      file,
      url: a.file,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      side: a.side,
      needs: a.needs,
      replaces: a.replaces ?? [],
    });
  }
  return { addons, missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { addons, missing } = addonsIndex();
  if (missing.length)
    console.warn(`[addons] нет jar в public/addons: ${missing.join(', ')} — в index.json их не будет`);
  if (fs.existsSync(DIR) || addons.length) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'index.json'), `${JSON.stringify({ addons }, null, 1)}\n`);
    console.log(
      `[addons] public/addons/index.json: ${addons.map((a) => `${a.id} ${a.version}`).join(', ') || 'пусто'}`,
    );
  }
}
