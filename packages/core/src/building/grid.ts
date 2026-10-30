/**
 * Сетка постройки: у каждой клетки роль (стена, угол, скат крыши…), форма блока (целый, ступени, плита…) и
 * ориентация. Генератор сначала раскладывает роли, потом заполнение превращает их в блоки сборки (fill.ts).
 */

/** Роли клеток. Порядок не менять: номер роли хранится в сетке */
export const ROLES = [
  'empty', // ничего не ставим — в мире остаётся, что было
  'interior', // воздух внутри здания
  'foundation',
  'floor',
  'ceiling',
  'wall',
  'corner',
  'plinth',
  'belt',
  'lintel',
  'sill',
  'jamb',
  'gable',
  'parapet',
  'frame',
  'infill',
  'chimney',
  'roof',
  'eave',
  'ridge',
  'verge',
  'glass',
  'door',
] as const;
export type Role = (typeof ROLES)[number];
export const ROLE: Record<Role, number> = Object.fromEntries(ROLES.map((r, i) => [r, i])) as Record<Role, number>;

/**
 * От кого роль берёт блоки, если её выключили или блоков не выбрали: угол → стена, свес → крыша.
 * Базовые роли (без родителя) — стена, крыша, пол, фундамент, стекло, дверь.
 */
export const ROLE_PARENT: Partial<Record<Role, Role>> = {
  corner: 'wall',
  plinth: 'wall',
  belt: 'wall',
  lintel: 'wall',
  sill: 'wall',
  jamb: 'wall',
  gable: 'wall',
  parapet: 'wall',
  frame: 'wall',
  infill: 'wall',
  chimney: 'wall',
  ceiling: 'floor',
  eave: 'roof',
  ridge: 'roof',
  verge: 'roof',
};

/** Формы блока. air — воздух (проём, интерьер) */
export const SHAPES = ['none', 'full', 'stairs', 'slab', 'pane', 'door', 'air'] as const;
export type Shape = (typeof SHAPES)[number];
export const SHAPE: Record<Shape, number> = Object.fromEntries(SHAPES.map((s, i) => [s, i])) as Record<Shape, number>;

/** Стороны света в порядке поворота по часовой: 0 север (−z), 1 восток (+x), 2 юг (+z), 3 запад (−x) */
export const DIRS = ['north', 'east', 'south', 'west'] as const;
export const DX = [0, 1, 0, -1];
export const DZ = [-1, 0, 1, 0];
export const AXES = ['y', 'x', 'z'] as const;

/**
 * Ориентация в одном байте: биты 0–1 — сторона (facing ступеней, двери, направление подъёма ската),
 * бит 2 — верхняя половина (ступени/плита вверх ногами, верх двери), биты 3–4 — ось (бревно: 0 y, 1 x, 2 z),
 * бит 5 — петли справа (дверь).
 */
export const orient = (facing = 0, top = false, axis = 0, hingeRight = false) =>
  (facing & 3) | (top ? 4 : 0) | ((axis & 3) << 3) | (hingeRight ? 32 : 0);
export const facingOf = (o: number) => o & 3;
export const isTop = (o: number) => (o & 4) !== 0;
export const axisOf = (o: number) => (o >> 3) & 3;
export const hingeRightOf = (o: number) => (o & 32) !== 0;

export class Grid {
  readonly role: Uint8Array;
  readonly shape: Uint8Array;
  readonly orient: Uint8Array;
  /** Внутри общего контура здания на этой высоте (со стенами) — для стен, углов и проёмов */
  readonly inside: Uint8Array;
  /** Над клеткой плана есть крыша (план X×Z) */
  readonly roofed: Uint8Array;
  /** Номер объёма + 1 у клетки (0 — ничей) */
  readonly volume: Uint8Array;

  readonly X: number;
  readonly Y: number;
  readonly Z: number;

  constructor(X: number, Y: number, Z: number) {
    this.X = X;
    this.Y = Y;
    this.Z = Z;
    const n = X * Y * Z;
    this.role = new Uint8Array(n);
    this.shape = new Uint8Array(n);
    this.orient = new Uint8Array(n);
    this.inside = new Uint8Array(n);
    this.volume = new Uint8Array(n);
    this.roofed = new Uint8Array(X * Z);
  }

  in(x: number, y: number, z: number) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.X && y < this.Y && z < this.Z;
  }
  idx(x: number, y: number, z: number) {
    return x + this.X * (z + this.Z * y);
  }
  roleAt(x: number, y: number, z: number) {
    return this.in(x, y, z) ? this.role[this.idx(x, y, z)] : 0;
  }
  shapeAt(x: number, y: number, z: number) {
    return this.in(x, y, z) ? this.shape[this.idx(x, y, z)] : 0;
  }
  insideAt(x: number, y: number, z: number) {
    return this.in(x, y, z) ? this.inside[this.idx(x, y, z)] === 1 : false;
  }
  set(x: number, y: number, z: number, role: Role, shape: Shape = 'full', o = 0) {
    if (!this.in(x, y, z)) return;
    const i = this.idx(x, y, z);
    this.role[i] = ROLE[role];
    this.shape[i] = SHAPE[shape];
    this.orient[i] = o;
  }
  /** Поставить, только если клетка пуста (или в ней воздух интерьера) */
  fill(x: number, y: number, z: number, role: Role, shape: Shape = 'full', o = 0) {
    const r = this.roleAt(x, y, z);
    if (r === ROLE.empty || r === ROLE.interior) this.set(x, y, z, role, shape, o);
  }
  /** Сменить только роль, форму и ориентацию оставить */
  relabel(x: number, y: number, z: number, role: Role) {
    if (this.in(x, y, z)) this.role[this.idx(x, y, z)] = ROLE[role];
  }
}

/** Число клеток каждой роли — для проверок и подписей в интерфейсе */
export function roleCounts(g: Grid): Map<Role, number> {
  const out = new Map<Role, number>();
  for (const r of g.role) if (r) out.set(ROLES[r], (out.get(ROLES[r]) ?? 0) + 1);
  return out;
}
