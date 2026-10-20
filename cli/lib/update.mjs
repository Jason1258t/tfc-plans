/**
 * Проверка новой версии tfc: раз в сутки читает version.json с сайта (его кладёт туда npm run tfc:dist).
 * Ошибка сети — молча: программа должна работать и без сайта. Ответ запоминается в папке настроек,
 * поэтому подсказка показывается при каждом запуске, пока файл не обновят, а в сеть — не чаще раза в сутки.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { configDir } from './config.mjs';
import { dim, yellow } from './ui.mjs';
import { BUILD, targetName } from './version.mjs';

export const SITE = 'https://tfc-plans-fd2c.web.app';
const DAY = 24 * 3600 * 1000;
/**
 * GET JSON с жёстким пределом времени. Не fetch: тот после отмены держит недоконнекченный сокет и не даёт
 * программе завершиться ещё ~10 с, а здесь сокет обрывается сразу.
 */
function getJson(url, ms) {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('https:') ? https : http).get(
      url,
      { headers: { 'Cache-Control': 'no-cache' } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(String(res.statusCode)));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(ms, () => req.destroy(new Error('timeout')));
    const timer = setTimeout(() => req.destroy(new Error('timeout')), ms);
    req.on('close', () => clearTimeout(timer));
  });
}

const cacheFile = () => path.join(configDir(), 'update-check.json');

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Запускает проверку (не ждёт сеть дольше 3 с). Возвращает Promise с текстом подсказки или null.
 * Только для собранного файла: из исходников обновляются через git.
 */
export async function checkUpdate({ force = false } = {}) {
  if (!BUILD || process.env.TFC_NO_UPDATE_CHECK) return null;
  let cache = readCache();
  if (force || !cache || !(Date.now() - cache.checkedAt < DAY)) {
    try {
      const url = process.env.TFC_UPDATE_URL || `${SITE}/tfc/version.json`;
      const remote = await getJson(url, 3000);
      cache = { checkedAt: Date.now(), version: remote.version, time: remote.time, files: remote.files };
      fs.mkdirSync(configDir(), { recursive: true });
      fs.writeFileSync(cacheFile(), `${JSON.stringify(cache, null, 2)}\n`);
    } catch {
      return null; // нет сети, сайт недоступен — не мешаем работе
    }
  }
  if (!cache?.time || !(cache.time > BUILD.time)) return null;
  const file = cache.files?.[targetName()]?.file;
  return [
    yellow(`Вышла новая версия tfc: ${cache.version} (у вас ${BUILD.version}).`),
    dim(`  Скачайте ${file ? `${SITE}/tfc/${file}` : `с ${SITE}/updates`} и замените им старый файл.`),
  ].join('\n');
}
