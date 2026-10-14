package ee.rectifier;

import com.george_vi.electroenergetics.CEECreativeTab;
import com.george_vi.electroenergetics.CEERegistries;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.material.MapColor;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * Выпрямители для Create Electro Energetics: один блок вместо диодного моста. Трёхфазный — три фазы на вход,
 * однофазный — фаза и нейтраль; на выходе «+» и «−» постоянного тока. Внутри — диоды EE (DiodeProperties).
 */
@Mod(EeRectifier.MOD_ID)
public class EeRectifier {
    public static final String MOD_ID = "ee_rectifier";

    static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(MOD_ID);
    static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MOD_ID);
    static final DeferredRegister<SimulatedDeviceType<?>> DEVICES =
            DeferredRegister.create(CEERegistries.SIMULATED_DEVICE_TYPE, MOD_ID);

    public static final Kind THREE_PHASE = new Kind(Layout.THREE_PHASE);
    public static final Kind SINGLE_PHASE = new Kind(Layout.SINGLE_PHASE);

    /** Блок, предмет и тип устройства EE одного выпрямителя */
    public static final class Kind {
        public final DeferredHolder<SimulatedDeviceType<?>, SimulatedDeviceType<RectifierDevice>> device;
        public final DeferredBlock<RectifierBlock> block;
        public final DeferredItem<Item> item;

        Kind(Layout layout) {
            String id = layout.id();
            device = DEVICES.register(id, () -> new SimulatedDeviceType<RectifierDevice>(
                    ResourceLocation.fromNamespaceAndPath(MOD_ID, id),
                    (type, level, pos, devices) -> new RectifierDevice(level, pos, devices, type, layout)));
            block = BLOCKS.register(id, () -> new RectifierBlock(BlockBehaviour.Properties.of()
                    .mapColor(MapColor.METAL)
                    .strength(2.0f, 6.0f)
                    .sound(SoundType.NETHERITE_BLOCK)
                    .noOcclusion(), layout, device::get));
            item = ITEMS.register(id, () -> new RectifierItem(block.get(), new Item.Properties()));
        }
    }

    public EeRectifier(IEventBus modBus) {
        BLOCKS.register(modBus);
        ITEMS.register(modBus);
        DEVICES.register(modBus);
        modBus.addListener(EeRectifier::addToTab);
    }

    /** Во вкладку творческого режима Electro Energetics, рядом с остальной электрикой */
    private static void addToTab(BuildCreativeModeTabContentsEvent event) {
        if (!event.getTabKey().equals(CEECreativeTab.CREATIVE_TAB.getKey())) return;
        event.accept(SINGLE_PHASE.item.get());
        event.accept(THREE_PHASE.item.get());
    }
}
