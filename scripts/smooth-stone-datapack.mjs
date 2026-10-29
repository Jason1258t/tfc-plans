// Датапак: гладкий камень и прочие «только долотом» блоки — на камнерезе и в прессе Create.
//
// Гладкие породы TFC, резные кирпичи, гладкий и тёсаный песчаник, полированный алебастр и т. п. в сборке делаются
// только долотом (режим «гладко» — в мире или на верстаке), а пилы WoodenCog KubeJS сборки удалила целиком.
// Скрипт берёт из каталога рецептов модов (public/recipes.json — его собирает `npm run mods`) все рецепты долота
// в режиме tfc:smooth для каменных блоков и пишет:
//   а) камнерез: тот же вход → тот же выход, 1:1;
//   б) пресс Create над чашей с нагревом (горелка — жёлтое пламя, heated): булыжник породы + 50 мБ лавы →
//      гладкая порода. Не 4 камешка + лава: это вход рецепта природного камня (перегрев), а пресс с перегревом
//      подходит и под рецепт с нагревом — рецепты бы перехватывали друг друга.
//
// Рецепты долота, которые KubeJS сборки удаляет (public/kubejs.json), и выходы, у которых камнерез уже есть,
// пропускаются. Медные/железные/деревянные блоки теплиц Firmalife (снятие окиси долотом) — не камень, не берём.
//
//   node scripts/smooth-stone-datapack.mjs [выход.zip] [--upload]   (по умолчанию out/smooth_stone.zip)
//
// --upload — ещё и положить датапак на сайт (Firestore datapacks, от имени `firebase login`): датапак с тем же
// именем обновляется, иначе создаётся новый. Подпись — TFC_AGENT_NICK (по умолчанию Claude), перед записью — те же
// проверки, что у MCP datapack_put (scripts/mcp/datapack-write.mjs).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { ROOT } from './firestore-rest.mjs';
import { uploadDatapack } from './mcp/datapack-write.mjs';
import { NICK } from './mcp/fmt.mjs';
import { PACK_FORMAT } from '../src/lib/datapackFiles.ts';
import { recipeHash } from '../src/shared/lib/hash.ts';
import { matchFilter } from '../src/shared/pack-data/recipeFilter.ts';
import { recipeRefs } from '../src/shared/pack-data/recipeRefs.ts';

const NS = 'tfc_plans_smooth';
const NAME = 'Гладкий камень на камнерезе и в прессе';
const DESCRIPTION =
  'Гладкие породы, резные кирпичи, песчаник, алебастр — на камнерезе; гладкие породы — в прессе Create с нагревом (scripts/smooth-stone-datapack.mjs, TFC Планы)';
const LAVA_MB = 50;
const args = process.argv.slice(2);
const upload = args.includes('--upload');
const out = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(ROOT, 'out/smooth_stone.zip'));

// В git worktree public/ нет — данные сборки берём из основной копии
const mainRoot = () =>
  path.dirname(
    path.resolve(ROOT, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim()),
  );
const DATA = fs.existsSync(path.join(ROOT, 'public/recipes.json')) ? ROOT : mainRoot();
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'));
const recipes = readJson('public/recipes.json');
const kubejsPath = path.join(DATA, 'public/kubejs.json');
const removes = fs.existsSync(kubejsPath)
  ? JSON.parse(fs.readFileSync(kubejsPath, 'utf8')).rules.filter((r) => r.kind === 'remove')
  : [];
if (!removes.length) console.warn('! нет public/kubejs.json — удаления KubeJS не проверяются (npm run kubejs)');

const removedByKubejs = (id, type, json) => {
  const { inputs, outputs } = recipeRefs(json);
  return removes.some((rule) => matchFilter(rule.filter, { id, type, inputs, outputs }) === true);
};
const active = (r) => !removedByKubejs(r.i, r.t, r.j);

/** выходы, у которых камнерез уже есть */
const cut = new Set(
  recipes.filter((r) => r.t === 'minecraft:stonecutting' && active(r)).map((r) => r.j.result?.id ?? r.j.result),
);
const asList = (ing) => (Array.isArray(ing) ? ing : [ing]);
const toIngredient = (s) => (s.startsWith('#') ? { tag: s.slice(1) } : { item: s });

const files = {
  'pack.mcmeta': JSON.stringify({ pack: { pack_format: PACK_FORMAT, description: DESCRIPTION } }, null, 2),
};
/** Записи датапака в формате сайта (types.ts, DatapackEntry) */
const entries = [];
const table = [];
const add = (file, json, source, note) => {
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
};

const chisel = recipes.filter(
  (r) => r.t === 'tfc:chisel' && r.j.mode === 'tfc:smooth' && !/greenhouse/.test(JSON.stringify(r.j.result)),
);
for (const r of chisel) {
  const result = typeof r.j.result === 'string' ? r.j.result : r.j.result?.id;
  if (!result) {
    console.warn(`! ${r.i}: непривычный выход долота, пропущен`);
    continue;
  }
  if (!active(r)) {
    console.warn(`! ${r.i} удаляет KubeJS — пропущен`);
    continue;
  }
  const inputs = asList(r.j.ingredient).map((x) => (typeof x === 'string' ? x : (x.item ?? `#${x.tag}`)));
  const [ns, name] = result.split(':');
  if (cut.has(result)) console.warn(`! ${result}: камнерез уже есть — пропущен`);
  else {
    const ingredient = inputs.length === 1 ? toIngredient(inputs[0]) : inputs.map(toIngredient);
    add(
      `data/${NS}/recipe/stonecutting/${ns}/${name}.json`,
      { type: 'minecraft:stonecutting', ingredient, result: { id: result, count: 1 } },
      r,
      `как долото «гладко»: ${inputs.join(' / ')}`,
    );
    table.push(`камнерез: ${inputs.join(' / ')} → ${result}`);
  }

  // Пресс — только для гладких пород: их булыжник есть у каждой породы
  const rock = /^tfc:rock\/smooth\/([a-z_]+)$/.exec(result)?.[1];
  if (!rock) continue;
  const cobble = `tfc:rock/cobble/${rock}`;
  if (!recipes.some((x) => JSON.stringify(x.j).includes(`"${cobble}"`))) {
    console.warn(`! ${cobble}: не найден в рецептах — пресс для ${result} пропущен`);
    continue;
  }
  add(
    `data/${NS}/recipe/compacting/${ns}/${name}.json`,
    {
      type: 'create:compacting',
      heat_requirement: 'heated',
      ingredients: [{ item: cobble }, { type: 'neoforge:single', amount: LAVA_MB, fluid: 'minecraft:lava' }],
      results: [{ id: result }],
    },
    r,
    `булыжник + ${LAVA_MB} мБ лавы, нагрев`,
  );
  table.push(`пресс (нагрев): ${cobble} + ${LAVA_MB} мБ лавы → ${result}`);
}

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
