/**
 * Ресурсы Minecraft и NeoForge для объёмных иконок там, где нет NeoForge platform из сборки аддона (tools/<мод>/build/…),
 * — прежде всего на сервере сборки. Генератору нужны только assets/: текстуры сущностей (сундуки, кровати, головы)
 * из client.jar Minecraft и модели neoforge:item/* (вёдра) из universal jar NeoForge. Классы не нужны.
 *
 * Качается один раз в <cacheDir>/platform/, со сверкой sha1 (Mojang — из метаданных версии, NeoForge — файл .sha1
 * рядом в maven). Не скачалось — иконки этих предметов остаются текстурой, сборка не падает.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

async function get(url, as = 'buffer') {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  if (as === 'json') return r.json();
  if (as === 'text') return r.text();
  return Buffer.from(await r.arrayBuffer());
}

/** Файл из кеша или скачанный (want — ожидаемый sha1 или функция, которая его даст) */
async function cached(file, url, want) {
  if (fs.existsSync(file)) return file;
  const buf = await get(url);
  const expected = typeof want === 'function' ? await want() : want;
  if (expected && sha1(buf) !== expected) throw new Error(`не сошлась контрольная сумма ${path.basename(file)}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, buf);
  fs.renameSync(`${file}.part`, file);
  return file;
}

/**
 * mc — версия Minecraft (1.21.1), neoforge — версия NeoForge (21.1.248 или «neoforge-21.1.248»).
 * minecraft: false — только NeoForge (его общие теги c:*). Возвращает { minecraft, neoforge, mappings } — пути к
 * файлам или null.
 */
export async function platformAssets({ cacheDir, mc, neoforge = null, minecraft = true, log = () => {} }) {
  const dir = path.join(cacheDir, 'platform');
  const out = { minecraft: null, neoforge: null, mappings: null };
  if (minecraft)
    try {
      // Классы client.jar обфусцированы — рядом карта имён Mojang (цвета красителей DyeColor для знамён и кроватей)
      const jar = path.join(dir, `minecraft-${mc}-client.jar`);
      const txt = path.join(dir, `minecraft-${mc}-client-mappings.txt`);
      if (!fs.existsSync(jar) || !fs.existsSync(txt)) {
        log(`ресурсы Minecraft ${mc}: качаю client.jar и карту имён`);
        const ver = (await get(MANIFEST, 'json')).versions.find((v) => v.id === mc);
        if (!ver) throw new Error(`версии ${mc} нет в манифесте Mojang`);
        const { client, client_mappings: map } = (await get(ver.url, 'json')).downloads;
        await cached(jar, client.url, client.sha1);
        if (map) await cached(txt, map.url, map.sha1);
      }
      out.minecraft = jar;
      out.mappings = fs.existsSync(txt) ? txt : null;
    } catch (e) {
      log(`ресурсы Minecraft не скачались (${e.message}) — сундуки, кровати и головы будут текстурой`);
    }
  const v = neoforge ? String(neoforge).replace(/^neoforge-/, '') : null;
  if (!v) log('версия NeoForge неизвестна — вёдра с жидкостью могут остаться текстурой');
  else
    try {
      const name = `neoforge-${v}-universal.jar`;
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) log(`ресурсы NeoForge ${v}: качаю ${name}`);
      const url = `${MAVEN}/${v}/${name}`;
      out.neoforge = await cached(file, url, async () => (await get(`${url}.sha1`, 'text')).trim().slice(0, 40));
    } catch (e) {
      log(`ресурсы NeoForge не скачались (${e.message}) — вёдра с жидкостью могут остаться текстурой`);
    }
  return out;
}
