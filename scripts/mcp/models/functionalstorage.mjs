/**
 * Functional Storage 1.5: ящики рисует FunctionalStorageISTER.renderBlockItem — модель состояния блока по умолчанию
 * (DrawerBlock.registerDefaultState: facing=down, subfacing=north, не заперт) с display.gui модели блока и поворотом
 * Y 180°, X −90°, Y 90° (DrawerISTER, CompactingDrawerISTER, FluidDrawerISTER). Содержимое не рисуется — в JEI ящик
 * пуст. Обрамлённые ящики (functionalstorage:framedblock, FramedModel.Baked) без выбранного оформления — дочерние
 * модели как есть, как у composite.
 */
import { R, mul } from '../entityModels.mjs';
import { compositeChildren } from './neoforge.mjs';

// R = Ry(180°)·Rx(−90°)·Ry(90°) — строки матрицы 3×3 (поворот вокруг центра блока)
const r = mul(mul(R('y', Math.PI), R('x', -Math.PI / 2)), R('y', Math.PI / 2));
const MAT = [r[0], r[1], r[2], r[4], r[5], r[6], r[8], r[9], r[10]].map((x) => Math.round(x * 1e9) / 1e9);

export default {
  name: 'Functional Storage',
  loaders: { 'functionalstorage:framedblock': compositeChildren },
  items: [
    {
      name: 'ящик (FunctionalStorageISTER)',
      match: (id) => id.startsWith('functionalstorage:'),
      build(ctx, id) {
        const bs = ctx.readJson(ctx.blockstatePath(id));
        if (!bs?.json) return null;
        const v = ctx.pickVariant(bs.json, { facing: 'down', subfacing: 'north', locked: 'false' });
        if (!v.parts.length) return null;
        const parts = v.parts.map((x) => ({ model: ctx.loadModel(x.model), x: x.x ?? 0, y: x.y ?? 0, mat: MAT }));
        if (parts.some((x) => !x.model.chain.length || x.model.missing.length)) return null;
        return { parts, drawnBy: `модель блока ${id.split(':')[1]} (FunctionalStorageISTER)` };
      },
    },
  ],
};
