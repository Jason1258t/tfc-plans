import { readNbt, T, writeNbt, type Compound, type ParsedNbt, type Tag } from './nbt';
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
