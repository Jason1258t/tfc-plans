/**
 * Minecraft: предметы, которые игра рисует кодом (builtin/entity) — модели сущностей и преобразования их рендереров
 * для предмета без мира (BlockEntityWithoutLevelRenderer), перенесённые из исходников Minecraft 1.21.1 / NeoForge 21.1
 * (net.minecraft.client.renderer.blockentity.*Renderer, net.minecraft.client.model.*Model). Вид — как в JEI и
 * творческом: сундук закрыт, кровать на юг, знамя без узоров, голова без профиля игрока.
 */
import { DEG, Pose, box, part, renderPart } from '../entityModels.mjs';
import { dyeColors } from '../fluids.mjs';

// ---------------------------------------------------------------- модели сущностей (LayerDefinition)

// ChestRenderer.createSingleBodyLayer, 64×64
const CHEST = [
  part([box(0, 19, 1, 0, 1, 14, 10, 14)]),
  part([box(0, 0, 1, 0, 0, 14, 5, 14)], { x: 0, y: 9, z: 1 }),
  part([box(0, 0, 7, -2, 14, 2, 4, 1)], { x: 0, y: 9, z: 1 }),
];
// ChestRenderer.createDoubleBodyLeftLayer / createDoubleBodyRightLayer, 64×64 — половины двойного сундука
const CHEST_LEFT = [
  part([box(0, 19, 0, 0, 1, 15, 10, 14)]),
  part([box(0, 0, 0, 0, 0, 15, 5, 14)], { x: 0, y: 9, z: 1 }),
  part([box(0, 0, 0, -2, 14, 1, 4, 1)], { x: 0, y: 9, z: 1 }),
];
const CHEST_RIGHT = [
  part([box(0, 19, 1, 0, 1, 15, 10, 14)]),
  part([box(0, 0, 1, 0, 0, 15, 5, 14)], { x: 0, y: 9, z: 1 }),
  part([box(0, 0, 15, -2, 14, 1, 4, 1)], { x: 0, y: 9, z: 1 }),
];
const CHEST_PARTS = { single: CHEST, left: CHEST_LEFT, right: CHEST_RIGHT };
// BedRenderer.createHeadLayer / createFootLayer, 64×64
const BED_HEAD = part([], {}, [
  part([box(0, 0, 0, 0, 0, 16, 16, 6)]),
  part([box(50, 6, 0, 6, 0, 3, 3, 3)], { xr: Math.PI / 2, zr: Math.PI / 2 }),
  part([box(50, 18, -16, 6, 0, 3, 3, 3)], { xr: Math.PI / 2, zr: Math.PI }),
]);
const BED_FOOT = part([], {}, [
  part([box(0, 22, 0, 0, 0, 16, 16, 6)]),
  part([box(50, 0, 0, 6, -16, 3, 3, 3)], { xr: Math.PI / 2 }),
  part([box(50, 12, -16, 6, -16, 3, 3, 3)], { xr: Math.PI / 2, zr: (Math.PI * 3) / 2 }),
]);
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
// DragonHeadModel.createHeadLayer, 256×256: addBox(имя, x, y, z, w, h, d, u, v), «scale» и «nostril» слева — mirror;
// setupAnim(0, 180, 0): голова yRot 180°, челюсть xRot = (sin 0 + 1)·0.2
const DRAGON_HEAD = part(
  [
    box(176, 44, -6, -1, -24, 12, 5, 16),
    box(112, 30, -8, -8, -10, 16, 16, 16),
    box(0, 0, -5, -12, -4, 2, 4, 6, 0, null, true),
    box(112, 0, -5, -3, -22, 2, 2, 4, 0, null, true),
    box(0, 0, 3, -12, -4, 2, 4, 6),
    box(112, 0, 3, -3, -22, 2, 2, 4),
  ],
  { yr: Math.PI },
  [part([box(176, 65, -6, 0, -16, 12, 4, 16)], { y: 4, z: -8, xr: 0.2 })],
);
// PiglinHeadModel (PiglinModel.addHead), 64×64; setupAnim(0, 180, 0): уши zRot ∓(cos 0 + 2.5)·0.2
const PIGLIN_HEAD = part(
  [
    box(0, 0, -5, -8, -4, 10, 8, 8),
    box(31, 1, -2, -4, -5, 4, 4, 1),
    box(2, 4, 2, -2, -5, 1, 2, 1),
    box(2, 0, -3, -2, -5, 1, 2, 1),
  ],
  { yr: Math.PI },
  [
    part([box(51, 6, 0, 0, -2, 1, 5, 4)], { x: 4.5, y: -6, zr: -0.7 }),
    part([box(39, 6, -1, 0, -2, 1, 5, 4)], { x: -4.5, y: -6, zr: 0.7 }),
  ],
);
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
// BEWLR получает позу уже после translate(−0.5) — блок 0…1
const base = () => new Pose();
const vanilla = (id) => id.startsWith('minecraft:');
const pathOf = (id) => id.split(':')[1];

/**
 * Сундук: ChestRenderer без мира — FACING = SOUTH (поворот 0), крышка закрыта; texId — текстура entity/chest/…;
 * type — ChestType: single, left / right — половина двойного (своя модель и текстура *_left / *_right)
 */
export function chestQuads(texId, type = 'single') {
  const out = [];
  for (const pt of CHEST_PARTS[type] ?? CHEST) renderPart(base(), pt, { id: texId, w: 64, h: 64 }, out);
  return out;
}

/**
 * Сундук как блок схемы (block у обработчика, см. models/index.mjs): по варианту type — своя модель, поворот по facing
 * делает сборщик. texOf(type) → текстура или null (нет половин — двойной рисуется как два одиночных)
 */
export const chestBlock = (texOf) => ({
  rotate: 'facing',
  variants: (ctx) =>
    ['single', 'left', 'right'].flatMap((type) => {
      const tex = [texOf(type), texOf('single')].find((t) => t && ctx.has(t));
      return tex ? [{ when: `type=${type}`, quads: chestQuads(tex, tex === texOf(type) ? type : 'single') }] : [];
    }),
});

const VANILLA_CHESTS = {
  chest: 'minecraft:entity/chest/normal',
  trapped_chest: 'minecraft:entity/chest/trapped',
  ender_chest: 'minecraft:entity/chest/ender',
};
// SkullBlockRenderer.SKIN_BY_TYPE; голова игрока без профиля — DefaultPlayerSkin (steve)
const SKULLS = {
  skeleton_skull: ['minecraft:entity/skeleton/skeleton', 64, 32, false],
  wither_skeleton_skull: ['minecraft:entity/skeleton/wither_skeleton', 64, 32, false],
  creeper_head: ['minecraft:entity/creeper/creeper', 64, 32, false],
  zombie_head: ['minecraft:entity/zombie/zombie', 64, 64, true],
  player_head: ['minecraft:entity/player/wide/steve', 64, 64, true],
};
// Свои модели голов (SkullBlockRenderer.createSkullRenderers): DragonHeadModel, PiglinHeadModel
const OWN_SKULLS = {
  dragon_head: [DRAGON_HEAD, 'minecraft:entity/enderdragon/dragon', 256, 256],
  piglin_head: [PIGLIN_HEAD, 'minecraft:entity/piglin/piglin', 64, 64],
};

export default {
  name: 'Minecraft',
  items: [
    {
      name: 'сундук (ChestRenderer)',
      match: (id, chain) => vanilla(id) && chain.includes('minecraft:item/chest'),
      build(ctx, id) {
        const tex = VANILLA_CHESTS[pathOf(id)];
        return tex && ctx.has(tex) ? { quads: chestQuads(tex) } : null;
      },
      block: (id) => {
        const tex = VANILLA_CHESTS[pathOf(id)];
        return tex ? chestBlock((type) => (type === 'single' ? tex : `${tex}_${type}`)) : null;
      },
    },
    {
      name: 'кровать (BedRenderer)',
      match: (id, chain) => vanilla(id) && chain.includes('minecraft:item/template_bed'),
      build(ctx, id) {
        const color = colorOf(pathOf(id), 'bed');
        if (!color) return null;
        const tex = { id: `minecraft:entity/bed/${color}`, w: 64, h: 64 };
        const out = [];
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
        return { quads: out };
      },
    },
    {
      name: 'шалкер (ShulkerBoxRenderer)',
      match: (id, chain) => vanilla(id) && chain.includes('minecraft:item/template_shulker_box'),
      build(ctx, id) {
        const p = pathOf(id);
        const color = p === 'shulker_box' ? null : colorOf(p, 'shulker_box');
        if (p !== 'shulker_box' && !color) return null;
        const tex = { id: `minecraft:entity/shulker/shulker${color ? `_${color}` : ''}`, w: 64, h: 64 };
        // ShulkerBoxRenderer: translate(.5), scale .9995, FACING UP, scale(1, −1, −1), translate(0, −1, 0)
        const ps = base().t(0.5, 0.5, 0.5).s(0.9995, 0.9995, 0.9995).s(1, -1, -1).t(0, -1, 0);
        const out = [];
        for (const pt of SHULKER) renderPart(ps, pt, tex, out);
        return { quads: out };
      },
    },
    {
      name: 'знамя (BannerRenderer)',
      match: (id, chain) => vanilla(id) && chain.includes('minecraft:item/template_banner'),
      build(ctx, id) {
        const color = colorOf(pathOf(id), 'banner');
        const tint = color ? dyeColors().get(color.toUpperCase()) : null;
        if (tint == null) return null;
        // BannerRenderer без мира: translate(.5), scale(2/3, −2/3, −2/3); древко и перекладина, флаг — banner_base и
        // поверх entity/banner/base с цветом знамени (DyeColor.textureDiffuseColor)
        const ps = base()
          .t(0.5, 0.5, 0.5)
          .s(2 / 3, -2 / 3, -2 / 3);
        const baseTex = { id: 'minecraft:entity/banner_base', w: 64, h: 64 };
        const out = [];
        for (const pt of BANNER_POLE) renderPart(ps, pt, baseTex, out);
        renderPart(ps, BANNER_FLAG, baseTex, out);
        renderPart(ps, BANNER_FLAG, { id: 'minecraft:entity/banner/base', w: 64, h: 64 }, out, {
          tint: tint & 0xffffff,
          overlay: true,
        });
        return { quads: out };
      },
    },
    {
      name: 'голова (SkullBlockRenderer)',
      match: (id, chain) => vanilla(id) && chain.includes('minecraft:item/template_skull'),
      build(ctx, id) {
        const p = pathOf(id);
        const own = OWN_SKULLS[p];
        const h = SKULLS[p];
        // renderSkull(null, 180°): translate(0.5, 0, 0.5), scale(−1, −1, 1)
        const ps = base().t(0.5, 0, 0.5).s(-1, -1, 1);
        const out = [];
        if (own && ctx.has(own[1])) {
          // DragonHeadModel.renderToBuffer: translate(0, −0.374375, 0), scale 0.75
          if (p === 'dragon_head') ps.t(0, -0.374375, 0).s(0.75, 0.75, 0.75);
          renderPart(ps, own[0], { id: own[1], w: own[2], h: own[3] }, out);
          return { quads: out };
        }
        if (!h || !ctx.has(h[0])) return null;
        renderPart(ps, skull(h[3]), { id: h[0], w: h[1], h: h[2] }, out);
        return { quads: out };
      },
    },
    {
      name: 'щит (ShieldModel)',
      match: (id) => id === 'minecraft:shield',
      build() {
        // BEWLR: scale(1, −1, −1), без узора — entity/shield_base_nopattern
        const ps = base().s(1, -1, -1);
        const out = [];
        for (const pt of SHIELD)
          renderPart(ps, pt, { id: 'minecraft:entity/shield_base_nopattern', w: 64, h: 64 }, out);
        return { quads: out };
      },
    },
    {
      name: 'проводник (ConduitRenderer)',
      match: (id) => id === 'minecraft:conduit',
      build() {
        // ConduitRenderer, не активен: translate(.5), оболочка entity/conduit/base
        const out = [];
        for (const pt of CONDUIT)
          renderPart(base().t(0.5, 0.5, 0.5), pt, { id: 'minecraft:entity/conduit/base', w: 32, h: 16 }, out);
        return { quads: out };
      },
    },
    {
      name: 'расписная ваза (DecoratedPotRenderer)',
      match: (id) => id === 'minecraft:decorated_pot',
      build() {
        // DecoratedPotRenderer, FACING north — поворот 180° − 180° = 0; стенки без узоров
        const out = [];
        for (const pt of POT_BASE)
          renderPart(base(), pt, { id: 'minecraft:entity/decorated_pot/decorated_pot_base', w: 32, h: 32 }, out);
        for (const pt of POT_SIDES)
          renderPart(base(), pt, { id: 'minecraft:entity/decorated_pot/decorated_pot_side', w: 16, h: 16 }, out);
        return { quads: out };
      },
    },
  ],
};
