import { readNbt, T, writeNbt, type Compound, type ParsedNbt, type Tag } from './nbt';
import { fuzzyCandidates } from './fuzzy';
import {
  geminiErrorText,
  suggestReplacements,
  type BlockRow,
  type CandidateRow,
  type ReplacementAnswer,
} from './gemini';
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

/** Значение в карте замен: блок убирается из схемы целиком (позиции удаляются, а не заменяются воздухом) */
export const REMOVE = '#remove';

/**
 * Замены, которые нельзя записать в схему: цель не из библиотеки предметов сборки.
 * Перед скачиванием — чтобы в схему попадал ровно тот id, что есть в сборке (minecraft:… не станет tfc:…).
 */
export function invalidTargets(replace: Map<string, string>, items: ItemIndex) {
  return [...replace].filter(([, to]) => to !== REMOVE && !items.byId.has(to)).map(([from, to]) => ({ from, to }));
}

/** Новый файл с заменами (исходник в памяти не меняется) */
export async function exportSchematic(s: Schematic, replace: Map<string, string>): Promise<Uint8Array> {
  const root = structuredClone(s.parsed.root);
  const palettes = paletteLists(root.value);
  // Индексы удаляемых блоков — по первой палитре (по ней же считаются блоки в loadSchematic)
  const removed = new Set<number>();
  palettes[0]?.forEach((entry, i) => {
    const name = nameOf(entry);
    if (name && replace.get(name) === REMOVE) removed.add(i);
  });
  for (const palette of palettes) {
    for (const entry of palette) {
      if (entry.type !== T.Compound) continue;
      const name = entry.value.get('Name');
      if (name?.type !== T.String) continue;
      const to = replace.get(name.value);
      // Удалённые остаются в палитре (на них больше нет ссылок) — индексы остальных не сдвигаются
      if (to && to !== REMOVE) entry.value.set('Name', { type: T.String, value: to });
    }
  }
  const blocks = root.value.get('blocks');
  if (removed.size && blocks?.type === T.List) {
    blocks.value = blocks.value.filter((b) => {
      if (b.type !== T.Compound) return true;
      const state = b.value.get('state');
      return !(state?.type === T.Int && removed.has(state.value));
    });
  }
  return writeNbt(root, s.parsed.gzipped);
}

export function changesIn(s: Schematic, replace: Map<string, string>) {
  let types = 0;
  let blocks = 0;
  let removed = 0;
  for (const [id, n] of s.counts) {
    const to = replace.get(id);
    if (!to) continue;
    if (to === REMOVE) removed += n;
    types++;
    blocks += n;
  }
  return { types, blocks, removed };
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
  /** source → запасные варианты агента (2-й и 3-й), для переключения в один клик */
  alternatives: Map<string, string[]>;
  /** Оставлены как есть: агент решил не менять или у блока нет вариантов кроме него самого */
  kept: AgentFailure[];
  /** Настоящие неудачи: ошибка агента, номера не из списка, нет ответа */
  failed: AgentFailure[];
  /** Сколько запросов к Gemini понадобилось */
  requests: number;
}

/** Блоков на один запрос: обычная схема целиком помещается в один (бесплатный лимит — запросы, а не размер) */
const BATCH = 200;
const MAX_CANDIDATES = 20;
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

const applyText = (s: string, rules: Rule[]) =>
  rules.filter((r) => r.from.trim()).reduce((acc, r) => acc.split(r.from.trim()).join(r.to.trim()), s);

const namesOf = (it: { e: string; r?: string }) => [it.e, it.r].filter(Boolean).join(' / ');

/**
 * 1. Для всех блоков заранее, без запросов: нечёткий поиск до 20 кандидатов (название и id с учётом правил,
 *    форма блока × материалы из пожеланий).
 * 2. Один запрос на всю схему: общая таблица кандидатов, агент отвечает до 3 номеров на блок.
 * 3. Проверка: принимаются только номера из списка этого блока; первый валидный — замена, остальные — запасные.
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

  // Общая таблица кандидатов: id → номер
  const tableIndex = new Map<string, number>();
  const table: CandidateRow[] = [];
  const numberOf = (id: string) => {
    let n = tableIndex.get(id);
    if (n === undefined) {
      n = table.length + 1;
      tableIndex.set(id, n);
      table.push({ n, id, names: namesOf(items.byId.get(id)!) });
    }
    return n;
  };

  const blocks: BlockRow[] = [];
  const result: AgentResult = {
    applied: new Map(),
    reasons: new Map(),
    alternatives: new Map(),
    kept: [],
    failed: [],
    requests: 0,
  };

  ids.forEach((id) => {
    const known = items.byId.get(id);
    const ns = id.split(':')[0];
    const words = (id.split(':')[1] ?? id).replace(/[/_]/g, ' ');
    const queries = [applyText(words, rules), words];
    if (known) queries.push(applyText(known.e, rules), known.e, ...(known.r ? [known.r] : []));
    const direct = fuzzyCandidates(items, queries, 14);
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
    const candidates = [...direct, ...byHint]
      .filter((c) => !seen.has(c.item.i) && !!seen.add(c.item.i))
      .slice(0, MAX_CANDIDATES);
    if (!candidates.length) {
      result.kept.push({ source: id, reason: 'поиск не нашёл других похожих предметов' });
      return;
    }
    blocks.push({
      n: blocks.length + 1,
      source: id,
      names: known ? namesOf(known) : 'нет в сборке',
      candidates: candidates.map((c) => ({ n: numberOf(c.item.i), similarity: c.similarity })),
    });
  });

  const hints = rules.filter((r) => r.from.trim()).map((r) => `${r.from.trim()} → ${r.to.trim()}`);
  const fullInstruction = [instruction.trim(), hints.length ? `Подсказки-замены: ${hints.join('; ')}` : '']
    .filter(Boolean)
    .join('\n');

  let done = 0;
  onProgress?.(0, blocks.length);
  // Пачки строго по очереди (лимит бесплатного тарифа — запросы в минуту)
  for (let i = 0; i < blocks.length; i += BATCH) {
    const batch = blocks.slice(i, i + BATCH);
    // В таблицу пачки — только её кандидаты
    const used = new Set(batch.flatMap((b) => b.candidates.map((c) => c.n)));
    result.requests++;
    let answers: ReplacementAnswer[];
    try {
      answers = await suggestReplacements(
        table.filter((c) => used.has(c.n)),
        batch,
        fullInstruction,
      );
    } catch (e) {
      for (const b of batch) result.failed.push({ source: b.source, reason: `ошибка агента: ${geminiErrorText(e)}` });
      continue;
    }
    const byBlock = new Map(answers.map((a) => [Number(a.block), a]));
    for (const b of batch) {
      const a = byBlock.get(b.n);
      if (!a) {
        result.failed.push({ source: b.source, reason: 'агент не ответил по этому блоку' });
        continue;
      }
      const allowed = new Set(b.candidates.map((c) => c.n));
      const valid = [...new Set((a.options ?? []).map(Number))]
        .filter((n) => allowed.has(n))
        .map((n) => table[n - 1].id)
        .slice(0, 3);
      if (valid.length) {
        result.applied.set(b.source, valid[0]);
        if (valid.length > 1) result.alternatives.set(b.source, valid.slice(1));
        if (a.reason) result.reasons.set(b.source, a.reason);
      } else if (!a.options?.length) {
        result.kept.push({ source: b.source, reason: a.reason || 'агент решил оставить как есть' });
      } else {
        result.failed.push({ source: b.source, reason: 'агент вернул номера не из списка кандидатов — отклонено' });
      }
    }
    done += batch.length;
    onProgress?.(done, blocks.length);
  }
  return result;
}
