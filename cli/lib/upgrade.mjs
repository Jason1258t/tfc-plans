/**
 * `tfc --upgrade` — самообновление собранного файла: version.json с сайта → zip своей системы → сверка sha256 →
 * новый файл рядом → проверочный запуск `--version` → замена. Старый файл не теряется, пока новый не запустился.
 * Windows не даёт перезаписать запущенный exe, но даёт переименовать: старый уходит в tfc.exe.old и удаляется
 * при следующем запуске (cleanupOld).
 * Пакет npm обновляется самим npm: npm install -g <пакет с сайта>.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { configDir } from './config.mjs';
import { mb, progress } from './ui.mjs';
import { getJson, SITE } from './update.mjs';
import { BUILD, CHANNEL, IS_BINARY, targetName } from './version.mjs';

const self = () => process.execPath;

/** Остаток прошлого обновления на Windows */
export function cleanupOld() {
  if (!IS_BINARY) return;
  try {
    fs.rmSync(`${self()}.old`, { force: true });
  } catch {
    // ещё занят — уберём в другой раз
  }
}

async function download(url, size) {
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`не скачался ${url}: ${res.status}`);
  const bar = progress('загрузка', size || Number(res.headers.get('content-length')) || 0);
  const parts = [];
  for await (const chunk of res.body) {
    parts.push(chunk);
    bar.add(chunk.length);
  }
  bar.end();
  return Buffer.concat(parts);
}

/** { from, to, path } — обновлено; null — уже последняя */
export async function upgrade({ force = false } = {}) {
  if (CHANNEL === 'source')
    throw new Error('это запуск из исходников (node cli/tfc.mjs) — обновляется через git pull, а не --upgrade');
  const base = process.env.TFC_UPDATE_URL || `${SITE}/tfc/version.json`;
  let remote;
  try {
    remote = await getJson(base, 15_000);
  } catch (e) {
    throw new Error(`не удалось узнать новую версию (${base}): ${e.message}`);
  }
  if (CHANNEL === 'npm') return upgradeNpm(remote, base, force);
  const target = targetName();
  const info = remote.files?.[target];
  if (!info?.file) throw new Error(`для этой системы (${target}) на сайте файла нет`);
  if (!force && !(remote.time > BUILD.time)) return null;

  const file = self();
  const dir = path.dirname(file);
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    throw new Error(`нет прав на запись в ${dir} — переложите tfc в свою папку или обновите вручную`);
  }

  console.log(`Скачиваю ${remote.version} (${mb(info.size)})`);
  const zip = await download(new URL(info.file, base).href, info.size);
  const sha = createHash('sha256').update(zip).digest('hex');
  if (info.sha256 && sha !== info.sha256)
    throw new Error('файл пришёл повреждённым (контрольная сумма не сошлась) — запустите ещё раз');
  const entries = unzipSync(new Uint8Array(zip));
  const name = process.platform === 'win32' ? 'tfc.exe' : 'tfc';
  const bin = entries[name] ?? Object.values(entries)[0];
  if (!bin?.length) throw new Error('в скачанном zip нет программы');

  const fresh = `${file}.new`;
  fs.writeFileSync(fresh, bin, { mode: fs.statSync(file).mode | 0o755 });
  // Проверочный запуск: битый файл не заменит рабочий
  try {
    execFileSync(fresh, ['--version'], {
      env: { ...process.env, TFC_NO_UPDATE_CHECK: '1' },
      stdio: 'pipe',
      timeout: 30_000,
    });
  } catch (e) {
    fs.rmSync(fresh, { force: true });
    throw new Error(`новая версия не запустилась, оставляю прежнюю: ${e.message}`);
  }
  if (process.platform === 'win32') {
    fs.rmSync(`${file}.old`, { force: true });
    fs.renameSync(file, `${file}.old`);
    try {
      fs.renameSync(fresh, file);
    } catch (e) {
      fs.renameSync(`${file}.old`, file);
      throw e;
    }
  } else fs.renameSync(fresh, file);
  // Подсказка «вышла новая версия» больше не нужна
  fs.rmSync(path.join(configDir(), 'update-check.json'), { force: true });
  return { from: BUILD.version, to: remote.version, path: file };
}

/** Пакет npm: npm install -g с сайта (тот же адрес, что в инструкции) */
function upgradeNpm(remote, base, force) {
  if (!remote.npm?.file) throw new Error('на сайте нет пакета npm');
  if (!force && !(remote.time > BUILD.time)) return null;
  const url = new URL(remote.npm.file, base).href;
  console.log(`Ставлю ${remote.version}: npm install -g ${url}`);
  // npm на Windows — npm.cmd, его запускает только оболочка
  const r = spawnSync('npm', ['install', '-g', url], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.error) throw new Error(`npm не запустился: ${r.error.message}`);
  if (r.status !== 0)
    throw new Error(
      `npm install завершился с ошибкой (код ${r.status})` +
        (process.platform === 'win32' ? '' : ' — если не хватило прав, запустите ту же команду через sudo'),
    );
  fs.rmSync(path.join(configDir(), 'update-check.json'), { force: true });
  return { from: BUILD.version, to: remote.version, path: 'npm (глобальный пакет)' };
}
