/**
 * Предметы, которые игра рисует кодом (модель предмета — builtin/entity): сундуки, кровати, шалкеры, знамёна,
 * головы, щит, проводник, расписная ваза. Геометрия — модели сущностей Minecraft (LayerDefinition: texOffs/addBox,
 * PartPose) и преобразования их рендереров для предмета без мира (BlockEntityWithoutLevelRenderer), перенесённые
 * из исходников Minecraft 1.21.1 / NeoForge 21.1 (net.minecraft.client.renderer.blockentity.*Renderer,
 * net.minecraft.client.model.*Model) и TFC 4.2.9 (сундуки из дерева TFC: TFCChestBlockEntityRenderer).
 * Вид — как в JEI и творческом: сундук закрыт, кровать на юг, знамя без узоров, голова без профиля игрока.
 *
 * entityItemModel(layers, id, own) → модель для renderModel (поле quads — грани в пикселях блока 0–16 с uv,
 * текстурой, окраской и наложением) или null — такой предмет генератор не знает (остаётся текстура).
 */
import { blockstatePath, findResource, loadModel, pickVariant, readJsonRes, texturePath } from './resources.mjs';
import { dyeColors } from './fluids.mjs';

// ---------------------------------------------------------------- матрицы (аффинные 3×4, как PoseStack)

const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function mul(a, b) {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return o;
}
const T = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
const S = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0];
function R(axis, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (axis === 'x') return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0];
  if (axis === 'y') return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0];
}
const apply = (m, [x, y, z]) => [
  m[0] * x + m[1] * y + m[2] * z + m[3],
  m[4] * x + m[5] * y + m[6] * z + m[7],
  m[8] * x + m[9] * y + m[10] * z + m[11],
];
const applyDir = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z, m[4] * x + m[5] * y + m[6] * z, m[8] * x + m[9] * y + m[10] * z];
const DEG = Math.PI / 180;

/** Стек поз: методы умножают справа, как PoseStack (translate, scale, mulPose) */
class Pose {
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
 */
const box = (u, v, x, y, z, w, h, d, g = 0, faces = null) => ({ u, v, x, y, z, w, h, d, g, faces });
/** Часть: pose { x, y, z (пиксели), xr, yr, zr (радианы) }, кубы и дочерние части */
const part = (cubes, pose = {}, children = []) => ({ cubes, pose, children });

function cubeQuads(c) {
  const x0 = c.x - c.g;
  const y0 = c.y - c.g;
  const z0 = c.z - c.g;
  const x1 = c.x + c.w + c.g;
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
    down: [[V4, V3, V7, V0], [f5, f10, f6, f11], [0, -1, 0]],
    up: [[V1, V2, V6, V5], [f6, f11, f7, f10], [0, 1, 0]],
    west: [[V7, V3, V6, V2], [f4, f11, f5, f12], [-1, 0, 0]],
    north: [[V0, V7, V2, V1], [f5, f11, f6, f12], [0, 0, -1]],
    east: [[V4, V0, V1, V5], [f6, f11, f8, f12], [1, 0, 0]],
    south: [[V3, V4, V5, V6], [f8, f11, f9, f12], [0, 0, 1]],
  };
  return Object.entries(all)
    .filter(([name]) => !c.faces || c.faces.includes(name))
    .map(([, q]) => q);
}

/**
 * Грани части в координатах предмета (пиксели блока 0–16): ModelPart.render — translate(x/16…), rotationZYX, кубы /16.
 * tex: { id, w, h (размер развёртки LayerDefinition) }, tint, overlay — наложение поверх (узор знамени).
 */
function renderPart(pose, p, tex, out, opts = {}) {
  const q = p.pose ?? {};
  const ps = pose.copy().t((q.x ?? 0) / 16, (q.y ?? 0) / 16, (q.z ?? 0) / 16);
  if (q.zr) ps.r('z', q.zr);
  if (q.yr) ps.r('y', q.yr);
  if (q.xr) ps.r('x', q.xr);
  for (const c of p.cubes)
    for (const [vs, [u1, v1, u2, v2], dir] of cubeQuads(c)) {
      const P = vs.map((x) => apply(ps.m, x.map((k) => k / 16)).map((k) => k * 16));
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

// ---------------------------------------------------------------- модели сущностей (LayerDefinition Minecraft)

// ChestRenderer.createSingleBodyLayer, 64×64
const CHEST = [
  part([box(0, 19, 1, 0, 1, 14, 10, 14)]),
  part([box(0, 0, 1, 0, 0, 14, 5, 14)], { x: 0, y: 9, z: 1 }),
  part([box(0, 0, 7, -2, 14, 2, 4, 1)], { x: 0, y: 9, z: 1 }),
];
// BedRenderer.createHeadLayer / createFootLayer, 64×64
const BED_HEAD = part(
  [],
  {},
  [
    part([box(0, 0, 0, 0, 0, 16, 16, 6)]),
    part([box(50, 6, 0, 6, 0, 3, 3, 3)], { xr: Math.PI / 2, zr: Math.PI / 2 }),
    part([box(50, 18, -16, 6, 0, 3, 3, 3)], { xr: Math.PI / 2, zr: Math.PI }),
  ],
);
const BED_FOOT = part(
  [],
  {},
  [
    part([box(0, 22, 0, 0, 0, 16, 16, 6)]),
    part([box(50, 0, 0, 6, -16, 3, 3, 3)], { xr: Math.PI / 2 }),
    part([box(50, 12, -16, 6, -16, 3, 3, 3)], { xr: Math.PI / 2, zr: (Math.PI * 3) / 2 }),
  ],
);
// ShulkerModel.createBodyLayer (base, lid), 64×64
const SHULKER = [
  part([box(0, 28, -8, -8, -8, 16, 8, 16)], { y: 24 }),
  part([box(0, 0, -8, -16, -8, 16, 12, 16)], { y: 24 }),
];
// BannerRenderer.createBodyLayer, 64×64; флаг — xRot = (−0.0125 + 0.01·cos 0)·π, y = −32
const BANNER_POLE = [part([box(44, 0, -1, -30, -1, 2, 42, 2)]), part([box(0, 42, -10, -32, -1, 20, 2, 2)])];
const BANNER_FLAG = part([box(0, 0, -10, 0, -2, 20, 40, 1)], { y: -32, xr: -0.0025 * Math.PI });
// SkullModel: голова (+ шапка 0.25 у голов людей), setupAnim(0, 180, 0) — yRot 180°
const skull = (hat) =>
  part([box(0, 0, -4, -8, -4, 8, 8, 8)], { yr: Math.PI }, hat ? [part([box(32, 0, -4, -8, -4, 8, 8, 8, 0.25)])] : []);
// ShieldModel.createLayer, 64×64
const SHIELD = [part([box(0, 0, -6, -11, -2, 12, 22, 1)]), part([box(26, 0, -1, -3, -1, 2, 6, 6)])];
// ConduitRenderer.createShellLayer, 32×16
const CONDUIT = [part([box(0, 0, -3, -3, -3, 6, 6, 6)])];
// DecoratedPotRenderer.createBaseLayer (32×32) и createSidesLayer (16×16, только грань north)
const POT_BASE = [
  part([box(0, 0, 4, 17, 4, 8, 3, 8, -0.1), box(0, 5, 5, 20, 5, 6, 1, 6, 0.2)], { y: 37, z: 16, xr: Math.PI }),
  part([box(-14, 13, 0, 0, 0, 14, 0, 14)], { x: 1, y: 16, z: 1 }),
  part([box(-14, 13, 0, 0, 0, 14, 0, 14)], { x: 1, y: 0, z: 1 }),
];
const potSide = (pose) => part([box(1, 0, 0, 0, 0, 14, 16, 0, 0, ['north'])], pose);
const POT_SIDES = [
  potSide({ x: 15, y: 16, z: 1, zr: Math.PI }),
  potSide({ x: 1, y: 16, z: 1, yr: -Math.PI / 2, zr: Math.PI }),
  potSide({ x: 15, y: 16, z: 15, yr: Math.PI / 2, zr: Math.PI }),
  potSide({ x: 1, y: 16, z: 15, xr: Math.PI }),
];

// ---------------------------------------------------------------- предметы

const DYES = [
  'white',
  'orange',
  'magenta',
  'light_blue',
  'yellow',
  'lime',
  'pink',
  'gray',
  'light_gray',
  'cyan',
  'purple',
  'blue',
  'brown',
  'green',
  'red',
  'black',
];
const colorOf = (p, suffix) => DYES.find((c) => p === `${c}_${suffix}`) ?? null;

/** Геометрия предмета: { quads, kind } или null */
function build(layers, id, chain) {
  const [ns, p] = id.split(':');
  const has = (t) => Boolean(findResource(layers, texturePath(t)));
  const base = () => new Pose().t(0, 0, 0); // BEWLR получает позу уже после translate(−0.5) — блок 0…1
  const out = [];
  const inChain = (m) => chain.includes(m);

  if (inChain('minecraft:item/chest')) {
    // ChestRenderer без мира: FACING = SOUTH (поворот 0), крышка закрыта
    let tex = null;
    if (ns === 'minecraft')
      tex = { chest: 'minecraft:entity/chest/normal', trapped_chest: 'minecraft:entity/chest/trapped', ender_chest: 'minecraft:entity/chest/ender' }[p];
    else {
      // TFCChestBlockEntityRenderer: tfc:entity/chest/<normal|trapped>/<дерево> (Beneath кладёт свои туда же)
      const m = p.match(/(trapped_)?chest\/([a-z0-9_]+)$/);
      if (m) tex = `tfc:entity/chest/${m[1] ? 'trapped' : 'normal'}/${m[2]}`;
    }
    if (!tex || !has(tex)) return null;
    for (const pt of CHEST) renderPart(base(), pt, { id: tex, w: 64, h: 64 }, out);
    return { quads: out, kind: 'сундук (ChestRenderer)' };
  }
  if (inChain('minecraft:item/template_bed') && ns === 'minecraft') {
    const color = colorOf(p, 'bed');
    if (!color) return null;
    const tex = { id: `minecraft:entity/bed/${color}`, w: 64, h: 64 };
    // BedRenderer.renderPiece: translate(0, 0.5625, foot ? −1 : 0), X 90°, вокруг центра Z (180° + SOUTH 0°)
    for (const [pt, foot] of [
      [BED_HEAD, false],
      [BED_FOOT, true],
    ]) {
      const ps = base()
        .t(0, 0.5625, foot ? -1 : 0)
        .r('x', 90 * DEG)
        .t(0.5, 0.5, 0.5)
        .r('z', 180 * DEG)
        .t(-0.5, -0.5, -0.5);
      renderPart(ps, pt, tex, out);
    }
    return { quads: out, kind: 'кровать (BedRenderer)' };
  }
  if (inChain('minecraft:item/template_shulker_box') && ns === 'minecraft') {
    const color = p === 'shulker_box' ? null : colorOf(p, 'shulker_box');
    if (p !== 'shulker_box' && !color) return null;
    const tex = { id: `minecraft:entity/shulker/shulker${color ? `_${color}` : ''}`, w: 64, h: 64 };
    // ShulkerBoxRenderer: translate(.5), scale .9995, FACING UP, scale(1, −1, −1), translate(0, −1, 0)
    const ps = base().t(0.5, 0.5, 0.5).s(0.9995, 0.9995, 0.9995).s(1, -1, -1).t(0, -1, 0);
    for (const pt of SHULKER) renderPart(ps, pt, tex, out);
    return { quads: out, kind: 'шалкер (ShulkerBoxRenderer)' };
  }
  if (inChain('minecraft:item/template_banner') && ns === 'minecraft') {
    const color = colorOf(p, 'banner');
    const tint = color ? dyeColors().get(color.toUpperCase()) : null;
    if (tint == null) return null;
    // BannerRenderer без мира: translate(.5), scale(2/3, −2/3, −2/3); древко и перекладина, флаг — banner_base и
    // поверх entity/banner/base с цветом знамени (DyeColor.textureDiffuseColor)
    const ps = base().t(0.5, 0.5, 0.5).s(2 / 3, -2 / 3, -2 / 3);
    const baseTex = { id: 'minecraft:entity/banner_base', w: 64, h: 64 };
    for (const pt of BANNER_POLE) renderPart(ps, pt, baseTex, out);
    renderPart(ps, BANNER_FLAG, baseTex, out);
    renderPart(ps, BANNER_FLAG, { id: 'minecraft:entity/banner/base', w: 64, h: 64 }, out, {
      tint: tint & 0xffffff,
      overlay: true,
    });
    return { quads: out, kind: 'знамя (BannerRenderer)' };
  }
  if (inChain('minecraft:item/template_skull') && ns === 'minecraft') {
    // SkullBlockRenderer.SKIN_BY_TYPE; голова игрока без профиля — DefaultPlayerSkin (steve)
    const heads = {
      skeleton_skull: ['minecraft:entity/skeleton/skeleton', 64, 32, false],
      wither_skeleton_skull: ['minecraft:entity/skeleton/wither_skeleton', 64, 32, false],
      creeper_head: ['minecraft:entity/creeper/creeper', 64, 32, false],
      zombie_head: ['minecraft:entity/zombie/zombie', 64, 64, true],
      player_head: ['minecraft:entity/player/wide/steve', 64, 64, true],
    };
    const h = heads[p];
    if (!h || !has(h[0])) return null; // голова дракона и пиглина — свои модели, не перенесены
    // renderSkull(null, 180°): translate(0.5, 0, 0.5), scale(−1, −1, 1)
    renderPart(base().t(0.5, 0, 0.5).s(-1, -1, 1), skull(h[3]), { id: h[0], w: h[1], h: h[2] }, out);
    return { quads: out, kind: 'голова (SkullBlockRenderer)' };
  }
  if (id === 'minecraft:shield') {
    // BEWLR: scale(1, −1, −1), без узора — entity/shield_base_nopattern
    const ps = base().s(1, -1, -1);
    for (const pt of SHIELD) renderPart(ps, pt, { id: 'minecraft:entity/shield_base_nopattern', w: 64, h: 64 }, out);
    return { quads: out, kind: 'щит (ShieldModel)' };
  }
  if (id === 'minecraft:conduit') {
    // ConduitRenderer, не активен: translate(.5), оболочка entity/conduit/base
    for (const pt of CONDUIT) renderPart(base().t(0.5, 0.5, 0.5), pt, { id: 'minecraft:entity/conduit/base', w: 32, h: 16 }, out);
    return { quads: out, kind: 'проводник (ConduitRenderer)' };
  }
  if (id === 'minecraft:decorated_pot') {
    // DecoratedPotRenderer, FACING north — поворот 180° − 180° = 0; стенки без узоров
    for (const pt of POT_BASE)
      renderPart(base(), pt, { id: 'minecraft:entity/decorated_pot/decorated_pot_base', w: 32, h: 32 }, out);
    for (const pt of POT_SIDES)
      renderPart(base(), pt, { id: 'minecraft:entity/decorated_pot/decorated_pot_side', w: 16, h: 16 }, out);
    return { quads: out, kind: 'расписная ваза (DecoratedPotRenderer)' };
  }
  return null;
}

/** Модель для renderModel по предмету с builtin/entity: own — loadModel предмета (display.gui из его цепочки) */
export function entityItemModel(layers, id, own) {
  if (!own?.entity) return null;
  const g = build(
    layers,
    id,
    own.chain.map((c) => c.id),
  );
  if (!g) return null;
  return {
    ...own,
    entity: false,
    elements: null,
    quads: g.quads,
    drawnBy: g.kind,
  };
}

/**
 * Предметы, чей рендерер рисует модель блока (а не модель сущности): ящики Functional Storage
 * (FunctionalStorageISTER.renderBlockItem) — модель состояния по умолчанию (facing=down, subfacing=north, не заперт;
 * DrawerBlock.registerDefaultState) с display.gui модели блока и поворотом Y 180°, X −90°, Y 90° (DrawerISTER,
 * CompactingDrawerISTER, FluidDrawerISTER). Содержимое ящика не рисуется — в JEI и творческом он пуст.
 * Возвращает { parts: [{ model, x, y, mat }], drawnBy } или null.
 */
export function codeBlockParts(layers, id, own) {
  if (!own?.entity) return null;
  const [ns, p] = id.split(':');
  if (ns !== 'functionalstorage') return null;
  const bs = readJsonRes(layers, blockstatePath(id));
  if (!bs?.json) return null;
  const v = pickVariant(bs.json, { facing: 'down', subfacing: 'north', locked: 'false' });
  if (!v.parts.length) return null;
  // R = Ry(180°)·Rx(−90°)·Ry(90°) — строки матрицы 3×3 (поворот вокруг центра блока)
  const r = mul(mul(R('y', Math.PI), R('x', -Math.PI / 2)), R('y', Math.PI / 2));
  const mat = [r[0], r[1], r[2], r[4], r[5], r[6], r[8], r[9], r[10]].map((x) => Math.round(x * 1e9) / 1e9);
  const parts = v.parts.map((x) => ({ model: loadModel(layers, x.model), x: x.x ?? 0, y: x.y ?? 0, mat }));
  if (parts.some((x) => !x.model.chain.length || x.model.missing.length)) return null;
  return { parts, drawnBy: `модель блока ${p} (FunctionalStorageISTER)` };
}
