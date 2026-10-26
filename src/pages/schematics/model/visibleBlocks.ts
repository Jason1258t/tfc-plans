import { EMPTY_BLOCKS, REMOVE, type Schematic } from '@/entities/schematic';
import { blockEntry, inPack, itemName, type ItemIndex } from '@/shared/pack-data';

/** Все блоки всех загруженных схем: id → сколько раз встречается, по убыванию */
export function aggregateBlocks(schematics: Schematic[]) {
  const total = new Map<string, number>();
  for (const s of schematics) for (const [id, n] of s.counts) total.set(id, (total.get(id) ?? 0) + n);
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
    return !to && items && !inPack(items, id) && !EMPTY_BLOCKS.has(id) ? 0 : 1;
  };
  const ordered = (list: typeof blocks) => [0, 1, 2].flatMap((r) => list.filter(({ id }) => rank(id) === r));
  if (!q) return ordered(blocks);
  return ordered(blocks).filter(({ id }) => {
    const to = replace.get(id);
    const hay = [
      id,
      itemName(blockEntry(items, id), ''),
      to === REMOVE ? 'удалён' : (to ?? ''),
      to && to !== REMOVE ? itemName(blockEntry(items, to), '') : '',
    ];
    return hay.join(' ').toLowerCase().includes(q);
  });
}
