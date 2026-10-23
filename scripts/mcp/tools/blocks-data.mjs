/**
 * Источники для раздела «blocks»: переводы, blockstate/модели, таблицы добычи и глобальные модификаторы добычи.
 * Порядок — как у игры: ванилла (кеш npm run mods) < jar сборки по имени < слои KubeJS < ресурспаки; поздний
 * источник с тем же путём побеждает (как kubejs/data заменяет файл мода в data.mjs).
 *
 * Индексы строятся лениво и держатся в памяти, пока не поменялся ни один источник (mtime jar, файлов слоёв).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MODS, WORK, readJson } from '../data.mjs';
import { jarList, jarToc, readEntry, zipEntries, zipRead } from '../jars.mjs';

const BASE = WORK;
const INSTANCE = process.env.TFC_INSTANCE_DIR ?? path.join(BASE, 'instance');
const VANILLA = process.env.TFC_VANILLA_DIR ?? path.join(BASE, '.cache', 'assets', 'minecraft-1.21.1');

/** Какие файлы источников нужны разделу */
const WANT =
  /^(data\/[^/]+\/(loot_table|loot_modifiers)\/.+\.json|assets\/[^/]+\/(lang\/(ru_ru|en_us)\.json|blockstates\/.+\.json|models\/.+\.json))$/;
const DIRS = { data: ['loot_table', 'loot_modifiers'], assets: ['lang', 'blockstates', 'models'] };
const dirWanted = (rel) => {
  const p = rel.split('/');
  return p[0] in DIRS && (p.length < 3 || DIRS[p[0]].includes(p[2]));
};

// ---------------------------------------------------------------- источники

const jarNames = new Map();
function jarSource(jar) {
  const mtime = fs.statSync(path.join(MODS, jar)).mtimeMs;
  const key = `${jar}|${mtime}`;
  let names = jarNames.get(key);
  if (!names) {
    names = jarToc(jar)
      .map((e) => e.name)
      .filter((n) => WANT.test(n));
    jarNames.set(key, names);
  }
  return { label: jar, sig: key, names, read: (n) => readEntry(jar, n)?.data };
}

/** Папка (слой KubeJS, ресурспак, кеш ванили); sigFile — не обходить папку ради подписи (кеш ванили большой) */
function dirSource(label, root, sigFile) {
  const names = [];
  let max = 0;
  const visit = (rel) => {
    let list;
    try {
      list = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of list) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (dirWanted(r)) visit(r);
      } else if (WANT.test(r)) {
        names.push(r);
        if (!sigFile) max = Math.max(max, fs.statSync(path.join(root, r)).mtimeMs);
      }
    }
  };
  let sig;
  if (sigFile) {
    sig = `${label}|${fs.statSync(sigFile).mtimeMs}`;
    const c = dirCache.get(sig);
    if (c) return c;
    visit('');
  } else {
    visit('');
    sig = `${label}|${names.length}|${max}`;
  }
  const src = { label, sig, names, read: (n) => fs.readFileSync(path.join(root, n)) };
  if (sigFile) dirCache.set(sig, src);
  return src;
}
const dirCache = new Map();

function zipSource(label, file) {
  const mtime = fs.statSync(file).mtimeMs;
  const entries = zipEntries(file).filter((e) => WANT.test(e.name));
  const by = new Map(entries.map((e) => [e.name, e]));
  return { label, sig: `${label}|${mtime}`, names: [...by.keys()], read: (n) => zipRead(file, by.get(n)) };
}

function kubejsLayers() {
  const dir = path.join(INSTANCE, 'kubejs');
  const known = (readJson('kubejs.json', null)?.layers ?? []).map((l) => l.name);
  let have = [];
  try {
    have = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory());
  } catch {
    return [];
  }
  const rest = have
    .filter((l) => !known.includes(l))
    .sort((a, b) => (a === 'pack' ? -1 : b === 'pack' ? 1 : a < b ? -1 : 1));
  return [...known.filter((l) => have.includes(l)), ...rest];
}

function resourcepacks() {
  const dir = path.join(INSTANCE, 'resourcepacks');
  let files = [];
  try {
    files = fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) out.push(dirSource(`ресурспак ${f}`, full));
    // Распакованная папка рядом с zip — одна и та же сборка ресурспака
    else if (f.endsWith('.zip') && !files.includes(f.slice(0, -4))) out.push(zipSource(`ресурспак ${f}`, full));
  }
  return out;
}

function sources() {
  const list = [];
  const done = path.join(VANILLA, '.done-v4');
  if (fs.existsSync(done)) list.push(dirSource('ванилла (кеш npm run mods)', VANILLA, done));
  for (const jar of jarList()) list.push(jarSource(jar));
  for (const layer of kubejsLayers()) list.push(dirSource(`kubejs/${layer}`, path.join(INSTANCE, 'kubejs', layer)));
  list.push(...resourcepacks());
  return list;
}

let state = null;
/**
 * Текущее состояние источников; при любой смене — новое, ленивые индексы на нём строятся заново.
 * Проверка (stat jar, обход папок слоёв) — не чаще раза в 2 с: один ответ инструмента зовёт её много раз.
 */
function current() {
  if (state && Date.now() - state.checked < 2000) return state;
  const list = sources();
  const sig = list.map((s) => s.sig).join('\n');
  if (state?.sig === sig) {
    state.checked = Date.now();
    return state;
  }
  const files = new Map();
  list.forEach((s, i) => {
    for (const n of s.names) {
      const l = files.get(n);
      if (l) l.push(i);
      else files.set(n, [i]);
    }
  });
  state = { sig, list, files, checked: Date.now() };
  return state;
}

export function parseJson(buf) {
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/** Файл ассетов/данных: кто его даёт (по порядку), победитель — последний */
export function fileSources(name) {
  const s = current();
  return (s.files.get(name) ?? []).map((i) => s.list[i].label);
}

export function readFile(name) {
  const s = current();
  const idx = s.files.get(name);
  if (!idx) return null;
  const src = s.list[idx.at(-1)];
  return { src: src.label, json: parseJson(src.read(name)) };
}

// ---------------------------------------------------------------- переводы

/** Ключ перевода → { ru, en, ruSrc, enSrc } после перекрытия источников */
export function lang() {
  const s = current();
  if (s.lang) return s.lang;
  const keys = new Map();
  for (const src of s.list)
    for (const n of src.names) {
      const m = /^assets\/[^/]+\/lang\/(ru_ru|en_us)\.json$/.exec(n);
      if (!m) continue;
      const j = parseJson(src.read(n));
      if (!j || typeof j !== 'object') continue;
      const code = m[1] === 'ru_ru' ? 'ru' : 'en';
      for (const [k, v] of Object.entries(j)) {
        if (typeof v !== 'string') continue;
        const e = keys.get(k) ?? {};
        e[code] = v;
        e[`${code}Src`] = src.label;
        keys.set(k, e);
      }
    }
  s.lang = keys;
  return keys;
}

/** Блоки, о которых что-то известно: blockstate или таблица добычи blocks/… */
export function blockIds() {
  const s = current();
  if (s.blocks) return s.blocks;
  const set = new Set();
  for (const n of s.files.keys()) {
    const m =
      /^assets\/([^/]+)\/blockstates\/(.+)\.json$/.exec(n) ?? /^data\/([^/]+)\/loot_table\/blocks\/(.+)\.json$/.exec(n);
    if (m) set.add(`${m[1]}:${m[2]}`);
  }
  s.blocks = set;
  return set;
}

// ---------------------------------------------------------------- таблицы добычи

const isDisabled = (j) =>
  !j ||
  (Array.isArray(j['neoforge:conditions']) && j['neoforge:conditions'].some((c) => c?.type === 'neoforge:false')) ||
  !Object.keys(j).some((k) => k !== 'random_sequence' && k !== 'neoforge:conditions');

/**
 * Таблицы: id → { id, file, src, over (перекрытые источники), json, disabled };
 * модификаторы: id → { id, src, json, active (подключён в global_loot_modifiers.json) }
 */
export function loot() {
  const s = current();
  if (s.loot) return s.loot;
  const tables = new Map();
  const modFiles = new Map();
  let active = [];
  for (const src of s.list)
    for (const n of src.names) {
      let m = /^data\/([^/]+)\/loot_table\/(.+)\.json$/.exec(n);
      if (m) {
        const id = `${m[1]}:${m[2]}`;
        const was = tables.get(id);
        const json = parseJson(src.read(n));
        tables.set(id, {
          id,
          file: n,
          src: src.label,
          over: was ? [...was.over, was.src] : [],
          json,
          disabled: isDisabled(json),
        });
        continue;
      }
      if (n === 'data/neoforge/loot_modifiers/global_loot_modifiers.json') {
        const j = parseJson(src.read(n));
        if (j?.replace === true) active = [];
        for (const e of j?.entries ?? []) if (typeof e === 'string' && !active.includes(e)) active.push(e);
        continue;
      }
      m = /^data\/([^/]+)\/loot_modifiers\/(.+)\.json$/.exec(n);
      if (m) modFiles.set(`${m[1]}:${m[2]}`, { id: `${m[1]}:${m[2]}`, src: src.label, json: parseJson(src.read(n)) });
    }
  const modifiers = new Map([...modFiles].map(([id, f]) => [id, { ...f, active: active.includes(id) }]));
  s.loot = { tables, modifiers, missing: active.filter((id) => !modFiles.has(id)) };
  return s.loot;
}
