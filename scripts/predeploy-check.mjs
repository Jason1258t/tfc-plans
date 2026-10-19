#!/usr/bin/env node
/**
 * Проверка собранного dist/ перед выкладкой (predeploy в firebase.json, после сборки): сайт должен быть собран
 * с настройками Firebase из .env.local. Без них он работает в запасном режиме на localStorage — у всех игроков
 * пропали бы общие задачи. Так бывает при деплое из git worktree, куда .env.local не попадает (его нет в git).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT, ROOT } from './firestore-rest.mjs';

const assets = path.join(ROOT, 'dist', 'assets');
const files = fs.existsSync(assets) ? fs.readdirSync(assets).filter((f) => f.endsWith('.js')) : [];
const ok = files.some((f) => fs.readFileSync(path.join(assets, f), 'utf8').includes(PROJECT));
if (!ok) {
  console.error(
    `[predeploy] в dist/ нет настроек Firebase проекта ${PROJECT}: сайт собран без .env.local и работал бы без общей базы.\n` +
      '[predeploy] Положите .env.local (в git worktree его берёт из основной копии сборка — npm run build) и запустите деплой снова.',
  );
  process.exit(1);
}
console.log(`[predeploy] настройки Firebase в сборке есть (${PROJECT})`);
