/**
 * Правки данных блок-сущностей (nbt блока схемы), без которых файл не загрузится в игре. Правило — модулем на мод:
 * id блока (уже после замен) и его nbt → новое nbt, null — убрать данные, undefined — не трогать.
 * Модуль запускают и сайт, и Node (через schematicFile.ts) — импорт только nbt.ts с расширением, стираемый TS.
 */
import { T, type Compound, type Tag } from './nbt.ts';

type BlockFix = (name: string, nbt: Compound) => Compound | null | undefined;

/**
 * Copycats+ 3.0.8: многосоставные копикаты (наследники MultiStateCopycatBlock) хранят материалы по частям
 * (material_data). Данные одиночного копиката (ключ Material — например, после замены двери-копиката на пластину)
 * MigrationManager.migrateStructure при чтении схемы переводит через блок-сущность create:copycat, а она с этим
 * блоком несовместима — IllegalStateException, стол схем забирает пустую схему и ничего не выдаёт.
 * Такие данные убираем: копикат встанет без материала.
 */
const COPYCATS_MULTISTATE = new Set(
  ['board', 'byte', 'byte_panel', 'half_layer', 'slab', 'stacked_half_layer', 'vertical_half_layer'].map(
    (b) => `copycats:copycat_${b}`,
  ),
);
const copycatsMultistate: BlockFix = (name, nbt) =>
  COPYCATS_MULTISTATE.has(name) && nbt.has('Material') ? null : undefined;

/**
 * Вторая ветка той же миграции: одиночный копикат Copycats+ с данными блок-сущности Create (id create:copycat)
 * она перечитывает через be.getLevel() свежей блок-сущности — мира у неё нет, NullPointerException. Формат данных
 * тот же, поэтому меняем только id на свой у Copycats+ (CCBlockEntityTypes.COPYCAT) — как и сделала бы миграция.
 */
const copycatsCreateId: BlockFix = (name, nbt) => {
  const id = nbt.get('id');
  if (!name.startsWith('copycats:') || COPYCATS_MULTISTATE.has(name)) return undefined;
  if (id?.type !== T.String || id.value !== 'create:copycat') return undefined;
  return new Map(nbt).set('id', { type: T.String, value: 'copycats:copycat' });
};

const FIXES: BlockFix[] = [copycatsMultistate, copycatsCreateId];

// ---------------------------------------------------------------- материалы копикатов

export const COPYCAT_BASE = 'create:copycat_base';

/** Материал копиката (blockstate: Name, Properties) и предмет, из которого он поставлен (может не быть) */
interface CopycatSlot {
  material: Compound;
  item: Compound | null;
}

/**
 * Материалы копиката в nbt блока. Create 6.0.10 CopycatBlockEntity: Material + Item; многосоставные Copycats+ 3.0.8
 * (MaterialItemStorage): material_data.<часть>.material + consumedItem. Другие nbt — пустой список.
 */
export function copycatSlots(nbt: Compound): CopycatSlot[] {
  const compound = (c: Compound, key: string) => {
    const t = c.get(key);
    return t?.type === T.Compound ? t.value : null;
  };
  const out: CopycatSlot[] = [];
  const material = compound(nbt, 'Material');
  if (material?.has('Name')) out.push({ material, item: compound(nbt, 'Item') });
  const data = compound(nbt, 'material_data');
  if (data)
    for (const part of data.keys()) {
      const slot = compound(data, part);
      const m = slot && compound(slot, 'material');
      if (slot && m?.has('Name')) out.push({ material: m, item: compound(slot, 'consumedItem') });
    }
  return out;
}

const str = (c: Compound, key: string) => {
  const t = c.get(key);
  return t?.type === T.String ? t.value : null;
};

/** Количество предмета: ключ и тип как в файле (до 1.20.5 — Count байтом, потом count числом) */
function setCount(item: Compound, n: number, legacy: boolean) {
  const key = item.has('count') ? 'count' : item.has('Count') ? 'Count' : legacy ? 'Count' : 'count';
  const old = item.get(key);
  const type =
    old?.type === T.Byte || old?.type === T.Short || old?.type === T.Int ? old.type : legacy ? T.Byte : T.Int;
  item.set(key, { type, value: n } as Tag);
}

/**
 * Замены в материалах копиката (nbt меняется на месте). target: id материала → новый id, COPYCAT_BASE — убрать
 * материал, null — не трогать. Предмет меняется вместе с материалом: Create при чтении сбрасывает копикат в
 * copycat_base, если предмет не ставит блок материала, а Create Schematic Checker считает схему читерской, если
 * предмет не совпадает с материалом или его не 1 (у copycat_base — minecraft:air и 0). Пустой предмет при
 * материале (часть, заполненная миграцией Copycats+) остаётся пустым. Свойства материала сохраняются: лишние игра
 * при чтении blockstate пропускает.
 */
export function replaceCopycatMaterials(nbt: Compound, target: (id: string) => string | null, legacy: boolean) {
  for (const { material, item } of copycatSlots(nbt)) {
    const from = str(material, 'Name');
    const to = from && target(from);
    if (!to || to === from) continue;
    material.set('Name', { type: T.String, value: to });
    if (to === COPYCAT_BASE) material.delete('Properties');
    if (!item) continue;
    const had = str(item, 'id');
    if (to === COPYCAT_BASE) {
      item.set('id', { type: T.String, value: 'minecraft:air' });
      setCount(item, 0, legacy);
    } else if (had && had !== 'minecraft:air') {
      item.set('id', { type: T.String, value: to });
      setCount(item, 1, legacy);
    }
  }
}

/** Применить правила к nbt блока; null — данные нужно убрать */
export function fixBlockData(name: string, nbt: Compound): Compound | null {
  let out = nbt;
  for (const fix of FIXES) {
    const next = fix(name, out);
    if (next === null) return null;
    if (next) out = next;
  }
  return out;
}
