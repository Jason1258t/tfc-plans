import type { ChecklistEntry } from '../types';
import type { ItemIndex } from './items';
import { readNbt, T, type Compound, type Tag } from './nbt';
import { uid } from './util';

/**
 * Список материалов схемы (.nbt Create / структура ванили): блоки → предметы, которые нужно собрать.
 * Учитывает, что одна вещь может занимать несколько блоков (двери, кровати, высокие растения),
 * а один блок — требовать несколько предметов (двойные плиты, свечи, огурцы моря).
 * Блок, у которого нет одноимённого предмета, пытаемся свести к нему правилами (wall_torch → torch);
 * если не вышло — материал «нераспознан», его можно добавить текстовым пунктом.
 */
export interface Material {
  /** id предмета (или блока, если предмет не нашёлся) */
  id: string;
  qty: number;
  /** Предмет есть в библиотеке сборки */
  known: boolean;
  /** Из каких блоков получен (если отличается от id) */
  from: string[];
}

export interface SchematicMaterials {
  fileName: string;
  materials: Material[];
  /** Блоков всего (без воздуха) */
  blocks: number;
  /** Пропущено: жидкости, вторые половины дверей и кроватей, сегменты ремней */
  skipped: number;
  /** Сущности в схеме (контрапции, рамки) — их содержимое не считаем */
  entities: number;
}

/** Блоки, которые не ставятся из предметов */
const SKIP = new Set([
  'minecraft:air',
  'minecraft:cave_air',
  'minecraft:void_air',
  'minecraft:structure_void',
  'minecraft:jigsaw',
  'minecraft:moving_piston',
  'minecraft:piston_head',
  'minecraft:fire',
  'minecraft:soul_fire',
  'minecraft:water',
  'minecraft:lava',
  'minecraft:bubble_column',
  'minecraft:nether_portal',
  'minecraft:end_portal',
  'minecraft:end_gateway',
  'minecraft:frosted_ice',
]);

/** Блок → предмет там, где имена не совпадают и правило не выводится */
const BLOCK_TO_ITEM: Record<string, string> = {
  'minecraft:redstone_wire': 'minecraft:redstone',
  'minecraft:tripwire': 'minecraft:string',
  'minecraft:cocoa': 'minecraft:cocoa_beans',
  'minecraft:carrots': 'minecraft:carrot',
  'minecraft:potatoes': 'minecraft:potato',
  'minecraft:beetroots': 'minecraft:beetroot_seeds',
  'minecraft:wheat': 'minecraft:wheat_seeds',
  'minecraft:melon_stem': 'minecraft:melon_seeds',
  'minecraft:attached_melon_stem': 'minecraft:melon_seeds',
  'minecraft:pumpkin_stem': 'minecraft:pumpkin_seeds',
  'minecraft:attached_pumpkin_stem': 'minecraft:pumpkin_seeds',
  'minecraft:sweet_berry_bush': 'minecraft:sweet_berries',
  'minecraft:bamboo_sapling': 'minecraft:bamboo',
  'minecraft:cave_vines': 'minecraft:glow_berries',
  'minecraft:cave_vines_plant': 'minecraft:glow_berries',
  'minecraft:tall_seagrass': 'minecraft:seagrass',
  'minecraft:big_dripleaf_stem': 'minecraft:big_dripleaf',
  'minecraft:powder_snow': 'minecraft:powder_snow_bucket',
  'create:belt': 'create:belt_connector',
};

const str = (t: Tag | undefined) => (t?.type === T.String ? t.value : undefined);

function props(entry: Compound): Record<string, string> {
  const p = entry.get('Properties');
  const out: Record<string, string> = {};
  if (p?.type === T.Compound) for (const [k, v] of p.value) if (v.type === T.String) out[k] = v.value;
  return out;
}

/** Сколько предметов даёт один блок с такими свойствами (0 — не считать) */
function multiplier(id: string, p: Record<string, string>): number {
  // Вторые половины многоблочных вещей: верх двери/высокого цветка, изголовье кровати
  if (p.half === 'upper') return 0;
  if (p.part === 'head') return 0;
  // Ремень Create: предмет-ремень один на весь ремень — считаем по началу
  if (id === 'create:belt') return p.part === 'start' ? 1 : 0;
  if (p.type === 'double' && id.endsWith('_slab')) return 2;
  for (const k of ['candles', 'pickles', 'eggs', 'flower_amount', 'layers']) {
    const n = Number(p[k]);
    if (n > 0) return n;
  }
  return 1;
}

/** Блок → предмет: прямое совпадение, таблица, затем правила по имени */
function itemFor(block: string, items: ItemIndex | null): { id: string; known: boolean } {
  const has = (id: string) => !items || items.byId.has(id);
  if (has(block)) return { id: block, known: true };
  const mapped = BLOCK_TO_ITEM[block];
  if (mapped && has(mapped)) return { id: mapped, known: true };

  const [ns, path] = block.split(':');
  const variants = [
    path.replace('wall_', ''), // wall_torch, oak_wall_sign, skeleton_wall_skull, wall_banner
    path.replace('_wall_', '_'),
    path.replace(/^potted_/, ''), // горшок с растением — нужно само растение (горшок не считаем)
    path.replace(/_plant$/, ''), // kelp_plant, weeping_vines_plant
    path.replace(/_stem$/, ''),
  ];
  for (const v of variants) {
    if (v && v !== path && has(`${ns}:${v}`)) return { id: `${ns}:${v}`, known: true };
  }
  return { id: block, known: false };
}

/** Жидкости модов (tfc:fluid/…) — не предметы и не ставятся руками */
const isFluid = (id: string) => /(^|[:/])fluid\//.test(id) || /:(flowing_)?[a-z_]*water$/.test(id);

export async function schematicMaterials(file: File, items: ItemIndex | null): Promise<SchematicMaterials> {
  const { root } = await readNbt(new Uint8Array(await file.arrayBuffer()));
  const nbt = root.value;
  const single = nbt.get('palette');
  const multi = nbt.get('palettes'); // структуры с вариантами палитры — берём первый
  const palette: Tag[] =
    single?.type === T.List
      ? single.value
      : multi?.type === T.List && multi.value[0]?.type === T.List
        ? multi.value[0].value
        : [];
  if (!palette.length) throw new Error(`«${file.name}»: в файле нет палитры блоков — это не схема`);

  // Палитра → (предмет, множитель) один раз, затем проход по блокам
  const names = palette.map((e) => (e.type === T.Compound ? str(e.value.get('Name')) : undefined));
  const resolved = palette.map((entry, i) => {
    const name = names[i];
    if (entry.type !== T.Compound || !name || SKIP.has(name) || isFluid(name)) return null;
    const mult = multiplier(name, props(entry.value));
    if (!mult) return null;
    return { block: name, mult, ...itemFor(name, items) };
  });

  const acc = new Map<string, Material>();
  let blocks = 0;
  let skipped = 0;
  const list = nbt.get('blocks');
  if (list?.type === T.List) {
    for (const b of list.value) {
      if (b.type !== T.Compound) continue;
      const state = b.value.get('state');
      if (state?.type !== T.Int) continue;
      const name = names[state.value];
      if (!name || SKIP.has(name)) continue;
      blocks++;
      const r = resolved[state.value];
      if (!r) {
        skipped++;
        continue;
      }
      const m = acc.get(r.id) ?? { id: r.id, qty: 0, known: r.known, from: [] };
      m.qty += r.mult;
      if (r.block !== r.id && !m.from.includes(r.block)) m.from.push(r.block);
      acc.set(r.id, m);
    }
  }
  const ents = nbt.get('entities');
  return {
    fileName: file.name,
    materials: [...acc.values()].sort((a, b) => Number(b.known) - Number(a.known) || b.qty - a.qty),
    blocks,
    skipped,
    entities: ents?.type === T.List ? ents.value.length : 0,
  };
}

/** Добавляет материалы в чеклист: к уже имеющимся ресурсам количество прибавляется */
export function addMaterials(
  list: ChecklistEntry[],
  materials: { id: string; qty: number; known: boolean }[],
  items: ItemIndex | null,
): ChecklistEntry[] {
  const next = [...list];
  for (const m of materials) {
    if (m.known) {
      const i = next.findIndex((e) => e.itemId === m.id);
      if (i >= 0) next[i] = { ...next[i], qty: (next[i].qty ?? 0) + m.qty };
      else {
        const it = items?.byId.get(m.id);
        next.push({ id: uid(), itemId: m.id, text: it ? (it.r ?? it.e) : m.id, qty: m.qty, got: 0 });
      }
    } else {
      next.push({ id: uid(), text: `${m.id} ×${m.qty}`, done: false });
    }
  }
  return next;
}
