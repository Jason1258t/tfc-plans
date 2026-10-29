package builder.tools;

import com.mojang.serialization.Codec;
import java.util.function.Supplier;
import net.minecraft.core.component.DataComponentType;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

/** Пояс строителя: пополнение блоков и инструмент при начале добычи. */
@Mod(BuilderTools.ID)
public final class BuilderTools {
    public static final String ID = "builder_tools";
    private static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(ID);
    private static final DeferredRegister.DataComponents COMPONENTS = DeferredRegister.createDataComponents(Registries.DATA_COMPONENT_TYPE, ID);
    public static final Supplier<DataComponentType<Boolean>> ENABLED = COMPONENTS.registerComponentType("enabled",
            b -> b.persistent(Codec.BOOL).networkSynchronized(ByteBufCodecs.BOOL));
    public static final DeferredItem<BuilderBeltItem> BELT = ITEMS.register("builder_belt",
            () -> new BuilderBeltItem(new Item.Properties().stacksTo(1)));

    public BuilderTools(IEventBus bus) {
        ITEMS.register(bus);
        COMPONENTS.register(bus);
        bus.addListener(BuilderTools::creative);
        NeoForge.EVENT_BUS.register(Refill.class);
    }

    private static void creative(BuildCreativeModeTabContentsEvent event) {
        if (event.getTabKey() == CreativeModeTabs.TOOLS_AND_UTILITIES) event.accept(BELT.get());
    }
}
