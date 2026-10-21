/**
 * Правки конфигов от агента (tfc admin changes): агент предлагает их через MCP (config_propose → Firestore
 * configChanges), сервер сборки отдаёт администратору (/admin/changes), здесь они ложатся в TOML папки игры
 * и папки сервера — с копией прежнего (tfc undo), — а итог по каждому ключу уходит обратно на сервер.
 *
 * Правка: { id, note, author, status, updateTime, edits: [{ path, layer, key, from, to }] }. layer config —
 * config/<path> (и defaultconfigs/<path>), layer server — serverconfig/<path> (инстанс, папка сервера, мир).
 */
import fs from 'node:fs';
import path from 'node:path';
import { tomlScan, tomlSet, tomlValue } from './tomledit.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Файлы, в которых живёт настройка у хоста: все существующие копии (клиент, сервер, мир) */
export function targetsOf(profile, edit) {
  const rel = edit.path.split('/');
  if (rel.some((p) => p === '..' || p === '')) return [];
  const roots = [profile.instance, profile.serverDir].filter(Boolean);
  const dirs =
    edit.layer === 'server'
      ? [
          ...roots.map((r) => path.join(r, 'serverconfig')),
          ...(profile.world ? [path.join(profile.world, 'serverconfig')] : []),
        ]
      : roots.flatMap((r) => [path.join(r, 'config'), path.join(r, 'defaultconfigs')]);
  const files = dirs.map((d) => path.join(d, ...rel)).filter((f) => fs.existsSync(f));
  return [...new Set(files.map((f) => path.resolve(f)))];
}

/** Где ещё стоит тот же ключ и перекрывает правку слоя config (serverconfig/ сервера или мира) */
function overriddenBy(profile, edit) {
  if (edit.layer === 'server') return [];
  return targetsOf(profile, { ...edit, layer: 'server' }).filter((f) => {
    try {
      return tomlScan(fs.readFileSync(f, 'utf8')).keys.some((k) => k.key === edit.key);
    } catch {
      return false;
    }
  });
}

/**
 * План одной правки, ничего не пишет: по каждому ключу и файлу — что будет.
 * item.state: change (как ждали), drift (в файле не то, что видел агент — хост менял), same (уже так),
 * add (ключа в файле нет — допишу), error. Тексты файлов — в texts (Map путь → новый текст).
 */
export function planChange(profile, change) {
  const texts = new Map();
  const items = [];
  for (const e of change.edits ?? []) {
    const files = targetsOf(profile, e);
    if (!files.length) {
      items.push({
        edit: e,
        file: null,
        state: 'error',
        msg: `нет файла ${e.layer === 'server' ? 'serverconfig' : 'config'}/${e.path}`,
      });
      continue;
    }
    for (const file of files) {
      try {
        const text = texts.get(file) ?? fs.readFileSync(file, 'utf8');
        const hit = tomlScan(text).keys.find((k) => k.key === e.key);
        const cur = hit ? tomlValue(hit.raw) : undefined;
        if (hit && same(cur, e.to)) {
          items.push({ edit: e, file, state: 'same', cur });
          continue;
        }
        const r = tomlSet(text, e.key, e.to);
        texts.set(file, r.text);
        const state = !hit ? 'add' : e.from !== null && e.from !== undefined && !same(cur, e.from) ? 'drift' : 'change';
        items.push({ edit: e, file, state, cur });
      } catch (err) {
        items.push({ edit: e, file, state: 'error', msg: err.message });
      }
    }
    const over = overriddenBy(profile, e);
    if (over.length) items.push({ edit: e, file: over[0], state: 'overridden' });
  }
  return { change, items, texts };
}

/** Записать план (копии — в backup через editBackup); файл пишется целиком через временный рядом */
export function applyChange(plan, backup, editBackup) {
  for (const [file, text] of plan.texts) {
    editBackup(backup, file);
    const tmp = `${file}.tfc-tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }
}

/** Итог по ключам для сервера: { path, key, ok, msg } — по одному на ключ (файлов бывает несколько) */
export function resultsOf(plan, short) {
  const by = new Map();
  for (const it of plan.items) {
    const id = `${it.edit.path}\n${it.edit.key}`;
    const r = by.get(id) ?? { path: it.edit.path, key: it.edit.key, ok: true, msgs: [] };
    const where = it.file ? short(it.file) : '';
    if (it.state === 'error') r.ok = false;
    const msg = {
      change: `${where}: ${JSON.stringify(it.cur)} → ${JSON.stringify(it.edit.to)}`,
      drift: `${where}: было ${JSON.stringify(it.cur)} (не ${JSON.stringify(it.edit.from)}) → ${JSON.stringify(it.edit.to)}`,
      add: `${where}: ключа не было, дописан`,
      same: `${where}: уже ${JSON.stringify(it.edit.to)}`,
      error: `${where ? `${where}: ` : ''}${it.msg}`,
      overridden: `перекрыт ${where} — там свой ${it.edit.key}`,
    }[it.state];
    r.msgs.push(msg);
    by.set(id, r);
  }
  return [...by.values()].map(({ msgs, ...r }) => ({ ...r, msg: msgs.join('; ') }));
}
