/** Библиотека и локальные схемы Create. Ник папки uploaded обозначает копию, а не автора. */
import fs from 'node:fs';
import path from 'node:path';
import { inspectSchematic, SCHEMATIC_MAX } from '@tfc/pack-server/schematic-nbt';
import { schematicTargets } from './pull.mjs';
import { loadState } from './plan.mjs';
import { confirm, mb } from './ui.mjs';

function roots(profile) {
  return [...new Set([profile?.instance, profile?.serverDir].filter(Boolean))].map((p) => path.join(p, 'schematics'));
}

export function localSchematics(profile) {
  const out = [];
  for (const root of roots(profile)) {
    if (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink()) continue;
    function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
          walk(file);
          continue;
        }
        if (!e.isFile() || !/\.nbt$/i.test(e.name)) continue;
        const rel = path.relative(root, file).split(path.sep).join('/');
        const owner = rel.startsWith('uploaded/') ? rel.split('/')[1] : null;
        const size = fs.statSync(file).size;
        let info;
        let error;
        try {
          if (size > SCHEMATIC_MAX) throw new Error('больше 10 МБ');
          info = inspectSchematic(fs.readFileSync(file));
        } catch (e) {
          error = e.message;
        }
        out.push({ file, rel, owner, size, info, error });
      }
    }
    walk(root);
  }
  return out;
}

async function catalog(api, profile) {
  const { items } = await api.get('/site/schematics');
  if (!profile) return items;
  const targets = (
    await schematicTargets({ get: async () => ({ items }), bytes: (...args) => api.bytes(...args) }, profile)
  ).items;
  for (const s of items) {
    const target = targets.find((x) => x.id === s.id);
    if (!target) continue;
    s.path = target.path;
    // bytes() заполняет кеш исходника; затем сравниваем исходную и обработанную формы.
    const edited = await target.bytes();
    const source = inspectSchematic(await target.sourceBytes());
    s.sourceHash = source.contentHash;
    s.sha256 = source.sha256;
    s.editedHash = inspectSchematic(edited).contentHash;
  }
  return items;
}

function matches(local, entries, profile) {
  const state = profile ? loadState(profile) : {};
  return entries
    .map((s) => {
      const sameSource = !!local.info && local.info.contentHash === s.sourceHash;
      const sameEdited = !!local.info && local.info.contentHash === s.editedHash;
      const tracked = state.pulled?.schematics?.[s.id];
      const copy = state.schematicCopies?.[path.relative(profile.instance, local.file).split(path.sep).join('/')];
      const known = (tracked && path.resolve(profile.instance, tracked.path) === local.file) || copy?.id === s.id;
      return sameSource || sameEdited || known
        ? { s, kind: sameSource ? 'исходник' : sameEdited ? 'с заменами' : 'изменена' }
        : null;
    })
    .filter(Boolean);
}

const contains = (text, query) => String(text).toLowerCase().includes(query.toLowerCase());
export async function listSchematics(api, profile, query = '', localOnly = false) {
  let entries;
  let available = true;
  try {
    entries = await catalog(api, profile);
  } catch (e) {
    if (!localOnly) throw e;
    console.log(`Библиотека недоступна: ${e.message}. Совпадения не проверены.`);
    entries = [];
    available = false;
  }
  const files = profile ? localSchematics(profile) : [];
  const containsLocal = (text) => contains(text, query);
  if (!localOnly) {
    const shown = entries.filter((s) => contains(`${s.id} ${s.name} ${s.fileName} ${s.author}`, query));
    console.log(`Библиотека на сайте${query ? ` (поиск «${query}»)` : ''}: ${shown.length}`);
    for (const s of shown) {
      const copies = files.filter((f) => matches(f, [s], profile).length);
      const installed = profile ? (copies.length ? `установлена (${copies.length})` : 'не установлена') : '—';
      console.log(`  ${s.name} | ${s.id} | ${installed}`);
    }
    if (!shown.length) console.log('  (пусто)');
    console.log('');
  }
  const shownFiles = files.filter((f) => {
    const hits = matches(f, entries, profile);
    return containsLocal(`${f.file} ${hits.map((h) => `${h.s.id} ${h.s.name}`).join(' ')}`);
  });
  if (shownFiles.length || files.length) {
    console.log(`Локальные .nbt${query ? ` (поиск «${query}»)` : ''}: ${shownFiles.length}`);
    for (const f of shownFiles) {
      const hits = matches(f, entries, profile);
      const status = f.error
        ? `ошибка: ${f.error}`
        : hits.length
          ? hits.map((h) => `${h.s.id}: ${h.kind}`).join(', ')
          : available
            ? 'нет в библиотеке'
            : 'совпадения не проверены';
      console.log(`  ${f.file} | ${mb(f.size)} | владелец: ${f.owner ?? 'локальная'} | ${status}`);
    }
    if (!shownFiles.length) console.log('  (пусто)');
  }
  if (localOnly && !files.length) console.log('Локальных .nbt нет.');
}

export async function publishSchematic(api, profile, selector, options = {}) {
  if (!selector) throw new Error('Укажите файл из tfc schematics local');
  const files = localSchematics(profile);
  const exact = files.filter((f) => f.file === path.resolve(selector));
  const selected = exact.length ? exact : files.filter((f) => f.rel === selector || path.basename(f.file) === selector);
  if (selected.length !== 1)
    throw new Error(
      selected.length
        ? `Одинаковые имена — укажите полный путь:\n${selected.map((f) => f.file).join('\n')}`
        : 'Схема не найдена в schematics/ выбранного профиля',
    );
  const file = selected[0];
  if (file.error) throw new Error(`Неверная схема: ${file.error}`);
  const entries = await catalog(api, profile);
  const old = options.id ? entries.find((s) => s.id === options.id) : null;
  if (options.id && !old) throw new Error('Нет схемы с таким id');
  const hits = matches(file, entries, profile);
  const transformed = hits.some((h) => h.kind === 'с заменами' && h.s.sourceHash !== file.info.contentHash);
  const duplicate = hits.find((h) => h.kind === 'исходник' && h.s.id !== options.id);
  const name = old?.name ?? options.name ?? path.basename(file.file, '.nbt');
  const author = old?.author ?? options.author ?? 'Неизвестен';
  console.log(
    `${old ? 'Обновление' : 'Публикация'}: ${name}\nИсточник: ${file.file}\nВладелец копии: ${file.owner ?? 'локальная'}\nАвтор: ${author}\nРазмер: ${file.info.size.join('×')}, блоков: ${file.info.blocks}, ${mb(file.size)}\nSHA-256: ${file.info.sha256}`,
  );
  for (const h of hits) console.log(`Совпадение: ${h.s.id} ${h.s.name} — ${h.kind}`);
  for (const s of entries.filter((s) => s.name === name && s.id !== options.id))
    console.log(`Такое название уже есть: ${s.id}; запись будет отдельной.`);
  if (old)
    console.log(`Ревизия: ${old.revision}; автор, название, описание и замены сохранятся; превью будет сброшено.`);
  if (duplicate) throw new Error(`Исходник уже опубликован: ${duplicate.s.id}`);
  if (transformed && !options.asSource)
    throw new Error('Это копия с применёнными заменами. Для её публикации как нового исходника нужен --as-source');
  if (options.dryRun) return;
  if (!options.yes && !(await confirm(old ? 'Обновить схему в библиотеке?' : 'Опубликовать схему в библиотеке?')))
    return console.log('Публикация отменена; без терминала укажите --yes или --dry-run.');
  // Файл мог измениться во время подтверждения — отправляем только проверенные байты.
  const bytes = fs.readFileSync(file.file);
  if (inspectSchematic(bytes).sha256 !== file.info.sha256)
    throw new Error('Файл изменился после предпросмотра — повторите команду');
  const result = await api.publishSchematic(bytes, {
    id: options.id,
    revision: old?.revision,
    name,
    author,
    fileName: path.basename(file.file),
    asSource: !!options.asSource,
    sourceOwner: file.owner,
  });
  console.log(
    `${result.unchanged ? 'Без изменений' : 'Готово'}: ${result.id}\nhttps://tfc-plans-fd2c.web.app/schematics`,
  );
  return result;
}
