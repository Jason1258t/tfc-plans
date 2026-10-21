package ee.extras;

import com.george_vi.electroenergetics.CEECreativeTab;
import com.george_vi.electroenergetics.CEERegistries;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.simulation.WireType;
import ee.extras.cable.CableEvents;
import ee.extras.cable.CableInsulatorBlock;
import ee.extras.cable.CableKind;
import ee.extras.cable.CableWires;
import ee.extras.cable.FourCoreSpoolItem;
import ee.extras.cable.FourCoreTerminationBlock;
import ee.extras.converter.BidiConverterBlock;
import ee.extras.converter.BidiConverterBlockEntity;
import ee.extras.converter.BidiConverterDevice;
import java.util.function.Supplier;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.material.MapColor;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.capabilities.RegisterCapabilitiesEvent;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * Дополнения к Create Electro Energetics для сборки TFC Планы (до 2.0 — «EE Rectifiers», modId ee_rectifier):
 * выпрямители, двусторонний преобразователь EE ↔ FE, двух- и четырёхжильные кабели (катушка двухпроводного кабеля EE
 * в 1.1.2 не доделана — прокладку делает этот мод), кабельные изоляторы.
 */
@Mod(EeExtras.MOD_ID)
public class EeExtras {
    public static final String MOD_ID = "ee_extras";
    /** Прежний modId: блоки, предметы и устройства EE из мира 1.x переходят на новые id по псевдонимам */
    static final String OLD_ID = "ee_rectifier";

    static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(MOD_ID);
    static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MOD_ID);
    static final DeferredRegister<SimulatedDeviceType<?>> DEVICES =
            DeferredRegister.create(CEERegistries.SIMULATED_DEVICE_TYPE, MOD_ID);
    static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES =
            DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, MOD_ID);
    public static final DeferredRegister<WireType> WIRES = DeferredRegister.create(CEERegistries.WIRE_TYPE, MOD_ID);

    public static final Kind THREE_PHASE = new Kind(Layout.THREE_PHASE);
    public static final Kind SINGLE_PHASE = new Kind(Layout.SINGLE_PHASE);

    public static final DeferredHolder<SimulatedDeviceType<?>, SimulatedDeviceType<BidiConverterDevice>> CONVERTER_DEVICE =
            DEVICES.register("bidirectional_converter", () -> new SimulatedDeviceType<BidiConverterDevice>(
                    rl("bidirectional_converter"),
                    (type, level, pos, devices) -> new BidiConverterDevice(level, pos, devices, type)));
    public static final DeferredBlock<BidiConverterBlock> CONVERTER = BLOCKS.register("bidirectional_converter",
            () -> new BidiConverterBlock(metal()));
    public static final DeferredItem<Item> CONVERTER_ITEM = ITEMS.register("bidirectional_converter",
            () -> new TooltipBlockItem(CONVERTER.get(), new Item.Properties()));
    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<BidiConverterBlockEntity>> CONVERTER_BE =
            BLOCK_ENTITIES.register("bidirectional_converter", () -> BlockEntityType.Builder
                    .of(BidiConverterBlockEntity::new, CONVERTER.get()).build(null));

    public static final DeferredBlock<FourCoreTerminationBlock> FOUR_CORE_TERMINATION = BLOCKS.register(
            "four_core_termination", () -> new FourCoreTerminationBlock(metal()));
    public static final DeferredItem<Item> FOUR_CORE_TERMINATION_ITEM = ITEMS.register("four_core_termination",
            () -> new TooltipBlockItem(FOUR_CORE_TERMINATION.get(), new Item.Properties()));
    public static final DeferredBlock<CableInsulatorBlock> DUPLEX_INSULATOR = BLOCKS.register(
            "duplex_cable_insulator", () -> new CableInsulatorBlock(ceramic(), CableKind.DUPLEX));
    public static final DeferredItem<Item> DUPLEX_INSULATOR_ITEM = ITEMS.register("duplex_cable_insulator",
            () -> new TooltipBlockItem(DUPLEX_INSULATOR.get(), new Item.Properties()));
    public static final DeferredBlock<CableInsulatorBlock> FOUR_CORE_INSULATOR = BLOCKS.register(
            "four_core_cable_insulator", () -> new CableInsulatorBlock(ceramic(), CableKind.FOUR_CORE));
    public static final DeferredItem<Item> FOUR_CORE_INSULATOR_ITEM = ITEMS.register("four_core_cable_insulator",
            () -> new TooltipBlockItem(FOUR_CORE_INSULATOR.get(), new Item.Properties()));
    public static final DeferredItem<FourCoreSpoolItem> FOUR_CORE_SPOOL = ITEMS.register("four_core_cable_spool",
            () -> new FourCoreSpoolItem(new Item.Properties().stacksTo(16)));

    /** Блок, предмет и тип устройства EE одного выпрямителя */
    public static final class Kind {
        public final DeferredHolder<SimulatedDeviceType<?>, SimulatedDeviceType<RectifierDevice>> device;
        public final DeferredBlock<RectifierBlock> block;
        public final DeferredItem<Item> item;

        Kind(Layout layout) {
            String id = layout.id();
            device = DEVICES.register(id, () -> new SimulatedDeviceType<RectifierDevice>(rl(id),
                    (type, level, pos, devices) -> new RectifierDevice(level, pos, devices, type, layout)));
            block = BLOCKS.register(id, () -> new RectifierBlock(metal(), layout, device::get));
            item = ITEMS.register(id, () -> new TooltipBlockItem(block.get(), new Item.Properties()));
            alias(id);
        }
    }

    public static ResourceLocation rl(String path) {
        return ResourceLocation.fromNamespaceAndPath(MOD_ID, path);
    }

    static BlockBehaviour.Properties metal() {
        return BlockBehaviour.Properties.of()
                .mapColor(MapColor.METAL)
                .strength(2.0f, 6.0f)
                .sound(SoundType.NETHERITE_BLOCK)
                .noOcclusion();
    }

    static BlockBehaviour.Properties ceramic() {
        return BlockBehaviour.Properties.of()
                .mapColor(MapColor.TERRACOTTA_WHITE)
                .strength(1.0f, 3.0f)
                .sound(SoundType.STONE)
                .noOcclusion();
    }

    /** ee_rectifier:x → ee_extras:x для блока, предмета и устройства EE (выпрямители из версии 1.x) */
    static void alias(String id) {
        ResourceLocation from = ResourceLocation.fromNamespaceAndPath(OLD_ID, id);
        BLOCKS.addAlias(from, rl(id));
        ITEMS.addAlias(from, rl(id));
        DEVICES.addAlias(from, rl(id));
    }

    public EeExtras(IEventBus modBus) {
        CableWires.init();
        BLOCKS.register(modBus);
        ITEMS.register(modBus);
        DEVICES.register(modBus);
        BLOCK_ENTITIES.register(modBus);
        WIRES.register(modBus);
        modBus.addListener(EeExtras::addToTab);
        modBus.addListener(EeExtras::capabilities);
        CableEvents.register(NeoForge.EVENT_BUS);
    }

    /** FE — только через заднюю грань (ту, которой блок стоит на конденсаторе или машине), как у преобразователя EE */
    private static void capabilities(RegisterCapabilitiesEvent event) {
        event.registerBlockEntity(Capabilities.EnergyStorage.BLOCK, CONVERTER_BE.get(), BidiConverterBlockEntity::energy);
    }

    /** Во вкладку творческого режима Electro Energetics, рядом с остальной электрикой */
    private static void addToTab(BuildCreativeModeTabContentsEvent event) {
        if (!event.getTabKey().equals(CEECreativeTab.CREATIVE_TAB.getKey())) return;
        for (Supplier<? extends Item> item : new Supplier[] {SINGLE_PHASE.item, THREE_PHASE.item, CONVERTER_ITEM,
                FOUR_CORE_TERMINATION_ITEM, DUPLEX_INSULATOR_ITEM, FOUR_CORE_INSULATOR_ITEM, FOUR_CORE_SPOOL})
            event.accept(item.get());
    }
}
