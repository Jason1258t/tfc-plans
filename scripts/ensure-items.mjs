// Запускает сборку библиотеки предметов, только если её ещё нет (перед dev/build)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

if (!fs.existsSync(new URL('../public/items.json', import.meta.url))) {
  console.log('[items] библиотека предметов не найдена — собираю (один раз, ~1 мин)…');
  execFileSync(process.execPath, [new URL('./build-items.mjs', import.meta.url).pathname], { stdio: 'inherit' });
}
