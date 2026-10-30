/**
 * Семейство блока: целый, ступени, плита, стенка одного материала. Скату нужны ступени, подоконнику — плита,
 * и блок без нужной формы роли не годится (у резного кремнистого сланца TFC ступеней нет).
 * Правила — реестром: общее правило по суффиксам покрывает TFC (`tfc:rock/bricks/chert` → `…/chert_stairs`),
 * ваниль (`stone_bricks` → `stone_brick_stairs`, `oak_planks` → `oak_stairs`), rnr и большинство модов;
 * мод с другим именованием — своё правило перед общим, без условий по именам в общем коде.
 */

export type FamilyShape = 'full' | 'stairs' | 'slab' | 'wall';
export interface Family {
  full: string;
  stairs?: string;
  slab?: string;
  wall?: string;
}
/** Есть ли такой блок в сборке */
export type Has = (id: string) => boolean;

export interface FamilyRule {
  /** Варианты id формы shape для целого блока full, по убыванию вероятности */
  variants(full: string, shape: Exclude<FamilyShape, 'full'>): string[];
  /** Варианты id целого блока для ступеней/плиты/стенки */
  bases(part: string): string[];
}

const split = (id: string) => {
  const i = id.indexOf(':');
  return [id.slice(0, i), id.slice(i + 1)];
};

const genericRule: FamilyRule = {
  variants(full, shape) {
    const [ns, p] = split(full);
    const stems = [
      p,
      p.replace(/s$/, ''),
      p.replace(/_planks$/, ''),
      p.replace(/_block$/, ''),
      p.replace(/_bricks$/, '_brick'),
    ];
    return [...new Set(stems)].map((s) => `${ns}:${s}_${shape}`);
  },
  bases(part) {
    const [ns, p] = split(part);
    const stem = p.replace(/_(stairs|slab|wall)$/, '');
    if (stem === p) return [];
    return [stem, `${stem}s`, `${stem}_planks`, `${stem}_block`].map((s) => `${ns}:${s}`);
  },
};

/** Приставка вместо суффикса — Immersive Engineering: `concrete` → `stairs_concrete`, `slab_concrete` */
const prefixRule: FamilyRule = {
  variants(full, shape) {
    const [ns, p] = split(full);
    return [`${ns}:${shape}_${p}`];
  },
  bases(part) {
    const [ns, p] = split(part);
    const m = /^(stairs|slab|wall)_(.+)$/.exec(p);
    return m ? [`${ns}:${m[2]}`] : [];
  },
};

/** Реестр правил: свои правила модов — в начало; общие идут по очереди, пока не найдётся блок */
export const FAMILY_RULES: FamilyRule[] = [genericRule, prefixRule];

const SHAPES = ['stairs', 'slab', 'wall'] as const;

/** Целый блок, к которому относится id (сам id, если он не ступени/плита/стенка) */
export function baseOf(id: string, has: Has): string {
  for (const rule of FAMILY_RULES) for (const b of rule.bases(id)) if (has(b)) return b;
  return id;
}

const cache = new WeakMap<Has, Map<string, Family>>();

export function familyOf(id: string, has: Has): Family {
  let byHas = cache.get(has);
  if (!byHas) cache.set(has, (byHas = new Map()));
  const full = baseOf(id, has);
  const hit = byHas.get(full);
  if (hit) return hit;
  const fam: Family = { full };
  for (const shape of SHAPES)
    for (const rule of FAMILY_RULES) {
      const found = rule.variants(full, shape).find(has);
      if (found) {
        fam[shape] = found;
        break;
      }
    }
  byHas.set(full, fam);
  return fam;
}

/** Блок нужной формы из семейства; null — такой формы у материала нет */
export function shapeOf(id: string, shape: FamilyShape, has: Has): string | null {
  const fam = familyOf(id, has);
  return shape === 'full' ? fam.full : (fam[shape] ?? null);
}

/** Бревно, столб, колонна — у них есть ось */
export const hasAxis = (id: string) => {
  // TFC: wood/log/oak, wood/stripped_wood/oak (но не wood/planks/oak); ваниль: oak_log, quartz_pillar, basalt
  const seg = split(id)[1].split('/');
  if (seg.slice(1).some((s) => /^(stripped_)?(log|wood|stem|hyphae)$/.test(s))) return true;
  return /(_log|_wood|_stem|_hyphae|_pillar|^basalt|^polished_basalt|^bone_block)$/.test(seg[seg.length - 1]);
};
export const isPane = (id: string) => /pane|bars/.test(id);
export const isDoor = (id: string) => /(^|[/_:])door($|[/_])/.test(id) && !/trapdoor/.test(id);

const VARIANT_WORDS =
  /(^|_)(mossy|cracked|chiseled|smooth|polished|cut|stripped|raw|hardened|cobble|cobbled|bricks?|tiles?|planks|log|wood|pillar|block)(?=_|$)/g;

/**
 * Ключ материала — что общего у вариантов: порода TFC (`tfc:rock/bricks/chert`, `rnr:rock/flagstones/chert` →
 * `rock:chert`), древесина, цвет алебастра; у прочих — имя без слов-вариантов (mossy, cracked, bricks…).
 */
export function materialKey(id: string): string {
  const [ns, p] = split(baseOfName(id));
  const seg = p.split('/');
  if (seg.length >= 3 && (seg[0] === 'rock' || seg[0] === 'wood' || seg[0] === 'alabaster'))
    return `${seg[0]}:${seg[seg.length - 1]}`;
  const name = seg[seg.length - 1]
    .replace(VARIANT_WORDS, '')
    .replace(/^_+|_+$/g, '')
    .replace(/__+/g, '_');
  return `${ns}:${name || seg[seg.length - 1]}`;
}

const baseOfName = (id: string) => id.replace(/_(stairs|slab|wall)$/, '');
