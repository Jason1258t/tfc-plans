/**
 * Данные сборки для MCP: предметы, рецепты (с учётом KubeJS), теги, справочник — из public/ основной копии.
 * Слияние источников — как на сайте (src/shared/pack-data/items.ts, recipes.ts, tags.ts, reference.ts, meals.ts): те модули
 * тянут React и fetch, поэтому здесь их логика повторена, а фильтры KubeJS и входы/выходы рецепта взяты
 * теми же модулями без импортов (recipeFilter.ts, recipeRefs.ts).
 *
 * Каждый файл перечитывается, если поменялся (npm run mods / kubejs), — сервер можно не перезапускать.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchFilter } from '../../src/shared/pack-data/recipeFilter.ts';
import { collectRefs } from '../../src/shared/pack-data/recipeRefs.ts';
import { PACK_MODS } from '../pack-cache.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Корень основной копии репозитория, если мы в git worktree (там нет собранного public/), иначе ROOT */
function packRoot() {
  try {
    const common = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.resolve(path.dirname(common));
  } catch {
    return ROOT;
  }
}

const BASE = process.env.TFC_PACK_ROOT ?? packRoot();
/** Данные сайта (npm run mods / kubejs); на сервере сборки — свои папки через переменные */
export const PUBLIC = process.env.TFC_PUBLIC_DIR ?? path.join(BASE, 'public');
/** Jar сборки — копия снимка вне репозитория (npm run pack:fetch, scripts/pack-cache.mjs) или TFC_MODS_DIR */
export const MODS = PACK_MODS;
/**
 * Рабочая папка MCP: .cache/mcp (декомпиляция, кандидаты, вложенные jar), instance/, tools/. Обычно — основная копия
 * репозитория; с TFC_MODS_DIR (сервер сборки: папка снимка) — папка над jar, как раньше.
 */
export const WORK = process.env.TFC_MODS_DIR ? path.dirname(MODS) : BASE;

// ---------------------------------------------------------------- чтение с кешем по времени изменения

const fileCache = new Map();
/** JSON из public/; fallback — если файла нет (не собран) */
export function readJson(name, fallback) {
  const file = path.join(PUBLIC, name);
  let mtime;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return fallback;
  }
  const c = fileCache.get(file);
  if (c && c.mtime === mtime) return c.data;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  fileCache.set(file, { mtime, data });
  return data;
}

/** Производные данные: пересчитываются, когда меняется любой из исходных JSON */
const derived = new Map();
function memo(key, sources, build, extra = []) {
  const inputs = [...sources.map((s) => readJson(s, null)), ...extra];
  const c = derived.get(key);
  if (c && c.inputs.length === inputs.length && c.inputs.every((x, i) => x === inputs[i])) return c.value;
  const value = build(...inputs);
  derived.set(key, { inputs, value });
  return value;
}

const norm = (s) => s.toLowerCase().replaceAll('ё', 'е');

// ---------------------------------------------------------------- моды и предметы

/** Моды сборки по id (namespace): название, версия, jar — из pack-manifest.json */
export const mods = () => memo('mods', ['pack-manifest.json'], (m) => new Map((m?.mods ?? []).map((x) => [x.id, x])));

/** Мод по id предмета/рецепта/тега: «tfc:metal/ingot/copper» → «TerraFirmaCraft (tfc)» */
export function modLabel(id) {
  const ns = id.replace(/^#/, '').split(':')[0];
  const m = mods().get(ns);
  return m ? `${m.name} (${ns})` : ns;
}

export const items = () =>
  memo('items', ['items.json', 'kubejs-items.json'], (mods, kjs) => {
    const have = new Set((mods ?? []).map((it) => it.i));
    const own = (kjs ?? []).filter((it) => !have.has(it.i)).map((it) => ({ ...it, kjs: true }));
    const list = [...(mods ?? []), ...own].filter((it) => it.i !== 'minecraft:air');
    return { list, byId: new Map(list.map((it) => [it.i, it])) };
  });

export const itemName = (id) => {
  const it = items().byId.get(id);
  return it ? (it.r ?? it.e) : null;
};

/** Как searchItems в src/shared/pack-data/items.ts: все слова запроса; начало имени > начало слова > вхождение; не ваниль выше */
export function searchItems(query) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const it of items().list) {
    if (it.h) continue; // скрытые (в игре не видно) — как на сайте
    const hay = [norm(it.r ?? ''), norm(it.e), it.i];
    let score = 0;
    let ok = true;
    for (const w of words) {
      let best = -1;
      for (const h of hay) {
        const pos = h.indexOf(w);
        if (pos === -1) continue;
        best = Math.max(best, pos === 0 ? 30 : /[\s/:_]/.test(h[pos - 1]) ? 20 : 8);
      }
      if (best < 0) {
        ok = false;
        break;
      }
      score += best;
    }
    if (!ok) continue;
    if (!it.i.startsWith('minecraft:')) score += 6;
    score -= (it.r ?? it.e).length / 10;
    scored.push({ it, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.it);
}

// ---------------------------------------------------------------- теги

const tagKey = (kind, id) => `${kind}|${id}`;

/** Как loadTags в src/shared/pack-data/tags.ts: источники модов в порядке загрузки + операции KubeJS после них */
export const tags = () =>
  memo('tags', ['tags.json', 'kubejs.json'], (raw, kjs) => {
    const ops = new Map();
    for (const o of kjs?.tags ?? []) {
      const key = tagKey(o.k, o.tag);
      ops.set(key, [...(ops.get(key) ?? []), o]);
    }
    const byKey = new Map();
    for (const t of raw?.tags ?? []) byKey.set(tagKey(t.k, t.i), { ...t, ops: ops.get(tagKey(t.k, t.i)) ?? [] });
    for (const [key, list] of ops) {
      if (byKey.has(key)) continue;
      const [k, i] = key.split('|');
      byKey.set(key, { i, k, s: [], ops: list });
    }
    const cat = { byKey, fluids: new Map((raw?.fluids ?? []).map((f) => [f.i, f])), memberOf: new Map() };
    // Обратный индекс: значение (с раскрытием вложенных тегов) → теги, где оно состоит
    for (const t of byKey.values())
      for (const v of flattenTag(cat, t.k, directMembers(t))) {
        const key = tagKey(t.k, v);
        const list = cat.memberOf.get(key) ?? [];
        list.push(t.i);
        cat.memberOf.set(key, list);
      }
    return cat;
  });

/** Прямые значения тега после слияния (вложенные — «#c:x»); KubeJS — только если withKubejs */
export function directMembers(tag, withKubejs = true) {
  const set = new Set();
  for (const s of tag?.s ?? []) {
    if (s.r) set.clear();
    for (const v of s.v) set.add(v);
    for (const x of s.x ?? []) set.delete(x);
  }
  if (withKubejs)
    for (const o of tag?.ops ?? []) {
      if (o.op === 'removeAll') set.clear();
      for (const v of o.v) {
        if (o.op === 'remove') set.delete(v);
        else set.add(v);
      }
    }
  return [...set];
}

export function flattenTag(cat, kind, members, seen = new Set()) {
  const out = new Set();
  for (const m of members) {
    if (!m.startsWith('#')) {
      out.add(m);
      continue;
    }
    const id = m.slice(1);
    if (seen.has(id)) continue;
    seen.add(id);
    for (const x of flattenTag(cat, kind, directMembers(cat.byKey.get(tagKey(kind, id))), seen)) out.add(x);
  }
  return [...out];
}

export const getTag = (kind, id) => tags().byKey.get(tagKey(kind, id.replace(/^#/, '')));
/** Теги, где состоит значение (с учётом вложенных тегов и KubeJS) */
export const tagsOf = (kind, id) => tags().memberOf.get(tagKey(kind, id)) ?? [];

// ---------------------------------------------------------------- рецепты

const isRemoval = (j) => {
  const conds = j['neoforge:conditions'];
  return (Array.isArray(conds) && conds.some((c) => c?.type === 'neoforge:false')) || Object.keys(j).length === 0;
};

/** Как kubejsHits в src/shared/pack-data/recipes.ts */
function kubejsHits(rules, target) {
  const removed = [];
  const maybe = [];
  const changed = [];
  rules.forEach((rule, n) => {
    const m = matchFilter(rule.filter, target);
    if (rule.kind === 'remove') {
      if (m === true) removed.push(n);
      else if (m === null) maybe.push(n);
    } else if (m === true) {
      const has = matchFilter({ [rule.kind === 'replaceInput' ? 'input' : 'output']: rule.from }, target);
      if (has !== false) changed.push(n);
    }
  });
  return { removed, maybe, changed };
}

/** Рецепт из файла датапака: data/<ns>/recipe/<путь>.json → { i, t, j } или null (не рецепт, не JSON) */
export function datapackRecipe(file, text) {
  const m = file.match(/^data\/([^/]+)\/recipes?\/(.+)\.json$/);
  if (!m) return null;
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  return { i: `${m[1]}:${m[2]}`, t: typeof j.type === 'string' ? j.type : '', j };
}

/**
 * Каталог как loadRecipes в src/shared/pack-data/recipes.ts: kubejs/data и рецепты скриптов с тем же id заменяют рецепт мода,
 * удаления KubeJS — только для рецептов из датапаков. Дополнительно: входы/выходы после replaceInput/replaceOutput
 * (когда from и to — строки), чтобы «из чего делают X» находило и рецепты, где X подставил скрипт.
 *
 * site — слой датапаков сайта, которые ставятся в мир (siteRecipes в tools.mjs): [{ i, t, j, s, dp }]. Он ложится
 * поверх модов (рецепт с тем же id заменяется), под kubejs/data и скриптами; удаления KubeJS действуют и на него.
 */
export const recipes = (site = null) =>
  memo(
    site ? 'recipes+site' : 'recipes',
    ['recipes.json', 'kubejs.json'],
    (raw, kubejs) => {
      const merged = new Map((raw ?? []).map((r) => [r.i, r]));
      for (const r of site ?? []) {
        const was = merged.get(r.i);
        merged.set(r.i, was ? { ...r, replaces: was.s } : r);
      }
      for (const r of kubejs?.recipes ?? []) merged.set(r.i, r);
      const rules = kubejs?.rules ?? [];
      const list = [];
      const byOutput = new Map();
      const byInput = new Map();
      for (const r of merged.values()) {
        const origin = r.k
          ? 'kubejs-script'
          : r.s.startsWith('kubejs/')
            ? 'kubejs-data'
            : r.dp
              ? 'site-datapack'
              : 'mod';
        const rec = recipeRecord(r, origin, rules);
        list.push(rec);
        indexRecipe(rec, byOutput, byInput);
      }
      return { list, byId: new Map(list.map((r) => [r.i, r])), byOutput, byInput, rules, kubejs };
    },
    [site],
  );

const indexInto = (map, ref, r) => {
  const l = map.get(ref);
  if (l) l.push(r);
  else map.set(ref, [r]);
};

/** Добавить рецепт в индексы «по выходу» и «по входу» (и после замен KubeJS) */
export function indexRecipe(rec, byOutput, byInput) {
  for (const o of new Set([...rec.outputs, ...rec.effOutputs])) indexInto(byOutput, o, rec);
  for (const i of new Set([...rec.inputs, ...rec.effInputs])) indexInto(byInput, i, rec);
}

/** Запись каталога: входы/выходы, что с рецептом делает KubeJS */
export function recipeRecord(r, origin, rules) {
  const outs = new Set();
  const ins = new Set();
  collectRefs(r.j, false, outs, ins);
  const target = {
    id: r.i,
    type: r.t,
    group: typeof r.j.group === 'string' ? r.j.group : undefined,
    inputs: [...ins],
    outputs: [...outs],
  };
  const hits = origin === 'kubejs-script' ? { removed: [], maybe: [], changed: [] } : kubejsHits(rules, target);
  const effIn = new Set(ins);
  const effOut = new Set(outs);
  for (const n of hits.changed) {
    const rule = rules[n];
    if (typeof rule.from !== 'string' || typeof rule.to !== 'string') continue;
    const set = rule.kind === 'replaceInput' ? effIn : effOut;
    const from = rule.from.replace(/^\d+x\s+/, '');
    if (set.delete(from)) set.add(rule.to.replace(/^\d+x\s+/, ''));
  }
  return {
    ...r,
    inputs: [...ins],
    outputs: [...outs],
    effInputs: [...effIn],
    effOutputs: [...effOut],
    removed: isRemoval(r.j),
    origin,
    kjsRemoved: hits.removed,
    kjsMaybe: hits.maybe,
    kjsChanged: hits.changed,
  };
}

/** Состояние рецепта в игре */
export function recipeStatus(r) {
  if (r.removed) return 'отключён заглушкой датапака';
  if (r.kjsRemoved.length) return 'удалён KubeJS';
  if (r.kjsMaybe.length) return 'работает (но есть удаление KubeJS с неразборчивым фильтром)';
  if (r.kjsChanged.length) return 'работает, изменён KubeJS';
  return 'работает';
}

export const isActive = (r) => !r.removed && !r.kjsRemoved.length;

// ---------------------------------------------------------------- справочник

/** Как loadKubejsData + loadReference/loadMeals: kubejs/data сборки заменяет записи модов */
export const reference = () =>
  memo('reference', ['reference.json', 'kubejs-data.json'], (ref, kjs) => {
    if (!ref) return null;
    const out = { ...ref };
    if (kjs?.foods?.length) {
      const own = new Set(kjs.foods.map((f) => f.id));
      out.foods = [...kjs.foods, ...ref.foods.filter((f) => !own.has(f.id))];
    }
    if (kjs?.metals?.length) {
      const mod = new Map(ref.metals.map((m) => [m.id, m]));
      const own = kjs.metals.map((m) => {
        const was = mod.get(m.id);
        return was && was.melt !== m.melt ? { ...m, modMelt: was.melt } : m;
      });
      out.metals = [...own, ...ref.metals.filter((m) => !own.some((o) => o.id === m.id))];
    }
    if (kjs?.ores) {
      out.smelt = kjs.ores.smelt;
      out.chains = kjs.ores.chains;
    }
    return out;
  });

export const meals = () =>
  memo('meals', ['meals.json', 'kubejs-data.json'], (d, kjs) => {
    if (!d) return null;
    const s = d.skillet ? { ...d.skillet } : null;
    if (s && kjs?.skillet) {
      const files = new Set(kjs.skillet.entries.map((e) => e.file));
      if (files.size) s.entries = [...s.entries.filter((e) => !e.file || !files.has(e.file)), ...kjs.skillet.entries];
      const cooked = new Set(kjs.skillet.cooked.map((c) => c.file));
      if (cooked.size)
        s.cooked = [
          ...s.cooked.filter((c) => !c.file || !cooked.has(c.file)),
          ...kjs.skillet.cooked.map((c) => ({
            file: c.file,
            items: c.items,
            tags: c.tags,
            nutrients: (d.nutrients ?? []).map((n) => c.values[n] ?? 0),
          })),
        ];
    }
    return { ...d, skillet: s };
  });
