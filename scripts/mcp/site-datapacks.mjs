/**
 * Датапаки сайта (Firestore datapacks) как слой рецептов: те, что отмечены «ставить» (install = true), программа tfc
 * кладёт в мир — их рецепты ложатся поверх модов (data.mjs, recipes(site)). Неотмеченные — отдельным списком
 * («есть на сайте, не ставится»). Файлы датапака собирает тот же src/lib/datapackFiles.ts, что и сайт.
 *
 * Чтения Firestore (50 тыс. в сутки на всех): коллекция целиком (сейчас ~10 документов) — раз в 10 минут.
 */
import { datapackFiles } from '../../src/lib/datapackFiles.ts';
import { datapackRecipe, indexRecipe, recipeRecord, recipes, readJson } from './data.mjs';
import { cached, listAll } from './firestore.mjs';

const loadDocs = cached(10 * 60_000, () => listAll('datapacks', ['name', 'description', 'install', 'entries']));
async function load() {
  const docs = await loadDocs();
  const installed = [];
  const other = [];
  const deployed = new Set((readJson('kubejs.json', {}).datapacks ?? []).map((d) => d.id));
  for (const d of docs) {
    const files = datapackFiles({ name: d.name, description: d.description, entries: d.entries ?? [] });
    for (const [file, text] of Object.entries(files)) {
      const r = datapackRecipe(file, text);
      if (!r) continue;
      (d.install && !deployed.has(d.id) ? installed : other).push({
        ...r,
        s: `датапак сайта ${d.name}`,
        dp: d.name,
        dpId: d.id,
        file,
      });
    }
  }
  return { docs: docs.length, installed, other, at: Date.now() };
}

/**
 * Каталог рецептов со слоем датапаков сайта: { cat, other (неставящиеся: byOutput/byInput/byId), note }.
 * Без входа в Firestore — каталог без слоя и note с причиной.
 */
export async function siteRecipes() {
  let layer;
  try {
    layer = await load();
  } catch (e) {
    return {
      cat: recipes(),
      other: null,
      note: `⚠ датапаки сайта не учтены (Firestore: ${String(e.message ?? e).slice(0, 160)})`,
    };
  }
  const cat = recipes(layer.installed);
  if (!layer.otherCat) {
    const byOutput = new Map();
    const byInput = new Map();
    const list = layer.other.map((r) => recipeRecord(r, 'site-datapack', cat.rules));
    for (const r of list) indexRecipe(r, byOutput, byInput);
    layer.otherCat = { list, byOutput, byInput, byId: new Map(list.map((r) => [r.i, r])) };
  }
  return { cat, other: layer.otherCat, note: null };
}
