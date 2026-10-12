import { useEffect, useState } from 'react';
import { itemName, searchItems, type ItemIndex } from './items';

/**
 * Теги сборки (public/tags.json, собирает scripts/mods/tags.mjs) и их правки KubeJS (public/kubejs.json → tags).
 * Слияние как в игре: источники идут в порядке загрузки, replace обнуляет накопленное, remove убирает значения;
 * KubeJS применяется после датапаков.
 */
export type TagKind = 'item' | 'fluid' | 'block' | 'entity_type';

export const TAG_KIND_LABEL: Record<TagKind, string> = {
  item: 'Предметы',
  fluid: 'Жидкости',
  block: 'Блоки',
  entity_type: 'Сущности',
};

export const TAG_KINDS = Object.keys(TAG_KIND_LABEL) as TagKind[];

export interface TagSource {
  /** Источник: имя jar без .jar или minecraft */
  s: string;
  v: string[];
  /** replace: true — файл обнуляет накопленное */
  r?: 1;
  /** remove (расширение NeoForge) */
  x?: string[];
}

export interface RawTag {
  i: string;
  k: TagKind;
  s: TagSource[];
}

/** Одна операция ServerEvents.tags из KubeJS */
export interface KjsTagOp {
  k: string;
  tag: string;
  op: 'add' | 'remove' | 'removeAll';
  v: string[];
  /** Шаблоны «/regex/» — по составу реестра их не раскрыть */
  re?: string[];
  layer: string;
  file: string;
  line: number;
  code: string;
}

export interface McFluid {
  i: string;
  e: string;
  r?: string;
}

export interface Tag extends RawTag {
  /** «fluid|c:plantoil» */
  key: string;
  ops: KjsTagOp[];
  /** Строка для поиска: id тега и id значений */
  hay: string;
}

export interface TagCatalog {
  list: Tag[];
  byKey: Map<string, Tag>;
  fluids: McFluid[];
  fluidById: Map<string, McFluid>;
  kubejsAt: number | null;
}

export const tagKey = (kind: string, id: string) => `${kind}|${id}`;

let promise: Promise<TagCatalog> | null = null;
let loaded: TagCatalog | null = null;

const fetchJson = <T>(name: string, fallback: T): Promise<T> =>
  fetch(`${import.meta.env.BASE_URL}${name}`)
    .then((r) => (r.ok ? (r.json() as Promise<T>) : fallback))
    .catch(() => fallback);

export function loadTags(): Promise<TagCatalog> {
  promise ??= Promise.all([
    fetchJson<{ tags: RawTag[]; fluids: McFluid[] }>('tags.json', { tags: [], fluids: [] }),
    fetchJson<{ generatedAt?: number; tags?: KjsTagOp[] } | null>('kubejs.json', null),
  ]).then(([raw, kjs]) => {
    const ops = new Map<string, KjsTagOp[]>();
    for (const o of kjs?.tags ?? []) {
      const key = tagKey(o.k, o.tag);
      ops.set(key, [...(ops.get(key) ?? []), o]);
    }
    const map = new Map<string, Tag>();
    for (const t of raw.tags) {
      const key = tagKey(t.k, t.i);
      map.set(key, { ...t, key, ops: ops.get(key) ?? [], hay: '' });
    }
    // Теги, которые есть только в скриптах KubeJS (kubejs:latex_logs…)
    for (const [key, list] of ops) {
      if (map.has(key)) continue;
      const [k, i] = key.split('|');
      map.set(key, { i, k: k as TagKind, s: [], key, ops: list, hay: '' });
    }
    for (const t of map.values()) {
      const ids = new Set<string>();
      for (const s of t.s) for (const v of s.v) ids.add(v);
      for (const o of t.ops) for (const v of o.v) ids.add(v);
      t.hay = `${t.i} ${[...ids].join(' ')}`.toLowerCase();
    }
    const list = [...map.values()].sort((a, b) => a.i.localeCompare(b.i));
    loaded = {
      list,
      byKey: map,
      fluids: raw.fluids,
      fluidById: new Map(raw.fluids.map((f) => [f.i, f])),
      kubejsAt: kjs?.generatedAt ?? null,
    };
    return loaded;
  });
  return promise;
}

export function useTags(): TagCatalog | null {
  const [cat, setCat] = useState(loaded);
  useEffect(() => {
    if (!cat) loadTags().then(setCat);
  }, [cat]);
  return cat;
}

/** «TerraFirmaCraft-NeoForge-1.21.1-4.2.9» → «TerraFirmaCraft» */
export const sourceName = (s: string) => s.replace(/[-_]?(?:neoforge)?[-_]?\d[\w.+-]*$/i, '') || s;

// ---------------------------------------------------------------- состав

const isRef = (v: string) => v.startsWith('#');

/** Прямые значения тега после слияния источников (теги внутри — как «#c:x»); KubeJS — только если withKubejs */
export function directMembers(tag: Tag | undefined, withKubejs = true): string[] {
  const set = new Set<string>();
  for (const s of tag?.s ?? []) {
    if (s.r) set.clear();
    for (const v of s.v) set.add(v);
    for (const x of s.x ?? []) set.delete(x);
  }
  if (withKubejs)
    for (const o of tag?.ops ?? []) {
      if (o.op === 'removeAll') set.clear();
      for (const v of o.v) {
        if (o.op === 'remove') set.delete(v);
        else set.add(v);
      }
    }
  return [...set];
}

/** Состав со всеми вложенными тегами (#…) раскрытыми */
export function flattenTag(cat: TagCatalog, kind: TagKind, members: string[], seen = new Set<string>()): string[] {
  const out = new Set<string>();
  for (const m of members) {
    if (!isRef(m)) {
      out.add(m);
      continue;
    }
    const id = m.slice(1);
    if (seen.has(id)) continue;
    seen.add(id);
    for (const x of flattenTag(cat, kind, directMembers(cat.byKey.get(tagKey(kind, id))), seen)) out.add(x);
  }
  return [...out];
}

const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е');

/** Название значения: предмет/блок — из библиотеки, жидкость — из tags.json */
export function memberName(cat: TagCatalog | null, items: ItemIndex | null, kind: TagKind, id: string): string {
  if (isRef(id)) return id;
  if (kind === 'fluid') {
    const f = cat?.fluidById.get(id);
    if (f) return f.r ?? f.e;
    // Текущая жидкость у вёдер/потоков: «flowing_x» → имя x
    const still = cat?.fluidById.get(id.replace(/(^|[:/])flowing_/, '$1'));
    if (still) return `${still.r ?? still.e} (течёт)`;
    return id;
  }
  const it = items?.byId.get(id);
  return it ? itemName(it) : id;
}

/**
 * Поиск тегов: слова запроса должны найтись в id тега, id значений или названиях значений.
 * Название ищем среди предметов/жидкостей, подходящих под запрос, — и берём теги, где они состоят.
 */
export function searchTags(
  cat: TagCatalog,
  items: ItemIndex | null,
  query: string,
  kind: TagKind | 'all',
  limit = 200,
): Tag[] {
  const q = norm(query).trim();
  const pool = kind === 'all' ? cat.list : cat.list.filter((t) => t.k === kind);
  if (!q) return pool.slice(0, limit);
  const words = q.split(/\s+/);
  // id значений, чьё название подходит под запрос (по-русски)
  const named = new Set<string>();
  if (items) for (const it of searchItems(items, q, 60)) named.add(it.i);
  for (const f of cat.fluids) {
    const hay = norm(`${f.r ?? ''} ${f.e} ${f.i}`);
    if (words.every((w) => hay.includes(w))) named.add(f.i);
  }
  const scored: { t: Tag; score: number }[] = [];
  for (const t of pool) {
    const id = t.i.toLowerCase();
    let score = 0;
    if (words.every((w) => id.includes(w))) score = id === q ? 100 : id.startsWith(q) ? 60 : 40;
    else if (words.every((w) => t.hay.includes(w))) score = 12;
    else if (named.size && [...named].some((n) => t.hay.includes(n.toLowerCase()))) score = 8;
    if (score) scored.push({ t, score: score - t.i.length / 100 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.t);
}

// ---------------------------------------------------------------- правка датапаком

export interface TagEdit {
  /** replace: true — файл заменяет тег целиком, values — полный состав */
  replace: boolean;
  /** Что добавить (в режиме «заменить» — весь список поверх базы вычисляется из added/removed) */
  added: string[];
  removed: string[];
}

/** Путь файла правки: data/<ns>/tags/<вид>/<путь>.json */
export function tagPath(kind: TagKind, id: string): string {
  const [ns, ...rest] = id.split(':');
  return `data/${ns}/tags/${kind}/${rest.join(':')}.json`;
}

/** Обратное: путь в датапаке → вид и id тега (или null, если это не файл тега) */
export function tagFromPath(path: string): { kind: TagKind; id: string } | null {
  const m = /^data\/([a-z0-9_.-]+)\/tags\/(item|fluid|block|entity_type)\/(.+)\.json$/.exec(path);
  return m ? { kind: m[2] as TagKind, id: `${m[1]}:${m[3]}` } : null;
}

/** Состав базы под правку: теги модов и ванили без KubeJS (датапак грузится раньше скриптов) */
export const baseMembers = (tag: Tag | undefined) => directMembers(tag, false);

/** Содержимое файла тега: merge — values + remove; replace — полный список */
export function tagFileContent(edit: TagEdit, base: string[]): string {
  const removed = new Set(edit.removed);
  if (edit.replace) {
    const values = [...new Set([...base.filter((b) => !removed.has(b)), ...edit.added])];
    return JSON.stringify({ replace: true, values }, null, 2) + '\n';
  }
  const out: Record<string, unknown> = { replace: false, values: [...new Set(edit.added)] };
  if (edit.removed.length) out.remove = edit.removed;
  return JSON.stringify(out, null, 2) + '\n';
}

/** Разбор файла тега из датапака обратно в правку; null — не тот формат */
export function parseTagFile(content: string, base: string[]): TagEdit | null {
  let j: unknown;
  try {
    j = JSON.parse(content);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  const o = j as { replace?: unknown; values?: unknown; remove?: unknown };
  const ids = (a: unknown) =>
    Array.isArray(a)
      ? a.flatMap((v) =>
          typeof v === 'string'
            ? [v]
            : typeof (v as { id?: unknown })?.id === 'string'
              ? [(v as { id: string }).id]
              : [],
        )
      : [];
  const values = ids(o.values);
  if (o.replace === true) {
    const keep = new Set(values);
    return {
      replace: true,
      added: values.filter((v) => !base.includes(v)),
      removed: base.filter((b) => !keep.has(b)),
    };
  }
  return { replace: false, added: values, removed: ids(o.remove) };
}

/** Итоговый состав после правки датапака (без KubeJS) */
export function resultMembers(edit: TagEdit, base: string[]): string[] {
  const removed = new Set(edit.removed);
  return [...new Set([...base.filter((b) => !removed.has(b)), ...edit.added])];
}

export const ID_RE = /^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/;
