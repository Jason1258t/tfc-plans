import { getAI, getGenerativeModel, GoogleAIBackend, Schema, type GenerativeModel } from 'firebase/ai';
import { app } from '../firebase';
import type { Task } from '../types';
import type { ItemIndex } from './items';
import { itemName } from './items';

export const geminiEnabled = Boolean(app);

const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.5-flash';

const SYSTEM = `Ты помощник группы игроков в Minecraft-сборке на TerraFirmaCraft (TFC) для Minecraft 1.21.1.
TFC сильно меняет ванильную игру: металлургия через тигли и наковальни, сезоны и климат, гниение еды, питание,
керамика (формы для отливки), выделка кожи, ремёсла через knapping и т.п.
Помогай планировать задачи: разбивай на шаги, перечисляй нужные ресурсы, инструменты и постройки.
Пиши по-русски, в Markdown (заголовки, списки, таблицы, чекбоксы "- [ ]").
Если не уверен в точных цифрах или рецептах TFC — так и пиши, не выдумывай.`;

let model: GenerativeModel | null = null;
function getModel(): GenerativeModel {
  if (!app) throw new Error('Gemini доступен только при подключённом Firebase');
  model ??= getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), {
    model: MODEL,
    systemInstruction: SYSTEM,
  });
  return model;
}

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

export interface AskParams {
  instruction: string;
  taskContext?: string;
  document?: string;
  selection?: string;
}

/** Стриминговый ответ для редактора артефактов. Возвращает накопленный текст в onChunk. */
export async function askGemini(p: AskParams, onChunk: (full: string) => void, signal?: AbortSignal): Promise<string> {
  const parts: string[] = [];
  if (p.taskContext) parts.push(`## Контекст задачи\n${p.taskContext}`);
  if (p.document?.trim()) parts.push(`## Текущий документ\n${p.document}`);
  if (p.selection?.trim()) parts.push(`## Выделенный фрагмент (работай с ним)\n${p.selection}`);
  parts.push(
    `## Запрос\n${p.instruction}\n\nВерни только Markdown-текст результата, без вступлений и без обрамления в \`\`\`.`,
  );

  const res = await getModel().generateContentStream(parts.join('\n\n'), { signal });
  let full = '';
  for await (const chunk of res.stream) {
    full += chunk.text();
    onChunk(full);
  }
  return full;
}

export interface ExtractedResource {
  name: string;
  qty: number;
}

/** Достаёт список ресурсов из произвольного текста плана — для заполнения чеклиста */
export async function extractResources(text: string): Promise<ExtractedResource[]> {
  const m = getGenerativeModel(getAI(app!, { backend: new GoogleAIBackend() }), {
    model: MODEL,
    systemInstruction: SYSTEM,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: Schema.array({
        items: Schema.object({
          properties: {
            name: Schema.string({
              description: 'Каноническое английское название предмета, как в игре (en_us), например "Copper Ingot"',
            }),
            qty: Schema.integer({ description: 'Сколько нужно' }),
          },
        }),
      }),
    },
  });
  const res = await m.generateContent(
    `Выпиши из текста все игровые предметы/ресурсы, которые нужно собрать или скрафтить, с количеством. ` +
      `Если количество не указано — оцени разумно или поставь 1. Не включай постройки и действия.\n\n${text}`,
  );
  const parsed = JSON.parse(res.response.text()) as ExtractedResource[];
  return parsed.filter((r) => r.name && r.qty > 0);
}
