import { itemName, type ItemIndex } from '@/shared/pack-data/items';
import type { Task } from './types';

/** Текст задачи для модели: заголовок, описание и чеклист (ресурсы — с русскими названиями) */
export function describeTask(task: Task, items: ItemIndex | null): string {
  const lines = [`Задача: ${task.title}`];
  if (task.description.trim()) lines.push(`Описание:\n${task.description}`);
  if (task.checklist.length) {
    lines.push('Чеклист:');
    for (const c of task.checklist) {
      if (c.itemId) {
        const name = itemName(items?.byId.get(c.itemId), c.itemId);
        lines.push(`- ${name} (${c.itemId}): собрано ${c.got ?? 0} из ${c.qty ?? 1}`);
      } else {
        lines.push(`- [${c.done ? 'x' : ' '}] ${c.text}`);
      }
    }
  }
  return lines.join('\n');
}
