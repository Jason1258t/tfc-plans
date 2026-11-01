import { isPair, pairBlock, parsePair } from '@tfc/core/copycatPairs';
import { EMPTY_BLOCKS, REMOVE, replaceName, type Schematic } from '@/entities/schematic';
import { inPack, type ItemIndex } from '@/shared/pack-data';

/** Все блоки всех загруженных схем: id → сколько раз встречается, по убыванию */
export function aggregateBlocks(schematics: Schematic[], replace: Map<string, string> = new Map()) {
  const total = new Map<string, number>();
  for (const s of schematics) for (const [id, n] of s.counts) total.set(id, (total.get(id) ?? 0) + n);
  // Замена копиката или материала целиком, без строки в схеме (всё внутри пар), — тоже строка: её надо видеть и снять
  const pairs = [...total].flatMap(([id, n]) => {
    const p = parsePair(id);
    return p ? [{ ...p, n }] : [];
  });
  for (const from of replace.keys()) {
    if (total.has(from) || isPair(from)) continue;
    const n = pairs.filter((p) => p.block === from || p.material === from).reduce((a, p) => a + p.n, 0);
    if (n) total.set(from, n);
  }
  return [...total].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/**
 * Строки списка блоков с учётом фильтра: нераспознанные без замены (кроме воздуха) — наверх, их надо разобрать;
 * удалённые — в конец, чтобы не мешались. Поиск — по id, русскому имени и замене.
 */
export function visibleBlocks(
  blocks: { id: string; count: number }[],
  filter: string,
  replace: Map<string, string>,
  items: ItemIndex | null,
) {
  const q = filter.trim().toLowerCase();
  const rank = (id: string) => {
    const to = replace.get(id);
    if (to === REMOVE) return 2;
    return !to && items && !inPack(items, pairBlock(id)) && !EMPTY_BLOCKS.has(id) ? 0 : 1;
  };
  const ordered = (list: typeof blocks) => [0, 1, 2].flatMap((r) => list.filter(({ id }) => rank(id) === r));
  if (!q) return ordered(blocks);
  return ordered(blocks).filter(({ id }) => {
    const to = replace.get(id);
    const hay = [
      id,
      replaceName(items, id),
      to === REMOVE ? 'удалён' : (to ?? ''),
      to && to !== REMOVE ? replaceName(items, to) : '',
    ];
    return hay.join(' ').toLowerCase().includes(q);
  });
}
