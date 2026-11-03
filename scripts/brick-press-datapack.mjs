// Датапак: кирпичные блоки — в прессе Create (чаша + пресс) и известковая вода из флюса.
//
// 1. Кирпичные блоки TFC и соседних модов делаются на верстаке по сетке 3×3 из кирпичей и строительного
//    раствора (5 кирпичей + 4 раствор → 4 блока). Автоматизировать такую сетку можно только механическим
//    крафтером на 9 слотов — для завода стройматериалов это громоздко. Скрипт берёт из каталога рецептов
//    (public/recipes.json — его собирает `npm run mods`) все такие рецепты и переносит их в пресс Create:
//    чаша (basin) + механический пресс. Соотношение то же, что у верстака: 5 кирпичей + 4 раствора → 4 блока
//    (у Firmalife — 1 блок, как в оригинале).
//    Чаша берёт по одному предмету на каждую запись ingredients (BasinRecipe.apply: extractItem(..., 1)), а не
//    по полю count — поэтому кирпичи и раствор перечислены столько раз, сколько их в сетке (как в ванильном
//    рецепте льда: 9 записей snow_block).
//
// 2. Известковая вода: бочка TFC и смеситель IE принимают флюс ИЛИ известь (составной input), а смешивание
//    Create умело только известь. Добавляется второй рецепт Create-смешивания — вода + флюс.
//
// Рецепты, которые KubeJS сборки удаляет (public/kubejs.json), и выходы, у которых рецепт в прессе уже есть,
// пропускаются.
//
//   node scripts/brick-press-datapack.mjs [выход.zip] [--upload]   (по умолчанию out/brick_press.zip)
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
import { PACK_FORMAT } from '@tfc/core/datapackFiles';
import { recipeHash } from '@tfc/core/hash';
import { matchFilter } from '@tfc/core/recipeFilter';
import { recipeRefs } from '@tfc/core/recipeRefs';

const NS = 'tfc_plans_factory';
const NAME = 'Кирпичи в прессе и известь из флюса';
const DESCRIPTION =
  'Кирпичные блоки (камень, глина, огнеупор, алебастр, Firmalife, Beneath) — в прессе Create из кирпичей и раствора; известковая вода через смешивание Create ещё и из флюса (scripts/brick-press-datapack.mjs, TFC Studio)';
const LIMEWATER_MIXING = {
  type: 'create:mixing',
  ingredients: [{ item: 'tfc:powder/flux' }, { type: 'neoforge:single', fluid: 'minecraft:water', amount: 500 }],
  results: [{ id: 'tfc:limewater', amount: 500 }],
};
const args = process.argv.slice(2);
const upload = args.includes('--upload');
const out = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(ROOT, 'out/brick_press.zip'));

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

/** выходы, у которых рецепт в прессе уже есть */
const pressed = new Set(
  recipes
    .filter((r) => r.t === 'create:compacting' && active(r))
    .map((r) => r.j.results?.[0]?.id ?? r.j.result?.id)
    .filter(Boolean),
);

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
    ...(source ? { sourceRecipe: source.i, sourceHash: recipeHash(source.j) } : {}),
    note,
  });
};

// Верстачная сетка 3×3 из кирпичей и раствора: два разных ключа, один из них — tfc:mortar.
const mortar = 'tfc:mortar';
let bricks = 0;
for (const r of recipes) {
  if (r.t !== 'minecraft:crafting_shaped') continue;
  const pattern = r.j.pattern;
  if (!pattern || pattern.length !== 3 || pattern.some((row) => row.length !== 3)) continue;
  const keys = Object.entries(r.j.key ?? {});
  if (keys.length !== 2) continue;
  const mortarKey = keys.find(([, v]) => v.item === mortar)?.[0];
  const brickEntry = keys.find(([k]) => k !== mortarKey);
  if (!mortarKey || !brickEntry || !brickEntry[1].item || !/brick/.test(brickEntry[1].item)) continue;
  const [brickKey, brickIngredient] = brickEntry;
  const result = typeof r.j.result === 'string' ? null : r.j.result;
  if (!result?.id) {
    console.warn(`! ${r.i}: непривычный выход, пропущен`);
    continue;
  }
  if (!active(r)) {
    console.warn(`! ${r.i} удаляет KubeJS — пропущен`);
    continue;
  }
  if (pressed.has(result.id)) {
    console.warn(`! ${result.id}: рецепт в прессе уже есть — пропущен`);
    continue;
  }
  const cells = pattern.join('');
  const countBricks = [...cells].filter((c) => c === brickKey).length;
  const countMortar = [...cells].filter((c) => c === mortarKey).length;
  if (!countBricks || !countMortar) continue;
  const [ns, name] = result.id.split(':');
  const ingredients = [
    ...Array.from({ length: countBricks }, () => ({ item: brickIngredient.item })),
    ...Array.from({ length: countMortar }, () => ({ item: mortar })),
  ];
  add(
    `data/${NS}/recipe/compacting/${ns}/${name}.json`,
    { type: 'create:compacting', ingredients, results: [{ id: result.id, count: result.count ?? 1 }] },
    r,
    `верстак: ${countBricks} кирпичей + ${countMortar} раствора → ${result.count ?? 1}`,
  );
  table.push(
    `пресс: ${countBricks} × ${brickIngredient.item} + ${countMortar} × ${mortar} → ${result.count ?? 1} × ${result.id}`,
  );
  bricks++;
}

const limewaterSource = recipes.find((r) => r.i === 'tfc:barrel/limewater');
add(
  `data/${NS}/recipe/mixing/limewater_flux.json`,
  LIMEWATER_MIXING,
  limewaterSource,
  'вода + флюс, как составной вход бочки TFC (флюс или известь)',
);
table.push('смешивание: 500 мБ воды + флюс → 500 мБ известковой воды');

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zipSync(Object.fromEntries(Object.entries(files).map(([p, s]) => [p, strToU8(s)]))));
console.log(table.sort().join('\n'));
console.log(`\n${bricks + 1} рецептов → ${path.relative(process.cwd(), out)}`);

if (upload) {
  const r = await uploadDatapack({ name: NAME, namespace: NS, description: DESCRIPTION, entries }, NICK);
  for (const w of r.warnings) console.warn(`! ${w}`);
  console.log(`${r.created ? 'создан' : 'обновлён'} датапак на сайте: datapacks/${r.id} (подпись ${NICK})`);
  if (r.deployment) console.log(r.deployment);
}
