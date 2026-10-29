// Датапак: гладкий камень и прочие «только долотом» блоки — на камнерезе и в прессе Create.
//
// Гладкие породы TFC, резные кирпичи, гладкий и тёсаный песчаник, полированный алебастр и т. п. в сборке делаются
// только долотом (режим «гладко» — в мире или на верстаке), а пилы WoodenCog KubeJS сборки удалила целиком.
// Скрипт берёт из каталога рецептов модов (public/recipes.json — его собирает `npm run mods`) все рецепты долота
// в режиме tfc:smooth для каменных блоков и пишет:
//   а) камнерез: тот же вход → тот же выход, 1:1; и из полученного блока — его плиты, ступени и стены, если у них
//      есть верстачный рецепт (число на один блок — как у верстака: плита 2, ступени и стена 1);
//   б) пресс Create над чашей с нагревом (горелка — жёлтое пламя, heated): природный камень → гладкий той же
//      породы, без жидкости. Вход — один блок, которого нет в других рецептах чаши: Create не выбирает между
//      рецептами с одинаковым входом (4 камешка + лава уже дают природный камень на перегреве).
//
// Рецепты долота, которые KubeJS сборки удаляет (public/kubejs.json), и выходы, у которых камнерез уже есть,
// пропускаются. Медные/железные/деревянные блоки теплиц Firmalife (снятие окиси долотом) — не камень, не берём.
//
//   node scripts/smooth-stone-datapack.mjs [выход.zip] [--upload]   (по умолчанию out/smooth_stone.zip)
//
// --upload — ещё и положить датапак на сайт (Firestore datapacks, от имени `firebase login`): датапак с тем же
// именем обновляется, иначе создаётся новый. Подпись — TFC_NICK или git user.name.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { DOCS, ROOT, deployer, fromValue, toValue, token } from './firestore-rest.mjs';
import { PACK_FORMAT } from '../src/lib/datapackFiles.ts';
import { recipeHash } from '../src/shared/lib/hash.ts';
import { matchFilter } from '../src/shared/pack-data/recipeFilter.ts';
import { recipeRefs } from '../src/shared/pack-data/recipeRefs.ts';

const NS = 'tfc_plans_smooth';
const NAME = 'Гладкий камень на камнерезе и в прессе';
const DESCRIPTION =
  'Гладкие породы, резные кирпичи, песчаник, алебастр, их плиты, ступени и стены — на камнерезе; гладкие породы — в прессе Create с нагревом (scripts/smooth-stone-datapack.mjs, TFC Планы)';
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

/** блок → верстачные рецепты его плиты/ступеней/стены (сетка только из этого блока) */
const shapes = new Map();
for (const r of recipes) {
  if (r.t !== 'minecraft:crafting_shaped' || !/_(slab|stairs|wall)$/.test(r.j.result?.id ?? '') || !active(r)) continue;
  const keys = Object.values(r.j.key ?? {});
  if (keys.length !== 1 || !keys[0].item) continue;
  shapes.set(keys[0].item, [...(shapes.get(keys[0].item) ?? []), r]);
}

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

  // Плиты, ступени, стены из этого блока: число — как у верстака на один блок (плита 6 из 3 → 2, ступени 8 из 6 → 1)
  for (const s of shapes.get(result) ?? []) {
    const shape = s.j.result.id;
    if (cut.has(shape)) {
      console.warn(`! ${shape}: камнерез уже есть — пропущен`);
      continue;
    }
    const cells = s.j.pattern.join('').replace(/ /g, '').length;
    const count = Math.max(1, Math.floor((s.j.result.count ?? 1) / cells));
    const [sns, sname] = shape.split(':');
    add(
      `data/${NS}/recipe/stonecutting/${sns}/${sname}.json`,
      { type: 'minecraft:stonecutting', ingredient: { item: result }, result: { id: shape, count } },
      s,
      `верстак: ${cells} → ${s.j.result.count ?? 1}`,
    );
    table.push(`камнерез: ${result} → ${count} × ${shape}`);
  }

  // Пресс — только для гладких пород: природный камень той же породы, без жидкости
  const rock = /^tfc:rock\/smooth\/([a-z_]+)$/.exec(result)?.[1];
  if (!rock) continue;
  const raw = `tfc:rock/raw/${rock}`;
  if (!inputs.includes(raw)) {
    console.warn(`! ${r.i}: среди входов долота нет ${raw} — пресс для ${result} пропущен`);
    continue;
  }
  add(
    `data/${NS}/recipe/compacting/${ns}/${name}.json`,
    {
      type: 'create:compacting',
      heat_requirement: 'heated',
      ingredients: [{ item: raw }],
      results: [{ id: result }],
    },
    r,
    'природный камень, нагрев',
  );
  table.push(`пресс (нагрев): ${raw} → ${result}`);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zipSync(Object.fromEntries(Object.entries(files).map(([p, s]) => [p, strToU8(s)]))));
console.log(table.sort().join('\n'));
console.log(`\n${table.length} рецептов → ${path.relative(process.cwd(), out)}`);

if (upload) {
  const auth = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
  const nick = deployer('Claude');
  let existing = null;
  for (let pageToken = ''; ;) {
    const res = await fetch(`${DOCS}/datapacks?pageSize=300${pageToken && `&pageToken=${pageToken}`}`, {
      headers: auth,
    });
    if (!res.ok) throw new Error(`чтение datapacks: ${res.status} ${await res.text()}`);
    const page = await res.json();
    existing ??= (page.documents ?? []).find((d) => fromValue(d.fields.name ?? { nullValue: null }) === NAME);
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  const now = Date.now();
  const data = { name: NAME, namespace: NS, description: DESCRIPTION, entries, updatedBy: nick, updatedAt: now };
  if (!existing) Object.assign(data, { author: nick, createdAt: now });
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]));
  const mask = Object.keys(data)
    .map((k) => `updateMask.fieldPaths=${k}`)
    .join('&');
  const res = existing
    ? await fetch(`https://firestore.googleapis.com/v1/${existing.name}?${mask}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ fields }),
      })
    : await fetch(`${DOCS}/datapacks`, { method: 'POST', headers: auth, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`запись датапака: ${res.status} ${await res.text()}`);
  const id = (await res.json()).name.split('/').pop();
  console.log(`${existing ? 'обновлён' : 'создан'} датапак на сайте: datapacks/${id} (подпись ${nick})`);
}
