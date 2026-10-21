/**
 * Ресурсы клиента сборки (assets/: блокстейты, модели, текстуры, переводы) по слоям, как их видит игра —
 * первый слой, где файл есть, побеждает:
 *   1. ресурспаки сборки (instance/resourcepacks/: папки и zip);
 *   2. assets KubeJS (instance/kubejs/<слой>/assets);
 *   3. папки аддонов tools/<мод>/src/main/resources — свежее, чем их jar в mods/ (для проверки до сборки);
 *   4. jar модов (mods/, без вложенных jar-in-jar);
 *   5. ресурсы Minecraft (neoforge-<версия>-client-extra-aka-minecraft-resources.jar рядом с platform, см. jars.mjs)
 *      и самого NeoForge (assets/neoforge в jar platform).
 * Слой можно сузить до одного (addon / jar) — так resources_check смотрит, что даёт сам мод.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MODS } from './data.mjs';
import { jarList, jarToc, platform, readEntry, zipEntries, zipRead } from './jars.mjs';
import { KUBEJS } from './tools/kubejs.mjs';

const BASE = path.dirname(MODS);
const TOOLS_DIR = path.join(process.env.TFC_PACK_ROOT ?? BASE, 'tools');

// ---------------------------------------------------------------- виды слоёв

/** Папка с assets/: файлы перечисляются один раз (подпись — время изменения файлов не отслеживаем: читаем с диска) */
function dirLayer(label, root, kind) {
  return {
    label,
    kind,
    root,
    has: (p) => fs.existsSync(path.join(root, p)),
    read: (p) => {
      try {
        return fs.readFileSync(path.join(root, p));
      } catch {
        return null;
      }
    },
    list(prefix) {
      const out = [];
      const walk = (rel) => {
        const abs = path.join(root, rel);
        let names;
        try {
          names = fs.readdirSync(abs, { withFileTypes: true });
        } catch {
          return;
        }
        for (const d of names) {
          const r = rel ? `${rel}/${d.name}` : d.name;
          if (d.isDirectory()) walk(r);
          else out.push(r);
        }
      };
      walk(prefix.replace(/\/$/, ''));
      return out;
    },
  };
}

const zipCache = new Map(); // файл → { mtime, byName }
function zipLayer(label, file, kind) {
  const toc = () => {
    const mtime = fs.statSync(file).mtimeMs;
    let c = zipCache.get(file);
    if (!c || c.mtime !== mtime) {
      c = { mtime, byName: new Map(zipEntries(file).map((e) => [e.name, e])) };
      zipCache.set(file, c);
    }
    return c.byName;
  };
  return {
    label,
    kind,
    has: (p) => toc().has(p),
    read: (p) => {
      const e = toc().get(p);
      return e ? zipRead(file, e) : null;
    },
    list: (prefix) => [...toc().keys()].filter((n) => n.startsWith(prefix) && !n.endsWith('/')),
  };
}

/** Jar мода из mods/ — через оглавление jars.mjs (кеш по времени файла) */
function jarLayer(jar) {
  return {
    label: `jar ${jar}`,
    kind: 'jar',
    jar,
    has: (p) => jarToc(jar).some((e) => e.name === p),
    read: (p) => readEntry(jar, p)?.data ?? null,
    list: (prefix) =>
      jarToc(jar)
        .filter((e) => e.name.startsWith(prefix) && !e.name.endsWith('/'))
        .map((e) => e.name),
  };
}

/** Папки аддонов: tools/<мод>/src/main/resources с assets/ или data/ */
export function addonDirs() {
  const out = [];
  for (const mod of fs.existsSync(TOOLS_DIR) ? fs.readdirSync(TOOLS_DIR).sort() : []) {
    const res = path.join(TOOLS_DIR, mod, 'src/main/resources');
    if (fs.existsSync(path.join(res, 'assets')) || fs.existsSync(path.join(res, 'data')))
      out.push({ name: mod, dir: path.join(TOOLS_DIR, mod), res });
  }
  return out;
}

/**
 * Папка аддона по имени в tools/ (ee-extras-mod, ee-extras) или пути к папке мода (в т. ч. в git worktree):
 * { name, dir, res } — res: src/main/resources или сама папка с assets/; null — не нашлась.
 */
export function addonRoot(q) {
  const hit = addonDirs().find((d) => d.name === q || d.name === `${q}-mod`);
  const dir = hit?.dir ?? path.resolve(q);
  const res = fs.existsSync(path.join(dir, 'src/main/resources'))
    ? path.join(dir, 'src/main/resources')
    : fs.existsSync(path.join(dir, 'assets'))
      ? dir
      : null;
  return res ? { name: path.basename(dir), dir, res } : null;
}

/** Ресурсы Minecraft: jar «client-extra» рядом с NeoForge platform */
export function minecraftResources() {
  const p = platform();
  if (!p) return null;
  const f = p.classes.replace(/\.jar$/, '-client-extra-aka-minecraft-resources.jar');
  return fs.existsSync(f) ? f : null;
}

// ---------------------------------------------------------------- набор слоёв

let jarIndex = null; // { tocs, byPath: Map(путь assets/… → [jar]) }
/** Какой jar даёт файл assets/… (первый по алфавиту, кроме skip): один проход по оглавлениям, пока jar не поменялись */
function jarFor(p, skip = null) {
  const jars = jarList();
  const tocs = jars.map((j) => jarToc(j));
  if (!jarIndex || jarIndex.tocs.length !== tocs.length || jarIndex.tocs.some((t, i) => t !== tocs[i])) {
    const byPath = new Map();
    jars.forEach((j, i) => {
      for (const e of tocs[i])
        if (e.name.startsWith('assets/')) (byPath.get(e.name) ?? byPath.set(e.name, []).get(e.name)).push(j);
    });
    jarIndex = { tocs, byPath };
  }
  return jarIndex.byPath.get(p)?.find((j) => !skip?.has(j)) ?? null;
}

/**
 * Слои ресурсов. only: { addon: папка аддона } — только он (+ Minecraft и jar для чужих namespace, если
 * withDeps; skipJars — jar, которых не видно: старая сборка того же аддона в mods/ не должна прятать файл, пропавший
 * в папке); { jar } — только этот jar (+ то же).
 * Без only — вся сборка.
 */
export function resourceLayers(only = null, withDeps = true, skipJars = null, addon = null) {
  const layers = [];
  if (!only) {
    const rp = path.join(BASE, 'instance', 'resourcepacks');
    for (const f of fs.existsSync(rp) ? fs.readdirSync(rp).sort() : []) {
      const abs = path.join(rp, f);
      if (fs.statSync(abs).isDirectory()) {
        if (fs.existsSync(path.join(abs, 'assets'))) layers.push(dirLayer(`ресурспак ${f}`, abs, 'resourcepack'));
      } else if (f.endsWith('.zip')) {
        // Распакованная папка рядом с тем же именем — она и есть, zip пропускаем
        if (!fs.existsSync(abs.replace(/\.zip$/, ''))) layers.push(zipLayer(`ресурспак ${f}`, abs, 'resourcepack'));
      }
    }
    for (const l of fs.existsSync(KUBEJS) ? fs.readdirSync(KUBEJS).sort() : []) {
      const dir = path.join(KUBEJS, l);
      if (fs.existsSync(path.join(dir, 'assets'))) layers.push(dirLayer(`KubeJS ${l}`, dir, 'kubejs'));
    }
    // addon — папка аддона вне tools/ основной копии (git worktree): вместо одноимённой из tools/ и раньше всех
    if (addon) layers.push(dirLayer(`аддон ${path.relative(BASE, addon.dir) || addon.dir}`, addon.res, 'addon'));
    for (const a of addonDirs())
      if (a.name !== addon?.name) layers.push(dirLayer(`аддон tools/${a.name}`, a.res, 'addon'));
  } else if (only.addon) layers.push(dirLayer(`аддон ${path.relative(BASE, only.addon)}`, only.addon, 'addon'));
  else if (only.jar) layers.push(jarLayer(only.jar));
  // Jar модов — общим индексом (по пути — один jar), а не слоем на каждый
  if (!only || withDeps)
    layers.push({
      label: 'jar модов',
      kind: 'jars',
      has: (p) => Boolean(jarFor(p, skipJars)),
      read: (p) => {
        const j = jarFor(p, skipJars);
        return j ? (readEntry(j, p)?.data ?? null) : null;
      },
      which: (p) => jarFor(p, skipJars),
      list: () => [],
    });
  const mc = minecraftResources();
  if (mc && (!only || withDeps)) layers.push(zipLayer('Minecraft', mc, 'minecraft'));
  // Модели и текстуры самого NeoForge (neoforge:item/default и т. п.) — в его jar
  const nf = platform()?.classes;
  if (nf && (!only || withDeps)) layers.push(zipLayer('NeoForge', nf, 'minecraft'));
  return layers;
}

/** Файл из первого слоя, где он есть: { data, layer, from } или null */
export function findResource(layers, p) {
  for (const l of layers) {
    const data = l.read(p);
    if (data) return { data, layer: l, from: l.which ? `jar ${l.which(p)}` : l.label };
  }
  return null;
}

// ---------------------------------------------------------------- имена ресурсов

/** «ns:path» → { ns, path }; без namespace — minecraft */
export function resLoc(id, def = 'minecraft') {
  const s = String(id ?? '').trim();
  const i = s.indexOf(':');
  return i < 0 ? { ns: def, path: s } : { ns: s.slice(0, i), path: s.slice(i + 1) };
}

export const modelPath = (id) => {
  const { ns, path: p } = resLoc(id);
  return `assets/${ns}/models/${p}.json`;
};
export const texturePath = (id) => {
  const { ns, path: p } = resLoc(id);
  return `assets/${ns}/textures/${p}.png`;
};
export const blockstatePath = (id) => {
  const { ns, path: p } = resLoc(id);
  return `assets/${ns}/blockstates/${p}.json`;
};

export function readJsonRes(layers, p) {
  const r = findResource(layers, p);
  if (!r) return null;
  try {
    // Модели и блокстейты бывают с комментариями и BOM — как у GSON в lenient-режиме, снимаем
    const text = r.data.toString('utf8').replace(/^﻿/, '');
    return { ...r, json: JSON.parse(text) };
  } catch (e) {
    return { ...r, json: null, error: e.message };
  }
}

// ---------------------------------------------------------------- модели: parent и текстуры

const BUILTIN = new Set(['builtin/generated', 'builtin/entity', 'builtin/missing']);

/**
 * Модель с цепочкой parent: { id, chain: [{ id, from }], textures (слитые), elements (ближайшие), display (слитые
 * по ключу), generated (предмет из слоёв текстур), entity (рисуется кодом), missing: [id], loader, children }.
 */
export function loadModel(layers, id) {
  const out = {
    id,
    chain: [],
    textures: {},
    elements: null,
    display: {},
    generated: false,
    entity: false,
    missing: [],
    errors: [],
    loader: null,
    children: null,
  };
  let cur = id;
  const seen = new Set();
  while (cur) {
    const { ns, path: p } = resLoc(cur);
    const key = `${ns}:${p}`;
    if (seen.has(key)) {
      out.errors.push(`цикл parent на ${key}`);
      break;
    }
    seen.add(key);
    if (BUILTIN.has(p) && ns === 'minecraft') {
      out.chain.push({ id: key, from: 'встроенная' });
      if (p === 'builtin/generated') out.generated = true;
      if (p === 'builtin/entity') out.entity = true;
      break;
    }
    const r = readJsonRes(layers, modelPath(key));
    if (!r) {
      out.missing.push(key);
      break;
    }
    out.chain.push({ id: key, from: r.from });
    if (!r.json) {
      out.errors.push(`${key}: JSON не разобрался (${r.error})`);
      break;
    }
    const m = r.json;
    for (const [k, v] of Object.entries(m.textures ?? {})) if (!(k in out.textures)) out.textures[k] = v;
    if (!out.elements && Array.isArray(m.elements)) out.elements = m.elements;
    for (const [k, v] of Object.entries(m.display ?? {})) if (!(k in out.display)) out.display[k] = v;
    if (!out.loader && m.loader) {
      out.loader = m.loader;
      out.loaderJson = m; // поля загрузчика: model (obj), base/perspectives, children, base_name…
      if (m.children) out.children = m.children;
    }
    cur = typeof m.parent === 'string' ? m.parent : null;
  }
  return out;
}

/** Текстура по переменной модели: «#0» → «ee_extras:block/x»; null — не задана (цикл тоже) */
export function resolveTexture(textures, ref) {
  let r = ref;
  for (let i = 0; i < 16 && typeof r === 'string' && r.startsWith('#'); i++) r = textures[r.slice(1)];
  if (r && typeof r === 'object') r = r.sprite; // форма { sprite, … } NeoForge
  return typeof r === 'string' && !r.startsWith('#') ? r : null;
}

// ---------------------------------------------------------------- блокстейты

/** «facing=north,roll=false» → { facing: 'north', roll: 'false' } */
export function parseState(s) {
  const out = {};
  for (const part of String(s ?? '').split(',')) {
    const [k, v] = part.split('=').map((x) => x?.trim());
    if (k && v != null) out[k] = v;
  }
  return out;
}
export const stateText = (st) =>
  Object.entries(st)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');

/** Подходит ли условие multipart «when» к состоянию */
export function whenMatches(when, st) {
  if (!when) return true;
  if (Array.isArray(when.OR)) return when.OR.some((w) => whenMatches(w, st));
  if (Array.isArray(when.AND)) return when.AND.every((w) => whenMatches(w, st));
  return Object.entries(when).every(([k, v]) => {
    const neg = String(v).startsWith('!');
    const vals = String(v).replace(/^!/, '').split('|');
    return neg ? !vals.includes(st[k]) : vals.includes(st[k]);
  });
}

/** Свойства и значения, упомянутые в блокстейте: Map(свойство → Set(значения)) */
export function statePropsOf(bs) {
  const props = new Map();
  const add = (k, v) => (props.get(k) ?? props.set(k, new Set()).get(k)).add(String(v));
  for (const key of Object.keys(bs.variants ?? {})) for (const [k, v] of Object.entries(parseState(key))) add(k, v);
  const walk = (w) => {
    if (!w) return;
    if (Array.isArray(w.OR)) return w.OR.forEach(walk);
    if (Array.isArray(w.AND)) return w.AND.forEach(walk);
    for (const [k, v] of Object.entries(w)) for (const x of String(v).replace(/^!/, '').split('|')) add(k, x);
  };
  for (const p of bs.multipart ?? []) walk(p.when);
  return props;
}

const firstModel = (v) => (Array.isArray(v) ? v[0] : v);

/** Модели блокстейта для состояния: [{ model, x, y, uvlock }], ключ варианта */
export function pickVariant(bs, want) {
  if (bs.variants) {
    const keys = Object.keys(bs.variants);
    const key =
      keys.find(
        (k) =>
          Object.entries(parseState(k)).every(([p, v]) => want[p] == null || want[p] === v) &&
          Object.keys(want).every((p) => p in parseState(k) || !k),
      ) ??
      keys.find((k) => Object.entries(want).every(([p, v]) => parseState(k)[p] === v)) ??
      keys[0];
    const v = firstModel(bs.variants[key]);
    return { key, parts: v ? [v] : [] };
  }
  // multipart: свойства без значения — первое упомянутое значение
  const st = { ...want };
  for (const [k, vals] of statePropsOf(bs)) if (st[k] == null) st[k] = [...vals][0];
  const parts = [];
  for (const p of bs.multipart ?? []) if (whenMatches(p.when, st)) parts.push(...[p.apply].flat().slice(0, 1));
  return { key: stateText(st), parts };
}
