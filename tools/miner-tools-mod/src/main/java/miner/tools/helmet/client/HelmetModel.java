package miner.tools.helmet.client;

import miner.tools.helmet.Helmet;
import miner.tools.helmet.MinerHelmetItem;
import net.minecraft.resources.ResourceLocation;
import software.bernie.geckolib.model.GeoModel;

/** Геометрия каски — из мода Mining Helmet (CysticTurtle85, MIT), текстура своя (art/gen_assets.py) */
public class HelmetModel extends GeoModel<MinerHelmetItem> {
    static final ResourceLocation MODEL = Helmet.id("geo/miner_helmet.geo.json");
    static final ResourceLocation ANIMATION = Helmet.id("animations/miner_helmet.animation.json");
    static final ResourceLocation TEXTURE = Helmet.id("textures/models/armor/miner_helmet.png");
    static final ResourceLocation TEXTURE_LIT = Helmet.id("textures/models/armor/miner_helmet_lit.png");

    @Override
    public ResourceLocation getModelResource(MinerHelmetItem animatable) {
        return MODEL;
    }

    @Override
    public ResourceLocation getTextureResource(MinerHelmetItem animatable) {
        return TEXTURE;
    }

    @Override
    public ResourceLocation getAnimationResource(MinerHelmetItem animatable) {
        return ANIMATION;
    }
}
