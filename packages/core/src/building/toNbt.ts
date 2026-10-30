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
        const c = p.cells[x + p.X * (z + p.Z * y)];
        if (c)
          blocks.push(
            compound([
              ['pos', ints([x, y, z])],
              ['state', int(c - 1)],
            ]),
          );
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

/** Сколько каких блоков (без воздуха) — список материалов */
export function materials(p: Painted): Map<string, number> {
  const per = new Array<number>(p.palette.length).fill(0);
  for (const c of p.cells) if (c) per[c - 1]++;
  const out = new Map<string, number>();
  p.palette.forEach((s, i) => {
    if (per[i] && s.Name !== 'minecraft:air') out.set(s.Name, (out.get(s.Name) ?? 0) + per[i]);
  });
  return out;
}
