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
  scandinavian: {
    name: 'Скандинавский',
    // Крутая крыша 2:1 — снег скатывается; светлые доски, тёмные углы и обвязка
    roof: { kind: 'gable', pitch: 2, overhang: 1 },
    details: { plinthH: 1, quoins: false, openingExt: false, frameEvery: 0 },
    roles: {
      foundation: one('tfc:rock/cobble/granite'),
      wall: one('tfc:wood/planks/birch'),
      corner: one('tfc:wood/log/spruce'),
      belt: one('tfc:wood/log/spruce'),
      plinth: one('tfc:rock/cobble/granite'),
      lintel: one('tfc:wood/log/spruce'),
      sill: one('tfc:wood/log/spruce'),
      gable: one('tfc:wood/planks/birch'),
      roof: one('tfc:wood/planks/spruce'),
      floor: one('tfc:wood/planks/birch'),
      glass: one('minecraft:glass_pane'),
      door: one('tfc:wood/door/birch'),
      chimney: one('tfc:rock/bricks/granite'),
    },
  },
  japanese: {
    name: 'Японский',
    // Вальма с широким свесом и подъёмом на углах; тёмный каркас, светлое заполнение
    roof: { kind: 'hip', pitch: 1, overhang: 2, upturned: true },
    details: { plinthH: 1, quoins: false, openingExt: false, frameEvery: 3 },
    roles: {
      foundation: one('tfc:rock/cobble/granite'),
      wall: one('tfc:wattle/white'),
      frame: one('tfc:wood/log/rosewood'),
      plinth: one('tfc:rock/cobble/granite'),
      lintel: one('tfc:wood/log/rosewood'),
      sill: one('tfc:wood/log/rosewood'),
      gable: one('tfc:wood/planks/white_cedar'),
      roof: one('tfc:rock/bricks/basalt'),
      floor: one('tfc:wood/planks/maple'),
      glass: one('minecraft:glass_pane'),
      door: one('tfc:wood/door/maple'),
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
  /** Форма объёмов (силос — круглый) */
  shape?: Volume['shape'];
  /** Своя отделка типа поверх стиля (котельная — высокая труба 2×2) */
  details?: Partial<DetailSpec>;
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
  sawtoothHall: {
    name: 'Цех с шедовой крышей',
    w: 25,
    d: 17,
    floors: 1,
    floorH: 8,
    openings: { windowW: 2, windowH: 3, windowEvery: 4, sillH: 2, door: { side: 'south', w: 5, h: 5 } },
    chimney: false,
    roof: { kind: 'sawtooth', pitch: 1, overhang: 0, tooth: 5 },
  },
  warehouse: {
    name: 'Склад',
    w: 23,
    d: 13,
    floors: 1,
    floorH: 9,
    // Ленточные окна под крышей: высоко над полом, узкие, частые
    openings: { windowW: 3, windowH: 1, windowEvery: 4, sillH: 6, door: { side: 'south', w: 5, h: 6 } },
    chimney: false,
    roof: { pitch: 0.5 },
  },
  boilerHouse: {
    name: 'Котельная',
    w: 11,
    d: 9,
    floors: 1,
    floorH: 9,
    openings: { windowW: 2, windowH: 5, windowEvery: 4, sillH: 1, door: { side: 'south', w: 2, h: 3 } },
    chimney: true,
    roof: { pitch: 0.5 },
    details: { chimneyH: 14, chimneySize: 2 },
  },
  silo: {
    name: 'Силос / башня',
    w: 9,
    d: 9,
    floors: 4,
    floorH: 5,
    openings: { windowW: 1, windowH: 1, windowEvery: 5, sillH: 2, door: { side: 'south', w: 2, h: 3 } },
    chimney: false,
    roof: { kind: 'cone', pitch: 1, overhang: 1 },
    shape: 'round',
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

type Rect = Pick<Volume, 'x' | 'z' | 'w' | 'd'> & {
  axis: RoofSpec['axis'];
  /** На сколько этажей ниже главного объёма (пристройка) */
  lower?: number;
  /** Высота основания и число этажей — у ярусов свои, не от типа */
  y?: number;
  floors?: number;
};

export const FORMS: Record<string, { name: string; rects(w: number, d: number, type: TypePreset): Rect[] }> = {
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
  annex: { name: 'С пристройкой', rects: annex },
  court: { name: 'Двор', rects: court },
  bay: {
    name: 'С эркером',
    rects: (w, d, type) => {
      // Эркер: выступ посередине южного фасада со своей крышей; у многоэтажного — на этаж ниже главного
      const bw = Math.max(3, Math.min(5, Math.round(w / 3) | 1));
      return [
        { x: 0, z: 0, w, d, axis: 'auto' },
        { x: Math.floor((w - bw) / 2), z: d - 1, w: bw, d: 4, axis: 'x', lower: type.floors > 1 ? 1 : 0 },
      ];
    },
  },
  tiers: {
    name: 'Ярусы',
    rects: (w, d, type) => {
      // Объёмы друг на друге: каждый следующий уже на 2 клетки с каждой стороны и на этаж ниже, всего до трёх
      const out: Rect[] = [{ x: 0, z: 0, w, d, axis: 'auto' }];
      let cw = w;
      let cd = d;
      let f = type.floors;
      let top = f * type.floorH;
      while (Math.min(cw, cd) > 9 && out.length < 3) {
        cw -= 4;
        cd -= 4;
        f = Math.max(1, f - 1);
        out.push({ x: (w - cw) / 2, z: (d - cd) / 2, w: cw, d: cd, axis: 'auto', y: top, floors: f });
        top += f * type.floorH;
      }
      return out;
    },
  },
};

/** Ширина крыла — нечётная (конёк по середине), не уже 5 */
const wing = (w: number, d: number) => Math.max(5, Math.round(Math.min(w, d) / 2) | 1);

/** Пристройка: низкое крыло вдоль южного фасада, стена общая с главным объёмом */
function annex(w: number, d: number): Rect[] {
  const k = Math.max(5, Math.round(d * 0.45) | 1);
  const aw = Math.max(7, Math.round(w * 0.6));
  return [
    { x: 0, z: 0, w, d, axis: 'auto' },
    { x: Math.floor((w - aw) / 2), z: d - 1, w: aw, d: k, axis: 'x', lower: 1 },
  ];
}

/** Двор: замкнутое кольцо из четырёх крыльев */
function court(w: number, d: number): Rect[] {
  // Крыло — четверть короткой стороны: внутри остаётся двор хотя бы 3×3
  const k = Math.max(5, Math.min(Math.round(Math.min(w, d) / 4) | 1, Math.floor((Math.min(w, d) - 3) / 2)));
  return [
    { x: 0, z: 0, w, d: k, axis: 'x' },
    { x: 0, z: d - k, w, d: k, axis: 'x' },
    { x: 0, z: 0, w: k, d, axis: 'z' },
    { x: w - k, z: 0, w: k, d, axis: 'z' },
  ];
}

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
  const grow = form === 'rect' || form === 'annex' || form === 'bay' ? 1 : 1.5;
  const w = opts.w ?? Math.round(type.w * grow);
  const d = opts.d ?? Math.round(type.d * grow);
  const roof = { ...style.roof, ...type.roof };
  return {
    v: 1,
    seed: opts.seed ?? 1,
    form,
    style: styleId,
    type: typeId,
    volumes: FORMS[form].rects(w, d, type).map((r, i) => ({
      id: String.fromCharCode(65 + i),
      x: r.x,
      z: r.z,
      w: r.w,
      d: r.d,
      y: r.y ?? 0,
      floors: r.floors ?? Math.max(1, type.floors - (r.lower ?? 0)),
      floorH: type.floorH,
      roof: { ...roof, axis: r.axis },
      ...(type.shape ? { shape: type.shape } : {}),
    })),
    openings: structuredClone(type.openings),
    details: { ...style.details, chimney: type.chimney, clearInside: true, ...type.details },
    texture: { degree: opts.degree ?? 0 },
    palette: opts.palette && PALETTES[opts.palette] ? opts.palette : '',
    roles:
      opts.palette && PALETTES[opts.palette]
        ? applyPalette(structuredClone(style.roles), PALETTES[opts.palette])
        : structuredClone(style.roles),
    overrides: [],
  };
}
