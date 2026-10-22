#!/usr/bin/env node
/**
 * Аддоны на сайт: карточки tools/<мод>/addon.json → jar (tools/<мод>/<jar>) и иконки (tools/<мод>/icons/) в
 * public/addons/ + список для программы tfc (`tfc pull addons`, sha256 и размер jar) → public/addons/index.json.
 * Запускается перед dev/build. Старые версии jar в public/addons не трогает (ссылки на них остаются рабочими).
 * Jar нет — аддон в список не попадает (предупреждение), сборка сайта не останавливается. Так же не попадают
 * повтор id, имя jar, которое tfc не примет, и unlisted (jar на сайте есть, но всем его не ставить).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = path.join(ROOT, 'public/addons');

/** Карточки аддонов из tools/<мод>/addon.json; source — папка от корня репозитория, dir — полный путь */
export function addonCards(root = ROOT) {
  const tools = path.join(root, 'tools');
  return fs
    .readdirSync(tools, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(tools, d.name, 'addon.json')))
    .map((d) => {
      const dir = path.join(tools, d.name);
      const card = JSON.parse(fs.readFileSync(path.join(dir, 'addon.json'), 'utf8'));
      return { ...card, source: `tools/${d.name}`, dir };
    })
    .sort((a, b) => a.order - b.order);
}

export function addonsIndex(root = ROOT, dir = DIR) {
  const addons = [];
  const missing = [];
  const warnings = [];
  const ids = new Set();
  for (const a of addonCards(root)) {
    // Те же требования, что у tfc (cli/lib/pull.mjs wantedAddons): иначе программа аддон молча пропустит
    if (!/^[\w.+-]+\.jar$/.test(a.jar ?? '')) {
      warnings.push(`${a.source}: jar «${a.jar}» — имя без пробелов и папок, на .jar`);
      continue;
    }
    if (ids.has(a.id)) {
      warnings.push(`${a.source}: id ${a.id} уже есть у другого аддона — пропущен`);
      continue;
    }
    ids.add(a.id);
    if (!a.jar.includes(a.version)) warnings.push(`${a.source}: в имени ${a.jar} нет версии ${a.version}`);
    const src = path.join(a.dir, a.jar);
    const jar = path.join(dir, a.jar);
    if (fs.existsSync(src)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(src, jar);
    }
    const icons = path.join(a.dir, 'icons');
    if (fs.existsSync(icons)) fs.cpSync(icons, path.join(dir, 'icons', a.id), { recursive: true });
    if (!fs.existsSync(jar)) {
      missing.push(`${a.source}/${a.jar}`);
      continue;
    }
    if (a.unlisted) continue;
    const bytes = fs.readFileSync(jar);
    addons.push({
      id: a.id,
      name: a.name,
      version: a.version,
      file: a.jar,
      url: `/addons/${a.jar}`,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      side: a.side,
      needs: a.needs,
      replaces: a.replaces ?? [],
    });
  }
  return { addons, missing, warnings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { addons, missing, warnings } = addonsIndex();
  for (const w of warnings) console.warn(`[addons] ${w}`);
  if (missing.length) console.warn(`[addons] нет jar: ${missing.join(', ')} — в index.json их не будет`);
  if (fs.existsSync(DIR) || addons.length) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'index.json'), `${JSON.stringify({ addons }, null, 1)}\n`);
    console.log(
      `[addons] public/addons/index.json: ${addons.map((a) => `${a.id} ${a.version}`).join(', ') || 'пусто'}`,
    );
  }
}
