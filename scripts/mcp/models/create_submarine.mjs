/**
 * Create Submarine 2.2: барометр — аквариум. Предмет рисует BarometerItemRenderer: модель блока в состоянии по умолчанию
 * (FACING = NORTH) и рендерер блока BarometerBlockEntityRenderer у макета без мира-глубины (syncedDepth = 0):
 * дно из песка, камень, три пучка водорослей (блоки ванили с позой из кода), рыба-фуга в спокойном виде (puffState 0 —
 * PufferfishSmallModel) и вода (текстура water_still с окраской воды, полупрозрачная). Покачивание рыбы зависит от
 * времени мира — берём момент 0 (как первый кадр анимированной текстуры).
 */
import { DEG, Pose, box, part, renderPart } from '../entityModels.mjs';

// PufferfishSmallModel.createBodyLayer, 32×32; setupAnim при возрасте 0: плавники zRot ∓0.2
const PUFFERFISH_SMALL = [
  part([box(0, 27, -1.5, -2, -1.5, 3, 2, 3)], { y: 23 }),
  part([box(24, 6, -1.5, 0, -1.5, 1, 1, 1)], { y: 20 }),
  part([box(28, 6, 0.5, 0, -1.5, 1, 1, 1)], { y: 20 }),
  part([box(-3, 0, -1.5, 0, 0, 3, 0, 3)], { y: 22, z: 1.5 }),
  part([box(25, 0, -1, 0, 0, 1, 0, 2)], { x: -1.5, y: 22, z: -1.5, zr: -0.2 }),
  part([box(25, 0, 0, 0, 0, 1, 0, 2)], { x: 1.5, y: 22, z: -1.5, zr: 0.2 }),
];

/** Поза содержимого: translate(0.5, 0.313125, 0.5), Y −facing.toYRot() (NORTH — 180°) */
const contents = () => new Pose().t(0.5, 0.313125, 0.5).r('y', -180 * DEG);

/** Модель блока ванили в состоянии по умолчанию (первый вариант блокстейта) */
function blockModel(ctx, id) {
  const bs = ctx.readJson(ctx.blockstatePath(id));
  const v = bs?.json && ctx.pickVariant(bs.json, {});
  const ref = v?.parts?.[0]?.model;
  const m = ref && ctx.loadModel(ref);
  return m?.chain.length && !m.missing.length ? m : null;
}

/** Куб воды (renderForcedFluid): грани наружу, только видимые (полупрозрачная — без задних граней) */
function waterQuads(from, to, tex, tint) {
  const [x0, y0, z0] = from.map((k) => k * 16);
  const [x1, y1, z1] = to.map((k) => k * 16);
  const q = (O, U, V, N) => ({ P: [O, U, V], uv: [0, 0, 16, 16], N, tex, tint, cull: true });
  return [
    q([x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [0, 1, 0]),
    q([x0, y0, z1], [x1, y0, z1], [x0, y0, z0], [0, -1, 0]),
    q([x1, y1, z0], [x0, y1, z0], [x1, y0, z0], [0, 0, -1]),
    q([x0, y1, z1], [x1, y1, z1], [x0, y0, z1], [0, 0, 1]),
    q([x0, y1, z0], [x0, y1, z1], [x0, y0, z0], [-1, 0, 0]),
    q([x1, y1, z1], [x1, y1, z0], [x1, y0, z1], [1, 0, 0]),
  ];
}

export default {
  name: 'Create Submarine',
  items: [
    {
      name: 'барометр-аквариум (BarometerItemRenderer)',
      match: (id) => id === 'create_submarine:barometer',
      build(ctx, id, own) {
        const bs = ctx.readJson(ctx.blockstatePath(id));
        const v = bs?.json && ctx.pickVariant(bs.json, { facing: 'north' });
        const shell = v?.parts?.[0] && ctx.loadModel(v.parts[0].model);
        if (!shell?.chain.length || shell.missing.length) return null;
        const display = own.display;
        const parts = [{ model: shell, x: v.parts[0].x ?? 0, y: v.parts[0].y ?? 0 }];
        // Блоки с позой рендерера: песок (дно), камень, водоросли ×3
        const placed = [
          ['minecraft:sand', contents().t(0, 0.025, 0).s(0.99, 0.05, 0.99).t(-0.5, -0.5, -0.5)],
          [
            'minecraft:stone',
            contents()
              .t(-0.3, 0.05, 0.1)
              .s(0.15, 0.1, 0.15)
              .r('y', 45 * DEG)
              .t(-0.5, 0, -0.5),
          ],
          ['minecraft:seagrass', contents().t(-0.25, 0.05, 0.25).s(0.4, 0.5, 0.4).t(-0.5, 0, -0.5)],
          ['minecraft:seagrass', contents().t(0.3, 0.05, 0.3).s(0.3, 0.4, 0.3).t(-0.5, 0, -0.5)],
          ['minecraft:seagrass', contents().t(0.2, 0.05, -0.2).s(0.35, 0.35, 0.35).t(-0.5, 0, -0.5)],
        ];
        for (const [block, pose] of placed) {
          const m = blockModel(ctx, block);
          if (m) parts.push({ model: { ...m, display }, x: 0, y: 0, affine: pose.m });
          else ctx.warn(`барометр: нет модели блока ${block}`);
        }
        // Рыба-фуга: translate(0.5, 0.40625, 0.5), Y −180°, scale 0.5, покачивание при времени 0 (Y 25°), затем
        // LivingEntityRenderer: setupRotations (translate(0, cos 0 · 0.08, 0), Y 180°), scale(−1, −1, 1),
        // translate(0, −1.501, 0)
        const fish = new Pose()
          .t(0.5, 0.40625, 0.5)
          .r('y', -180 * DEG)
          .s(0.5, 0.5, 0.5)
          .r('y', 25 * DEG)
          .t(0, 0.08, 0)
          .r('y', 180 * DEG)
          .s(-1, -1, 1)
          .t(0, -1.501, 0);
        const quads = [];
        if (ctx.has('minecraft:entity/fish/pufferfish'))
          for (const pt of PUFFERFISH_SMALL)
            renderPart(fish, pt, { id: 'minecraft:entity/fish/pufferfish', w: 32, h: 32 }, quads);
        // Вода последней (поверх содержимого): окраска воды NeoForge — 0x3F76E4
        quads.push(
          ...waterQuads(
            [0.000625, 0.250625, 0.000625],
            [0.999375, 0.999375, 0.999375],
            'minecraft:block/water_still',
            0x3f76e4,
          ),
        );
        parts.push({ model: { ...shell, elements: null, loader: null, quads, display }, x: 0, y: 0 });
        return { parts };
      },
    },
  ],
};
