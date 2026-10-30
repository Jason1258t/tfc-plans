/**
 * Подборщик похожих блоков: из выбранного блока роли — кандидаты по группам. Сам ничего не назначает: человек
 * отмечает нужные блоки из списка (в роль попадает только отмеченное).
 *
 * Оценка = 0,45 цвет (CIEDE2000) + 0,25 то же семейство (порода/древесина) + 0,15 общие теги + 0,15 похожая
 * пестрота. Кандидат без нужной роли формы (ступени для ската, плита для подоконника) не показывается.
 */
import { deltaE, type Lab } from './color.ts';
import { familyOf, materialKey, type Has } from './families.ts';

/** Запись public/block-colors.json: [L, a, b, пестрота, целый куб 0/1] */
export type ColorRow = [number, number, number, number, number];
export interface BlockColors {
  v: 1;
  b: Record<string, ColorRow>;
}

export type Need = 'stairs' | 'slab';
export type GroupId = 'family' | 'close' | 'lighter' | 'darker' | 'textured';
export const GROUP_NAMES: Record<GroupId, string> = {
  family: 'То же семейство',
  close: 'Близкие по цвету',
  lighter: 'Акцент светлее',
  darker: 'Акцент темнее',
  textured: 'Фактурные',
};

export interface Suggestion {
  id: string;
  score: number;
  /** Разница цвета с исходным (CIEDE2000) и светлоты (+ светлее) */
  dE: number;
  dL: number;
  group: GroupId;
}

export interface SimilarOptions {
  /** Формы, без которых блок роли не годится */
  need?: Need[];
  /** Теги блока — для оценки (необязательно) */
  tagsOf?: (id: string) => string[];
  /** Сколько в каждой группе (по умолчанию 12) */
  limit?: number;
  exclude?: Set<string>;
}

/** Что не строительный блок: руды, растения, механизмы-однодневки, формы-варианты */
const NOT_BUILDING =
  /(^|[/_:])(ore|deposit|loose|spike|sapling|leaves|fallen_leaves|crop|plant|flower|grass|mushroom|coral|button|pressure_plate|sign|torch|lantern|chest|crate|barrel|bed|carpet|candle|rail|door|trapdoor|fence|fence_gate|gravel|sand|dirt|farmland|snow|ice|water|lava|spawner|infested|shulker_box|command_block|structure|jigsaw|barrier|air|magma|clay|muddy_roots|roots|peat|grate|piston|sticky_piston|observer|dispenser|dropper|furnace|crafting_table|hopper|tnt|sponge)($|[/_])|_(stairs|slab|wall)$/;

export const isBuildingBlock = (id: string) => !NOT_BUILDING.test(id);

const jaccard = (a: string[], b: string[]) => {
  if (!a.length && !b.length) return 0;
  const s = new Set(a);
  const inter = b.filter((x) => s.has(x)).length;
  return inter / (a.length + b.length - inter);
};

export function rankSimilar(
  seed: string,
  colors: BlockColors,
  has: Has,
  opts: SimilarOptions = {},
): Record<GroupId, Suggestion[]> {
  const out: Record<GroupId, Suggestion[]> = { family: [], close: [], lighter: [], darker: [], textured: [] };
  const base = familyOf(seed, has).full;
  const me = colors.b[base] ?? colors.b[seed];
  if (!me) return out;
  const lab: Lab = [me[0], me[1], me[2]];
  const key = materialKey(base);
  const myTags = opts.tagsOf?.(base) ?? [];
  const need = opts.need ?? [];
  for (const [id, row] of Object.entries(colors.b)) {
    if (id === base || !row[4] || opts.exclude?.has(id) || !isBuildingBlock(id)) continue;
    if (need.length) {
      const fam = familyOf(id, has);
      if (need.some((n) => !fam[n])) continue;
    }
    const other: Lab = [row[0], row[1], row[2]];
    const dE = deltaE(lab, other);
    const dL = other[0] - lab[0];
    const dab = Math.hypot(other[1] - lab[1], other[2] - lab[2]);
    const fam = materialKey(id) === key ? 1 : 0;
    const tags = opts.tagsOf ? jaccard(myTags, opts.tagsOf(id)) : 0;
    const spreadSim = Math.max(0, 1 - Math.abs(row[3] - me[3]) / 15);
    const score = 0.45 * Math.max(0, 1 - dE / 40) + 0.25 * fam + 0.15 * tags + 0.15 * spreadSim;
    let group: GroupId | null = null;
    if (fam) group = 'family';
    else if (dE < 12) group = 'close';
    else if (dL > 6 && dab < 15) group = 'lighter';
    else if (dL < -6 && dab < 15) group = 'darker';
    else if (row[3] > me[3] + 4 && dE < 25) group = 'textured';
    if (group) out[group].push({ id, score, dE, dL, group });
  }
  const limit = opts.limit ?? 12;
  for (const g of Object.keys(out) as GroupId[]) out[g] = out[g].sort((a, b) => b.score - a.score).slice(0, limit);
  return out;
}
