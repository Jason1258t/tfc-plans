import { readNbt, T, writeNbt, type Compound, type ParsedNbt, type Tag } from './nbt';
import { fuzzyCandidates } from './fuzzy';
import { geminiErrorText, suggestReplacements, type ReplacementAnswer, type ReplacementRequest } from './gemini';
import type { ItemIndex } from './items';

/**
 * Схема Create / структура ванили (.nbt): palette — список блоков { Name, Properties },
 * blocks — позиции со ссылкой state на индекс в палитре. Замена блока = смена Name в палитре.
 * Свойства (facing, axis…) сохраняются как есть; игра молча отбрасывает неподходящие.
 */
export interface Schematic {
  key: string;
  fileName: string;
  fileSize: number;
  parsed: ParsedNbt;
  /** id блока → сколько раз встречается */
  counts: Map<string, number>;
  size: [number, number, number] | null;
}

function paletteLists(root: Compound): Tag[][] {
  const single = root.get('palette');
  if (single?.type === T.List) return [single.value];
  // Структуры с несколькими вариантами палитры (palettes: [[...], [...]])
  const multi = root.get('palettes');
  if (multi?.type === T.List) return multi.value.filter((p) => p.type === T.List).map((p) => p.value as Tag[]);
  return [];
}

const nameOf = (entry: Tag) => {
  if (entry.type !== T.Compound) return null;
  const n = entry.value.get('Name');
  return n?.type === T.String ? n.value : null;
};

export async function loadSchematic(file: File): Promise<Schematic> {
  const parsed = await readNbt(new Uint8Array(await file.arrayBuffer()));
  const root = parsed.root.value;
  const palettes = paletteLists(root);
  if (!palettes.length) throw new Error('В файле нет палитры блоков — это не схема');
  const palette = palettes[0];

  const counts = new Map<string, number>();
  const blocks = root.get('blocks');
  if (blocks?.type === T.List) {
    for (const b of blocks.value) {
      if (b.type !== T.Compound) continue;
      const state = b.value.get('state');
      if (state?.type !== T.Int) continue;
      const name = nameOf(palette[state.value]);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  // Блоки палитры, которые не встречаются в blocks (бывает) — тоже показываем
  for (const p of palettes.flat()) {
    const name = nameOf(p);
    if (name && !counts.has(name)) counts.set(name, 0);
  }

  const sizeTag = root.get('size');
  const size =
    sizeTag?.type === T.List && sizeTag.value.length === 3
      ? (sizeTag.value.map((v) => (v.type === T.Int ? v.value : 0)) as [number, number, number])
      : null;

  return {
    key: `${file.name}-${file.size}-${file.lastModified}`,
    fileName: file.name,
    fileSize: file.size,
    parsed,
    counts,
    size,
  };
}

/** Новый файл с заменами (исходник в памяти не меняется) */
export async function exportSchematic(s: Schematic, replace: Map<string, string>): Promise<Uint8Array> {
  const root = structuredClone(s.parsed.root);
  for (const palette of paletteLists(root.value)) {
    for (const entry of palette) {
      if (entry.type !== T.Compound) continue;
      const name = entry.value.get('Name');
      if (name?.type !== T.String) continue;
      const to = replace.get(name.value);
      if (to) entry.value.set('Name', { type: T.String, value: to });
    }
  }
  return writeNbt(root, s.parsed.gzipped);
}

export function changesIn(s: Schematic, replace: Map<string, string>) {
  let types = 0;
  let blocks = 0;
  for (const [id, n] of s.counts) {
    if (replace.has(id)) {
      types++;
      blocks += n;
    }
  }
  return { types, blocks };
}

// ---------------------------------------------------------------- «умная» замена (пока по подстрокам)

export interface Rule {
  from: string;
  to: string;
}

export interface RuleResult {
  /** source → target, которые нашлись в библиотеке */
  applied: Map<string, string>;
  /** source → получившийся id, которого нет в сборке */
  failed: { source: string; target: string }[];
}

/**
 * Применяет правила по очереди к id блока (все вхождения подстроки).
 * Замена принимается, только если получившийся id есть в библиотеке предметов.
 */
export function applyRules(ids: string[], rules: Rule[], items: ItemIndex): RuleResult {
  const active = rules.filter((r) => r.from.trim());
  const applied = new Map<string, string>();
  const failed: RuleResult['failed'] = [];
  for (const id of ids) {
    let target = id;
    for (const r of active) target = target.split(r.from.trim()).join(r.to.trim());
    if (target === id) continue;
    if (items.byId.has(target)) applied.set(id, target);
    else failed.push({ source: id, target });
  }
  return { applied, failed };
}

// ---------------------------------------------------------------- замена агентом

export interface AgentFailure {
  source: string;
  target?: string;
  reason: string;
}

export interface AgentResult {
  applied: Map<string, string>;
  /** source → объяснение агента */
  reasons: Map<string, string>;
  /** Оставлены как есть: агент решил не менять или у блока нет вариантов кроме него самого */
  kept: AgentFailure[];
  /** Настоящие неудачи: ошибка агента, выдуманный id, нет ответа */
  failed: AgentFailure[];
}

// Бесплатный тариф Gemini — 5 запросов в минуту на модель: крупные пачки и строго по одной
const BATCH = 60;
const STOP_WORDS = new Set([
  'заменить',
  'замена',
  'оставить',
  'аналоги',
  'аналог',
  'материалы',
  'ванильные',
  'ванильный',
  'блоки',
  'вместо',
  'нужно',
  'хочу',
  'terrafirmacraft',
]);
const PARALLEL = 1;

const applyText = (s: string, rules: Rule[]) =>
  rules.filter((r) => r.from.trim()).reduce((acc, r) => acc.split(r.from.trim()).join(r.to.trim()), s);

/**
 * Для каждого блока: нечёткий поиск кандидатов (по названию и id, в том числе после правил-подсказок),
 * затем Gemini выбирает одного из кандидатов. Ответ проверяется: принимаются только id из списка.
 */
export async function agentReplace(
  ids: string[],
  rules: Rule[],
  instruction: string,
  items: ItemIndex,
  onProgress?: (done: number, total: number) => void,
): Promise<AgentResult> {
  // Слова-материалы из пожеланий и правил («гранит», «eucalyptus») — ищем их вместе с формой блока
  const hintWords = [
    ...new Set(
      `${instruction} ${rules.map((r) => r.to).join(' ')}`
        .toLowerCase()
        .split(/[^a-zа-яё0-9]+/)
        .filter((w) => w.length >= 4 && !STOP_WORDS.has(w)),
    ),
  ].slice(0, 12);

  const requests: ReplacementRequest[] = ids.map((id) => {
    const known = items.byId.get(id);
    const ns = id.split(':')[0];
    const words = (id.split(':')[1] ?? id).replace(/[/_]/g, ' ');
    const queries = [applyText(words, rules), words];
    if (known) queries.push(applyText(known.e, rules), known.e, ...(known.r ? [known.r] : []));
    const direct = fuzzyCandidates(items, queries);
    // Форма блока (последнее слово id: planks, door, stairs, bricks) + материал из пожеланий,
    // среди других модов: stone_bricks + «гранит» → tfc:rock/bricks/granite
    const form = words.split(' ').pop() ?? '';
    const byHint =
      form.length >= 3 && hintWords.length
        ? fuzzyCandidates(
            items,
            hintWords.flatMap((w) => [`${form} ${w}`, w]),
            16,
          ).filter((c) => !c.item.i.startsWith(`${ns}:`))
        : [];
    const seen = new Set<string>([id]);
    const candidates = [...direct, ...byHint.slice(0, 8)]
      .filter((c) => !seen.has(c.item.i) && !!seen.add(c.item.i))
      .map((c) => ({
        id: c.item.i,
        names: [c.item.e, c.item.r].filter(Boolean).join(' / '),
        similarity: c.similarity,
      }));
    return { source: id, names: known ? [known.e, known.r].filter(Boolean).join(' / ') : 'нет в сборке', candidates };
  });

  const result: AgentResult = { applied: new Map(), reasons: new Map(), kept: [], failed: [] };
  const withCandidates = requests.filter((r) => r.candidates.length);
  for (const r of requests)
    if (!r.candidates.length) result.kept.push({ source: r.source, reason: 'поиск не нашёл других похожих предметов' });

  const hints = rules.filter((r) => r.from.trim()).map((r) => `${r.from.trim()} → ${r.to.trim()}`);
  const fullInstruction = [instruction.trim(), hints.length ? `Подсказки-замены: ${hints.join('; ')}` : '']
    .filter(Boolean)
    .join('\n');

  const batches: ReplacementRequest[][] = [];
  for (let i = 0; i < withCandidates.length; i += BATCH) batches.push(withCandidates.slice(i, i + BATCH));
  let done = 0;
  onProgress?.(0, withCandidates.length);

  const runBatch = async (batch: ReplacementRequest[]) => {
    let answers: ReplacementAnswer[] = [];
    try {
      answers = await suggestReplacements(batch, fullInstruction);
    } catch (e) {
      for (const b of batch) result.failed.push({ source: b.source, reason: `ошибка агента: ${geminiErrorText(e)}` });
      return;
    }
    const byId = new Map(answers.map((a) => [a.source, a]));
    for (const b of batch) {
      const a = byId.get(b.source);
      if (!a) result.failed.push({ source: b.source, reason: 'агент не ответил по этому блоку' });
      else if (!a.target || a.target === b.source)
        result.kept.push({ source: b.source, reason: a.reason || 'агент решил оставить как есть' });
      else if (!b.candidates.some((c) => c.id === a.target) || !items.byId.has(a.target))
        result.failed.push({
          source: b.source,
          target: a.target,
          reason: 'агент предложил id не из списка — отклонено',
        });
      else {
        result.applied.set(b.source, a.target);
        if (a.reason) result.reasons.set(b.source, a.reason);
      }
    }
    done += batch.length;
    onProgress?.(done, withCandidates.length);
  };

  // Несколько пачек параллельно
  const queue = [...batches];
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      while (queue.length) await runBatch(queue.shift()!);
    }),
  );
  return result;
}
