import { getAI, getGenerativeModel, GoogleAIBackend, Schema, type GenerativeModel } from 'firebase/ai';
import { app } from '../firebase';
import type { Task } from '../types';
import type { ItemIndex } from './items';
import { itemName } from './items';

export const geminiEnabled = Boolean(app);

/**
 * У каждой модели свой бесплатный лимит (у gemini-3.8-flash — 20 запросов в сутки), поэтому
 * задаём цепочки: если у модели кончился суточный лимит или она недоступна, берём следующую.
 */
const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];
/** Чат в документах — самая умная модель первой */
const CHAT_MODELS = uniq([
  import.meta.env.VITE_GEMINI_MODEL,
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
]);
/** Длинные структурированные тексты (патчноуты) — сначала быстрая, но толковая модель */
const WRITER_MODELS = uniq(['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
/** Простые структурированные задачи (выбор из списка, разбор ресурсов) — сначала лёгкая модель с бо́льшим лимитом */
const FAST_MODELS = uniq([
  import.meta.env.VITE_GEMINI_FAST_MODEL,
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
]);

const SYSTEM = `Ты помощник группы игроков в Minecraft-сборке на TerraFirmaCraft (TFC) для Minecraft 1.21.1.
TFC сильно меняет ванильную игру: металлургия через тигли и наковальни, сезоны и климат, гниение еды, питание,
керамика (формы для отливки), выделка кожи, ремёсла через knapping и т.п.
Помогай планировать задачи: разбивай на шаги, перечисляй нужные ресурсы, инструменты и постройки.
Пиши по-русски, в Markdown (заголовки, списки, таблицы, чекбоксы "- [ ]").
Если не уверен в точных цифрах или рецептах TFC — так и пиши, не выдумывай.`;

function modelFor(name: string, extra: Partial<Parameters<typeof getGenerativeModel>[1]> = {}): GenerativeModel {
  if (!app) throw new Error('Gemini доступен только при подключённом Firebase');
  return getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), {
    model: name,
    systemInstruction: SYSTEM,
    ...extra,
  });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Ждать сервер просит секунды — это минутный лимит или перегрузка, есть смысл повторить */
const shortWait = (msg: string) => {
  if (!/\[(500|503|429)\b|high demand|overloaded|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(msg)) return null;
  if (/retry in \d+h|retry in \d+m\d/i.test(msg)) return null; // суточный лимит — ждать бессмысленно
  const s = Number(msg.match(/retry in ([\d.]+)s/i)?.[1]);
  return s ? Math.min(s * 1000 + 500, 30_000) : 2500;
};
/** Модель не подходит совсем: снята, не найдена или суточный лимит исчерпан */
const skipModel = (msg: string) =>
  /\[404\b|not found|no longer available/i.test(msg) || (/\[429\b|quota/i.test(msg) && shortWait(msg) === null);

/**
 * Запрос с запасными моделями: короткие ошибки (минутный лимит, перегрузка) повторяем на той же модели,
 * при суточном лимите или недоступности — переходим к следующей.
 */
/** Модель иногда принимает запрос и молчит минутами — тогда не ждём, а идём к следующей */
const MODEL_TIMEOUT_MS = 90_000;
class ModelTimeout extends Error {}
const withTimeout = <R>(p: Promise<R>, ms: number) =>
  new Promise<R>((resolve, reject) => {
    const t = setTimeout(() => reject(new ModelTimeout(`модель не ответила за ${ms / 1000} с`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });

async function withFallback<R>(
  models: string[],
  run: (model: string) => Promise<R>,
  timeoutMs = MODEL_TIMEOUT_MS,
): Promise<R> {
  let last: unknown;
  for (const name of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await withTimeout(run(name), timeoutMs);
      } catch (e) {
        last = e;
        const msg = errText(e);
        if (e instanceof ModelTimeout || skipModel(msg)) break;
        const wait = shortWait(msg);
        if (wait === null || attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw last;
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

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

export interface AskParams {
  instruction: string;
  /** Предыдущие реплики диалога с агентом (без контекста документа) */
  history?: ChatTurn[];
  taskContext?: string;
  document?: string;
  selection?: string;
}

/**
 * Стриминговый ответ агента в документе. Контекст (задача, документ, выделение) прикладывается
 * только к текущему сообщению, история диалога — краткая, чтобы не раздувать запрос.
 */
export async function askGemini(p: AskParams, onChunk: (full: string) => void, signal?: AbortSignal): Promise<string> {
  const parts: string[] = [];
  if (p.taskContext) parts.push(`## Контекст задачи\n${p.taskContext}`);
  if (p.document?.trim()) parts.push(`## Текущий документ\n${p.document}`);
  if (p.selection?.trim()) parts.push(`## Выделенный фрагмент (работай с ним)\n${p.selection}`);
  parts.push(
    `## Запрос\n${p.instruction}\n\nОтвечай Markdown-текстом, который можно сразу вставить в документ: без вступлений и без обрамления в \`\`\`. ` +
      `Если вопрос не про изменение документа — просто ответь по существу.`,
  );

  const history = (p.history ?? []).slice(-8).map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
  // Ошибка лимита приходит до первого куска ответа, поэтому запасная модель подхватывает запрос целиком
  const res = await withFallback(CHAT_MODELS, (name) =>
    modelFor(name).startChat({ history }).sendMessageStream(parts.join('\n\n'), { signal }),
  );
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
  const config = {
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
  };
  const res = await withFallback(FAST_MODELS, (name) =>
    modelFor(name, config).generateContent(
      `Выпиши из текста все игровые предметы/ресурсы, которые нужно собрать или скрафтить, с количеством. ` +
        `Если количество не указано — оцени разумно или поставь 1. Не включай постройки и действия.\n\n${text}`,
    ),
  );
  const parsed = JSON.parse(res.response.text()) as ExtractedResource[];
  return parsed.filter((r) => r.name && r.qty > 0);
}

/** Понятное сообщение для частых ошибок настройки Firebase AI Logic */
export function geminiErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('genai config not found'))
    return 'AI Logic не настроен: в консоли Firebase откройте AI Logic → Get started → Gemini Developer API.';
  if (/high demand|overloaded|\[50[03]\b/i.test(msg))
    return 'Gemini сейчас перегружен — попробуйте ещё раз через минуту.';
  if (/\[429\b|quota|RESOURCE_EXHAUSTED/i.test(msg)) {
    const wait = msg.match(/retry in (\d+h)?(\d+m)?/i);
    if (wait?.[1] || wait?.[2])
      return `Исчерпан суточный бесплатный лимит Gemini на всех моделях. Снова заработает через ${(wait[1] ?? '') + (wait[2] ?? '')}`
        .replace('h', ' ч ')
        .replace('m', ' мин');
    return 'Превышен лимит запросов к Gemini в минуту — попробуйте чуть позже.';
  }
  if (/PERMISSION_DENIED|403/.test(msg)) return `Нет доступа к Gemini (проверьте настройки API-ключа). ${msg}`;
  return msg;
}

// ---------------------------------------------------------------- подбор замен для схем

/** Кандидат в общей таблице запроса: каждый предмет перечисляется один раз */
export interface CandidateRow {
  n: number;
  id: string;
  names: string;
}

export interface BlockRow {
  n: number;
  source: string;
  names: string;
  /** номера кандидатов из общей таблицы и похожесть по поиску (0..1) */
  candidates: { n: number; similarity: number }[];
}

export interface ReplacementAnswer {
  block: number;
  /** До 3 номеров кандидатов, лучший первым; пусто — оставить блок как есть */
  options: number[];
  reason: string;
}

/**
 * Один запрос на всю схему: общая таблица кандидатов + блоки со ссылками на неё.
 * Агент отвечает номерами (не id) — выдумать несуществующий предмет он физически не может,
 * а номера вне списка блока отбрасываются при проверке.
 */
export async function suggestReplacements(
  table: CandidateRow[],
  blocks: BlockRow[],
  instruction: string,
): Promise<ReplacementAnswer[]> {
  const config = {
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: Schema.array({
        items: Schema.object({
          properties: {
            block: Schema.integer({ description: 'Номер блока (B…), только число' }),
            options: Schema.array({
              items: Schema.integer(),
              description: 'До 3 номеров кандидатов этого блока, лучший первым; пустой массив — оставить как есть',
            }),
            reason: Schema.string({ description: 'Коротко, по-русски: почему выбран первый вариант' }),
          },
        }),
      }),
    },
  };
  const candidates = table.map((c) => `${c.n} | ${c.id} | ${c.names}`).join('\n');
  const list = blocks
    .map(
      (b) =>
        `B${b.n} | ${b.source} | ${b.names} → ` +
        b.candidates.map((c) => `${c.n}:${Math.round(c.similarity * 100)}`).join(' '),
    )
    .join('\n');
  const prompt =
    `Мы переносим схему постройки Create в сборку TerraFirmaCraft.\n` +
    `Для каждого блока выбери до 3 замен из ЕГО списка кандидатов (номера после стрелки, через двоеточие — похожесть ` +
    `по поиску в процентах), лучший вариант первым. Сохраняй форму блока: дверь → дверь, ступеньки → ступеньки, ` +
    `плита → плита, бревно → бревно; меняй материал так, как просит пользователь. При прочих равных предпочитай ` +
    `блоки TerraFirmaCraft и его аддонов (tfc:, afc:, rnr:, firmalife:) декоративным модам (copycats, dndecor, createdeco). ` +
    `Если блок и так подходит или подходящих кандидатов нет — верни пустой options. Ответь по каждому блоку.\n\n` +
    `Пожелания пользователя: ${instruction.trim() || 'заменить ванильные материалы на аналоги TFC'}\n\n` +
    `## Кандидаты (номер | id | названия)\n${candidates}\n\n` +
    `## Блоки схемы (B-номер | id | названия → номера кандидатов:похожесть)\n${list}`;
  const res = await withFallback(FAST_MODELS, (name) => modelFor(name, config).generateContent(prompt));
  return JSON.parse(res.response.text()) as ReplacementAnswer[];
}

// ---------------------------------------------------------------- подсказки по типам рецептов

export interface GeneratedHint {
  title: string;
  body: string;
}

/**
 * Агент пишет подсказку по типу рецепта по фактам: статистика полей по всем рецептам этого типа
 * в сборке + несколько реальных примеров. Используется, когда подсказки нет или она устарела.
 */
export async function generateRecipeHint(
  type: string,
  stats: { path: string; pct: number; kinds: string; examples: string[] }[],
  examples: unknown[],
  existing?: string,
): Promise<GeneratedHint> {
  const config = {
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: Schema.object({
        properties: {
          title: Schema.string({ description: 'Короткое название по-русски: «Мод: машина/процесс», до 60 символов' }),
          body: Schema.string({ description: 'Подсказка в Markdown по-русски' }),
        },
      }),
    },
  };
  const statText = stats
    .map(
      (s) =>
        `- ${s.path} — ${s.pct}% рецептов, ${s.kinds}${s.examples.length ? `, примеры: ${s.examples.join(', ')}` : ''}`,
    )
    .join('\n');
  const prompt =
    `Напиши подсказку для человека, который пишет датапак-рецепт типа \`${type}\` (Minecraft 1.21.1, NeoForge, сборка TerraFirmaCraft).\n` +
    `Опирайся ТОЛЬКО на факты ниже — статистику полей по всем рецептам этого типа в сборке и реальные примеры. ` +
    `Не выдумывай полей, которых нет в статистике. Если смысл поля неочевиден — так и напиши.\n\n` +
    `Формат body: 1 строка — что это за механизм/процесс; затем список полей «- \`поле\` — что это, формат, типичные значения»; ` +
    `единицы измерения (тики: 20 = 1 с, mB, °C, RF), обязательные и необязательные поля (по проценту встречаемости). ` +
    `Без вступлений, кратко.\n\n` +
    (existing ? `Текущая подсказка (обнови, если она неточна или неполна):\n${existing}\n\n` : '') +
    `## Поля (по ${stats.length ? 'всем рецептам типа' : 'примерам'})\n${statText || '- нет данных'}\n\n` +
    `## Примеры\n${examples.map((e) => '```json\n' + JSON.stringify(e, null, 1).slice(0, 2500) + '\n```').join('\n')}`;
  const res = await withFallback(CHAT_MODELS, (name) => modelFor(name, config).generateContent(prompt));
  const parsed = JSON.parse(res.response.text()) as GeneratedHint;
  if (!parsed.title || !parsed.body) throw new Error('Агент вернул пустую подсказку');
  return parsed;
}

// ---------------------------------------------------------------- патчноут обновления сборки

export interface PatchNotesInput {
  /** Готовый текстовый отчёт о разнице сборок (см. describeUpdate в UpdatesPage) */
  report: string;
  /** Группы и активные задачи — чтобы модель отметила, что касается нас */
  context: string;
}

/**
 * Человеческий патчноут по машинной разнице сборок. Один запрос; модель обязана опираться
 * только на отчёт (ченджлоги, списки модов и предметов), разделы без данных пропускает.
 */
export async function generatePatchNotes(input: PatchNotesInput): Promise<string> {
  const config = {
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: Schema.object({ properties: { body: Schema.string({ description: 'Патчноут в Markdown' }) } }),
    },
  };
  const prompt =
    `Составь патчноут обновления нашей сборки для игроков группы. Ниже — машинный отчёт о том, что изменилось ` +
    `(моды, их ченджлоги с Modrinth, предметы, рецепты, датапаки под угрозой) и контекст группы.\n\n` +
    `Правила:\n` +
    `- Только факты из отчёта. Ничего не додумывай; если ченджлога нет — не пересказывай «вероятные» изменения.\n` +
    `- По-русски, Markdown. Разделы (пропускай пустые): «## Главное» (2–4 пункта, самое заметное для игры), ` +
    `«## Новое» (по модам), «## Что проверить у нас» (датапаки под угрозой, задачи и механики группы, которых касаются изменения), ` +
    `«## Мелочи» (исправления, техничка — кратко).\n` +
    `- Названия предметов — как в отчёте (русские, если есть). Версии модов — «было → стало».\n` +
    `- Без вступлений и выводов, коротко: игрок должен прочитать за минуту.\n\n` +
    `# Контекст группы\n${input.context.slice(0, 4000)}\n\n# Отчёт\n${input.report.slice(0, 60_000)}`;
  const res = await withFallback(WRITER_MODELS, (name) => modelFor(name, config).generateContent(prompt));
  const body = (JSON.parse(res.response.text()) as { body?: string }).body?.trim();
  if (!body) throw new Error('Агент вернул пустой патчноут');
  return body;
}
