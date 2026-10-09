#!/usr/bin/env node
/**
 * KubeJS сборки → public/kubejs.json: какие рецепты скрипты удаляют, меняют и добавляют.
 *
 *   npm run kubejs -- ~/Downloads/kubejs.zip                 — папка kubejs сборки (слой pack)
 *   npm run kubejs -- ~/Downloads/kubejs_world.zip --layer world — ещё один слой (скрипты мира/сервера)
 *   npm run kubejs                                           — пересобрать kubejs.json из уже импортированного
 *
 * Импорт копирует папку в instance/kubejs/<слой>/ (в git не хранится) и заменяет прошлую версию слоя.
 * Разбор — без регулярок по тексту: server_scripts выполняются в песочнице Node, где ServerEvents.recipes
 * отдаёт записывающий event. Каждый event.remove / replaceInput / replaceOutput запоминается с фильтром,
 * файлом и строкой; custom / shaped / shapeless / recipes.<мод>.<тип> — как добавленные рецепты.
 * Всё остальное API (Item, Java.loadClass, события игроков…) — заглушки, которые ничего не делают.
 *
 * kubejs/data — обычный датапак (KubeJS грузит его вместе с остальными): его рецепты идут в каталог
 * как переопределения/добавления. Удаления KubeJS применяются и к ним, и к нашим датапакам — так же, как в игре:
 * RecipesKubeEvent.remove перебирает только рецепты из датапаков (originalRecipes), не добавленные скриптами.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { unzipSync } from 'fflate';
import { ROOT } from './firestore-rest.mjs';
import { matchFilter } from '../src/lib/recipeFilter.ts';
import { recipeRefs } from '../src/lib/recipeRefs.ts';

const INSTANCE = path.join(ROOT, 'instance', 'kubejs');
const OUT = path.join(ROOT, 'public', 'kubejs.json');
const log = (...a) => console.log('[kubejs]', ...a);

// ---------------------------------------------------------------- импорт слоя

function importLayer(input, layer) {
  const dest = path.join(INSTANCE, layer);
  const files = [];
  if (fs.statSync(input).isDirectory()) {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else files.push({ name: path.relative(input, full), data: fs.readFileSync(full) });
      }
    };
    walk(input);
  } else {
    for (const [name, data] of Object.entries(unzipSync(new Uint8Array(fs.readFileSync(input)))))
      if (!name.endsWith('/')) files.push({ name, data });
  }
  // Корень — папка, где лежат server_scripts / data (в zip обычно есть обёртка kubejs/)
  const rel = (n) => {
    const parts = n.replaceAll('\\', '/').split('/');
    const i = parts.findIndex((p) =>
      ['server_scripts', 'startup_scripts', 'client_scripts', 'data', 'assets', 'config'].includes(p),
    );
    return i >= 0 ? parts.slice(i).join('/') : null;
  };
  const kept = files
    .map((f) => ({ ...f, rel: rel(f.name) }))
    .filter((f) => f.rel && /^(server_scripts|startup_scripts|data)\//.test(f.rel));
  if (!kept.length) throw new Error(`в ${input} нет server_scripts/ или data/ — это не папка kubejs`);
  fs.rmSync(dest, { recursive: true, force: true });
  for (const f of kept) {
    const out = path.join(dest, f.rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, f.data);
  }
  fs.writeFileSync(path.join(dest, '.source'), path.basename(input));
  log(`слой ${layer}: ${kept.length} файлов из ${path.basename(input)} → instance/kubejs/${layer}/`);
}

// ---------------------------------------------------------------- песочница

/** Заглушки — чтобы в фильтрах отличать их от настоящих значений */
const ANY = new WeakSet();

/** Заглушка «что угодно»: любые свойства и вызовы, ничего не делает, в строке — свой путь */
function anything(label) {
  const fn = function () {};
  const p = new Proxy(fn, {
    get(_, k) {
      if (k === Symbol.toPrimitive || k === 'toString' || k === 'valueOf' || k === 'toJSON') return () => label;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then' || typeof k === 'symbol') return undefined;
      if (k === 'length') return 0;
      return anything(`${label}.${k}`);
    },
    apply: () => anything(`${label}()`),
    construct: () => anything(`new ${label}`),
    has: () => false,
  });
  ANY.add(p);
  return p;
}

/** Значение из скрипта → JSON (RegExp — { $re }, заглушки — { $unknown }) */
function ser(v, depth = 0) {
  if (depth > 12) return { $unknown: '…' };
  if (v === null || v === undefined) return v ?? null;
  if (v instanceof RegExp || Object.prototype.toString.call(v) === '[object RegExp]')
    return { $re: v.source, $flags: v.flags };
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (ANY.has(v)) return { $unknown: String(v) };
  if (typeof v === 'function') {
    return ANY.has(v) ? { $unknown: String(v) } : { $fn: true };
  }
  if (v.__kjsItem) return v.__kjsItem;
  if (Array.isArray(v)) return v.map((x) => ser(x, depth + 1));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ser(x, depth + 1)]));
  return { $unknown: String(v) };
}

/** Item.of('2x minecraft:stick') → строка-предмет, которую понимают фильтры и сборка JSON */
function itemOf(id, count) {
  if (typeof id !== 'string') return id;
  const m = /^(\d+)x\s+(.+)$/.exec(id);
  const s = new String(m ? m[2] : id);
  s.__kjsItem = m ? m[2] : id;
  s.__count = m ? Number(m[1]) : typeof count === 'number' ? count : 1;
  // Методы ItemStack/Ingredient, которые встречаются в скриптах сборки
  const ref = s.__kjsItem;
  s.toJson = () => (ref.startsWith('#') ? { tag: ref.slice(1) } : { item: ref });
  s.getId = () => ref;
  s.id = ref;
  s.withChance = () => s;
  s.withCount = (n) => itemOf(ref, n);
  s.weakNBT = () => s;
  s.strongNBT = () => s;
  return s;
}

const stackJson = (v) => {
  const s = ser(v);
  if (typeof s === 'string') {
    const count = v?.__count ?? 1;
    return s.startsWith('#') ? { tag: s.slice(1) } : { id: s, ...(count > 1 ? { count } : {}) };
  }
  return s;
};
const ingJson = (v) => {
  const s = ser(v);
  if (typeof s === 'string') return s.startsWith('#') ? { tag: s.slice(1) } : { item: s };
  if (Array.isArray(s)) return s.map((x) => (typeof x === 'string' ? ingJson(x) : x));
  return s;
};

function runLayer(layer) {
  const dir = path.join(INSTANCE, layer, 'server_scripts');
  const rules = [];
  const added = [];
  const errors = [];
  if (!fs.existsSync(dir)) return { rules, added, errors, files: 0 };

  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) files.push(full);
    }
  };
  walk(dir);
  const texts = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
  const priority = (f) => Number(/^\s*\/\/\s*priority:\s*(-?\d+)/m.exec(texts.get(f))?.[1] ?? 0);
  files.sort((a, b) => priority(b) - priority(a) || a.localeCompare(b));

  const relOf = (f) => `${layer}/${path.relative(path.join(INSTANCE, layer), f).replaceAll('\\', '/')}`;
  const tag = (f) => `kubejs://${relOf(f)}`;
  const lineOf = (f, line) => texts.get(f)?.split('\n')[line - 1]?.trim() ?? '';

  /** Где в скриптах сделан вызов: первый кадр стека из файлов kubejs */
  const where = () => {
    for (const fr of new Error().stack.split('\n')) {
      const m = /kubejs:\/\/(.+?):(\d+):\d+/.exec(fr);
      if (m) {
        const file = files.find((f) => relOf(f) === m[1]);
        return { file: m[1], line: Number(m[2]), code: file ? lineOf(file, Number(m[2])) : '' };
      }
    }
    return { file: '?', line: 0, code: '' };
  };

  /** Добавленный рецепт: цепочка .id('…') и любые настройки (.xp(), .heated()…) */
  const addRecipe = (type, json) => {
    const rec = { type, json, id: null, ...where() };
    added.push(rec);
    const chain = new Proxy(function () {}, {
      get(_, k) {
        if (k === 'id') return (id) => ((rec.id = String(id)), chain);
        if (typeof k === 'symbol' || k === 'then') return undefined;
        return () => chain;
      },
      apply: () => chain,
    });
    return chain;
  };

  /**
   * Строка, где записан сам id: удаления часто идут циклом по массиву (ids.forEach(id => event.remove({id}))),
   * и строка вызова одна на всех — а убирать из скрипта надо строку массива.
   */
  const literalOf = (filter, at) => {
    const id = typeof filter === 'string' ? filter : typeof filter?.id === 'string' ? filter.id : null;
    const file = files.find((f) => relOf(f) === at.file);
    if (!id || !file) return {};
    const lines = texts.get(file).split('\n');
    const n = lines.findIndex((l) => l.includes(`'${id}'`) || l.includes(`"${id}"`) || l.includes(`\`${id}\``));
    return n >= 0 && n + 1 !== at.line ? { idLine: n + 1, idCode: lines[n].trim() } : {};
  };

  const event = {
    remove: (filter) => {
      const at = where();
      const f = ser(filter);
      rules.push({ kind: 'remove', filter: f, ...at, ...literalOf(f, at) });
    },
    replaceInput: (filter, from, to) =>
      rules.push({ kind: 'replaceInput', filter: ser(filter), from: ser(from), to: ser(to), ...where() }),
    replaceOutput: (filter, from, to) =>
      rules.push({ kind: 'replaceOutput', filter: ser(filter), from: ser(from), to: ser(to), ...where() }),
    custom: (json) => addRecipe(ser(json)?.type ?? 'unknown', ser(json)),
    shaped: (out, pattern, key) =>
      addRecipe('minecraft:crafting_shaped', {
        type: 'minecraft:crafting_shaped',
        pattern: ser(pattern),
        key: Object.fromEntries(Object.entries(key ?? {}).map(([k, v]) => [k, ingJson(v)])),
        result: stackJson(out),
      }),
    shapeless: (out, ins) =>
      addRecipe('minecraft:crafting_shapeless', {
        type: 'minecraft:crafting_shapeless',
        ingredients: (Array.isArray(ins) ? ins : [ins]).map(ingJson),
        result: stackJson(out),
      }),
    // Ванильные «печные» и прочие хелперы: (выход, вход)
    ...Object.fromEntries(
      ['smelting', 'blasting', 'smoking', 'campfireCooking', 'stonecutting'].map((t) => [
        t,
        (out, input) => {
          const type = `minecraft:${t === 'campfireCooking' ? 'campfire_cooking' : t}`;
          return addRecipe(type, { type, ingredient: ingJson(input), result: stackJson(out) });
        },
      ]),
    ),
    // event.recipes.<мод>.<тип>(...аргументы) — JSON не собрать, сохраняем аргументы (по ним видны предметы)
    recipes: new Proxy(
      {},
      {
        get: (_, ns) =>
          typeof ns === 'symbol'
            ? undefined
            : new Proxy(
                {},
                {
                  get: (_, type) =>
                    typeof type === 'symbol'
                      ? undefined
                      : (...args) =>
                          addRecipe(`${ns}:${String(type).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`, {
                            type: `${ns}:${String(type)}`,
                            // Соглашение хелперов KubeJS: (выход, вход…) — так их различит разбор входов/выходов
                            kubejs_output: ser(args[0]),
                            kubejs_input: args.slice(1).map(ser),
                          }),
                },
              ),
      },
    ),
    findRecipes: () => [],
    findRecipeIds: () => [],
    forEachRecipe: () => {},
    containsRecipe: () => false,
    countRecipes: () => 0,
  };
  const eventProxy = new Proxy(event, {
    get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : anything(`event.${String(k)}`)),
  });

  const recipeCallbacks = [];
  const known = {
    ServerEvents: new Proxy(
      {},
      {
        get: (_, k) =>
          k === 'recipes'
            ? (cb) => typeof cb === 'function' && recipeCallbacks.push(cb)
            : typeof k === 'symbol'
              ? undefined
              : () => {},
      },
    ),
    console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    global: {},
  };
  // Item.of / Ingredient.of / Fluid.of — значения, которые идут в фильтры и JSON
  const ItemApi = new Proxy(
    { of: itemOf, empty: '' },
    { get: (t, k) => (k in t ? t[k] : anything(`Item.${String(k)}`)) },
  );
  const IngredientApi = new Proxy(
    {
      of: (x) => {
        if (typeof x === 'string') return itemOf(x);
        if (x && typeof x === 'object' && !x.toJson) {
          // Массив/объект ингредиентов — оставляем значением, добавляем toJson() как у Ingredient
          const copy = Array.isArray(x) ? [...x] : { ...x };
          Object.defineProperty(copy, 'toJson', { value: () => ingJson(x), enumerable: false });
          return copy;
        }
        return x;
      },
      all: '*',
    },
    { get: (t, k) => (k in t ? t[k] : anything(`Ingredient.${String(k)}`)) },
  );
  const FluidApi = new Proxy(
    { of: (id) => itemOf(id), water: () => itemOf('minecraft:water'), lava: () => itemOf('minecraft:lava') },
    { get: (t, k) => (k in t ? t[k] : anything(`Fluid.${String(k)}`)) },
  );
  Object.assign(known, { Item: ItemApi, Ingredient: IngredientApi, Fluid: FluidApi });

  // Глобальный объект песочницы: стандартные встроенные — настоящие, остальное — заглушки
  const builtins = new Set(Object.getOwnPropertyNames(globalThis));
  const sandbox = new Proxy(known, {
    has: (t, k) => typeof k === 'string' && (k in t || !builtins.has(k)),
    get: (t, k) => {
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      if (builtins.has(k)) return globalThis[k];
      return anything(String(k));
    },
    set: (t, k, v) => ((t[k] = v), true),
  });
  const ctx = vm.createContext(sandbox);

  for (const f of files) {
    try {
      new vm.Script(texts.get(f), { filename: tag(f) }).runInContext(ctx, { timeout: 2000 });
    } catch (e) {
      errors.push({ file: relOf(f), message: String(e?.message ?? e).split('\n')[0] });
    }
  }
  for (const cb of recipeCallbacks) {
    try {
      cb(eventProxy);
    } catch (e) {
      const at = /kubejs:\/\/(.+?):(\d+)/.exec(String(e?.stack));
      errors.push({ file: at ? `${at[1]}:${at[2]}` : '?', message: String(e?.message ?? e).split('\n')[0] });
    }
  }
  return { rules, added, errors, files: files.length };
}

// ---------------------------------------------------------------- kubejs/data — датапак

function dataRecipes(layer) {
  const base = path.join(INSTANCE, layer, 'data');
  const out = [];
  if (!fs.existsSync(base)) return out;
  for (const ns of fs.readdirSync(base)) {
    for (const folder of ['recipe', 'recipes']) {
      const dir = path.join(base, ns, folder);
      if (!fs.existsSync(dir)) continue;
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) walk(full);
          else if (e.name.endsWith('.json')) {
            try {
              const j = JSON.parse(fs.readFileSync(full, 'utf8'));
              const id = `${ns}:${path
                .relative(dir, full)
                .replaceAll('\\', '/')
                .replace(/\.json$/, '')}`;
              out.push({ i: id, t: typeof j.type === 'string' ? j.type : '', s: `kubejs/${layer}/data`, j });
            } catch {
              /* битый JSON игра тоже пропустит */
            }
          }
        }
      };
      walk(dir);
    }
  }
  return out;
}

// ---------------------------------------------------------------- main

function analyze() {
  if (!fs.existsSync(INSTANCE)) {
    log('instance/kubejs нет — импортируйте папку: npm run kubejs -- <zip|папка>');
    return;
  }
  const layers = fs
    .readdirSync(INSTANCE, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => (a === 'pack' ? -1 : b === 'pack' ? 1 : a.localeCompare(b)));

  const rules = [];
  const recipes = [];
  const errors = [];
  const layerInfo = [];
  for (const layer of layers) {
    const r = runLayer(layer);
    const data = dataRecipes(layer);
    rules.push(...r.rules.map((x) => ({ ...x, layer })));
    errors.push(...r.errors.map((x) => ({ ...x, layer })));
    recipes.push(...data);
    let n = 0;
    for (const a of r.added) {
      n++;
      recipes.push({
        i: a.id ?? `kubejs:generated/${a.file.replace(/\.js$/, '').replace(/[^a-z0-9/_.-]/gi, '_')}/${n}`,
        t: a.type,
        s: `kubejs/${a.file}`,
        j: a.json,
        k: { file: a.file, line: a.line, code: a.code, explicitId: Boolean(a.id) },
      });
    }
    let source = '';
    try {
      source = fs.readFileSync(path.join(INSTANCE, layer, '.source'), 'utf8');
    } catch {
      /* импортировано вручную */
    }
    layerInfo.push({
      name: layer,
      source,
      scripts: r.files,
      rules: r.rules.length,
      added: r.added.length,
      data: data.length,
    });
    log(
      `слой ${layer}: скриптов ${r.files}, удалений/замен ${r.rules.length}, добавлено ${r.added.length}, ` +
        `рецептов в data ${data.length}, ошибок ${r.errors.length}`,
    );
  }
  for (const e of errors) log(`  ошибка в ${e.file}: ${e.message}`);

  // Сводка по каталогу: сколько рецептов сборки задевают удаления (сайт считает то же самое у себя)
  const catalogFile = path.join(ROOT, 'public', 'recipes.json');
  if (fs.existsSync(catalogFile)) {
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    // Как на сайте: kubejs/data переопределяет рецепт мода, рецепт скрипта с тем же id — заменяет его
    const byId = new Map(catalog.map((r) => [r.i, r]));
    for (const r of recipes) byId.set(r.i, r);
    const original = [...byId.values()].filter((r) => !r.k);
    let removed = 0;
    let maybe = 0;
    const removes = rules.filter((r) => r.kind === 'remove');
    for (const r of original) {
      const target = { id: r.i, type: r.t, group: r.j?.group, ...recipeRefs(r.j) };
      const m = removes.map((rule) => matchFilter(rule.filter, target));
      if (m.includes(true)) removed++;
      else if (m.includes(null)) maybe++;
    }
    log(`каталог: удалено KubeJS ${removed} рецептов из ${original.length}, неоднозначно ${maybe}`);
  }

  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: Date.now(), layers: layerInfo, rules, recipes, errors }));
  log(`записан public/kubejs.json (${(fs.statSync(OUT).size / 1024).toFixed(0)} КБ)`);
}

const argv = process.argv.slice(2);
try {
  const layerAt = argv.indexOf('--layer');
  const layer = layerAt >= 0 ? argv[layerAt + 1] : 'pack';
  const input = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--layer');
  if (input) {
    if (!/^[a-z0-9_-]{1,32}$/i.test(layer)) throw new Error('--layer: латиница, цифры, _ и -');
    importLayer(input, layer);
  }
  analyze();
} catch (e) {
  console.error('[kubejs]', e.message ?? e);
  process.exit(1);
}
