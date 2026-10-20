#!/usr/bin/env node
/**
 * Импорт конфигов модов в Firestore (коллекция config) — чтобы сайт брал настройки из того, что реально стоит
 * на сервере, а не из ручного ввода. Сейчас из них читается карта мира (tfc_real_world/server.toml).
 *
 *   npm run serverconfig -- ~/Downloads/serverconfig.zip           — zip с папкой serverconfig/ или config/
 *   npm run serverconfig -- <папка инстанса>/serverconfig            — или папка
 *   … --scope <имя>   — чьи это настройки. По умолчанию — по папке: serverconfig/ → server (переопределения
 *                       сервера), config/ и defaultconfigs/ → config (конфиг сборки). Сайт ищет значение сначала
 *                       в server, потом в config, потом берёт значение мода по умолчанию из кода.
 *   … --all           — импортировать и клиентские конфиги, и файлы с нестандартными именами (по умолчанию берутся
 *                       только <мод>-server.toml / -common.toml, <мод>/server.toml / common.toml и <мод>.json5 в корне —
 *                       так хранят настройки моды на Collective: World Border и другие моды Natamus)
 *   … --only <подстрока пути>   — импортировать только подходящие файлы (можно несколько раз)
 *   … --dry-run       — показать, что будет записано, без записи
 *
 * Один файл = один документ config/{scope}__{путь, где / → __}:
 *   { scope, path, mod, values (разобранный TOML или JSON5), sha1, source, importedBy, importedAt }
 * Коллекцию config читает любой посетитель сайта, поэтому в неё не попадают: клиентские конфиги (*-client.toml,
 * client.toml), резервные копии (.bak) и любые файлы, где есть непустой ключ, похожий на секрет
 * (token, secret, password, webhook, api key) — такие файлы пропускаются целиком, с сообщением.
 * Комментарии из TOML и JSON5 не сохраняются. Повторный импорт перезаписывает документ целиком.
 * Писать в config может только этот скрипт (правила Firestore закрывают коллекцию для сайта).
 * Из кода: configDocs(вход, опции) — документы без записи, importServerConfig(опции) — разбор, сводка и запись.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { parse } from 'smol-toml';
import { fileURLToPath } from 'node:url';
import { deployer, writeConfigDocs } from './firestore-rest.mjs';

const log = (...a) => console.log('[config]', ...a);

function args(argv) {
  const opts = { input: null, scope: null, only: [], dryRun: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--scope') opts.scope = argv[++i];
    else if (a === '--only') opts.only.push(argv[++i]);
    else if (!a.startsWith('--')) opts.input = a;
    else throw new Error(`неизвестный флаг ${a}`);
  }
  if (!opts.input) throw new Error('укажите zip или папку с конфигами: npm run serverconfig -- <путь>');
  return opts;
}

/** Путь конфига относительно папки config/ или serverconfig/ (как его видит игра) */
function configPath(p) {
  const parts = p.replaceAll('\\', '/').split('/').filter(Boolean);
  const i = parts.findLastIndex((x) => x === 'serverconfig' || x === 'config' || x === 'defaultconfigs');
  return (i >= 0 ? parts.slice(i + 1) : parts).join('/');
}

/** Чьи настройки по папке: serverconfig/ — переопределения сервера, config/ — конфиг сборки */
function scopeOf(p, input) {
  const parts = `${input}/${p}`.replaceAll('\\', '/').split('/').filter(Boolean);
  const root = parts.findLast((x) => x === 'serverconfig' || x === 'config' || x === 'defaultconfigs');
  return root === 'serverconfig' || !root ? 'server' : 'config';
}

/** Конфиги модов по соглашению NeoForge: <мод>-server.toml, <мод>-common.toml, <мод>/server.toml, <мод>/common.toml */
const MOD_CONFIG = /(^|[-_/])(server|common)\.toml$/i;
const CLIENT = /(^|[-_/])client(-\d+)?\.toml$/i;
/** <мод>.json5 в корне config/ — настройки модов на Collective (Natamus: worldborder.json5 и т. п.) */
const JSON5_CONFIG = /^[^/]+\.json5$/i;
const CONFIG_FILE = /\.(toml|json5)$/i;
const SECRET =
  /^\s*"?[\w.-]*(token|secret|password|passwd|webhook|cookie|api[_-]?key)[\w.-]*"?\s*[=:]\s*(?!""|''|false|true|\d)\S/im;

/**
 * JSON5 без зависимостей: комментарии // и /* *\/, запятые перед } и ], ключи без кавычек, строки в одинарных
 * кавычках. Collective пишет почти JSON (ключи в кавычках, комментарии строками) — этого хватает с запасом.
 */
export function parseJson5(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      let body = '';
      for (; j < text.length && text[j] !== c; j++) {
        if (text[j] === '\\') body += text[j++];
        body += text[j];
      }
      if (j >= text.length) throw new Error('строка без закрывающей кавычки');
      out += c === '"' ? `"${body}"` : JSON.stringify(body.replace(/\\'/g, "'"));
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('комментарий /* без конца');
      i = end + 1;
    } else out += c;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1').replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
  return JSON.parse(out);
}

function readInput(input) {
  const files = [];
  const stat = fs.statSync(input);
  if (stat.isDirectory()) {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else files.push({ name: path.relative(input, full), data: fs.readFileSync(full) });
      }
    };
    walk(input);
  } else {
    const entries = unzipSync(new Uint8Array(fs.readFileSync(input)));
    for (const [name, data] of Object.entries(entries)) if (!name.endsWith('/')) files.push({ name, data });
  }
  return files;
}

/** Firestore не принимает ключи-пустышки и бесконечности; даты TOML — строкой */
function clean(v) {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
  return v;
}

/**
 * Документы config/{scope}__… из zip или папки. Опции: scope (иначе — по папке), only, all, как у флагов;
 * exclude — путь конфига → true, если файл брать нельзя (запреты npm run pack).
 */
export function configDocs(input, { scope: forcedScope = null, only = [], all = false, exclude = null } = {}) {
  if (forcedScope !== null && !/^[a-z0-9_-]{1,40}$/i.test(forcedScope))
    throw new Error('--scope: латиница, цифры, _ и -');
  const opts = { input, scope: forcedScope, only, all };
  const source = path.basename(opts.input);
  const by = deployer('import');
  const docs = [];
  const skipped = { other: 0, excluded: 0, client: 0, secret: [], unusual: [] };
  for (const f of readInput(opts.input)) {
    const p = configPath(f.name);
    if (!CONFIG_FILE.test(p)) {
      skipped.other++;
      continue;
    }
    if (exclude?.(p)) {
      skipped.excluded++;
      continue;
    }
    const forced = opts.only.some((o) => p.includes(o));
    if (opts.only.length && !forced) continue;
    if (!opts.all && CLIENT.test(p)) {
      skipped.client++;
      continue;
    }
    // Файлы с нестандартными именами (coldsweat/item.toml, c2me.toml…) — только по явной просьбе: --only или --all
    if (!opts.all && !forced && !MOD_CONFIG.test(p) && !JSON5_CONFIG.test(p)) {
      skipped.unusual.push(p);
      continue;
    }
    const text = new TextDecoder().decode(f.data);
    if (SECRET.test(text)) {
      skipped.secret.push(p);
      continue;
    }
    const scope = opts.scope ?? scopeOf(f.name, opts.input);
    const json5 = /\.json5$/i.test(p);
    let values;
    try {
      values = clean(json5 ? parseJson5(text) : parse(text));
    } catch (e) {
      log(`пропущен ${p}: не разобрался ${json5 ? 'JSON5' : 'TOML'} — ${e.message.split('\n')[0]}`);
      continue;
    }
    docs.push({
      id: `${scope}__${p.replaceAll('/', '__')}`,
      data: {
        scope,
        path: p,
        // Мод — по папке (tfc_real_world/server.toml) или по имени файла (tfc_eratosthenes-server.toml)
        mod: p.includes('/') ? p.split('/')[0] : p.replace(/(-(server|common|client))?\.(toml|json5)$/i, ''),
        values,
        sha1: createHash('sha1').update(f.data).digest('hex'),
        source,
        importedBy: by,
        importedAt: Date.now(),
      },
    });
  }
  return { docs, skipped };
}

/** Сводка в лог: что импортируется, что пропущено, карта мира */
export function logConfigDocs(docs, skipped) {
  if (docs.length <= 12)
    for (const d of docs)
      log(`${d.data.path} → config/${d.id} (ключей верхнего уровня: ${Object.keys(d.data.values).length})`);
  const scopes = [...new Set(docs.map((d) => d.data.scope))];
  log(
    `к импорту: ${docs.length} файлов (${scopes.map((x) => `${x}: ${docs.filter((d) => d.data.scope === x).length}`).join(', ')})`,
  );
  log(
    `пропущено: не TOML/JSON5 ${skipped.other}, клиентских ${skipped.client}, с похожим на секрет ключом ${skipped.secret.length}` +
      (skipped.excluded ? `, запрещённых для импорта ${skipped.excluded}` : ''),
  );
  for (const p of skipped.secret) log(`  не импортирован (секрет?): ${p}`);
  if (skipped.unusual.length)
    log(
      `не похожи на конфиг мода (нужен --only <путь> или --all): ${skipped.unusual.length} — ${skipped.unusual.slice(0, 8).join(', ')}${skipped.unusual.length > 8 ? '…' : ''}`,
    );
  const world = docs.find((d) => d.data.path === 'tfc_real_world/server.toml')?.data.values;
  if (world) {
    const g = world.generation_modes ?? {};
    const s = world.spawn_settings ?? {};
    log(
      `карта: профиль ${world.map_settings?.map_profile}, радиус ${g.horizontal_scale}×${g.vertical_scale} блоков,` +
        ` спавн ${s.spawn_mode} ${s.spawn_center_latitude ?? ''} ${s.spawn_center_longitude ?? ''}`,
    );
  }
}

export async function importServerConfig({ input, dryRun = false, ...opts }) {
  const { docs, skipped } = configDocs(input, opts);
  if (!docs.length) throw new Error('не найдено ни одного .toml или .json5');
  logConfigDocs(docs, skipped);
  if (dryRun) {
    log('--dry-run, ничего не записываю');
    for (const d of docs) console.log(JSON.stringify(d, null, 2));
    return docs;
  }
  await writeConfigDocs(docs);
  log(`записано документов: ${docs.length}`);
  return docs;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  Promise.resolve()
    .then(() => importServerConfig(args(process.argv.slice(2))))
    .catch((e) => {
      console.error('[config]', e.message ?? e);
      process.exit(1);
    });
}
