/**
 * Инструменты для моделей сущностей Minecraft (LayerDefinition: texOffs/addBox, PartPose) — их рисуют рендереры
 * предметов builtin/entity (сундуки, головы, щит…). Сами модели и правила предметов — в группах scripts/mcp/models/*.mjs
 * (minecraft.mjs, tfc.mjs, create_submarine.mjs …), здесь — матрицы позы, куб ModelPart и грани для renderModel:
 *   renderPart(pose, part, { id, w, h }, out, { tint, overlay }) — грани в пикселях блока 0–16 с uv 0–16.
 */

// ---------------------------------------------------------------- матрицы (аффинные 3×4, как PoseStack)

export const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
export function mul(a, b) {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return o;
}
export const T = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
export const S = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0];
export function R(axis, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (axis === 'x') return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0];
  if (axis === 'y') return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0];
}
export const apply = (m, [x, y, z]) => [
  m[0] * x + m[1] * y + m[2] * z + m[3],
  m[4] * x + m[5] * y + m[6] * z + m[7],
  m[8] * x + m[9] * y + m[10] * z + m[11],
];
export const applyDir = (m, [x, y, z]) => [
  m[0] * x + m[1] * y + m[2] * z,
  m[4] * x + m[5] * y + m[6] * z,
  m[8] * x + m[9] * y + m[10] * z,
];
export const DEG = Math.PI / 180;

/** Стек поз: методы умножают справа, как PoseStack (translate, scale, mulPose) */
export class Pose {
  constructor(m = ident()) {
    this.m = m;
  }
  t(x, y, z) {
    this.m = mul(this.m, T(x, y, z));
    return this;
  }
  s(x, y, z) {
    this.m = mul(this.m, S(x, y, z));
    return this;
  }
  r(axis, rad) {
    this.m = mul(this.m, R(axis, rad));
    return this;
  }
  copy() {
    return new Pose([...this.m]);
  }
}

// ---------------------------------------------------------------- ModelPart

/**
 * Куб ModelPart.Cube: texOffs (u, v), addBox(x, y, z, w, h, d), рост g (CubeDeformation), только грани faces.
 * Вершины и uv граней — как в конструкторе Cube (Polygon: [0] → (u2, v1), [1] → (u1, v1), [2] → (u1, v2)).
 * mirror (CubeListBuilder.mirror) — x0 и x1 меняются местами, uv остаются у тех же вершин, нормаль по x — наоборот.
 */
export const box = (u, v, x, y, z, w, h, d, g = 0, faces = null, mirror = false) => ({
  u,
  v,
  x,
  y,
  z,
  w,
  h,
  d,
  g,
  faces,
  mirror,
});
/** Часть: pose { x, y, z (пиксели), xr, yr, zr (радианы) }, кубы и дочерние части */
export const part = (cubes, pose = {}, children = []) => ({ cubes, pose, children });

function cubeQuads(c) {
  let x0 = c.x - c.g;
  const y0 = c.y - c.g;
  const z0 = c.z - c.g;
  let x1 = c.x + c.w + c.g;
  if (c.mirror) [x0, x1] = [x1, x0];
  const y1 = c.y + c.h + c.g;
  const z1 = c.z + c.d + c.g;
  const V7 = [x0, y0, z0];
  const V0 = [x1, y0, z0];
  const V1 = [x1, y1, z0];
  const V2 = [x0, y1, z0];
  const V3 = [x0, y0, z1];
  const V4 = [x1, y0, z1];
  const V5 = [x1, y1, z1];
  const V6 = [x0, y1, z1];
  const { u, v, w, h, d } = c;
  const f4 = u;
  const f5 = u + d;
  const f6 = u + d + w;
  const f7 = u + d + w + w;
  const f8 = u + d + w + d;
  const f9 = u + d + w + d + w;
  const f10 = v;
  const f11 = v + d;
  const f12 = v + d + h;
  const all = {
    down: [
      [V4, V3, V7, V0],
      [f5, f10, f6, f11],
      [0, -1, 0],
    ],
    up: [
      [V1, V2, V6, V5],
      [f6, f11, f7, f10],
      [0, 1, 0],
    ],
    west: [
      [V7, V3, V6, V2],
      [f4, f11, f5, f12],
      [-1, 0, 0],
    ],
    north: [
      [V0, V7, V2, V1],
      [f5, f11, f6, f12],
      [0, 0, -1],
    ],
    east: [
      [V4, V0, V1, V5],
      [f6, f11, f8, f12],
      [1, 0, 0],
    ],
    south: [
      [V3, V4, V5, V6],
      [f8, f11, f9, f12],
      [0, 0, 1],
    ],
  };
  return Object.entries(all)
    .filter(([name]) => !c.faces || c.faces.includes(name))
    .map(([, [vs, uv, n]]) => [vs, uv, c.mirror ? [-n[0], n[1], n[2]] : n]);
}

/**
 * Грани части в координатах предмета (пиксели блока 0–16): ModelPart.render — translate(x/16…), rotationZYX, кубы /16.
 * tex: { id, w, h (размер развёртки LayerDefinition) }, tint, overlay — наложение поверх (узор знамени).
 */
export function renderPart(pose, p, tex, out, opts = {}) {
  const q = p.pose ?? {};
  const ps = pose.copy().t((q.x ?? 0) / 16, (q.y ?? 0) / 16, (q.z ?? 0) / 16);
  if (q.zr) ps.r('z', q.zr);
  if (q.yr) ps.r('y', q.yr);
  if (q.xr) ps.r('x', q.xr);
  for (const c of p.cubes)
    for (const [vs, [u1, v1, u2, v2], dir] of cubeQuads(c)) {
      const P = vs.map((x) =>
        apply(
          ps.m,
          x.map((k) => k / 16),
        ).map((k) => k * 16),
      );
      out.push({
        P: [P[1], P[0], P[2]], // начало uv (u1, v1), конец по u, конец по v
        uv: [(u1 * 16) / tex.w, (v1 * 16) / tex.h, (u2 * 16) / tex.w, (v2 * 16) / tex.h],
        N: applyDir(ps.m, dir),
        tex: tex.id,
        tint: opts.tint ?? null,
        overlay: Boolean(opts.overlay),
      });
    }
  for (const ch of p.children ?? []) renderPart(ps, ch, tex, out, opts);
}
