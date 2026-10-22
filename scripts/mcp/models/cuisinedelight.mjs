/**
 * Cuisine Delight 1.2: сковорода (builtin/entity) — SkilletBEWLR рисует отдельную модель CuisineDelightClient.SKILLET_MODEL
 * (item/cuisine_skillet_base, со своим display); еда в ней — только у сковороды с содержимым, в JEI она пуста.
 */
const SKILLET = 'cuisinedelight:item/cuisine_skillet_base';

export default {
  name: 'Cuisine Delight',
  items: [
    {
      name: `модель ${SKILLET} (SkilletBEWLR)`,
      match: (id) => id === 'cuisinedelight:cuisine_skillet',
      build(ctx) {
        const model = ctx.loadModel(SKILLET);
        return model.chain.length && !model.missing.length ? { parts: [{ model, x: 0, y: 0 }] } : null;
      },
    },
  ],
};
