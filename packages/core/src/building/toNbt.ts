/**
 * Раскрашенная сетка → структура в формате схем Create (тот же, что у ванильных структур): size, palette, blocks,
 * entities, DataVersion. DataVersion 3955 — Minecraft 1.21.1: id блоков уже в именах 1.21, переводчик версий
 * игры их не трогает (схемы из библиотеки с 1.20.1 несут 3465).
 */
import { T, writeNbt, type Compound, type NbtRoot, type Tag } from '../nbt.ts';
import type { Painted } from './fill.ts';

export const DATA_VERSION = 3955;

const int = (value: number): Tag => ({ type: T.Int, value });
const str = (value: string): Tag => ({ type: T.String, value });
const ints = (v: number[]): Tag => ({ type: T.List, elemType: T.Int, value: v.map(int) });
const compound = (entries: [string, Tag][]): Tag => ({ type: T.Compound, value: new Map(entries) as Compound });

export function structureRoot(p: Painted): NbtRoot {
  const palette = p.palette.map((s) => {
    const e: [string, Tag][] = [['Name', str(s.Name)]];
    if (s.Properties) e.push(['Properties', compound(Object.entries(s.Properties).map(([k, v]) => [k, str(v)]))]);
    return compound(e);
  });
  const blocks: Tag[] = [];
  for (let y = 0; y < p.Y; y++)
    for (let z = 0; z < p.Z; z++)
      for (let x = 0; x < p.X; x++) {
        const i = x + p.X * (z + p.Z * y);
        const c = p.cells[i];
        if (!c) continue;
        const e: [string, Tag][] = [
          ['pos', ints([x, y, z])],
          ['state', int(c - 1)],
        ];
        // Копикат: данные блок-сущности с материалом и предметом (проверка схемы в игре требует совпадения)
        const mat = p.mats[i];
        if (mat) {
          const be = p.palette[c - 1].Name.startsWith('copycats:') ? 'copycats:copycat' : 'create:copycat';
          e.push([
            'nbt',
            compound([
              ['id', str(be)],
              [
                'Item',
                compound([
                  ['id', str(mat)],
                  ['count', int(1)],
                ]),
              ],
              ['Material', compound([['Name', str(mat)]])],
            ]),
          ]);
        }
        blocks.push(compound(e));
      }
  return {
    name: '',
    value: new Map<string, Tag>([
      ['size', ints([p.X, p.Y, p.Z])],
      ['entities', { type: T.List, elemType: T.Compound, value: [] }],
      ['blocks', { type: T.List, elemType: T.Compound, value: blocks }],
      ['palette', { type: T.List, elemType: T.Compound, value: palette }],
      ['DataVersion', int(DATA_VERSION)],
    ]),
  };
}

/** Файл .nbt (gzip), как его сохраняет Create */
export const toNbt = (p: Painted) => writeNbt(structureRoot(p), true);

/** Сколько каких блоков (без воздуха) — список материалов; у копиката считается и он сам, и его материал */
export function materials(p: Painted): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string) => out.set(id, (out.get(id) ?? 0) + 1);
  for (let i = 0; i < p.cells.length; i++) {
    const c = p.cells[i];
    if (!c) continue;
    const name = p.palette[c - 1].Name;
    if (name !== 'minecraft:air') add(name);
    const mat = p.mats[i];
    if (mat) add(mat);
  }
  return out;
}
