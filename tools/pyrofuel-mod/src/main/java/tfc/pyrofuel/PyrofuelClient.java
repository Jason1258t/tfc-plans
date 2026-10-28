package tfc.pyrofuel;

import net.minecraft.resources.ResourceLocation;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.client.extensions.common.IClientFluidTypeExtensions;
import net.neoforged.neoforge.client.extensions.common.RegisterClientExtensionsEvent;

/** Клиентская часть отделена от регистрации сервера. */
public final class PyrofuelClient {
    public static void register(IEventBus bus) {
        bus.addListener((RegisterClientExtensionsEvent e) -> {
            register(e, Pyrofuel.RAW_GEL, "raw_pyrogel");
            register(e, Pyrofuel.GEL, "pyrogel");
        });
    }
    private static void register(RegisterClientExtensionsEvent e, Pyrofuel.Liquid fluid, String name) {
        e.registerFluidType(new IClientFluidTypeExtensions() {
            @Override public ResourceLocation getStillTexture() { return Pyrofuel.rl("fluid/" + name + "_still"); }
            @Override public ResourceLocation getFlowingTexture() { return Pyrofuel.rl("fluid/" + name + "_flow"); }
        }, fluid.type.get());
    }
}
