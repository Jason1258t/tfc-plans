package miner.tools.helmet.client;

import miner.tools.helmet.Helmet;
import miner.tools.helmet.MinerHelmetItem;
import net.minecraft.resources.ResourceLocation;
import software.bernie.geckolib.renderer.GeoArmorRenderer;

/** Каска на игроке; горящий фонарь — текстура со светлым стеклом */
public class HelmetRenderer extends GeoArmorRenderer<MinerHelmetItem> {
    public HelmetRenderer() {
        super(new HelmetModel());
    }

    @Override
    public ResourceLocation getTextureLocation(MinerHelmetItem animatable) {
        return Helmet.lit(getCurrentStack()) ? HelmetModel.TEXTURE_LIT : HelmetModel.TEXTURE;
    }
}
