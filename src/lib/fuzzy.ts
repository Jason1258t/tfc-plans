import Fuse from 'fuse.js';
import type { ItemIndex, McItem } from './items';

/**
 * Нечёткий поиск по библиотеке предметов (Fuse.js): оценка похожести 0..1, прощает опечатки,
 * окончания («дубовая доска» ~ «дубовые доски») и разный порядок слов в id.
 *
 * Fuse на всех 13 тыс. предметах — ~150 мс на запрос, поэтому сначала отбираем предметы,
 * у которых совпадает основа хотя бы одного слова (первые 4 буквы — окончания не мешают),
 * и уже по ним считаем похожесть.
 */
export interface Candidate {
  item: McItem;
  /** 0..1, 1 — полное совпадение */
  similarity: number;
}

type Doc = McItem & { w: string };

const FUSE_OPTIONS = {
  keys: [
    { name: 'e', weight: 0.4 },
    { name: 'w', weight: 0.35 },
    { name: 'r', weight: 0.25 },
  ],
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.4,
  minMatchCharLength: 2,
};

const STEM = 4;
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replaceAll('ё', 'е')
    .split(/[^a-zа-я0-9]+/)
    .filter((t) => t.length >= 3);
const stem = (t: string) => t.slice(0, STEM);

let cached: { idx: ItemIndex; docs: Doc[]; byStem: Map<string, number[]> } | null = null;

function getIndex(idx: ItemIndex) {
  if (cached?.idx === idx) return cached;
  // w — путь id словами: «tfc:wood/planks/oak» → «wood planks oak»
  const docs: Doc[] = idx.list.map((it) => ({ ...it, w: it.i.split(':')[1].replace(/[/_]/g, ' ') }));
  const byStem = new Map<string, number[]>();
  docs.forEach((d, n) => {
    for (const st of new Set(tokens(`${d.e} ${d.r ?? ''} ${d.w}`).map(stem))) {
      const list = byStem.get(st);
      if (list) list.push(n);
      else byStem.set(st, [n]);
    }
  });
  cached = { idx, docs, byStem };
  return cached;
}

/** Несколько запросов → объединённый список лучших кандидатов (по лучшей похожести) */
export function fuzzyCandidates(idx: ItemIndex, queries: string[], limit = 12, minSimilarity = 0.55): Candidate[] {
  const { docs, byStem } = getIndex(idx);
  const qs = [...new Set(queries.map((s) => s.trim()).filter((s) => s.length >= 2))];

  // Предварительный отбор: предметы, где встречается основа хотя бы одного слова запросов
  const pool = new Set<number>();
  for (const q of qs) for (const t of tokens(q)) for (const n of byStem.get(stem(t)) ?? []) pool.add(n);
  if (!pool.size) return [];
  const fuse = new Fuse([...pool].map((n) => docs[n]), FUSE_OPTIONS);

  const best = new Map<string, Candidate>();
  for (const q of qs) {
    for (const r of fuse.search(q, { limit: limit * 2 })) {
      const similarity = 1 - (r.score ?? 1);
      if (similarity < minSimilarity) continue;
      const prev = best.get(r.item.i);
      if (!prev || prev.similarity < similarity) best.set(r.item.i, { item: idx.byId.get(r.item.i)!, similarity });
    }
  }
  return [...best.values()].sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
