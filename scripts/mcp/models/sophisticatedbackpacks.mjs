/**
 * Sophisticated Backpacks: рюкзак (BackpackDynamicModel) — части block/backpack_<часть> с текстурой clips из модели
 * предмета. Без улучшений (как в JEI и творческом) — основа, карманы слева, справа и спереди, лямки. Цвета ткани и
 * окантовки по умолчанию — BackpackWrapper.DEFAULT_MAIN_COLOR / DEFAULT_ACCENT_COLOR (tintindex 0 и 1).
 */
const PARTS = ['base', 'left_pouch', 'right_pouch', 'front_pouch', 'straps'];
const TINTS = { 0: 0xcc613a, 1: 0x622e1a };

export default {
  name: 'Sophisticated Backpacks',
  loaders: {
    'sophisticatedbackpacks:backpack': (ctx, part) => {
      const m = part.model;
      const clips = ctx.resolveTexture(m.textures, '#clips');
      const out = [];
      for (const name of PARTS) {
        const c = ctx.loadModel(`sophisticatedbackpacks:block/backpack_${name}`);
        if (!c.chain.length || c.missing.length) {
          ctx.warn(`${m.id}: нет части рюкзака backpack_${name}`);
          continue;
        }
        if (clips) c.textures = { ...c.textures, clips };
        c.display = { ...c.display, ...m.display };
        c.tints = TINTS;
        out.push({ ...part, model: c });
      }
      return out;
    },
  },
};
