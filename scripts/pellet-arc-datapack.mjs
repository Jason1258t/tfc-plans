// Датапак: пеллеты и брикеты tfcorewashing → слитки в дуговой печи IE.
//
// В сборке дуговая печь плавит только пыльки руд (20 шт. → 1 слиток), а пеллеты (4 пыльки) и брикеты
// (4 пеллеты) в неё не лезут. Скрипт берёт из каталога рецептов модов (public/recipes.json — его собирает
// `npm run mods`) все рецепты печи «N пылек → слитки» без добавок, находит пеллету и брикет из той же пыльки
// и пишет рецепты с тем же выходом на пыльку. Если на один слиток уходит не целое число пеллет/брикетов,
// обе стороны умножаются до целых (20 пылек = 5 пеллет → 1 слиток; 5 брикетов = 80 пылек → 4 слитка).
// Энергия и время — пропорционально числу слитков, как если бы печь плавила те же пыльки.
//
// Рецепты печи, которые KubeJS сборки удаляет (public/kubejs.json), пропускаются.
//
//   node scripts/pellet-arc-datapack.mjs [выход.zip] [--upload]   (по умолчанию out/pellet_arc_furnace.zip)
//
// --upload — ещё и положить датапак на сайт (Firestore datapacks, от имени `firebase login`): датапак с тем же
// именем обновляется, иначе создаётся новый. Подпись — TFC_AGENT_NICK (по умолчанию Claude), перед записью — те же
// проверки, что у MCP datapack_put (scripts/mcp/datapack-write.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { ROOT } from './firestore-rest.mjs';
import { PUBLIC } from './mcp/data.mjs';
import { uploadDatapack } from './mcp/datapack-write.mjs';
import { NICK } from './mcp/fmt.mjs';
import { PACK_FORMAT } from '@tfc/core/datapackFiles';
import { recipeHash } from '@tfc/core/hash';
import { matchFilter } from '@tfc/core/recipeFilter';
import { recipeRefs } from '@tfc/core/recipeRefs';

const NS = 'tfc_plans_pellets';
const NAME = 'Пеллеты и брикеты в дуговой печи';
const DESCRIPTION =
  'Пеллеты и брикеты tfcorewashing плавятся в дуговой печи (scripts/pellet-arc-datapack.mjs, TFC Studio)';
const args = process.argv.slice(2);
const upload = args.includes('--upload');
const out = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(ROOT, 'out/pellet_arc_furnace.zip'));

// Данные сборки — public/ основной копии (в git worktree его нет), как у MCP
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(PUBLIC, p), 'utf8'));
const recipes = readJson('recipes.json');
const kubejsPath = path.join(PUBLIC, 'kubejs.json');
const removes = fs.existsSync(kubejsPath)
  ? JSON.parse(fs.readFileSync(kubejsPath, 'utf8')).rules.filter((r) => r.kind === 'remove')
  : [];
if (!removes.length) console.warn('! нет public/kubejs.json — удаления KubeJS не проверяются (npm run kubejs)');

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const removedByKubejs = (id, type, json) => {
  const { inputs, outputs } = recipeRefs(json);
  return removes.some((rule) => matchFilter(rule.filter, { id, type, inputs, outputs }) === true);
};

// Теги предметов из каталога модов (правки тегов KubeJS не учитываются)
const itemTags = new Map();
for (const t of readJson('tags.json').tags)
  if (t.k === 'item') itemTags.set(t.i, [...new Set(t.s.flatMap((s) => s.v))]);
const expand = (ing, seen = new Set()) => {
  if (ing.item) return [ing.item];
  if (!ing.tag || seen.has(ing.tag)) return [];
  seen.add(ing.tag);
  return (itemTags.get(ing.tag) ?? []).flatMap((v) => (v.startsWith('#') ? expand({ tag: v.slice(1) }, seen) : [v]));
};

// Сжатие tfcorewashing: «N × вход → 1 × выход» из бесформенных рецептов мода (вход — предмет или тег)
/** id результата → { from: подходящие предметы, count } */
const compress = new Map();
for (const r of recipes) {
  if (!r.i.startsWith('tfcorewashing:crafting/pellet/') && !r.i.startsWith('tfcorewashing:crafting/briquet/')) continue;
  const ings = r.j.ingredients ?? [];
  const key = JSON.stringify(ings[0]);
  if (!ings.length || ings.some((x) => JSON.stringify(x) !== key) || (r.j.result.count ?? 1) !== 1) {
    console.warn(`! ${r.i}: непривычный рецепт сжатия, пропущен`);
    continue;
  }
  compress.set(r.j.result.id, { from: expand(ings[0]), count: ings.length });
}
/** пеллета/брикет → { base: из каких пылек, powders: сколько пылек в одной штуке } */
const packed = new Map();
for (const [item] of compress) {
  let powders = 1;
  let cur = [item];
  while (cur.length === 1 && compress.has(cur[0])) {
    powders *= compress.get(cur[0]).count;
    cur = compress.get(cur[0]).from;
  }
  packed.set(item, { base: new Set(cur), powders });
}

const files = {
  'pack.mcmeta': JSON.stringify(
    {
      pack: {
        pack_format: PACK_FORMAT,
        description: DESCRIPTION,
      },
    },
    null,
    2,
  ),
};
const table = [];
/** Записи датапака в формате сайта (types.ts, DatapackEntry) */
const entries = [];
/** пеллета/брикет → рецепт печи, по которому сделан */
const made = new Map();
for (const r of recipes) {
  if (r.t !== 'immersiveengineering:arc_furnace') continue;
  const j = r.j;
  const powder = j.input?.basePredicate?.item ?? j.input?.item;
  const n = j.input?.count ?? (j.input?.item ? 1 : 0);
  if (!powder || j.additives?.length || j.results?.length !== 1 || j.secondaries?.length) continue;
  if (removedByKubejs(r.i, r.t, j)) {
    console.warn(`! ${r.i} удаляет KubeJS — пропущен`);
    continue;
  }
  const res = j.results[0];
  const outCount = res.count ?? 1;
  for (const [item, { base, powders }] of packed) {
    if (!base.has(powder)) continue;
    if (made.has(item)) {
      console.warn(`! ${item}: подходит и к ${r.i}, оставлен ${made.get(item)}`);
      continue;
    }
    made.set(item, r.i);
    // n пылек → outCount слитков; k штук по powders пылек → m слитков, k·powders/n·outCount = m
    const num = outCount * powders;
    const g = gcd(num, n);
    const k = n / g;
    const m = num / g;
    const name = item.split(':')[1];
    const file = `data/${NS}/recipe/arc_furnace/${name}.json`;
    files[file] = JSON.stringify(
      {
        type: 'immersiveengineering:arc_furnace',
        additives: [],
        energy: Math.round((j.energy * m) / outCount),
        input: { basePredicate: { item }, count: k },
        results: [{ ...res, count: m }],
        time: Math.round((j.time * m) / outCount),
      },
      null,
      2,
    );
    entries.push({
      id: Math.random().toString(36).slice(2, 10),
      kind: 'add',
      path: file,
      content: files[file],
      recipeType: r.t,
      sourceRecipe: r.i,
      sourceHash: recipeHash(r.j),
      note: `${k} шт. = ${k * powders} пылек; исходник — ${n} пылек → ${outCount}`,
    });
    table.push(`${k} × ${item} → ${m} × ${res.id ?? JSON.stringify(res)}   (как ${n} × ${powder} → ${outCount})`);
  }
}

for (const [item, { base }] of packed)
  if (!made.has(item)) console.warn(`! ${item}: в дуговой печи нет рецепта из ${[...base].join(' / ')} — пропущен`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zipSync(Object.fromEntries(Object.entries(files).map(([p, s]) => [p, strToU8(s)]))));
console.log(table.sort().join('\n'));
console.log(`\n${table.length} рецептов → ${path.relative(process.cwd(), out)}`);

if (upload) {
  const r = await uploadDatapack({ name: NAME, namespace: NS, description: DESCRIPTION, entries }, NICK);
  for (const w of r.warnings) console.warn(`! ${w}`);
  console.log(`${r.created ? 'создан' : 'обновлён'} датапак на сайте: datapacks/${r.id} (подпись ${NICK})`);
  if (r.deployment) console.log(r.deployment);
}
