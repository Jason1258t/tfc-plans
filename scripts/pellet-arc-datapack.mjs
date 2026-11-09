// Датапак: пеллеты и брикеты tfcorewashing → слитки в дуговой печи IE.
//
// В сборке дуговая печь плавит только пыльки руд (20 шт. → 1 слиток), а пеллеты (4 пыльки) и брикеты
// (4 пеллеты) в неё не лезут. Скрипт берёт из каталога рецептов (public/ — его собирает `npm run mods`, плюс
// KubeJS и датапаки сайта, как у MCP) все рецепты печи «N пылек → слитки» без добавок, находит пеллету и брикет
// из той же пыльки и пишет рецепты с тем же выходом на пыльку. Если на один слиток уходит не целое число
// пеллет/брикетов, обе стороны умножаются до целых (20 пылек = 5 пеллет → 1 слиток; 5 брикетов = 80 пылек → 4 слитка).
// Энергия и время — пропорционально числу слитков, как если бы печь плавила те же пыльки.
//
// Если у пыльки нет рецепта печи (хромит), он пишется в датапак сам: из нагрева TFC (мБ на пыльку) и литья в форму
// слитка (100 мБ) — N = 100 / мБ пылек → 1 слиток, энергия и время как у руд TFC-IE-Crossover.
//
// Отключённые рецепты (удаления KubeJS, заглушки датапаков сайта — например, боксит в M13) пропускаются.
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
import { flattenTag, isActive, tags } from './mcp/data.mjs';
import { uploadDatapack } from './mcp/datapack-write.mjs';
import { NICK } from './mcp/fmt.mjs';
import { siteRecipes } from './mcp/site-datapacks.mjs';
import { PACK_FORMAT } from '@tfc/core/datapackFiles';
import { recipeHash } from '@tfc/core/hash';

const NS = 'tfc_plans_pellets';
const NAME = 'Пеллеты и брикеты в дуговой печи';
const DESCRIPTION =
  'Пеллеты и брикеты tfcorewashing плавятся в дуговой печи (scripts/pellet-arc-datapack.mjs, TFC Studio)';
const args = process.argv.slice(2);
const upload = args.includes('--upload');
const out = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(ROOT, 'out/pellet_arc_furnace.zip'));

// Каталог рецептов сборки со слоем датапаков сайта; свой датапак не учитывается — он пишется заново
const site = await siteRecipes();
if (site.note) console.warn(`! ${site.note}`);
const recipes = site.cat.list.filter((r) => !r.i.startsWith(`${NS}:`));
const active = recipes.filter(isActive);

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// Теги предметов с учётом правок KubeJS
const expand = (ing) =>
  ing.item ? [ing.item] : ing.tag ? flattenTag(tags(), 'item', [`#${ing.tag}`]).filter((v) => !v.startsWith('#')) : [];

// Сжатие tfcorewashing: «N × вход → 1 × выход» из бесформенных рецептов мода (вход — предмет или тег)
/** id результата → { from: подходящие предметы, count } */
const compress = new Map();
for (const r of active) {
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
function addFile(file, json, source, note) {
  files[file] = JSON.stringify(json, null, 2);
  entries.push({
    id: Math.random().toString(36).slice(2, 10),
    kind: 'add',
    path: file,
    content: files[file],
    recipeType: json.type,
    sourceRecipe: source.i,
    sourceHash: recipeHash(source.j),
    note,
  });
}

// Рецепты печи «N пылек → слитки» без добавок: { r — исходник, powder, n, res, energy, time }
const bases = [];
for (const r of active) {
  if (r.t !== 'immersiveengineering:arc_furnace') continue;
  const j = r.j;
  const powder = j.input?.basePredicate?.item ?? j.input?.item;
  const n = j.input?.count ?? (j.input?.item ? 1 : 0);
  if (!powder || j.additives?.length || j.results?.length !== 1 || j.secondaries?.length) continue;
  bases.push({ r, powder, n, res: j.results[0], energy: j.energy, time: j.time });
}

// Пыльки без рецепта печи: по нагреву TFC и литью в форму слитка
const ORE_ENERGY = 25600; // как у руд TFC-IE-Crossover (касситерит и др.): 20 пылек → 1 слиток
const ORE_TIME = 100;
const covered = new Set(bases.map((b) => b.powder));
for (const powder of new Set([...packed.values()].flatMap(({ base }) => [...base]))) {
  if (covered.has(powder)) continue;
  const heat = active.find(
    (r) => r.t === 'tfc:heating' && r.j.result_fluid?.amount && expand(r.j.ingredient ?? {}).includes(powder),
  );
  const fluid = heat?.j.result_fluid;
  const cast =
    fluid &&
    active.find(
      (r) =>
        r.t === 'tfc:casting' &&
        r.j.mold?.item === 'tfc:ceramic/ingot_mold' &&
        (r.j.fluid?.fluid ?? r.j.fluid?.id) === fluid.id,
    );
  const ingotMb = cast?.j.fluid?.amount;
  if (!cast || !ingotMb || ingotMb % fluid.amount) {
    console.warn(`! ${powder}: нет нагрева TFC с литьём в слиток (или не делится нацело) — пропущен`);
    continue;
  }
  const n = ingotMb / fluid.amount;
  const res = { id: cast.j.result.id };
  const file = `data/${NS}/recipe/arc_furnace/${powder.split(':')[1]}.json`;
  const json = {
    type: 'immersiveengineering:arc_furnace',
    additives: [],
    energy: ORE_ENERGY,
    input: { basePredicate: { item: powder }, count: n },
    results: [res],
    time: ORE_TIME,
  };
  addFile(file, json, heat, `${n} пылек по ${fluid.amount} мБ → 1 слиток (${ingotMb} мБ); по ${heat.i} и ${cast.i}`);
  table.push(`${n} × ${powder} → 1 × ${res.id}   (по нагреву ${fluid.amount} мБ)`);
  // Исходник пеллет и брикетов — тот же нагрев: рецепт из этого датапака сайт не отследит
  bases.push({ r: heat, powder, n, res, energy: ORE_ENERGY, time: ORE_TIME });
}

/** пеллета/брикет → рецепт печи, по которому сделан */
const made = new Map();
for (const { r, powder, n, res, energy, time } of bases) {
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
    const file = `data/${NS}/recipe/arc_furnace/${item.split(':')[1]}.json`;
    addFile(
      file,
      {
        type: 'immersiveengineering:arc_furnace',
        additives: [],
        energy: Math.round((energy * m) / outCount),
        input: { basePredicate: { item }, count: k },
        results: [{ ...res, count: m }],
        time: Math.round((time * m) / outCount),
      },
      r,
      `${k} шт. = ${k * powders} пылек; исходник — ${n} пылек → ${outCount}`,
    );
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
