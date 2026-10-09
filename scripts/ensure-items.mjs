// Перед dev/build: пересобирает библиотеку предметов, если её нет или поменялось содержимое mods/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SIGNATURE_FILE, modsSignature } from './build-items.mjs';

const itemsJson = fileURLToPath(new URL('../public/items.json', import.meta.url));
const recipesJson = fileURLToPath(new URL('../public/recipes.json', import.meta.url));
const referenceJson = fileURLToPath(new URL('../public/reference.json', import.meta.url));
const manifestJson = fileURLToPath(new URL('../public/pack-manifest.json', import.meta.url));
const geoJson = fileURLToPath(new URL('../public/geo.json', import.meta.url));
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
else if (!fs.existsSync(referenceJson)) reason = 'справочник не найден';
else if (!fs.existsSync(manifestJson)) reason = 'снимок сборки не найден';
else if (!fs.existsSync(geoJson)) reason = 'география не найдена';
else if (previous !== null && previous !== current) reason = 'набор модов в mods/ изменился';
else if (previous === null && current !== '[]') reason = 'в mods/ появились моды';

if (reason) {
  console.log(`[items] ${reason} — пересобираю…`);
  execFileSync(process.execPath, [fileURLToPath(new URL('./build-items.mjs', import.meta.url))], {
    stdio: 'inherit',
  });
}

// Скрипты KubeJS импортированы (instance/kubejs), а разбора нет — пересобрать public/kubejs.json
const kubejsJson = fileURLToPath(new URL('../public/kubejs.json', import.meta.url));
if (fs.existsSync(fileURLToPath(new URL('../instance/kubejs', import.meta.url))) && !fs.existsSync(kubejsJson)) {
  console.log('[kubejs] разбор скриптов не найден — собираю…');
  execFileSync(process.execPath, [fileURLToPath(new URL('./kubejs.mjs', import.meta.url))], { stdio: 'inherit' });
}
