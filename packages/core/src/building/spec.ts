/**
 * Параметры постройки (BuildingSpec) — один формат для страницы генератора, библиотеки схем, MCP и режима «по фото».
 * Здесь полные параметры: стиль и тип здания уже развёрнуты в значения (makeSpec), поэтому сохранённая схема не
 * меняется, если потом поправят стиль.
 */
import type { Role } from './grid.ts';

export type RoofKind = 'gable' | 'hip' | 'shed' | 'flat';
/** Уклон: 1 — 45° (ступени), 0.5 — пологий (плита и целый блок через ряд) */
export type Pitch = 1 | 0.5;
/** Вдоль какой оси конёк (у односкатной — вдоль высокой стороны); auto — вдоль длинной стороны */
export type RidgeAxis = 'x' | 'z' | 'auto';

export interface RoofSpec {
  kind: RoofKind;
  pitch: Pitch;
  /** Свес за стены, 0–2 блока */
  overhang: number;
  axis: RidgeAxis;
}

/** Объём — прямоугольник в плане; здание сложной формы = несколько объёмов */
export interface Volume {
  id: string;
  /** Угол объёма (минимальные x и z), размеры вместе со стенами */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Высота основания (фундамента) */
  y: number;
  floors: number;
  /** Высота этажа: пол + воздух */
  floorH: number;
  roof: RoofSpec;
}

export type Side = 'north' | 'east' | 'south' | 'west';

export interface OpeningsSpec {
  /** Окна: ширина, высота, расстояние между центрами, высота подоконника над полом */
  windowW: number;
  windowH: number;
  windowEvery: number;
  sillH: number;
  /** Вход: сторона главного (первого) объёма, ширина и высота проёма */
  door: { side: Side; w: number; h: number };
}

export type FillPattern = 'patches' | 'mix' | 'rows';

export interface RoleFill {
  /** Выбранные блоки, первый — основной; w — вес вручную (нет — по степени текстурирования) */
  blocks: { id: string; w?: number }[];
  pattern?: FillPattern;
  /** Своя степень текстурирования для роли */
  degree?: number;
}

export interface RoleSpec {
  /** false — роль выключена, клетки берут блоки родителя */
  on?: boolean;
  fill?: RoleFill;
}

/** Отделка, которую задаёт стиль */
export interface DetailSpec {
  /** Рядов цоколя (0 — нет) */
  plinthH: number;
  /** Русты: угол заходит на соседнюю клетку через ряд то на один фасад, то на другой */
  quoins: boolean;
  /** Перемычка и подоконник шире проёма на клетку с каждой стороны */
  openingExt: boolean;
  /** Фахверк: стойки каркаса через столько клеток (0 — без каркаса) */
  frameEvery: number;
  /** Простенки: сплошные столбы стены между колоннами окон берут роль каркаса (индустриальный кирпич) */
  piers?: boolean;
  /** Труба */
  chimney: boolean;
  /** Воздух внутри (очистить место под постройку) */
  clearInside: boolean;
}

export interface Override {
  pos: [number, number, number];
  role?: Role;
  block?: string;
}

export interface BuildingSpec {
  v: 1;
  seed: number;
  /** Подписи пресетов — для интерфейса; генератор их не читает */
  form: string;
  style: string;
  type: string;
  /** Палитра материалов (подпись; пусто — блоки стиля или выбранные вручную) */
  palette?: string;
  volumes: Volume[];
  openings: OpeningsSpec;
  details: DetailSpec;
  /** Степень текстурирования 0–4: насколько смешан материал внутри роли */
  texture: { degree: number };
  roles: Partial<Record<Role, RoleSpec>>;
  overrides: Override[];
}

export const MAX_SIDE = 96;
export const MAX_HEIGHT = 96;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, Math.round(Number(v) || 0)));

/** Проверка и приведение к допустимым значениям; ошибки — по-русски, для интерфейса и MCP */
export function checkSpec(spec: BuildingSpec): string[] {
  const errors: string[] = [];
  if (!spec.volumes?.length) errors.push('нет ни одного объёма');
  for (const v of spec.volumes ?? []) {
    if (v.w < 3 || v.d < 3) errors.push(`объём ${v.id}: меньше 3×3`);
    if (v.w > MAX_SIDE || v.d > MAX_SIDE) errors.push(`объём ${v.id}: больше ${MAX_SIDE} блоков`);
    if (v.floors < 1 || v.floors > 12) errors.push(`объём ${v.id}: этажей должно быть 1–12`);
    if (v.floorH < 3 || v.floorH > 12) errors.push(`объём ${v.id}: высота этажа 3–12`);
    if (v.y + v.floors * v.floorH > MAX_HEIGHT) errors.push(`объём ${v.id}: выше ${MAX_HEIGHT} блоков`);
  }
  if (spec.texture.degree < 0 || spec.texture.degree > 4) errors.push('степень текстурирования — от 0 до 4');
  return errors;
}

/** Привести числа к целым и рамкам (поля из формы и из ответа Gemini приходят какими угодно) */
export function normalizeSpec(spec: BuildingSpec): BuildingSpec {
  return {
    ...spec,
    seed: clamp(spec.seed, 0, 2 ** 31 - 1),
    volumes: spec.volumes.map((v) => ({
      ...v,
      x: clamp(v.x, -MAX_SIDE, MAX_SIDE),
      z: clamp(v.z, -MAX_SIDE, MAX_SIDE),
      y: clamp(v.y, 0, MAX_HEIGHT),
      w: clamp(v.w, 3, MAX_SIDE),
      d: clamp(v.d, 3, MAX_SIDE),
      floors: clamp(v.floors, 1, 12),
      floorH: clamp(v.floorH, 3, 12),
      roof: { ...v.roof, overhang: clamp(v.roof.overhang, 0, 2) },
    })),
    openings: {
      ...spec.openings,
      windowW: clamp(spec.openings.windowW, 0, 8),
      windowH: clamp(spec.openings.windowH, 1, 10),
      windowEvery: clamp(spec.openings.windowEvery, 2, 16),
      sillH: clamp(spec.openings.sillH, 0, 6),
      door: {
        ...spec.openings.door,
        w: clamp(spec.openings.door.w, 0, 8),
        h: clamp(spec.openings.door.h, 2, 10),
      },
    },
    details: {
      ...spec.details,
      plinthH: clamp(spec.details.plinthH, 0, 4),
      frameEvery: clamp(spec.details.frameEvery, 0, 12),
    },
    texture: { degree: clamp(spec.texture.degree, 0, 4) },
  };
}
