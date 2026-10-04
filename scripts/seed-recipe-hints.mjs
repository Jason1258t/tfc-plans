#!/usr/bin/env node
/**
 * Заливает подсказки по типам рецептов из scripts/recipe-hints.json в Firestore (коллекция recipeHints).
 * Авторизация — от имени залогиненного firebase CLI (`firebase login`), правила Firestore не мешают.
 * Подсказки, которые с тех пор правил человек или агент (source ≠ "claude"), не перезаписываются.
 *
 *   node scripts/seed-recipe-hints.mjs            — залить/обновить
 *   node scripts/seed-recipe-hints.mjs --force    — перезаписать и правки людей/агента
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default;
const force = process.argv.includes('--force');

const require = createRequire(import.meta.url);
const fbRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const auth = require(path.join(fbRoot, 'firebase-tools/lib/auth'));

/** id документа = тип рецепта, где «:» и «/» недопустимы в id Firestore */
export const hintDocId = (type) => type.replaceAll(':', '__').replaceAll('/', '--');

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/recipeHints`;

async function main() {
  const acc = auth.getGlobalDefaultAccount();
  if (!acc) throw new Error('Нужно выполнить firebase login');
  const { access_token } = await auth.getAccessToken(acc.tokens.refresh_token, [
    'https://www.googleapis.com/auth/cloud-platform',
  ]);
  const headers = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };
  const hints = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/recipe-hints.json'), 'utf8'));
  let written = 0;
  let skipped = 0;
  for (const h of hints) {
    const url = `${BASE}/${hintDocId(h.type)}`;
    const existing = await fetch(url, { headers });
    if (existing.ok && !force) {
      const src = (await existing.json()).fields?.source?.stringValue;
      if (src && src !== 'claude') {
        skipped++;
        continue;
      }
    }
    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        fields: {
          type: { stringValue: h.type },
          title: { stringValue: h.title },
          body: { stringValue: h.body },
          source: { stringValue: 'claude' },
          updatedBy: { stringValue: 'Claude' },
          updatedAt: { integerValue: String(Date.now()) },
        },
      }),
    });
    if (!res.ok) throw new Error(`${h.type}: ${res.status} ${await res.text()}`);
    written++;
  }
  console.log(`[hints] записано ${written}, пропущено (правили люди/агент) ${skipped}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
