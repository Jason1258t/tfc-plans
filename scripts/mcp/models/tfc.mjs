/**
 * TerraFirmaCraft 4.2.9: сундуки из дерева (TFCChestBlockEntityRenderer — модель ванильного сундука, текстура
 * tfc:entity/chest/<normal|trapped>/<дерево>; Beneath и аддоны дерева кладут свои туда же), плоские загрузчики:
 *   tfc:fluid_container (ContainedFluidModel) — сосуд пустой: base;
 *   tfc:trim (TrimmedItemModel) — броня без отделки: armor и overlay, оба с tintindex 0 (кожаная броня — цвет
 *   кожи по умолчанию DyedItemColor.LEATHER_COLOR Minecraft).
 */
import { chestQuads } from './minecraft.mjs';

/** DyedItemColor.LEATHER_COLOR Minecraft 1.21.1 — кожаная броня без окраски */
const LEATHER_COLOR = 0xffa06540;

export default {
  name: 'TFC',
  items: [
    {
      name: 'сундук из дерева (TFCChestBlockEntityRenderer)',
      match: (id, chain) => !id.startsWith('minecraft:') && chain.includes('minecraft:item/chest'),
      build(ctx, id) {
        const m = id.split(':')[1].match(/(trapped_)?chest\/([a-z0-9_]+)$/);
        const tex = m && `tfc:entity/chest/${m[1] ? 'trapped' : 'normal'}/${m[2]}`;
        return tex && ctx.has(tex) ? { quads: chestQuads(tex) } : null;
      },
    },
  ],
  flat: {
    'tfc:fluid_container': (ctx, model) => {
      const base = ctx.resolveTexture(model.textures, '#base');
      return { specs: base ? [{ id: base }] : [] };
    },
    'tfc:trim': (ctx, model, itemId) => {
      const tex = (k) => ctx.resolveTexture(model.textures, `#${k}`);
      const tint = /^minecraft:leather_/.test(itemId ?? '') ? LEATHER_COLOR : undefined;
      return { specs: ['armor', 'overlay'].filter(tex).map((k) => ({ id: tex(k), tint })) };
    },
  },
};
