/**
 * Проверка новой версии tfc: читает version.json с сайта (его кладёт туда npm run tfc:dist) раз в сутки, а перед
 * командой — ещё и раз за сеанс терминала (для автообновления, cli/lib/upgrade.mjs → autoUpgrade).
 * Ошибка сети — молча: программа должна работать и без сайта. Ответ запоминается в папке настроек,
 * поэтому подсказка показывается при каждом запуске, пока файл не обновят.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { configDir } from './config.mjs';
import { dim, yellow } from './ui.mjs';
import { BUILD, CHANNEL, targetName } from './version.mjs';

export const SITE = 'https://tfc-plans-fd2c.web.app';
const DAY = 24 * 3600 * 1000;
/** Не чаще: оболочка-обёртка (tfc.cmd от npm, скрипт) даёт новый «сеанс» на каждый запуск */
const SESSION_MIN = 10 * 60 * 1000;

/** Сеанс терминала — процесс-родитель (оболочка, из которой запустили tfc) */
const session = () => process.ppid;
/**
 * GET JSON с жёстким пределом времени. Не fetch: тот после отмены держит недоконнекченный сокет и не даёт
 * программе завершиться ещё ~10 с, а здесь сокет обрывается сразу.
 */
export function getJson(url, ms) {
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
 * Что последнее на сайте: { version, time, files } или null (нет сети). В сеть — не дольше 3 с и только когда
 * пора: force, прошли сутки или (perSession) это новый сеанс терминала. Только для собранного файла:
 * из исходников обновляются через git.
 */
export async function latest({ force = false, perSession = false } = {}) {
  if (!BUILD || process.env.TFC_NO_UPDATE_CHECK) return null;
  let cache = readCache();
  const age = cache ? Date.now() - cache.checkedAt : Infinity;
  if (force || !(age < DAY) || (perSession && cache.session !== session() && age > SESSION_MIN)) {
    try {
      const url = process.env.TFC_UPDATE_URL || `${SITE}/tfc/version.json`;
      const remote = await getJson(url, 3000);
      cache = {
        checkedAt: Date.now(),
        session: session(),
        version: remote.version,
        time: remote.time,
        files: remote.files,
      };
      fs.mkdirSync(configDir(), { recursive: true });
      fs.writeFileSync(cacheFile(), `${JSON.stringify(cache, null, 2)}\n`);
    } catch {
      return null; // нет сети, сайт недоступен — не мешаем работе
    }
  }
  return cache;
}

/** Есть ли версия новее этой */
export const isNewer = (remote) => Boolean(remote?.time && BUILD && remote.time > BUILD.time);

/** Запускает проверку. Возвращает Promise с текстом подсказки или null. */
export async function checkUpdate({ force = false } = {}) {
  const cache = await latest({ force });
  if (!isNewer(cache)) return null;
  const file = cache.files?.[targetName()]?.file;
  const manual =
    CHANNEL === 'npm'
      ? `npm install -g ${SITE}/tfc/tfc.tgz`
      : `скачайте ${file ? `${SITE}/tfc/${file}` : `с ${SITE}/updates`} и замените им старый файл`;
  return [
    yellow(`Вышла новая версия tfc: ${cache.version} (у вас ${BUILD.version}).`),
    dim(`  Обновить: tfc --upgrade (или ${manual}).`),
  ].join('\n');
}
