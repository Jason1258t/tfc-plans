#!/usr/bin/env node
/**
 * Импорт конфигов модов в Firestore (коллекция config) — чтобы сайт брал настройки из того, что реально стоит
 * на сервере, а не из ручного ввода. Сейчас из них читается карта мира (tfc_real_world/server.toml).
 *
 *   npm run config -- ~/Downloads/serverconfig.zip           — zip с папкой serverconfig/ или config/
 *   npm run config -- <папка инстанса>/serverconfig            — или папка
 *   … --scope <имя>   — чьи это настройки (по умолчанию server; например, клиентские конфиги игрока)
 *   … --only <подстрока пути>   — импортировать только подходящие файлы (можно несколько раз)
 *   … --dry-run       — показать, что будет записано, без записи
 *
 * Один файл = один документ config/{scope}__{путь, где / → __}:
 *   { scope, path, mod, values (разобранный TOML), sha1, source, importedBy, importedAt }
 * Комментарии из TOML не сохраняются. Повторный импорт перезаписывает документ целиком.
 * Писать в config может только этот скрипт (правила Firestore закрывают коллекцию для сайта).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { parse } from 'smol-toml';
import { deployer, DOCS, toValue, token } from './firestore-rest.mjs';

const log = (...a) => console.log('[config]', ...a);

function args() {
  const argv = process.argv.slice(2);
  const opts = { input: null, scope: 'server', only: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--scope') opts.scope = argv[++i];
    else if (a === '--only') opts.only.push(argv[++i]);
    else if (!a.startsWith('--')) opts.input = a;
    else throw new Error(`неизвестный флаг ${a}`);
  }
  if (!opts.input) throw new Error('укажите zip или папку с конфигами: npm run config -- <путь>');
  if (!/^[a-z0-9_-]{1,40}$/i.test(opts.scope)) throw new Error('--scope: латиница, цифры, _ и -');
  return opts;
}

/** Путь конфига относительно папки config/ или serverconfig/ (как его видит игра) */
function configPath(p) {
  const parts = p.replaceAll('\\', '/').split('/').filter(Boolean);
  const i = parts.findLastIndex((x) => x === 'serverconfig' || x === 'config' || x === 'defaultconfigs');
  return (i >= 0 ? parts.slice(i + 1) : parts).join('/');
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

async function main() {
  const opts = args();
  const source = path.basename(opts.input);
  const by = deployer('import');
  const docs = [];
  for (const f of readInput(opts.input)) {
    const p = configPath(f.name);
    if (!p.endsWith('.toml')) {
      if (!/readme|\.txt$/i.test(p)) log(`пропущен ${p}: пока поддерживается только TOML`);
      continue;
    }
    if (opts.only.length && !opts.only.some((o) => p.includes(o))) continue;
    const text = new TextDecoder().decode(f.data);
    let values;
    try {
      values = clean(parse(text));
    } catch (e) {
      log(`пропущен ${p}: не разобрался TOML — ${e.message.split('\n')[0]}`);
      continue;
    }
    docs.push({
      id: `${opts.scope}__${p.replaceAll('/', '__')}`,
      data: {
        scope: opts.scope,
        path: p,
        // Мод — по папке (tfc_real_world/server.toml) или по имени файла (tfc_eratosthenes-server.toml)
        mod: p.includes('/') ? p.split('/')[0] : p.replace(/(-(server|common|client))?\.toml$/, ''),
        values,
        sha1: createHash('sha1').update(f.data).digest('hex'),
        source,
        importedBy: by,
        importedAt: Date.now(),
      },
    });
  }
  if (!docs.length) throw new Error('не найдено ни одного .toml');

  for (const d of docs)
    log(`${d.data.path} → config/${d.id} (ключей верхнего уровня: ${Object.keys(d.data.values).length})`);
  const world = docs.find((d) => d.data.path === 'tfc_real_world/server.toml')?.data.values;
  if (world) {
    const g = world.generation_modes ?? {};
    const s = world.spawn_settings ?? {};
    log(
      `карта: профиль ${world.map_settings?.map_profile}, радиус ${g.horizontal_scale}×${g.vertical_scale} блоков,` +
        ` спавн ${s.spawn_mode} ${s.spawn_center_latitude ?? ''} ${s.spawn_center_longitude ?? ''}`,
    );
  }
  if (opts.dryRun) {
    log('--dry-run, ничего не записываю');
    for (const d of docs) console.log(JSON.stringify(d, null, 2));
    return;
  }

  const headers = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
  for (const d of docs) {
    // PATCH без updateMask — документ заменяется целиком (создаётся, если его не было)
    const r = await fetch(`${DOCS}/config/${encodeURIComponent(d.id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields: toValue(d.data).mapValue.fields }),
    });
    if (!r.ok) throw new Error(`Firestore ${r.status} на ${d.id}: ${(await r.text()).slice(0, 300)}`);
  }
  log(`записано документов: ${docs.length}`);
}

main().catch((e) => {
  console.error('[config]', e.message ?? e);
  process.exit(1);
});
