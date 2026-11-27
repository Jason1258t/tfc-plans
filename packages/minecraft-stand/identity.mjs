/** Версия установленного инструмента по байтам, без git и рабочего checkout. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { digest } from './passport.mjs';
export async function installedIdentity(root = path.dirname(fileURLToPath(import.meta.url))) {
  const files = [];
  const walk = async (directory, prefix = '') => {
    for (const name of (await fs.readdir(directory)).sort()) {
      const rel = prefix + name;
      if (name.startsWith('.') || name === 'node_modules') continue;
      const full = path.join(directory, name);
      const st = await fs.lstat(full);
      if (st.isDirectory()) await walk(full, `${rel}/`);
      else if (st.isFile() && (name.endsWith('.mjs') || rel === 'package.json'))
        files.push({
          path: rel,
          sha256: createHash('sha256')
            .update(await fs.readFile(full))
            .digest('hex'),
        });
    }
  };
  await walk(root);
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  return { version: pkg.version, sha256: digest(files) };
}
