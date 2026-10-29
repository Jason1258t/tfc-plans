/** Файлы слоя KubeJS в порядке игры: ZIP по имени, затем обычный data/<namespace>/. */
import fs from 'node:fs';
import path from 'node:path';
import { inspectDatapack } from '@tfc/pack-server/datapacks';

export function kubejsDataFiles(root, label) {
  const base = path.join(root, 'data');
  const files = new Map();
  if (!fs.existsSync(base)) return files;
  const names = fs.readdirSync(base);
  const order = (a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
  for (const name of names.filter((n) => n.endsWith('.zip') && fs.statSync(path.join(base, n)).isFile()).sort(order)) {
    const pack = inspectDatapack(fs.readFileSync(path.join(base, name)));
    for (const [file, bytes] of Object.entries(pack.files)) {
      if (file.startsWith('data/'))
        files.set(file.slice(5), { text: bytes.toString('utf8'), source: `${label}/data/${name}` });
    }
  }
  function walk(dir, prefix) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = `${prefix}/${e.name}`;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else if (e.isFile())
        files.set(rel, { text: fs.readFileSync(path.join(dir, e.name), 'utf8'), source: `${label}/data` });
    }
  }
  for (const name of names) if (fs.statSync(path.join(base, name)).isDirectory()) walk(path.join(base, name), name);
  return files;
}
