import { T, type Compound, type ParsedNbt, type Tag } from '@tfc/core/nbt';
import { COPYCAT_BASE, EMPTY_BLOCKS, intList, nameOf, paletteLists, posOf, sizeOf } from '@tfc/core/schematicFile';
import { copycatSlots } from '@tfc/core/schematicBlockFixes';

/**
 * Блочная структура для просмотра по слоям: шаблон мультиблока IE, схема Create из библиотеки, постройка в гайде.
 * Координаты: x — вправо, y — вверх, z — к игроку (лицевая сторона — +Z).
 */

export interface BlockState {
  id: string;
  /** Свойства блока (type у плит, facing…) */
  p?: Record<string, string>;
  /** Материал копиката (схемы Create): блок, которым он выглядит */
  m?: string;
}

/** [x, y, z, номер в палитре] — без воздуха */
export type StructureBlock = [number, number, number, number];

export interface BlockShape {
  size: [number, number, number];
  palette: BlockState[];
  blocks: StructureBlock[];
}

/** Форма блока для объёмного вида: плиты — половина, заборы и столбы — тонкие */
export type BlockForm = 'cube' | 'slab-bottom' | 'slab-top' | 'post';
export function blockForm(s: BlockState): BlockForm {
  const path = s.id.split(':')[1] ?? '';
  if (/(^|_)slab(_|$)/.test(path))
    return s.p?.type === 'top' ? 'slab-top' : s.p?.type === 'double' ? 'cube' : 'slab-bottom';
  if (/fence|_post$/.test(path) && !/gate/.test(path)) return 'post';
  return 'cube';
}

/** Материалы: блок → сколько штук, по убыванию (копикаты — по материалу отдельно; свойства не различаем) */
export function materials(shape: BlockShape): { state: BlockState; count: number }[] {
  const byId = new Map<string, { state: BlockState; count: number }>();
  for (const b of shape.blocks) {
    const s = shape.palette[b[3]];
    const key = s.m ? `${s.id}|${s.m}` : s.id;
    const cur = byId.get(key) ?? { state: s, count: 0 };
    cur.count++;
    byId.set(key, cur);
  }
  return [...byId.values()].sort((a, b) => b.count - a.count || a.state.id.localeCompare(b.state.id));
}

/**
 * Структура из файла .nbt (схема Create / структура ванили): первая палитра, блоки без воздуха; у копиката —
 * материал (отдельная запись палитры на каждую пару «копикат + материал»). Замены и форму карточки библиотеки
 * применяют до этого — тем же кодом, что и при скачивании (applyEdits).
 */
export function shapeFromNbt(parsed: ParsedNbt): BlockShape {
  const root = parsed.root.value;
  const [list] = paletteLists(root);
  if (!list) throw new Error('В файле нет палитры блоков — это не схема');
  const palette: BlockState[] = list.map((entry) => {
    const props = entry.type === T.Compound ? entry.value.get('Properties') : undefined;
    const p: Record<string, string> = {};
    if (props?.type === T.Compound) for (const [k, v] of props.value) if (v.type === T.String) p[k] = v.value;
    const id = nameOf(entry) ?? 'minecraft:air';
    return Object.keys(p).length ? { id, p } : { id };
  });
  const withMaterial = new Map<string, number>();
  const blocksTag = root.get('blocks');
  const blocks: StructureBlock[] = [];
  const max: [number, number, number] = [0, 0, 0];
  if (blocksTag?.type === T.List)
    for (const b of blocksTag.value) {
      if (b.type !== T.Compound) continue;
      const pos = posOf(b);
      const st = b.value.get('state');
      if (!pos || st?.type !== T.Int || !palette[st.value]) continue;
      if (EMPTY_BLOCKS.has(palette[st.value].id)) continue;
      let state = st.value;
      const nbt = b.value.get('nbt');
      const material =
        nbt?.type === T.Compound
          ? copycatSlots(nbt.value)
              .map((slot) => nameOf({ type: T.Compound, value: slot.material }))
              .find((m) => m && m !== COPYCAT_BASE && !EMPTY_BLOCKS.has(m))
          : null;
      if (material) {
        const key = `${state}|${material}`;
        if (!withMaterial.has(key)) {
          withMaterial.set(key, palette.length);
          palette.push({ ...palette[state], m: material });
        }
        state = withMaterial.get(key)!;
      }
      blocks.push([pos[0], pos[1], pos[2], state]);
      for (let i = 0; i < 3; i++) max[i] = Math.max(max[i], pos[i] + 1);
    }
  const size = sizeOf(root) ?? max;
  return { size: [Math.max(size[0], max[0]), Math.max(size[1], max[1]), Math.max(size[2], max[2])], palette, blocks };
}

/**
 * Обратно — структура как файл .nbt в памяти (палитра, блоки, размер; у копиката — материал в nbt клетки): для
 * объёмного вида редактора схем, который рисует по файлу. У мультиблоков IE файла рядом нет — собираем.
 */
export function nbtFromShape(shape: BlockShape): ParsedNbt {
  const str = (value: string): Tag => ({ type: T.String, value });
  const compound = (entries: [string, Tag][]): Tag => ({ type: T.Compound, value: new Map(entries) as Compound });
  const palette = shape.palette.map((s) =>
    compound([
      ['Name', str(s.id)],
      ...(s.p ? ([['Properties', compound(Object.entries(s.p).map(([k, v]) => [k, str(v)]))]] as [string, Tag][]) : []),
    ]),
  );
  const blocks = shape.blocks.map(([x, y, z, st]) => {
    const m = shape.palette[st]?.m;
    return compound([
      ['pos', intList([x, y, z])],
      ['state', { type: T.Int, value: st }],
      ...(m ? ([['nbt', compound([['Material', compound([['Name', str(m)]])]])]] as [string, Tag][]) : []),
    ]);
  });
  const root: Compound = new Map([
    ['size', intList(shape.size)],
    ['palette', { type: T.List, elemType: T.Compound, value: palette }],
    ['blocks', { type: T.List, elemType: T.Compound, value: blocks }],
  ]);
  return { root: { name: '', value: root }, gzipped: true };
}
