package miner.tools;

import com.mojang.serialization.Codec;
import java.util.function.Supplier;
import net.minecraft.core.component.DataComponentType;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.component.ItemContainerContents;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.common.extensions.IMenuTypeExtension;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * Снаряжение шахтёра для сборки TFC Планы.
 * <p>
 * Пояс шахтёра: пока он надет (слот Curios «пояс») или лежит в инвентаре, игрок не подбирает предметы из его фильтра —
 * камешки, гравий, землю. ПКМ с поясом в руке — окно фильтра, Shift+ПКМ — включить/выключить.
 */
@Mod(MinerTools.MOD_ID)
public class MinerTools {
    public static final String MOD_ID = "miner_tools";

    static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MOD_ID);
    static final DeferredRegister.DataComponents COMPONENTS = DeferredRegister.createDataComponents(
            Registries.DATA_COMPONENT_TYPE, MOD_ID);
    static final DeferredRegister<MenuType<?>> MENUS = DeferredRegister.create(Registries.MENU, MOD_ID);

    /** Что не подбирать: до {@link BeltMenu#SLOTS} образцов */
    public static final Supplier<DataComponentType<ItemContainerContents>> FILTER = COMPONENTS.registerComponentType(
            "filter", b -> b.persistent(ItemContainerContents.CODEC).networkSynchronized(ItemContainerContents.STREAM_CODEC));
    /** Пояс работает (по умолчанию — да) */
    public static final Supplier<DataComponentType<Boolean>> ENABLED = COMPONENTS.registerComponentType(
            "enabled", b -> b.persistent(Codec.BOOL).networkSynchronized(ByteBufCodecs.BOOL));
    /** Образец означает все породы и почвы (камешек гранита — любой камешек), по умолчанию — да */
    public static final Supplier<DataComponentType<Boolean>> ANY_VARIANT = COMPONENTS.registerComponentType(
            "any_variant", b -> b.persistent(Codec.BOOL).networkSynchronized(ByteBufCodecs.BOOL));

    public static final DeferredItem<MinerBeltItem> BELT = ITEMS.register("miner_belt",
            () -> new MinerBeltItem(new Item.Properties().stacksTo(1)));
    public static final DeferredHolder<MenuType<?>, MenuType<BeltMenu>> MENU = MENUS.register("miner_belt",
            () -> IMenuTypeExtension.create(BeltMenu::new));

    public MinerTools(IEventBus modBus) {
        ITEMS.register(modBus);
        COMPONENTS.register(modBus);
        MENUS.register(modBus);
        modBus.addListener(MinerTools::creativeTab);
        NeoForge.EVENT_BUS.register(PickupFilter.class);
    }

    private static void creativeTab(BuildCreativeModeTabContentsEvent event) {
        if (event.getTabKey() == CreativeModeTabs.TOOLS_AND_UTILITIES) event.accept(BELT.get());
    }
}
