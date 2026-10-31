/**
 * Заполнение: роль клетки → блок сборки с состоянием. Блоки роли выбирает человек (первый — основной), степень
 * текстурирования решает, сколько из них смешивать и как: доли блоков точные (раздаются по рангу значения шума),
 * а шум делает пятна связными. Всё детерминировано по seed.
 *
 * | степень | блоков в смеси | доля основного | пятна            | градиент по высоте |
 * | 0       | 1              | 100%           | —                | нет                |
 * | 1       | 2              | 85%            | крупные (≈6)     | нет                |
 * | 2       | 3              | 70%            | средние (≈4)     | слабый             |
 * | 3       | 4              | 55%            | мелкие (≈2,5)    | да                 |
 * | 4       | все выбранные  | 40%            | разного размера  | да                 |
 */
import {
  AXES,
  DIRS,
  DX,
  DZ,
  ROLE,
  ROLES,
  ROLE_PARENT,
  SHAPE,
  axisOf,
  facingOf,
  hingeRightOf,
  isTop,
  type Grid,
  type Role,
} from './grid.ts';
import { hasAxis, isDoor, isPane, shapeOf, type FamilyShape, type Has } from './families.ts';
import type { Layout } from './massing.ts';
import type { BuildingSpec, FillPattern, RoleFill } from './spec.ts';

export interface BlockState {
  Name: string;
  Properties?: Record<string, string>;
}

export interface Painted {
  X: number;
  Y: number;
  Z: number;
  /** Номер в палитре + 1 у каждой клетки; 0 — блок не ставится */
  cells: Uint32Array;
  palette: BlockState[];
  /** Материал копиката у клетки (форма c*): палитра держит блок-копикат, а это — блок роли для nbt */
  mats: (string | null)[];
}

export const DEGREE = [
  { n: 1, main: 1, scale: 0, gradient: 0 },
  { n: 2, main: 0.85, scale: 6, gradient: 0 },
  { n: 3, main: 0.7, scale: 4, gradient: 0.15 },
  { n: 4, main: 0.55, scale: 2.5, gradient: 0.3 },
  { n: Infinity, main: 0.4, scale: -1, gradient: 0.3 },
] as const;

// ---------------------------------------------------------------- шум

function hash(seed: number, x: number, y: number, z: number) {
  let h = seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x61c88647);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Шум значений: случайные числа в узлах решётки с шагом scale, между ними — плавно */
export function valueNoise(seed: number, x: number, y: number, z: number, scale: number) {
  const fx = x / scale;
  const fy = y / scale;
  const fz = z / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const tz = smooth(fz - z0);
  const h = (dx: number, dy: number, dz: number) => hash(seed, x0 + dx, y0 + dy, z0 + dz);
  return lerp(
    lerp(lerp(h(0, 0, 0), h(1, 0, 0), tx), lerp(h(0, 1, 0), h(1, 1, 0), tx), ty),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), tx), lerp(h(0, 1, 1), h(1, 1, 1), tx), ty),
    tz,
  );
}

// ---------------------------------------------------------------- роль → блоки

interface Source {
  role: Role;
  fill: RoleFill;
}

/** Чьи блоки берёт роль: своя, если включена и выбраны блоки, иначе — родителя */
export function sourceOf(spec: BuildingSpec, role: Role): Source | null {
  for (let r: Role | undefined = role; r; r = ROLE_PARENT[r]) {
    const rs = spec.roles[r];
    if (rs && rs.on !== false && rs.fill?.blocks.length) return { role: r, fill: rs.fill };
  }
  return null;
}

/** Доли блоков смеси по степени; веса, заданные вручную, главнее */
export function mixWeights(fill: RoleFill, degree: number): number[] {
  const d = DEGREE[Math.max(0, Math.min(4, degree))];
  const n = Math.min(fill.blocks.length, d.n);
  const chosen = fill.blocks.slice(0, n);
  if (chosen.some((b) => b.w !== undefined && b.w > 0)) {
    const w = chosen.map((b) => Math.max(0, b.w ?? 1));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((v) => v / sum);
  }
  if (n === 1) return [1];
  const rest = Array.from({ length: n - 1 }, (_, i) => 0.6 ** i);
  const sum = rest.reduce((a, b) => a + b, 0);
  return [d.main, ...rest.map((v) => ((1 - d.main) * v) / sum)];
}

const FAMILY_OF_SHAPE: Partial<Record<number, FamilyShape>> = {
  [SHAPE.full]: 'full',
  [SHAPE.stairs]: 'stairs',
  [SHAPE.slab]: 'slab',
};

interface Group {
  ids: string[];
  weights: number[];
  pattern: FillPattern;
  degree: number;
  salt: number;
  cells: number[];
  values: number[];
}

export function paint({ grid: g, ox, oz }: Layout, spec: BuildingSpec, has: Has): Painted {
  const n = g.X * g.Y * g.Z;
  const block: (string | null)[] = new Array(n).fill(null);
  const final = new Uint8Array(n); // итоговая форма: ступени без своих ступеней становятся целым блоком
  const groups = new Map<string, Group>();
  const clearInside = spec.details.clearInside;

  for (let i = 0; i < n; i++) {
    const r = g.role[i];
    if (!r) continue;
    const role = ROLES[r];
    const shape = g.shape[i];
    if (shape === SHAPE.air || r === ROLE.interior) {
      if (r !== ROLE.interior || clearInside) {
        block[i] = 'minecraft:air';
        final[i] = SHAPE.air;
      }
      continue;
    }
    const src = sourceOf(spec, role);
    if (!src) continue;
    const degree = src.fill.degree ?? spec.texture.degree;
    const weights = mixWeights(src.fill, degree);
    let ids = src.fill.blocks.slice(0, weights.length).map((b) => b.id);
    let w = weights;
    // Плавные скаты: ступени и плиты крыши становятся копикатами — материал целый, семейство не нужно
    const smooth =
      spec.details.trim?.slopes && (r === ROLE.roof || r === ROLE.eave || r === ROLE.verge)
        ? shape === SHAPE.stairs
          ? SHAPE.cslope
          : shape === SHAPE.slab
            ? SHAPE.cslopelayer
            : 0
        : 0;
    let fs = smooth || shape;
    const fam = smooth ? undefined : FAMILY_OF_SHAPE[shape];
    if (fam && fam !== 'full') {
      // Только блоки, у которых есть такая форма; нет ни одного — у родителя; нет и там — целый блок
      const pick = (list: string[], ws: number[]) => {
        const keep = list.map((id, k) => [shapeOf(id, fam, has), ws[k]] as const).filter(([v]) => v);
        return keep.length ? { ids: keep.map(([v]) => v!), w: keep.map(([, v]) => v) } : null;
      };
      let got = pick(ids, w);
      const parent = ROLE_PARENT[src.role];
      if (!got && parent) {
        const ps = sourceOf(spec, parent);
        if (ps)
          got = pick(
            ps.fill.blocks.map((b) => b.id),
            mixWeights(ps.fill, ps.fill.degree ?? spec.texture.degree),
          );
      }
      if (got) {
        ids = got.ids;
        w = got.w;
      } else fs = SHAPE.full;
    } else if (shape === SHAPE.pane) {
      if (!ids.some(isPane)) fs = SHAPE.full;
    } else if (shape === SHAPE.door) {
      if (!isDoor(ids[0])) {
        block[i] = 'minecraft:air';
        final[i] = SHAPE.air;
        continue;
      }
      ids = [ids[0]];
      w = [1];
    }
    final[i] = fs;
    const key = `${src.role}|${ids.join(',')}|${w.join(',')}`;
    let grp = groups.get(key);
    if (!grp) {
      const pattern = src.fill.pattern ?? 'patches';
      grp = { ids, weights: w, pattern, degree, salt: ROLE[src.role] * 7919, cells: [], values: [] };
      groups.set(key, grp);
    }
    grp.cells.push(i);
  }

  // Доли точные: клетки группы сортируются по значению шума и делятся по весам
  for (const grp of groups.values()) {
    const d = DEGREE[Math.max(0, Math.min(4, grp.degree))];
    const seed = (spec.seed + grp.salt) | 0;
    for (const i of grp.cells) {
      const x = i % g.X;
      const z = Math.floor(i / g.X) % g.Z;
      const y = Math.floor(i / (g.X * g.Z));
      let v: number;
      if (grp.pattern === 'mix' || grp.ids.length === 1) v = hash(seed, x, y, z);
      else if (grp.pattern === 'rows') v = (y % grp.ids.length) / grp.ids.length;
      else if (d.scale > 0) v = valueNoise(seed, x, y, z, d.scale);
      else v = 0.6 * valueNoise(seed, x, y, z, 4) + 0.4 * valueNoise(seed + 1, x, y, z, 1.5);
      // Градиент: внизу чаще второстепенные блоки (грязь, мох у земли)
      if (grp.pattern !== 'rows' && d.gradient) v = v * (1 - d.gradient) + d.gradient * (1 - y / Math.max(1, g.Y - 1));
      grp.values.push(v);
    }
    if (grp.pattern === 'rows') {
      grp.cells.forEach((i, k) => (block[i] = grp.ids[Math.round(grp.values[k] * grp.ids.length) % grp.ids.length]));
      continue;
    }
    const order = grp.cells.map((_, k) => k).sort((a, b) => grp.values[a] - grp.values[b]);
    let at = 0;
    grp.weights.forEach((wt, b) => {
      const end =
        b === grp.weights.length - 1 ? order.length : Math.min(order.length, at + Math.round(wt * order.length));
      for (; at < end; at++) block[grp.cells[order[at]]] = grp.ids[b];
    });
  }

  for (const ov of spec.overrides)
    if (ov.block) {
      const [x, y, z] = [ov.pos[0] + ox, ov.pos[1], ov.pos[2] + oz];
      if (!g.in(x, y, z)) continue;
      const i = g.idx(x, y, z);
      if (ov.block === 'minecraft:air') {
        block[i] = ov.block;
        final[i] = SHAPE.air;
        continue;
      }
      // Форма клетки сохраняется: на месте ступени — ступень выбранного материала; нет такой формы — целый блок
      const fam = FAMILY_OF_SHAPE[final[i]];
      const shaped = fam ? shapeOf(ov.block, fam, has) : null;
      block[i] = shaped ?? ov.block;
      if (
        !final[i] ||
        final[i] === SHAPE.air ||
        (fam && !shaped) ||
        (final[i] === SHAPE.pane && !isPane(ov.block)) ||
        (final[i] === SHAPE.door && !isDoor(ov.block))
      )
        final[i] = SHAPE.full;
    }

  // Состояния блоков
  const palette: BlockState[] = [];
  const keys = new Map<string, number>();
  const cells = new Uint32Array(n);
  const mats: (string | null)[] = new Array(n).fill(null);
  const finalAt = (x: number, y: number, z: number) => (g.in(x, y, z) ? final[g.idx(x, y, z)] : 0);
  const stairsAt = (x: number, y: number, z: number) => finalAt(x, y, z) === SHAPE.stairs;
  for (let i = 0; i < n; i++) {
    const id = block[i];
    if (!id) continue;
    const x = i % g.X;
    const z = Math.floor(i / g.X) % g.Z;
    const y = Math.floor(i / (g.X * g.Z));
    const o = g.orient[i];
    let props: Record<string, string> | undefined;
    const fs = final[i];
    // Копикаты: в палитру идёт блок-копикат с его состоянием, выбранный блок роли — материалом в nbt клетки
    let copycat: string | null = null;
    if (fs === SHAPE.cslope || fs === SHAPE.cslopelayer) {
      copycat = fs === SHAPE.cslope ? 'copycats:copycat_slope' : 'copycats:copycat_slope_layer';
      props = { facing: DIRS[facingOf(o)], half: isTop(o) ? 'top' : 'bottom' };
      if (fs === SHAPE.cslopelayer) props.layers = '2';
    } else if (fs === SHAPE.cbeam) {
      copycat = 'copycats:copycat_beam';
      props = { axis: AXES[axisOf(o)] };
    } else if (fs === SHAPE.cpanel) {
      copycat = 'create:copycat_panel';
      props = { facing: DIRS[facingOf(o)] };
    } else if (fs === SHAPE.cpane) {
      copycat = 'copycats:copycat_pane';
      props = {};
      for (let s = 0; s < 4; s++) {
        const f = finalAt(x + DX[s], y, z + DZ[s]);
        props[DIRS[s]] =
          f === SHAPE.full || f === SHAPE.pane || f === SHAPE.cpane || f === SHAPE.stairs ? 'true' : 'false';
      }
    }
    const name = copycat ?? id;
    if (copycat) mats[i] = id;
    if (!copycat && fs === SHAPE.stairs) {
      props = { facing: DIRS[facingOf(o)], half: isTop(o) ? 'top' : 'bottom', shape: stairShape(g, x, y, z, stairsAt) };
    } else if (!copycat && fs === SHAPE.slab) props = { type: isTop(o) ? 'top' : 'bottom' };
    else if (fs === SHAPE.door)
      props = {
        facing: DIRS[facingOf(o)],
        half: isTop(o) ? 'upper' : 'lower',
        hinge: hingeRightOf(o) ? 'right' : 'left',
        open: 'false',
      };
    else if (!copycat && (fs === SHAPE.pane || (fs === SHAPE.full && isPane(id)))) {
      props = {};
      for (let s = 0; s < 4; s++) {
        const f = finalAt(x + DX[s], y, z + DZ[s]);
        props[DIRS[s]] = f === SHAPE.full || f === SHAPE.pane || f === SHAPE.stairs ? 'true' : 'false';
      }
    } else if (!copycat && fs === SHAPE.full && hasAxis(id)) props = { axis: AXES[axisOf(o)] };
    const key = props
      ? `${name}|${Object.entries(props)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')}`
      : name;
    let p = keys.get(key);
    if (p === undefined) {
      p = palette.length;
      palette.push(props ? { Name: name, Properties: props } : { Name: name });
      keys.set(key, p);
    }
    cells[i] = p + 1;
  }
  return { X: g.X, Y: g.Y, Z: g.Z, cells, palette, mats };
}

/** Форма ступеней по соседям — как StairBlock.getStairsShape в 1.21.1 (проверено по исходникам NeoForge 21.1.251) */
function stairShape(g: Grid, x: number, y: number, z: number, stairsAt: (x: number, y: number, z: number) => boolean) {
  const me = g.orient[g.idx(x, y, z)];
  const f = facingOf(me);
  const same = (nx: number, nz: number) => stairsAt(nx, y, nz) && isTop(g.orient[g.idx(nx, y, nz)]) === isTop(me);
  const facingAt = (nx: number, nz: number) => facingOf(g.orient[g.idx(nx, y, nz)]);
  const ccw = (f + 3) % 4;
  const canTake = (dir: number) => {
    const nx = x + DX[dir];
    const nz = z + DZ[dir];
    return !same(nx, nz) || facingAt(nx, nz) !== f;
  };
  const fx = x + DX[f];
  const fz = z + DZ[f];
  if (same(fx, fz)) {
    const d1 = facingAt(fx, fz);
    if (d1 % 2 !== f % 2 && canTake((d1 + 2) % 4)) return d1 === ccw ? 'outer_left' : 'outer_right';
  }
  const bx = x - DX[f];
  const bz = z - DZ[f];
  if (same(bx, bz)) {
    const d2 = facingAt(bx, bz);
    if (d2 % 2 !== f % 2 && canTake(d2)) return d2 === ccw ? 'inner_left' : 'inner_right';
  }
  return 'straight';
}
