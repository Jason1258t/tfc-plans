import { strToU8, zipSync } from 'fflate';
import type { Datapack, DatapackEntry } from '../types';
import { recipeHash } from './hash';
import type { ItemIndex } from './items';
import { itemRefsOf, recipePath, type Recipe, type RecipeCatalog } from './recipes';
import { uid } from './util';

/** pack_format датапаков Minecraft 1.21.1 */
export const PACK_FORMAT = 48;

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
export function staleIssues(pack: Datapack, catalog: RecipeCatalog | null, items: ItemIndex | null): PackIssue[] {
  const issues: PackIssue[] = [];
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
    if (items?.list.length && e.path.endsWith('.json')) {
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
  }
  return issues;
}

export function buildZip(pack: Datapack): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'pack.mcmeta': strToU8(pretty({ pack: { pack_format: PACK_FORMAT, description: pack.description || pack.name } })),
  };
  for (const e of pack.entries) files[e.path] = strToU8(e.content);
  return zipSync(files, { level: 6 });
}

/** Имя zip: кириллица допустима, убираем только символы, запрещённые в именах файлов */
export const zipName = (pack: Datapack) =>
  `${
    pack.name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_') || 'datapack'
  }.zip`;
