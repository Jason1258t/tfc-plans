/**
 * Снимок сборки (public/pack-manifest.json): моды с версиями, id предметов, отпечатки рецептов.
 * По разнице снимков scripts/pack-release.mjs при деплое пишет запись об обновлении сборки.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

/** FNV-1a 32 бита — такой же считает сайт (src/lib/hash.ts), чтобы сверять рецепты датапаков со сборкой */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Первая [[mods]] секция neoforge.mods.toml: modId, displayName, version (без полноценного TOML-парсера) */
function modsToml(text) {
  const block = text.split(/^\s*\[\[mods\]\].*$/m)[1]?.split(/^\s*\[\[?\w/m)[0] ?? '';
  const field = (name) => {
    const m = block.match(new RegExp(`^\\s*${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'm'));
    return m ? (m[1] ?? m[2]) : null;
  };
  return { id: field('modId'), name: field('displayName'), version: field('version') };
}

/** Версия из имени файла: «create-1.21.1-6.0.10.jar» → «6.0.10» (последняя группа цифр с точками, не версия MC) */
function versionFromName(file) {
  const parts = path.basename(file, '.jar').match(/\d+(?:\.\d+)+(?:[-+][\w.]+)?/g) ?? [];
  return parts.filter((p) => p !== '1.21.1' && p !== '1.21').at(-1) ?? null;
}

function modInfo(file) {
  let toml = null;
  let implVersion = null;
  try {
    const zip = new AdmZip(file);
    const t = zip.getEntry('META-INF/neoforge.mods.toml');
    if (t) toml = modsToml(t.getData().toString('utf8'));
    const mf = zip.getEntry('META-INF/MANIFEST.MF');
    if (mf)
      implVersion =
        mf
          .getData()
          .toString('utf8')
          .match(/^Implementation-Version:\s*(.+)$/m)?.[1]
          ?.trim() ?? null;
  } catch {
    /* не zip — версия из имени */
  }
  const placeholder = (v) => !v || v.includes('${');
  return {
    id: toml?.id ?? path.basename(file, '.jar'),
    name: toml?.name ?? toml?.id ?? path.basename(file, '.jar'),
    version: !placeholder(toml?.version) ? toml.version : (implVersion ?? versionFromName(file) ?? '?'),
  };
}

/** sha1 jar (для поиска версии на Modrinth); кеш по имени+размеру+дате */
function sha1s(files, cacheFile) {
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    /* пусто */
  }
  const next = {};
  const out = {};
  for (const f of files) {
    const st = fs.statSync(f);
    const key = `${path.basename(f)}:${st.size}:${Math.round(st.mtimeMs)}`;
    next[key] = cache[key] ?? createHash('sha1').update(fs.readFileSync(f)).digest('hex');
    out[f] = next[key];
  }
  fs.writeFileSync(cacheFile, JSON.stringify(next));
  return out;
}

export function writeManifest({ jarPaths, items, recipes, outFile, cacheDir }) {
  const hashes = sha1s(jarPaths, path.join(cacheDir, 'jar-sha1.json'));
  const mods = jarPaths.map((f) => ({ ...modInfo(f), jar: path.basename(f), sha1: hashes[f] }));
  const recipeHashes = {};
  const types = new Set();
  for (const [id, r] of [...recipes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    recipeHashes[id] = fnv1a(JSON.stringify(r.json));
    if (typeof r.json.type === 'string') types.add(r.json.type);
  }
  const manifest = {
    version: 1,
    builtAt: Date.now(),
    mods: mods.sort((a, b) => a.id.localeCompare(b.id)),
    items: items.map((i) => i.i).sort(),
    recipes: recipeHashes,
    recipeTypes: [...types].sort(),
  };
  fs.writeFileSync(outFile, JSON.stringify(manifest));
  return manifest;
}
