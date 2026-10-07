/**
 * Справочник сборки (public/reference.json): жилы руд, топливо, еда, температуры металлов.
 * Источники — data/ из ванили и jar модов в порядке загрузки: поздние перекрывают ранние, как датапаки;
 * теги складываются (если не replace).
 */
import fs from 'node:fs';
import path from 'node:path';

/** Все файлы data/<ns>/<sub>/**.json → Map("ns:path", { json, source }) с перекрытием поздними */
function collect(dataDirs, sub, parse, filter = () => true) {
  const out = new Map();
  for (const { dir, source } of dataDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const ns of fs.readdirSync(dir)) {
      const base = path.join(dir, ns, sub);
      if (!fs.existsSync(base)) continue;
      for (const rel of fs.readdirSync(base, { recursive: true })) {
        if (!rel.endsWith('.json')) continue;
        const p = rel.slice(0, -5).split(path.sep).join('/');
        if (!filter(p)) continue;
        const json = parse(fs.readFileSync(path.join(base, rel), 'utf8'));
        if (json && typeof json === 'object') out.set(`${ns}:${p}`, { json, source });
      }
    }
  }
  return out;
}

/** Теги предметов: складываем значения по всем источникам, раскрываем вложенные #теги */
function itemTags(dataDirs, parse) {
  const raw = new Map();
  for (const { dir } of dataDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const ns of fs.readdirSync(dir)) {
      const base = path.join(dir, ns, 'tags', 'item');
      if (!fs.existsSync(base)) continue;
      for (const rel of fs.readdirSync(base, { recursive: true })) {
        if (!rel.endsWith('.json')) continue;
        const id = `${ns}:${rel.slice(0, -5).split(path.sep).join('/')}`;
        const json = parse(fs.readFileSync(path.join(base, rel), 'utf8'));
        if (!json || !Array.isArray(json.values)) continue;
        const values = json.values.map((v) => (typeof v === 'string' ? v : v?.id)).filter(Boolean);
        raw.set(id, json.replace ? values : [...(raw.get(id) ?? []), ...values]);
      }
    }
  }
  const resolved = new Map();
  const resolve = (id, stack = new Set()) => {
    if (resolved.has(id)) return resolved.get(id);
    if (stack.has(id)) return [];
    stack.add(id);
    const out = new Set();
    for (const v of raw.get(id) ?? []) {
      if (v.startsWith('#')) for (const x of resolve(v.slice(1), stack)) out.add(x);
      else out.add(v);
    }
    const list = [...out];
    resolved.set(id, list);
    return list;
  };
  for (const id of raw.keys()) resolve(id);
  return resolved;
}

/** Ингредиент TFC/ванили → список id предметов (item, tag, массив, вложенный ingredient) */
function ingredientItems(ing, tags) {
  if (!ing) return [];
  if (Array.isArray(ing)) return [...new Set(ing.flatMap((i) => ingredientItems(i, tags)))];
  if (typeof ing === 'string') return ing.startsWith('#') ? (tags.get(ing.slice(1)) ?? []) : [ing];
  if (ing.item) return [ing.item];
  if (ing.tag) return tags.get(ing.tag) ?? [];
  if (ing.ingredient) return ingredientItems(ing.ingredient, tags);
  if (ing.items) return ingredientItems(ing.items, tags);
  return [];
}

const ingredientLabel = (ing) => (ing?.tag ? `#${ing.tag}` : (ing?.item ?? null));

const GRADES = ['poor', 'normal', 'rich', 'single', 'deposit'];

/**
 * Блок жилы → предмет и минерал. Руда в породе («tfc:ore/normal_native_copper/rhyolite») —
 * предмет без породы («tfc:ore/normal_native_copper»); россыпь («tfc:deposit/native_copper/rhyolite»)
 * — своя для каждой породы, оставляем как есть; прочее (дайки, гравий) — сам блок.
 */
function oreOf(block, rocks) {
  const parts = block.split('/');
  const inRock = rocks.some((r) => r.endsWith(`/${parts.at(-1)}`));
  const graded = block.match(/^([a-z0-9_.-]+):ore\/(poor|normal|rich)_([^/]+)(\/[^/]+)?$/);
  if (graded)
    return {
      item: `${graded[1]}:ore/${graded[2]}_${graded[3]}`,
      grade: graded[2],
      mineral: `${graded[1]}:${graded[3]}`,
    };
  const deposit = block.match(/^([a-z0-9_.-]+):deposit\/([^/]+)/);
  if (deposit) return { item: block, grade: 'deposit', mineral: `${deposit[1]}:${deposit[2]}` };
  const single = block.match(/^([a-z0-9_.-]+):ore\/([^/]+)/);
  if (single) {
    const item = inRock && parts.length > 2 ? parts.slice(0, -1).join('/') : block;
    return { item, grade: 'single', mineral: `${single[1]}:${single[2]}` };
  }
  return { item: block, grade: 'single', mineral: block };
}

function veinRecord(id, { json, source }) {
  const c = json.config ?? {};
  const type = String(json.type ?? '').replace(/^tfc:/, '');
  const groups = Array.isArray(c.blocks) ? c.blocks : [];
  const rocks = [...new Set(groups.flatMap((g) => (Array.isArray(g.replace) ? g.replace : [])))];
  // Доли по сортам — по первой группе (во всех породах одинаковые); минералы — по всем
  const minerals = new Map();
  for (const g of groups) {
    const with_ = Array.isArray(g.with) ? g.with : g.with ? [g.with] : [];
    const total = with_.reduce((s, w) => s + (w.weight ?? 1), 0) || 1;
    for (const w of with_) {
      const block = typeof w === 'string' ? w : w.block;
      if (!block) continue;
      const o = oreOf(block, rocks);
      const m = minerals.get(o.mineral) ?? { mineral: o.mineral, items: new Map() };
      const cur = m.items.get(o.item) ?? { item: o.item, grade: o.grade, share: 0 };
      if (g === groups[0] || !cur.share) cur.share = Math.round(((w.weight ?? 1) / total) * 100);
      m.items.set(o.item, cur);
      minerals.set(o.mineral, m);
    }
  }
  const ind = c.indicator;
  const isOre = [...minerals.values()].some((m) => [...m.items.keys()].some((i) => /:(ore|deposit)\//.test(i)));
  return {
    id,
    source,
    type,
    kind: isOre ? 'ore' : groups.length ? 'rock' : 'other',
    rarity: c.rarity ?? null,
    density: c.density ?? null,
    size: c.size ?? null,
    height: c.height ?? null,
    radius: c.radius ?? null,
    minY: c.min_y ?? null,
    maxY: c.max_y ?? null,
    rocks,
    minerals: [...minerals.values()].map((m) => {
      // Россыпи у каждой породы свои — в списке достаточно одной (для иконки и доли)
      const list = [...m.items.values()];
      const deposit = list.find((i) => i.grade === 'deposit');
      const items = list.filter((i) => i.grade !== 'deposit');
      if (deposit) items.push(deposit);
      return {
        mineral: m.mineral,
        items: items.sort((a, b) => GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade)),
      };
    }),
    indicator: ind
      ? {
          blocks: (ind.blocks ?? []).map((b) => (typeof b === 'string' ? b : b.block)).filter(Boolean),
          depth: ind.depth ?? null,
          rarity: ind.rarity ?? null,
        }
      : null,
  };
}

// ---------------------------------------------------------------- цепочка обработки руды до металла

const ID_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const NON_ITEM_KEYS = new Set([
  'type',
  'mode',
  'knapping_type',
  'sound',
  'texture',
  'category',
  'group',
  'trait',
  'modid',
]);
/** Типы, которые не про обработку: обрушения, генерация минералов IE */
const SKIP_TYPES = new Set(['tfc:collapse', 'tfc:landslide', 'immersiveengineering:mineral_mix', 'tfc:chisel']);

/**
 * Входы и основной выход рецепта. Для цепочки руды важен именно основной продукт: побочные
 * (secondaries, второй и дальше элемент results, шаги sequence) уводят в камень и порошки пород.
 */
function recipeRefs(json, tags) {
  const ins = new Set();
  const outs = new Set();
  const walk = (node, target, key) => {
    if (typeof node === 'string') {
      if (NON_ITEM_KEYS.has(key) || !ID_RE.test(node)) return;
      if (key === 'tag') for (const t of tags.get(node) ?? []) target.add(t);
      else target.add(node);
      return;
    }
    if (Array.isArray(node)) return node.forEach((v) => walk(v, target, key));
    if (node && typeof node === 'object')
      for (const [k, v] of Object.entries(node)) {
        if (/conditions|sequence|secondar|transitional|remainder/i.test(k)) continue;
        if (/^results$/i.test(k) && Array.isArray(v)) walk(v[0], outs, k);
        else if (/result|output/i.test(k)) walk(v, outs, k);
        else walk(v, target, k);
      }
  };
  walk(json, ins, '');
  return { ins, outs };
}

/**
 * Кратчайшая цепочка «предмет → … → жидкий металл»: шаги через рецепты, где предмет на входе,
 * до первого предмета, который плавится (tfc:heating с result_fluid). На каждом шаге — все способы
 * (молот, дробилка, пресс…), которыми можно сделать этот переход.
 */
function buildChains(starts, recipes, tags, smelt) {
  const byInput = new Map();
  for (const [id, r] of recipes) {
    const t = r.json?.type;
    if (typeof t !== 'string' || SKIP_TYPES.has(t) || t === 'tfc:heating') continue;
    const { ins, outs } = recipeRefs(r.json, tags);
    for (const i of ins) {
      if (outs.has(i)) continue;
      const list = byInput.get(i) ?? [];
      list.push({ id, type: t, outs: [...outs] });
      byInput.set(i, list);
    }
  }
  const chains = {};
  for (const start of starts) {
    if (smelt[start]) continue;
    // BFS по предметам
    const prev = new Map([[start, null]]);
    let queue = [start];
    let found = null;
    for (let depth = 0; depth < 5 && queue.length && !found; depth++) {
      const next = [];
      for (const item of queue) {
        for (const r of byInput.get(item) ?? []) {
          for (const o of r.outs) {
            if (prev.has(o)) continue;
            prev.set(o, { from: item, type: r.type });
            if (smelt[o] && !found) found = o;
            next.push(o);
          }
        }
      }
      queue = next;
    }
    if (!found) continue;
    const path = [];
    for (let cur = found; prev.get(cur); cur = prev.get(cur).from)
      path.unshift({ from: prev.get(cur).from, item: cur });
    chains[start] = path.map((s) => ({
      item: s.item,
      methods: [...new Set((byInput.get(s.from) ?? []).filter((r) => r.outs.includes(s.item)).map((r) => r.type))],
    }));
  }
  return chains;
}

export function buildReference(dataDirs, recipes, parse) {
  const tags = itemTags(dataDirs, parse);

  const veins = [
    ...collect(
      dataDirs,
      'worldgen/configured_feature',
      parse,
      (p) => p.startsWith('vein/') || /(^|\/)[^/]*vein[^/]*$/.test(p),
    ),
  ]
    .filter(([, v]) => Array.isArray(v.json?.config?.blocks) || v.json?.config?.indicator)
    .map(([id, v]) => veinRecord(id, v));

  // Плавка руд и других предметов: heating с жидким результатом
  const smelt = {};
  for (const [, r] of recipes) {
    const j = r.json;
    if (j?.type !== 'tfc:heating' || !j.result_fluid) continue;
    for (const item of ingredientItems(j.ingredient, tags)) {
      smelt[item] = {
        fluid: j.result_fluid.id ?? j.result_fluid.fluid,
        mb: j.result_fluid.amount,
        temp: j.temperature,
      };
    }
  }

  const metals = [...collect(dataDirs, 'tfc/fluid_heat', parse)].map(([id, { json, source }]) => ({
    id,
    source,
    fluid: json.fluid ?? null,
    melt: json.melt_temperature ?? json.temperature ?? null,
    specificHeat: json.specific_heat_capacity ?? null,
  }));

  const fuels = [...collect(dataDirs, 'tfc/fuel', parse)].map(([id, { json, source }]) => ({
    id,
    source,
    ingredient: ingredientLabel(json.ingredient),
    items: ingredientItems(json.ingredient, tags),
    temp: json.temperature ?? null,
    duration: json.duration ?? null,
    purity: json.purity ?? null,
  }));

  const NUTRIENTS = ['grain', 'fruit', 'vegetables', 'protein', 'dairy'];
  const foods = [...collect(dataDirs, 'tfc/food', parse)].map(([id, { json, source }]) => ({
    id,
    source,
    ingredient: ingredientLabel(json.ingredient),
    items: ingredientItems(json.ingredient, tags),
    hunger: json.hunger ?? 0,
    saturation: json.saturation ?? 0,
    water: json.water ?? 0,
    decay: json.decay_modifier ?? 1,
    nutrients: Object.fromEntries(NUTRIENTS.filter((n) => json[n]).map((n) => [n, json[n]])),
  }));

  // Цепочки строим только для сортовых руд: у прочих (графит, самоцветы) «путь до металла» бессмыслен
  const oreItems = new Set(
    veins.flatMap((v) =>
      v.minerals.flatMap((m) => m.items.filter((i) => GRADES.indexOf(i.grade) < 3).map((i) => i.item)),
    ),
  );
  const chains = buildChains(oreItems, recipes, tags, smelt);
  // В smelt оставляем только то, что нужно справочнику: руды и концы цепочек
  const needed = new Set([...oreItems, ...Object.values(chains).map((c) => c.at(-1).item)]);
  const smeltUsed = Object.fromEntries(Object.entries(smelt).filter(([k]) => needed.has(k)));

  return { veins, smelt: smeltUsed, chains, metals, fuels, foods, tagCount: tags.size };
}
