// Перед dev/build: пересобирает библиотеку предметов, если её нет или поменялось содержимое mods/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SIGNATURE_FILE, modsSignature } from './build-items.mjs';

const itemsJson = fileURLToPath(new URL('../public/items.json', import.meta.url));
const recipesJson = fileURLToPath(new URL('../public/recipes.json', import.meta.url));
const current = JSON.stringify(modsSignature());
let previous = null;
try {
  previous = fs.readFileSync(SIGNATURE_FILE, 'utf8');
} catch {
  /* ещё не собирали */
}

let reason = null;
if (!fs.existsSync(itemsJson)) reason = 'библиотека предметов не найдена';
else if (!fs.existsSync(recipesJson)) reason = 'каталог рецептов не найден';
else if (previous !== null && previous !== current) reason = 'набор модов в mods/ изменился';
else if (previous === null && current !== '[]') reason = 'в mods/ появились моды';

if (reason) {
  console.log(`[items] ${reason} — пересобираю…`);
  execFileSync(process.execPath, [fileURLToPath(new URL('./build-items.mjs', import.meta.url))], {
    stdio: 'inherit',
  });
}
