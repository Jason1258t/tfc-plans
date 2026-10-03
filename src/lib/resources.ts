import type { ChecklistEntry } from '../types';
import type { ExtractedResource } from './gemini';
import { matchItem, type ItemIndex } from './items';
import { uid } from './util';

/**
 * Сливает найденные Gemini ресурсы в чеклист: сопоставляет названия с библиотекой предметов,
 * повторяющиеся предметы суммирует, несопоставленные добавляет текстовыми пунктами.
 */
export function mergeResources(
  list: ChecklistEntry[],
  found: ExtractedResource[],
  items: ItemIndex | null,
): ChecklistEntry[] {
  const next = [...list];
  for (const r of found) {
    const item = items ? matchItem(items, r.name) : undefined;
    if (item) {
      const i = next.findIndex((e) => e.itemId === item.i);
      if (i >= 0) next[i] = { ...next[i], qty: Math.max(next[i].qty ?? 1, r.qty) };
      else next.push({ id: uid(), itemId: item.i, text: item.r ?? item.e, qty: r.qty, got: 0 });
    } else if (!next.some((e) => !e.itemId && e.text === `${r.name} ×${r.qty}`)) {
      next.push({ id: uid(), text: `${r.name} ×${r.qty}`, done: false });
    }
  }
  return next;
}
