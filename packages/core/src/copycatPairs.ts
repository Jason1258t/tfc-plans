/**
 * Пара «копикат + материал» как отдельная строка замен: `copycats:copycat_slab+minecraft:bricks`. «+» в id блока
 * не встречается, поэтому пара лежит в тех же списках замен { from, to }, что и обычные блоки (библиотека, избранное).
 * Пара в from — только такие копикаты, пара в to — поставить копикат с этим материалом.
 *
 * Импорт только nbt.ts и schematicBlockFixes.ts с расширением, стираемый TS: модуль запускают и сайт, и Node.
 */
import { T, type Compound, type NbtRoot, type Tag } from './nbt.ts';
import { COPYCAT_BASE, copycatSlots, replaceCopycatMaterials } from './schematicBlockFixes.ts';

const SEP = '+';
/** То же значение, что REMOVE в schematicFile.ts (он импортирует этот модуль) */
const REMOVE = '#remove';

export const pairKey = (block: string, material: string) => `${block}${SEP}${material}`;
export const isPair = (id: string) => id.includes(SEP);

export function parsePair(id: string): { block: string; material: string } | null {
  const i = id.indexOf(SEP);
  return i < 0 ? null : { block: id.slice(0, i), material: id.slice(i + SEP.length) };
}

/** Блок строки замен: у пары — сам копикат */
export const pairBlock = (id: string) => parsePair(id)?.block ?? id;

/** Замены без пар: то, что можно применять к палитре и материалам по id */
export function plainRules(replace: Map<string, string>) {
  return new Map([...replace].filter(([from, to]) => !isPair(from) && !isPair(to)));
}

/**
 * Что станет с парой без своего правила: обычные замены копиката и материала действуют и на неё. null — ничего.
 * Копикат заменили парой или обычным блоком — итог этот; материал убрали — копикат без материала.
 */
export function inheritedTarget(id: string, replace: Map<string, string>): string | null {
  const pair = parsePair(id);
  if (!pair) return null;
  const block = replace.get(pair.block);
  const material = replace.get(pair.material);
  if (!block && !material) return null;
  if (block === REMOVE) return REMOVE;
  if (block && isPair(block)) return block;
  const to = block ?? pair.block;
  if (block && !canHoldMaterial(block)) return block;
  if (material === REMOVE) return to;
  const kept = material && !isPair(material) ? material : pair.material;
  return pairKey(to, kept);
}

export const hasPairRules = (replace: Map<string, string>) =>
  [...replace].some(([from, to]) => isPair(from) || isPair(to));

/**
 * Блок-сущность копиката, которому можно записать материал. Списки — CCBlockEntityTypes (Copycats+ 3.0.8: COPYCAT и
 * MULTI_STATE_COPYCAT) и Create 6.0.10. Остальные многосоставные (байт, доска, полуслои) зависят от свойств, которых
 * у обычных блоков нет; шестерни, валы и трубы — другие блок-сущности: туда пару не ставим.
 */
const CREATE_SINGLE = new Set(['create:copycat_step', 'create:copycat_panel']);
const COPYCATS_SINGLE = new Set(
  [
    'block',
    'beam',
    'vertical_step',
    'half_panel',
    'stairs',
    'fence',
    'fence_gate',
    'trapdoor',
    'iron_trapdoor',
    'wall',
    'ghost_block',
    'ladder',
    'layer',
    'slice',
    'vertical_slice',
    'corner_slice',
    'wooden_button',
    'stone_button',
    'wooden_pressure_plate',
    'stone_pressure_plate',
    'light_weighted_pressure_plate',
    'heavy_weighted_pressure_plate',
    'vertical_stairs',
    'slope',
    'vertical_slope',
    'slope_layer',
    'door',
    'iron_door',
    'pane',
    'flat_pane',
  ].map((b) => `copycats:copycat_${b}`),
);
const COPYCATS_SLAB = 'copycats:copycat_slab';

/** Этому блоку можно задать материал парой */
export const canHoldMaterial = (id: string) => CREATE_SINGLE.has(id) || COPYCATS_SINGLE.has(id) || id === COPYCATS_SLAB;

const str = (value: string): Tag => ({ type: T.String, value });
const compound = (entries: [string, Tag][]): Tag => ({ type: T.Compound, value: new Map(entries) as Compound });

/** Предмет материала: Create Schematic Checker требует совпадения с материалом и количества 1 */
const itemTag = (material: string, legacy: boolean): Tag =>
  legacy
    ? compound([
        ['id', str(material)],
        ['Count', { type: T.Byte, value: 1 }],
      ])
    : compound([
        ['id', str(material)],
        ['count', { type: T.Int, value: 1 }],
      ]);

const materialTag = (material: string, props: Tag | undefined): Tag =>
  compound(
    props
      ? [
          ['Name', str(material)],
          ['Properties', props],
        ]
      : [['Name', str(material)]],
  );

/**
 * Данные блок-сущности копиката с материалом. Плита Copycats+ (MaterialItemStorage): части по свойству type, чего
 * нет — остаётся copycat_base конструктором хранилища. Одиночные — Item + Material, как у CopycatBlockEntity.
 */
function pairNbt(
  block: string,
  material: string,
  slabType: string | undefined,
  props: Tag | undefined,
  legacy: boolean,
) {
  if (block === COPYCATS_SLAB) {
    const type = slabType ?? 'bottom';
    const parts = type === 'double' ? ['bottom', 'top'] : [type === 'top' ? 'top' : 'bottom'];
    const data: [string, Tag][] = parts.map((part) => [
      part,
      compound([
        ['material', materialTag(material, props)],
        ['consumedItem', itemTag(material, legacy)],
        ['enableCT', { type: T.Byte, value: 1 }],
      ]),
    ]);
    return new Map<string, Tag>([
      ['id', str('copycats:multistate_copycat')],
      ['material_data', compound(data)],
    ]);
  }
  return new Map<string, Tag>([
    ['id', str(CREATE_SINGLE.has(block) ? 'create:copycat' : 'copycats:copycat')],
    ['Item', itemTag(material, legacy)],
    ['Material', materialTag(material, props)],
  ]);
}

const nameOf = (c: Compound) => {
  const n = c.get('Name');
  return n?.type === T.String ? n.value : null;
};

/** Материалы копиката в клетке: без пустых частей (copycat_base, воздух) */
export function filledMaterials(nbt: Compound, empty: (id: string) => boolean): string[] {
  const out: string[] = [];
  for (const { material } of copycatSlots(nbt)) {
    const m = nameOf(material);
    if (m && m !== COPYCAT_BASE && !empty(m)) out.push(m);
  }
  return out;
}

/** Строка замен для клетки: пара по первому заполненному материалу, иначе сам блок */
export function cellKeyOf(name: string, nbt: Compound | null, empty: (id: string) => boolean) {
  const [material] = nbt ? filledMaterials(nbt, empty) : [];
  return material ? pairKey(name, material) : name;
}

/** Чем станет строка после замен: своё правило, потом замена копиката или материала целиком, иначе она сама */
export const cellTarget = (key: string, replace: Map<string, string>) =>
  replace.get(key) ?? inheritedTarget(key, replace) ?? key;

/** Данные копиката с материалом для клетки; свойства материала берутся из старых данных, если он там уже был */
export function pairData(
  pair: { block: string; material: string },
  slabType: string | undefined,
  old: Compound | null,
  legacy: boolean,
) {
  const source = old ? copycatSlots(old).find((s) => nameOf(s.material) === pair.material) : undefined;
  return pairNbt(pair.block, pair.material, slabType, source?.material.get('Properties'), legacy);
}

/** Заполненный копикат целиком удаляется заменами пар: все его материалы → удалить */
export function pairsRemoved(name: string, materials: string[], replace: Map<string, string>) {
  return materials.length > 0 && materials.every((m) => replace.get(pairKey(name, m)) === REMOVE);
}

/** Есть ли блок в счётчиках схемы: как строка или как часть пары (копикат, материал) */
export function hasBlock(counts: Map<string, number>, id: string) {
  if (counts.has(id)) return true;
  if (isPair(id)) return false;
  for (const key of counts.keys()) {
    const p = parsePair(key);
    if (p && (p.block === id || p.material === id)) return true;
  }
  return false;
}

export interface ResolvedPairs {
  /** Длина первой палитры до добавлений: новые записи уже итоговые, обычные замены их не трогают */
  paletteSize: number;
  /** Блоки, материалы которых уже решены парами */
  done: Set<Tag>;
}

/**
 * Применить замены с парами к схеме (root меняется на месте): клетка получает другую запись палитры и другие данные.
 * Обычные замены — дальше, в applyEdits; материал без своей пары берёт обычную замену (plainMaterial).
 */
export function resolvePairs(
  root: NbtRoot,
  palettes: Tag[][],
  replace: Map<string, string>,
  empty: (id: string) => boolean,
  plainMaterial: (id: string) => string | null,
  legacy: boolean,
): ResolvedPairs {
  const palette = palettes[0] ?? [];
  const resolved: ResolvedPairs = { paletteSize: palette.length, done: new Set() };
  const blocks = root.value.get('blocks');
  if (blocks?.type !== T.List) return resolved;

  /** Та же запись палитры с другим именем (свойства те же: лишние игра при чтении отбрасывает) */
  const added = new Map<string, number>();
  const stateFor = (state: number, block: string) => {
    const key = `${state}|${block}`;
    let n = added.get(key);
    if (n !== undefined) return n;
    for (const p of palettes) {
      const base = p[state] ?? palette[state];
      const value: Compound = base.type === T.Compound ? new Map(base.value) : new Map();
      value.set('Name', str(block));
      p.push({ type: T.Compound, value });
    }
    n = palette.length - 1;
    added.set(key, n);
    return n;
  };
  const slabTypeOf = (state: number) => {
    const e = palette[state];
    const props = e?.type === T.Compound ? e.value.get('Properties') : undefined;
    const t = props?.type === T.Compound ? props.value.get('type') : undefined;
    return t?.type === T.String ? t.value : undefined;
  };

  const kept: Tag[] = [];
  for (const b of blocks.value) {
    kept.push(b);
    if (b.type !== T.Compound) continue;
    const st = b.value.get('state');
    const entry = st?.type === T.Int ? palette[st.value] : undefined;
    const name = entry?.type === T.Compound ? nameOf(entry.value) : null;
    if (st?.type !== T.Int || !name) continue;
    const nbtTag = b.value.get('nbt');
    const nbt = nbtTag?.type === T.Compound ? nbtTag.value : null;
    const materials = nbt ? filledMaterials(nbt, empty) : [];

    const rules = materials.map((m) => replace.get(pairKey(name, m)));
    if (materials.length && pairsRemoved(name, materials, replace)) {
      kept.pop();
      continue;
    }
    // Правило, которое меняет сам блок: пара с другим копикатом, обычный блок; потом — замена копиката целиком
    let target = rules.find((r) => r && r !== REMOVE && pairBlock(r) !== name);
    if (!target && !rules.some(Boolean)) {
      const whole = replace.get(name);
      if (whole && isPair(whole)) target = whole;
    }
    if (target) {
      const pair = parsePair(target);
      if (pairBlock(target) !== name)
        b.value.set('state', { type: T.Int, value: stateFor(st.value, pairBlock(target)) });
      if (pair)
        b.value.set('nbt', {
          type: T.Compound,
          value: pairData(pair, slabTypeOf(st.value), nbt, legacy),
        });
      else b.value.delete('nbt');
      resolved.done.add(b);
      continue;
    }
    // Только материалы: блок остаётся, части без своей пары идут по обычным заменам
    if (nbt && rules.some(Boolean)) {
      replaceCopycatMaterials(
        nbt,
        (m) => {
          const r = replace.get(pairKey(name, m));
          // Удалить часть или та же форма без материала — часть становится пустой
          if (r === REMOVE || r === name) return COPYCAT_BASE;
          return (r && parsePair(r)?.material) || plainMaterial(m);
        },
        legacy,
      );
      resolved.done.add(b);
    }
  }
  blocks.value = kept;
  return resolved;
}
