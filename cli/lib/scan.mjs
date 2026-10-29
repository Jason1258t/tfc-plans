/**
 * Что из папки игры входит в сборку и какие у файлов sha256.
 *
 * Путь в снимке — относительно папки версии через «/»; всё из мира — под префиксом `world/` (имя мира у всех
 * своё). serverconfig/ берётся из папки сервера профиля, если в инстансе его нет. Белый список — общий с сервером
 * сборки (server/pack-server/lib/paths.mjs), чтобы программа не предлагала то, что сервер всё равно отвергнет.
 *
 * Хеши кешируются в <версия>/.tfc/hashes.json по размеру и дате изменения: сотни МБ jar не перечитываются.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { classifyPath, isStatePath } from '@tfc/pack-server/paths';
import { isDir } from './detect.mjs';

/** Папки, которые обходим, и что внутри них не берём (сгенерированное модами, черновики программы) */
const TOP = ['mods', 'config', 'defaultconfigs', 'serverconfig', 'kubejs', 'resourcepacks'];
const SKIP = [/^kubejs\/(exported|probe|local)\//, /\.tfc-new$/, /^config\/.*\.(log|lock)$/i];

/** Где папка снимка лежит на диске */
export function rootsOf(profile) {
  const inst = profile.instance;
  const serverconfig =
    !isDir(path.join(inst, 'serverconfig')) && profile.serverDir && isDir(path.join(profile.serverDir, 'serverconfig'))
      ? profile.serverDir
      : inst;
  return { inst, world: profile.world || null, serverconfig };
}

/** Путь снимка → путь на диске (null — для этого пути нет места: мир не выбран) */
export function localPath(profile, snapPath) {
  const r = rootsOf(profile);
  if (snapPath.startsWith('world/')) return r.world ? path.join(r.world, ...snapPath.slice(6).split('/')) : null;
  if (snapPath.startsWith('serverconfig/')) return path.join(r.serverconfig, ...snapPath.split('/'));
  return path.join(r.inst, ...snapPath.split('/'));
}

export const stateDir = (profile) => path.join(profile.instance, '.tfc');

function walk(base, rel, out) {
  const dir = path.join(base, rel);
  if (!isDir(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(base, r, out);
    else if (e.isFile()) out.push(r);
  }
}

/**
 * Пути сборки в папке игры: [{ path, file, kind }], сколько пропущено вне белого списка и сколько — состояние
 * модов (кеши, история, личное: isStatePath), которое в сборку не входит
 */
export function listLocal(profile) {
  const r = rootsOf(profile);
  const found = [];
  for (const top of TOP) {
    const base = top === 'serverconfig' ? r.serverconfig : r.inst;
    const rels = [];
    walk(base, top, rels);
    for (const rel of rels) found.push({ path: rel, file: path.join(base, ...rel.split('/')) });
  }
  if (r.world) {
    const rels = [];
    walk(r.world, 'datapacks', rels);
    // Датапак-папка и датапак-zip: берём файлы как есть
    for (const rel of rels) found.push({ path: `world/${rel}`, file: path.join(r.world, ...rel.split('/')) });
    const cal = path.join(r.world, 'data', 'tfc_calendar.dat');
    if (fs.existsSync(cal)) found.push({ path: 'world/data/tfc_calendar.dat', file: cal });
  }
  const files = [];
  let skipped = 0;
  let state = 0;
  for (const f of found) {
    if (SKIP.some((re) => re.test(f.path))) continue;
    if (isStatePath(f.path)) {
      state++;
      continue;
    }
    const c = classifyPath(f.path);
    if (c.error) skipped++;
    else files.push({ ...f, kind: c.kind });
  }
  return { files, skipped, state };
}

/** sha256 файла потоком */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

/** Кеш хешей: путь на диске → { size, mtimeMs, sha256 } */
export class HashCache {
  constructor(profile) {
    this.file = path.join(stateDir(profile), 'hashes.json');
    try {
      this.map = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.map = {};
    }
    this.dirty = false;
  }
  async hash(file) {
    const st = fs.statSync(file);
    const c = this.map[file];
    if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.sha256;
    const sha256 = await sha256File(file);
    this.map[file] = { size: st.size, mtimeMs: st.mtimeMs, sha256 };
    this.dirty = true;
    return sha256;
  }
  /** Файл только что записан нами с известным хешем — не перечитывать */
  remember(file, sha256) {
    const st = fs.statSync(file);
    this.map[file] = { size: st.size, mtimeMs: st.mtimeMs, sha256 };
    this.dirty = true;
  }
  save() {
    if (!this.dirty) return;
    for (const f of Object.keys(this.map)) if (!fs.existsSync(f)) delete this.map[f];
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.map));
    this.dirty = false;
  }
}

/** Файлы сборки с хешами: Map путь снимка → { path, file, kind, size, sha256 } */
export async function scanLocal(profile, { onProgress } = {}) {
  const { files, skipped, state } = listLocal(profile);
  const cache = new HashCache(profile);
  const out = new Map();
  let i = 0;
  for (const f of files) {
    const sha256 = await cache.hash(f.file);
    out.set(f.path, { ...f, size: fs.statSync(f.file).size, sha256 });
    onProgress?.(++i, files.length);
  }
  cache.save();
  return { files: out, skipped, state, cache };
}
