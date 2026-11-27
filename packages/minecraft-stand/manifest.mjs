/** Закреплённый список файлов сборки, без зависимости от источника доставки. */
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
