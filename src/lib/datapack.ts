import { strToU8, zipSync } from 'fflate';
import { datapackFiles } from './datapackFiles';
import type { Datapack, DatapackEntry } from '../types';
import { recipeHash } from './hash';
import type { ItemIndex } from './items';
import { entryRecipeId, recipePathOf, targetFromJson } from './kubejsFix';
import { kindsOf, TAG_KIND_LABEL, tagFromPath, type TagCatalog } from './tags';
import { recipeRefs } from './recipeRefs';
import { itemRefsOf, kubejsHits, recipePath, type Recipe, type RecipeCatalog } from './recipes';
import { uid } from './util';

export { PACK_FORMAT, zipName } from './datapackFiles';

/** Так сам TFC отключает ванильные рецепты: файл по тому же пути с ложным условием */
export const REMOVAL_JSON = { 'neoforge:conditions': [{ type: 'neoforge:false' }] };

export const sanitizeNamespace = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'tfc_plans';

export const sanitizeFileName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, '_')
    .replace(/^[_/]+|[_/]+$/g, '') || 'recipe';

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export function entryFromRecipe(
  kind: 'add' | 'replace' | 'remove',
  r: Recipe,
  pack: Pick<Datapack, 'namespace' | 'entries'>,
): DatapackEntry {
  if (kind === 'add') {
    // Новый рецепт в своём namespace; имя — от исходного, с суффиксом при совпадении
    const base = sanitizeFileName(r.i.split(':')[1].split('/').pop() ?? 'recipe');
    let name = base;
    let n = 2;
    const taken = new Set(pack.entries.map((e) => e.path));
    while (taken.has(`data/${pack.namespace}/recipe/${name}.json`)) name = `${base}_${n++}`;
    return {
      id: uid(),
      kind,
      path: `data/${pack.namespace}/recipe/${name}.json`,
      content: pretty(r.j),
      recipeType: r.t,
      sourceRecipe: r.i,
      sourceHash: recipeHash(r.j),
    };
  }
  return {
    id: uid(),
    kind,
    path: recipePath(r.i),
    content: pretty(kind === 'remove' ? REMOVAL_JSON : r.j),
    recipeType: r.t,
    sourceRecipe: r.i,
    sourceHash: recipeHash(r.j),
  };
}

/** Тип рецепта из текста JSON (для подсказки при правке) */
/** Рецепт датапака под удалением KubeJS: какие правила его режут (только add/replace — remove и так удаляет) */
export function kubejsIssues(pack: Datapack, catalog: RecipeCatalog | null) {
  const rules = catalog?.kubejs?.rules;
  const out = new Map<string, number[]>();
  if (!rules?.length) return out;
  for (const e of pack.entries) {
    if (e.kind !== 'add' && e.kind !== 'replace') continue;
    const id = entryRecipeId(e.path);
    if (!id) continue;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(e.content);
    } catch {
      continue;
    }
    const hits = kubejsHits(rules, targetFromJson(id, json));
    if (hits.removed.length) out.set(e.id, hits.removed);
  }
  return out;
}

/** Рецепт из датапака с новым id: тот же JSON, другой путь */
export function entryWithId(content: string, id: string, sourceRecipe?: string): DatapackEntry {
  return {
    id: uid(),
    kind: 'add',
    path: recipePathOf(id),
    content,
    recipeType: typeOfContent(content),
    ...(sourceRecipe ? { sourceRecipe } : {}),
  };
}

export function typeOfContent(content: string): string | undefined {
  try {
    const t = (JSON.parse(content) as { type?: unknown }).type;
    return typeof t === 'string' ? t : undefined;
  } catch {
    return undefined;
  }
}

export interface PackIssue {
  path: string;
  message: string;
}

/** Проверки перед экспортом: JSON, пути, дубли */
export function validatePack(pack: Datapack): PackIssue[] {
  const issues: PackIssue[] = [];
  const seen = new Set<string>();
  for (const e of pack.entries) {
    if (!/^data\/[a-z0-9_.-]+\/[a-z0-9_./-]+\.[a-z0-9]+$/.test(e.path))
      issues.push({ path: e.path, message: 'путь должен быть вида data/<ns>/…, только a-z 0-9 _ . - /' });
    if (seen.has(e.path)) issues.push({ path: e.path, message: 'этот путь встречается дважды — победит последний' });
    seen.add(e.path);
    if (e.path.endsWith('.json')) {
      try {
        JSON.parse(e.content);
      } catch (err) {
        issues.push({ path: e.path, message: `ошибка JSON: ${err instanceof Error ? err.message : err}` });
      }
    }
  }
  return issues;
}

/**
 * Расхождения датапака с текущей сборкой: исходный рецепт пропал или изменился (после обновления модов),
 * в файлах упоминаются предметы, которых в сборке больше нет.
 */
export function staleIssues(
  pack: Datapack,
  catalog: RecipeCatalog | null,
  items: ItemIndex | null,
  tags: TagCatalog | null = null,
): PackIssue[] {
  const issues: PackIssue[] = [];
  // Теги, которые датапак определяет сам
  const ownTags = new Set(pack.entries.map((e) => tagFromPath(e.path)?.id).filter(Boolean));
  for (const e of pack.entries) {
    if (catalog?.list.length && e.sourceRecipe) {
      const r = catalog.byId.get(e.sourceRecipe);
      if (!r) issues.push({ path: e.path, message: `рецепта ${e.sourceRecipe} больше нет в сборке` });
      else if (e.sourceHash && recipeHash(r.j) !== e.sourceHash && e.kind !== 'remove')
        issues.push({
          path: e.path,
          message: `${e.kind === 'add' ? 'шаблон' : 'оригинал'} ${e.sourceRecipe} изменился в сборке — сверьте с новой версией`,
        });
    }
    if (items?.list.length && e.path.endsWith('.json') && !tagFromPath(e.path)) {
      try {
        // Жидкости (tfc:metal/copper, …fluid…) и ваниль не проверяем: их нет в библиотеке предметов
        const missing = itemRefsOf(JSON.parse(e.content)).filter(
          (id) => !items.byId.has(id) && !id.startsWith('minecraft:') && !/:metal\/[a-z_]+$|fluid/.test(id),
        );
        if (missing.length)
          issues.push({
            path: e.path,
            message: `нет в сборке: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`,
          });
      } catch {
        /* синтаксис проверяет validatePack */
      }
    }
    if (tags?.list.length && e.path.endsWith('.json') && !tagFromPath(e.path)) {
      try {
        // Рецепт берёт теги предметов или жидкостей; тег блоков с тем же именем ему не подходит — ячейка пустая
        const { inputs, outputs } = recipeRefs(JSON.parse(e.content));
        for (const ref of new Set([...inputs, ...outputs])) {
          if (!ref.startsWith('#')) continue;
          const id = ref.slice(1);
          if (ownTags.has(id)) continue;
          const kinds = kindsOf(tags, id);
          if (kinds.includes('item') || kinds.includes('fluid')) continue;
          issues.push({
            path: e.path,
            message: kinds.length
              ? `тег #${id} есть только у вида «${kinds.map((k) => TAG_KIND_LABEL[k]).join('», «')}», а рецепт берёт теги предметов и жидкостей — в игре на этом месте будет пусто`
              : `тега #${id} в сборке нет — в игре на этом месте будет пусто`,
          });
        }
      } catch {
        /* синтаксис проверяет validatePack */
      }
    }
  }
  return issues;
}

/** zip датапака: файлы — из общего с Node модуля datapackFiles.ts */
export function buildZip(pack: Datapack): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(datapackFiles(pack))) files[path] = strToU8(text);
  return zipSync(files, { level: 6 });
}
