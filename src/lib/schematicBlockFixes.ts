/**
 * Правки данных блок-сущностей (nbt блока схемы), без которых файл не загрузится в игре. Правило — модулем на мод:
 * id блока (уже после замен) и его nbt → новое nbt, null — убрать данные, undefined — не трогать.
 * Модуль запускают и сайт, и Node (через schematicFile.ts) — импорт только nbt.ts с расширением, стираемый TS.
 */
import { T, type Compound } from './nbt.ts';

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
