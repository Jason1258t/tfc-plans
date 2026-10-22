/**
 * CC: Tweaked 1.120: черепаха (computercraft:turtle, TurtleModelParts) без улучшений, наклейки и окраски — модель
 * семейства из поля model с её display (на Рождество в игре ещё колпак — не рисуем).
 */
export default {
  name: 'CC: Tweaked',
  loaders: {
    'computercraft:turtle': (ctx, part) => {
      const m = part.model;
      const c = ctx.inlineModel(m.loaderJson?.model);
      if (!c?.chain.length) {
        ctx.warn(`${m.id}: нет модели черепахи ${m.loaderJson?.model}`);
        return [];
      }
      c.display = { ...c.display, ...m.display };
      return ctx.expand([{ ...part, model: c }]);
    },
  },
};
