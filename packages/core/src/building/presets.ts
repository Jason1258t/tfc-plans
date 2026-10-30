/**
 * Пресеты: стиль (крыша, отделка, материалы ролей), тип здания (этажи, проёмы, труба) и форма плана (набор
 * объёмов). makeSpec разворачивает их в полные параметры — дальше генератор пресетов не знает.
 * Новый стиль/тип/форма — запись в реестре здесь. Блоки по умолчанию проверены по библиотеке сборки (2026-10-30).
 */
import type { Role } from './grid.ts';
import { PALETTES, applyPalette } from './palettes.ts';
import type { BuildingSpec, DetailSpec, OpeningsSpec, RoleSpec, RoofSpec, Volume } from './spec.ts';

const one = (id: string): RoleSpec => ({ on: true, fill: { blocks: [{ id }] } });
const off: RoleSpec = { on: false };

export interface StylePreset {
  name: string;
  roof: Omit<RoofSpec, 'axis'>;
  details: Omit<DetailSpec, 'chimney' | 'clearInside'>;
  roles: Partial<Record<Role, RoleSpec>>;
}

export const STYLES: Record<string, StylePreset> = {
  industrial: {
    name: 'Индустриальный',
    roof: { kind: 'gable', pitch: 0.5, overhang: 1 },
    details: { plinthH: 2, quoins: false, openingExt: true, frameEvery: 0, piers: true },
    roles: {
      foundation: one('immersiveengineering:concrete'),
      wall: one('minecraft:bricks'),
      frame: one('createdeco:corner_red_bricks'),
      corner: one('createdeco:corner_red_bricks'),
      plinth: one('immersiveengineering:concrete_brick'),
      belt: one('immersiveengineering:concrete'),
      lintel: one('immersiveengineering:concrete'),
      sill: one('immersiveengineering:concrete'),
      jamb: off,
      parapet: one('immersiveengineering:concrete'),
      roof: one('create:cut_deepslate_bricks'),
      floor: one('immersiveengineering:concrete'),
      glass: one('create:industrial_iron_window_pane'),
      door: one('createdeco:industrial_iron_door'),
      chimney: one('minecraft:bricks'),
    },
  },
  stone: {
    name: 'Каменный',
    roof: { kind: 'gable', pitch: 1, overhang: 1 },
    details: { plinthH: 1, quoins: true, openingExt: true, frameEvery: 0 },
    roles: {
      foundation: one('tfc:rock/cobble/granite'),
      wall: one('tfc:rock/bricks/granite'),
      corner: one('tfc:rock/smooth/granite'),
      plinth: one('tfc:rock/cobble/granite'),
      belt: one('tfc:rock/smooth/granite'),
      lintel: one('tfc:rock/smooth/granite'),
      sill: one('tfc:rock/smooth/granite'),
      jamb: off,
      roof: one('tfc:rock/bricks/slate'),
      floor: one('tfc:wood/planks/oak'),
      glass: one('minecraft:glass_pane'),
      door: one('tfc:wood/door/oak'),
      chimney: one('tfc:rock/bricks/granite'),
    },
  },
  timber: {
    name: 'Фахверк',
    roof: { kind: 'gable', pitch: 1, overhang: 1 },
    details: { plinthH: 1, quoins: false, openingExt: false, frameEvery: 3 },
    roles: {
      foundation: one('tfc:rock/cobble/granite'),
      wall: one('tfc:wattle/white'),
      frame: one('tfc:wood/log/oak'),
      plinth: one('tfc:rock/cobble/granite'),
      lintel: one('tfc:wood/log/oak'),
      sill: one('tfc:wood/log/oak'),
      gable: one('tfc:wood/planks/oak'),
      roof: one('tfc:wood/planks/spruce'),
      floor: one('tfc:wood/planks/oak'),
      glass: one('minecraft:glass_pane'),
      door: one('tfc:wood/door/oak'),
      chimney: one('tfc:rock/bricks/granite'),
    },
  },
  log: {
    name: 'Сруб',
    roof: { kind: 'gable', pitch: 1, overhang: 2 },
    details: { plinthH: 1, quoins: false, openingExt: false, frameEvery: 0 },
    roles: {
      foundation: one('tfc:rock/cobble/granite'),
      // Бревно лежит вдоль стены, на углах оси меняются через ряд (перекрёст)
      wall: one('tfc:wood/log/pine'),
      plinth: one('tfc:rock/cobble/granite'),
      corner: off,
      belt: off,
      gable: one('tfc:wood/planks/pine'),
      roof: one('tfc:wood/planks/spruce'),
      floor: one('tfc:wood/planks/pine'),
      glass: one('minecraft:glass_pane'),
      door: one('tfc:wood/door/pine'),
      chimney: one('tfc:rock/bricks/granite'),
    },
  },
};

export interface TypePreset {
  name: string;
  w: number;
  d: number;
  floors: number;
  floorH: number;
  openings: OpeningsSpec;
  chimney: boolean;
  /** Своя крыша типа поверх стиля (цех — пологая) */
  roof?: Partial<Omit<RoofSpec, 'axis'>>;
}

export const TYPES: Record<string, TypePreset> = {
  house: {
    name: 'Дом',
    w: 9,
    d: 7,
    floors: 2,
    floorH: 4,
    openings: { windowW: 1, windowH: 2, windowEvery: 3, sillH: 1, door: { side: 'south', w: 1, h: 2 } },
    chimney: true,
  },
  barn: {
    name: 'Амбар',
    w: 11,
    d: 9,
    floors: 1,
    floorH: 6,
    openings: { windowW: 1, windowH: 1, windowEvery: 4, sillH: 3, door: { side: 'south', w: 3, h: 4 } },
    chimney: false,
  },
  workshop: {
    name: 'Мастерская',
    w: 13,
    d: 9,
    floors: 1,
    floorH: 7,
    openings: { windowW: 2, windowH: 3, windowEvery: 4, sillH: 1, door: { side: 'south', w: 3, h: 4 } },
    chimney: false,
    roof: { pitch: 0.5 },
  },
  factory: {
    name: 'Цех',
    w: 21,
    d: 13,
    floors: 2,
    floorH: 6,
    openings: { windowW: 2, windowH: 3, windowEvery: 4, sillH: 1, door: { side: 'south', w: 4, h: 5 } },
    chimney: true,
    roof: { pitch: 0.5 },
  },
};

type Rect = Pick<Volume, 'x' | 'z' | 'w' | 'd'> & { axis: RoofSpec['axis'] };

export const FORMS: Record<string, { name: string; rects(w: number, d: number): Rect[] }> = {
  rect: { name: 'Прямоугольник', rects: (w, d) => [{ x: 0, z: 0, w, d, axis: 'auto' }] },
  L: {
    name: 'Г',
    rects: (w, d) => {
      const k = wing(w, d);
      return [
        { x: 0, z: 0, w, d: k, axis: 'x' },
        { x: 0, z: 0, w: k, d, axis: 'z' },
      ];
    },
  },
  T: {
    name: 'Т',
    rects: (w, d) => {
      const k = wing(w, d);
      return [
        { x: 0, z: 0, w, d: k, axis: 'x' },
        { x: Math.floor((w - k) / 2), z: 0, w: k, d, axis: 'z' },
      ];
    },
  },
  U: {
    name: 'П',
    rects: (w, d) => {
      const k = wing(w, d);
      return [
        { x: 0, z: 0, w, d: k, axis: 'x' },
        { x: 0, z: 0, w: k, d, axis: 'z' },
        { x: w - k, z: 0, w: k, d, axis: 'z' },
      ];
    },
  },
};

/** Ширина крыла — нечётная (конёк по середине), не уже 5 */
const wing = (w: number, d: number) => Math.max(5, Math.round(Math.min(w, d) / 2) | 1);

export interface MakeSpecOptions {
  form?: string;
  style?: string;
  type?: string;
  /** Размер плана целиком; нет — по типу здания (у сложных форм — в полтора раза больше) */
  w?: number;
  d?: number;
  seed?: number;
  degree?: number;
  /** Палитра материалов (PALETTES); нет — блоки стиля */
  palette?: string;
}

export function makeSpec(opts: MakeSpecOptions = {}): BuildingSpec {
  const form = FORMS[opts.form ?? 'rect'] ? (opts.form ?? 'rect') : 'rect';
  const styleId = STYLES[opts.style ?? 'stone'] ? (opts.style ?? 'stone') : 'stone';
  const typeId = TYPES[opts.type ?? 'house'] ? (opts.type ?? 'house') : 'house';
  const style = STYLES[styleId];
  const type = TYPES[typeId];
  const grow = form === 'rect' ? 1 : 1.5;
  const w = opts.w ?? Math.round(type.w * grow);
  const d = opts.d ?? Math.round(type.d * grow);
  const roof = { ...style.roof, ...type.roof };
  return {
    v: 1,
    seed: opts.seed ?? 1,
    form,
    style: styleId,
    type: typeId,
    volumes: FORMS[form].rects(w, d).map((r, i) => ({
      id: String.fromCharCode(65 + i),
      x: r.x,
      z: r.z,
      w: r.w,
      d: r.d,
      y: 0,
      floors: type.floors,
      floorH: type.floorH,
      roof: { ...roof, axis: r.axis },
    })),
    openings: structuredClone(type.openings),
    details: { ...style.details, chimney: type.chimney, clearInside: true },
    texture: { degree: opts.degree ?? 0 },
    palette: opts.palette && PALETTES[opts.palette] ? opts.palette : '',
    roles:
      opts.palette && PALETTES[opts.palette]
        ? applyPalette(structuredClone(style.roles), PALETTES[opts.palette])
        : structuredClone(style.roles),
    overrides: [],
  };
}
