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
  /** Исходный файл — для сохранения в библиотеку */
  file: File;
  /** Открыта из библиотеки: id записи */
  libraryId?: string;
  fileName: string;
  fileSize: number;
  parsed: ParsedNbt;
  /** id блока → сколько раз встречается */
  counts: Map<string, number>;
  size: [number, number, number] | null;
  /** Обрезка и отступы при скачивании */
  shape: Shape;
  /** Файл в хранилище у схемы из библиотеки — заменяется, если блоки правили по клеткам */
  libraryFileId?: string;
  /** Номер правки по клеткам (редактор слоёв меняет parsed на месте); 0 — как в исходнике */
  rev: number;
  /** rev, с которым исходник лежит в библиотеке: отличается — при сохранении файл загружается заново */
  savedRev?: number;
}

/**
 * Форма схемы при скачивании. crop — обрезать по крайним непустым блокам (воздух и структурная пустота
 * не считаются), sides/bottom/top — сколько пустых блоков оставить вокруг (sides — по X и Z).
 * clearAir — записать воздух во все свободные клетки итогового объёма, чтобы при вставке он расчищал место.
 */
export interface Shape {
  crop: boolean;
  sides: number;
  bottom: number;
  top: number;
  clearAir: boolean;
  /**
   * Площадка: platformHeight слоёв блока platformBlock под всей схемой, ниже нижнего отступа.
   * platformHollow: сплошной только верхний слой, ниже — стенки по периметру, без дна («перевёрнутая коробка»).
   */
  platform: boolean;
  platformHeight: number;
  platformBlock: string;
  platformHollow: boolean;
}

export const DEFAULT_SHAPE: Shape = {
  crop: false,
  sides: 0,
  bottom: 0,
  top: 1,
  clearAir: false,
  platform: false,
  platformHeight: 1,
  platformBlock: 'minecraft:stone',
  platformHollow: false,
};

/** Не больше стольких клеток при записи воздуха: каждая — отдельная запись в файле и в памяти браузера */
const MAX_CLEAR_CELLS = 2_000_000;

export const EMPTY_BLOCKS = new Set([
  'minecraft:air',
  'minecraft:cave_air',
  'minecraft:void_air',
  'minecraft:structure_void',
]);

export function paletteLists(root: Compound): Tag[][] {
  const single = root.get('palette');
  if (single?.type === T.List) return [single.value];
  // Структуры с несколькими вариантами палитры (palettes: [[...], [...]])
  const multi = root.get('palettes');
  if (multi?.type === T.List) return multi.value.filter((p) => p.type === T.List).map((p) => p.value as Tag[]);
  return [];
}

export const nameOf = (entry: Tag) => {
  if (entry.type !== T.Compound) return null;
  const n = entry.value.get('Name');
  return n?.type === T.String ? n.value : null;
};

export async function loadSchematic(file: File): Promise<Schematic> {
  const parsed = await readNbt(new Uint8Array(await file.arrayBuffer()));
  const root = parsed.root.value;
  const palettes = paletteLists(root);
  if (!palettes.length) throw new Error('В файле нет палитры блоков — это не схема');

  const sizeTag = root.get('size');
  const size =
    sizeTag?.type === T.List && sizeTag.value.length === 3
      ? (sizeTag.value.map((v) => (v.type === T.Int ? v.value : 0)) as [number, number, number])
      : null;

  return {
    key: `${file.name}-${file.size}-${file.lastModified}`,
    file,
    fileName: file.name,
    fileSize: file.size,
    parsed,
    counts: countBlocks(parsed),
    size,
    shape: { ...DEFAULT_SHAPE },
    rev: 0,
  };
}

/** id блока → сколько раз встречается; блоки палитры без позиций — с нулём */
export function countBlocks(parsed: ParsedNbt): Map<string, number> {
  const root = parsed.root.value;
  const palettes = paletteLists(root);
  const palette = palettes[0] ?? [];
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
  return counts;
}

export type Vec = [number, number, number];

export const posOf = (b: Tag): Vec | null => {
  if (b.type !== T.Compound) return null;
  const p = b.value.get('pos');
  if (p?.type !== T.List || p.value.length !== 3) return null;
  const v = p.value.map((x) => (x.type === T.Int ? x.value : NaN));
  return v.some(Number.isNaN) ? null : (v as Vec);
};

/** Индексы палитры, которые после замен — воздух/пустота или удаляются */
function emptyStates(palette: Tag[], replace: Map<string, string>) {
  const out = new Set<number>();
  palette.forEach((entry, i) => {
    const name = nameOf(entry);
    if (!name) return;
    const to = replace.get(name) ?? name;
    if (to === REMOVE || EMPTY_BLOCKS.has(to)) out.add(i);
  });
  return out;
}

/** Итоговый объём: начало в координатах исходника и размер. null — менять нечего */
function shapeBox(s: Schematic, replace: Map<string, string>): { min: Vec; size: Vec } | null {
  const { shape } = s;
  if (!shape.crop && !shape.clearAir && !shape.platform) return null;
  const root = s.parsed.root.value;
  const palette = paletteLists(root)[0] ?? [];
  const blocks = root.get('blocks');
  const list = blocks?.type === T.List ? blocks.value : [];
  const empty = emptyStates(palette, replace);

  const lo: Vec = [Infinity, Infinity, Infinity];
  const hi: Vec = [-Infinity, -Infinity, -Infinity];
  const all = { lo: [...lo] as Vec, hi: [...hi] as Vec };
  for (const b of list) {
    const p = posOf(b);
    if (!p || b.type !== T.Compound) continue;
    const st = b.value.get('state');
    const solid = !(st?.type === T.Int && empty.has(st.value));
    for (let i = 0; i < 3; i++) {
      all.lo[i] = Math.min(all.lo[i], p[i]);
      all.hi[i] = Math.max(all.hi[i], p[i]);
      if (solid) {
        lo[i] = Math.min(lo[i], p[i]);
        hi[i] = Math.max(hi[i], p[i]);
      }
    }
  }
  // Площадка — ещё H слоёв под низом: начало уходит вниз, размер по Y растёт
  const base = shape.platform ? shape.platformHeight : 0;
  const withPlatform = (min: Vec, size: Vec) => ({
    min: [min[0], min[1] - base, min[2]] as Vec,
    size: [size[0], size[1] + base, size[2]] as Vec,
  });
  if (shape.crop && Number.isFinite(lo[0])) {
    const pad: Vec = [shape.sides, shape.bottom, shape.sides];
    const padHi: Vec = [shape.sides, shape.top, shape.sides];
    return withPlatform(
      lo.map((v, i) => v - pad[i]) as Vec,
      lo.map((v, i) => hi[i] - v + 1 + pad[i] + padHi[i]) as Vec,
    );
  }
  // Без обрезки — исходный объём (из size, а если его нет — по блокам)
  const size: Vec = s.size ?? (all.hi.map((v, i) => (Number.isFinite(v) ? v - Math.min(0, all.lo[i]) + 1 : 0)) as Vec);
  return withPlatform([0, 0, 0], size);
}

/** Размер файла после обрезки — для показа в списке; null, если форма не меняется */
export function shapedSize(s: Schematic, replace: Map<string, string>): Vec | null {
  return shapeBox(s, replace)?.size ?? null;
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

/** Исходник с правками слоёв (без замен и формы) — его хранит библиотека */
export async function editedSource(s: Schematic): Promise<File> {
  if (!s.rev) return s.file;
  const bytes = await writeNbt(s.parsed.root, s.parsed.gzipped);
  return new File([bytes as BlobPart], s.fileName, { type: 'application/octet-stream' });
}

/** Новый файл с заменами (исходник в памяти не меняется) */
export async function exportSchematic(s: Schematic, replace: Map<string, string>): Promise<Uint8Array> {
  // Объём считаем по исходнику и исходным именам: в клоне палитра уже с заменами
  const box = shapeBox(s, replace);
  if (box && (s.shape.clearAir || s.shape.platform)) {
    const cells = box.size[0] * box.size[1] * box.size[2];
    if (cells > MAX_CLEAR_CELLS)
      throw new Error(`Площадка или очистка: ${box.size.join('×')} — слишком большой объём (${cells} клеток)`);
    if (paletteLists(s.parsed.root.value).length > 1)
      throw new Error('Площадка и очистка пространства не поддерживаются для схем с несколькими палитрами');
  }
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
  if (box) reshape(root.value, box, s.shape);
  return writeNbt(root, s.parsed.gzipped);
}

export const intList = (v: Vec): Tag => ({
  type: T.List,
  elemType: T.Int,
  value: v.map((x) => ({ type: T.Int, value: x })),
});

/** Сдвиг блоков и сущностей в новый объём; блоки вне объёма отбрасываются, свободные клетки — воздух */
function reshape(root: Compound, box: { min: Vec; size: Vec }, shape: Shape) {
  const { min, size } = box;
  const inside = (p: Vec) => p.every((v, i) => v >= 0 && v < size[i]);
  const shift = (p: Vec) => p.map((v, i) => v - min[i]) as Vec;

  const blocks = root.get('blocks');
  const kept: Tag[] = [];
  const occupied = new Set<number>();
  if (blocks?.type === T.List) {
    for (const b of blocks.value) {
      const p = posOf(b);
      if (!p || b.type !== T.Compound) continue;
      const q = shift(p);
      if (!inside(q)) continue;
      b.value.set('pos', intList(q));
      kept.push(b);
      occupied.add((q[1] * size[2] + q[2]) * size[0] + q[0]);
    }
  }

  const cellKey = (x: number, y: number, z: number) => (y * size[2] + z) * size[0] + x;
  const newBlock = (x: number, y: number, z: number, state: number): Tag => ({
    type: T.Compound,
    value: new Map<string, Tag>([
      ['pos', intList([x, y, z])],
      ['state', { type: T.Int, value: state }],
    ]),
  });
  const palette = paletteLists(root)[0];
  /** Индекс блока без свойств в палитре; нет — добавляется в конец */
  const stateOf = (name: string) => {
    let i = palette.findIndex((e) => nameOf(e) === name && e.type === T.Compound && !e.value.has('Properties'));
    if (i < 0) {
      palette.push({ type: T.Compound, value: new Map([['Name', { type: T.String, value: name }]]) });
      i = palette.length - 1;
    }
    return i;
  };

  // Площадка: слои снизу вверх, верхний сплошной, остальные при «пустой» — только периметр.
  // Она ниже всего блока схемы (начало объёма опущено на её высоту), поэтому с блоками не пересекается
  if (shape.platform && shape.platformHeight > 0) {
    const st = stateOf(shape.platformBlock);
    for (let y = 0; y < shape.platformHeight; y++) {
      const solid = !shape.platformHollow || y === shape.platformHeight - 1;
      for (let z = 0; z < size[2]; z++)
        for (let x = 0; x < size[0]; x++) {
          const edge = x === 0 || z === 0 || x === size[0] - 1 || z === size[2] - 1;
          if (!solid && !edge) continue;
          kept.push(newBlock(x, y, z, st));
          occupied.add(cellKey(x, y, z));
        }
    }
  }

  if (shape.clearAir) {
    const air = stateOf('minecraft:air');
    for (let y = 0; y < size[1]; y++)
      for (let z = 0; z < size[2]; z++)
        for (let x = 0; x < size[0]; x++) {
          if (!occupied.has(cellKey(x, y, z))) kept.push(newBlock(x, y, z, air));
        }
  }
  if (blocks?.type === T.List) blocks.value = kept;
  else root.set('blocks', { type: T.List, elemType: T.Compound, value: kept });

  root.set('size', intList(size));

  const entities = root.get('entities');
  if (entities?.type === T.List) {
    entities.value = entities.value.filter((e) => {
      if (e.type !== T.Compound) return true;
      const bp = e.value.get('blockPos');
      const pos = e.value.get('pos');
      if (bp?.type === T.List && bp.value.length === 3) {
        const q = shift(bp.value.map((x) => (x.type === T.Int ? x.value : 0)) as Vec);
        if (!inside(q)) return false;
        e.value.set('blockPos', intList(q));
      }
      if (pos?.type === T.List && pos.value.length === 3) {
        e.value.set('pos', {
          type: T.List,
          elemType: T.Double,
          value: pos.value.map((x, i) => ({ type: T.Double, value: (x.type === T.Double ? x.value : 0) - min[i] })),
        });
      }
      return true;
    });
  }
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
