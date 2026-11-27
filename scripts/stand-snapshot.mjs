/** Закреплённая сборка задания: manifest и отдельная копия, не общий изменяемый кеш. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const manifestHash = (manifest) => createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
export function checkManifest(manifest) {
  if (!/^[\w-]+$/.test(manifest?.id ?? '') || !Array.isArray(manifest.files) || !manifest.files.length)
    throw new Error('Некорректный manifest снимка');
  const seen = new Set();
  for (const f of manifest.files) {
    if (
      !f.path ||
      f.path.startsWith('.') ||
      f.path.includes('\\') ||
      f.path.split('/').some((s) => !s || s === '.' || s === '..') ||
      path.isAbsolute(f.path) ||
      !/^[a-f0-9]{64}$/.test(f.sha256) ||
      !Number.isSafeInteger(f.size) ||
      f.size < 0 ||
      seen.has(f.path)
    )
      throw new Error(`Некорректный файл снимка: ${f.path}`);
    seen.add(f.path);
  }
  return manifest;
}
export async function selectSnapshot(refs, requested, server = process.env) {
  const inherited = refs.filter(Boolean).map((j) => {
    if (!j.snapshot?.manifest)
      throw new Error(`У исходного задания ${j.id} нет закреплённого снимка; нужен новый прогон`);
    checkManifest(j.snapshot.manifest);
    if (j.snapshot.id !== j.snapshot.manifest.id || manifestHash(j.snapshot.manifest) !== j.snapshot.sha256)
      throw new Error('Изменён manifest исходного задания');
    return j.snapshot;
  });
  if (
    inherited.some((s) => s.sha256 !== inherited[0].sha256) ||
    (requested && inherited.length && requested !== inherited[0].id)
  )
    throw new Error('Связанные задания используют разные снимки');
  if (inherited.length) return inherited[0];
  if (!server.TFC_PACK_URL || !server.TFC_PACK_TOKEN)
    throw new Error('Нет доступа к серверу сборки для закрепления снимка');
  const endpoint = requested ? `/pack/snapshots/${encodeURIComponent(requested)}` : '/pack/current';
  const res = await fetch(`${server.TFC_PACK_URL.replace(/\/$/, '')}${endpoint}`, {
    headers: { Authorization: `Bearer ${server.TFC_PACK_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Не удалось закрепить снимок: HTTP ${res.status}`);
  const manifest = checkManifest(await res.json());
  if (requested && manifest.id !== requested) throw new Error('Сервер вернул другой снимок');
  return { id: manifest.id, sha256: manifestHash(manifest), manifest };
}
export function verifySnapshot(dir, snapshot) {
  try {
    checkManifest(snapshot.manifest);
    if (manifestHash(snapshot.manifest) !== snapshot.sha256) return false;
    const metadata = JSON.parse(fs.readFileSync(path.join(dir, '.tfc-fetch.json')));
    if (
      metadata.snapshot !== snapshot.id ||
      metadata.mc !== snapshot.manifest.mc ||
      metadata.loader !== snapshot.manifest.loader
    )
      return false;
    if (manifestHash(JSON.parse(fs.readFileSync(path.join(dir, '.tfc-manifest.json')))) !== snapshot.sha256)
      return false;
    const expected = new Set(snapshot.manifest.files.map((f) => f.path));
    const walk = (base, prefix = '') =>
      fs.readdirSync(base).every((name) => {
        const rel = prefix + name;
        if (!prefix && ['.tfc-fetch.json', '.tfc-manifest.json'].includes(name)) return true;
        const st = fs.lstatSync(path.join(base, name));
        return st.isDirectory() ? walk(path.join(base, name), `${rel}/`) : st.isFile() && expected.has(rel);
      });
    return (
      walk(dir) &&
      snapshot.manifest.files.every((f) => {
        const file = path.join(dir, f.path);
        return (
          fs.lstatSync(file).isFile() &&
          fs.statSync(file).size === f.size &&
          createHash('sha256').update(fs.readFileSync(file)).digest('hex') === f.sha256
        );
      })
    );
  } catch {
    return false;
  }
}
