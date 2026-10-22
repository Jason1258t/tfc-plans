package ee.extras;

import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.CEECreativeTab;
import com.george_vi.electroenergetics.CEEItems;
import com.george_vi.electroenergetics.config.CEEConfigs;
import com.george_vi.electroenergetics.CEERegistries;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDevice;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.simulation.WireType;
import ee.extras.cable.CableEvents;
import ee.extras.cable.CableHud;
import ee.extras.cable.CableInsulatorBlock;
import ee.extras.cable.CableKind;
import ee.extras.cable.CableWires;
import ee.extras.cable.FourCoreSpoolItem;
import ee.extras.cable.FourCoreTerminationBlock;
import ee.extras.cable.PhaseTapBlock;
import ee.extras.lines.LineWire;
import ee.extras.lines.LinesClient;
import ee.extras.lines.Tension;
import ee.extras.converter.BidiConverterBlock;
import ee.extras.converter.BidiConverterBlockEntity;
import ee.extras.converter.BidiConverterDevice;
import ee.extras.generator.GeneratorClient;
import ee.extras.generator.GeneratorDevice;
import ee.extras.generator.KineticGeneratorBlock;
import ee.extras.generator.KineticGeneratorBlockEntity;
import com.simibubi.create.api.stress.BlockStressValues;
import com.mojang.logging.LogUtils;
import java.util.function.Supplier;
import org.slf4j.Logger;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.material.MapColor;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent;
import net.neoforged.fml.loading.FMLEnvironment;
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
 * выпрямители и сетевые инверторы двух ступеней мощности, компактный кинетический генератор, двусторонний преобразователь EE ↔ FE, двух- и четырёхжильные кабели (катушка двухпроводного кабеля EE
 * в 1.1.2 не доделана — прокладку делает этот мод), кабельные изоляторы.
 */
@Mod(EeExtras.MOD_ID)
public class EeExtras {
    public static final String MOD_ID = "ee_extras";
    public static final Logger LOGGER = LogUtils.getLogger();
    /** Прежний modId: блоки, предметы и устройства EE из мира 1.x переходят на новые id по псевдонимам */
    static final String OLD_ID = "ee_rectifier";

    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(MOD_ID);
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MOD_ID);
    static final DeferredRegister<SimulatedDeviceType<?>> DEVICES =
            DeferredRegister.create(CEERegistries.SIMULATED_DEVICE_TYPE, MOD_ID);
    static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES =
            DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, MOD_ID);
    public static final DeferredRegister<WireType> WIRES = DeferredRegister.create(CEERegistries.WIRE_TYPE, MOD_ID);

    public static final Kind<RectifierDevice> THREE_PHASE = new Kind<>(Layout.THREE_PHASE, Tier.LIGHT, RectifierDevice::new);
    public static final Kind<RectifierDevice> SINGLE_PHASE = new Kind<>(Layout.SINGLE_PHASE, Tier.LIGHT, RectifierDevice::new);
    public static final Kind<RectifierDevice> HEAVY_THREE_PHASE = new Kind<>(Layout.THREE_PHASE, Tier.HEAVY, RectifierDevice::new);
    public static final Kind<RectifierDevice> HEAVY_SINGLE_PHASE = new Kind<>(Layout.SINGLE_PHASE, Tier.HEAVY, RectifierDevice::new);
    public static final Kind<InverterDevice> THREE_PHASE_INVERTER =
            new Kind<>(Layout.THREE_PHASE_INVERTER, Tier.LIGHT, InverterDevice::new);
    public static final Kind<InverterDevice> SINGLE_PHASE_INVERTER =
            new Kind<>(Layout.SINGLE_PHASE_INVERTER, Tier.LIGHT, InverterDevice::new);
    public static final Kind<InverterDevice> HEAVY_THREE_PHASE_INVERTER =
            new Kind<>(Layout.THREE_PHASE_INVERTER, Tier.HEAVY, InverterDevice::new);
    public static final Kind<InverterDevice> HEAVY_SINGLE_PHASE_INVERTER =
            new Kind<>(Layout.SINGLE_PHASE_INVERTER, Tier.HEAVY, InverterDevice::new);
    /** Порядок во вкладке творческого режима */
    static final Kind<?>[] POWER = {SINGLE_PHASE, THREE_PHASE, HEAVY_SINGLE_PHASE, HEAVY_THREE_PHASE,
            SINGLE_PHASE_INVERTER, THREE_PHASE_INVERTER, HEAVY_SINGLE_PHASE_INVERTER, HEAVY_THREE_PHASE_INVERTER};

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

    public static final DeferredHolder<SimulatedDeviceType<?>, SimulatedDeviceType<GeneratorDevice>> KINETIC_GENERATOR_DEVICE =
            DEVICES.register("compact_kinetic_generator", () -> new SimulatedDeviceType<GeneratorDevice>(
                    rl("compact_kinetic_generator"), (type, level, pos, devices) ->
                            new GeneratorDevice(level, pos, devices, type, KineticGeneratorBlockEntity.NOMINAL)));
    public static final DeferredBlock<KineticGeneratorBlock> KINETIC_GENERATOR = BLOCKS.register("compact_kinetic_generator",
            () -> new KineticGeneratorBlock(metal()));
    public static final DeferredItem<Item> KINETIC_GENERATOR_ITEM = ITEMS.register("compact_kinetic_generator",
            () -> new TooltipBlockItem(KINETIC_GENERATOR.get(), new Item.Properties()));
    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<KineticGeneratorBlockEntity>> KINETIC_GENERATOR_BE =
            BLOCK_ENTITIES.register("compact_kinetic_generator", () -> BlockEntityType.Builder
                    .of(KineticGeneratorBlockEntity::new, KINETIC_GENERATOR.get()).build(null));

    public static final DeferredBlock<FourCoreTerminationBlock> FOUR_CORE_TERMINATION = BLOCKS.register(
            "four_core_termination", () -> new FourCoreTerminationBlock(metal()));
    public static final DeferredItem<Item> FOUR_CORE_TERMINATION_ITEM = ITEMS.register("four_core_termination",
            () -> new TooltipBlockItem(FOUR_CORE_TERMINATION.get(), new Item.Properties()));
    public static final DeferredBlock<PhaseTapBlock> PHASE_TAP = BLOCKS.register(
            "four_core_tap", () -> new PhaseTapBlock(metal()));
    public static final DeferredItem<Item> PHASE_TAP_ITEM = ITEMS.register("four_core_tap",
            () -> new TooltipBlockItem(PHASE_TAP.get(), new Item.Properties()));
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

    /** Устройство EE выпрямителя или инвертора */
    interface Factory<D extends SimulatedDevice> {
        D create(Level level, BlockPos pos, DevicesSavedData devices, SimulatedDeviceType<?> type, Layout layout, Tier tier);
    }

    /** Блок, предмет и тип устройства EE одного выпрямителя или инвертора; id — приставка ступени + id раскладки */
    public static final class Kind<D extends SimulatedDevice> {
        public final Tier tier;
        public final DeferredHolder<SimulatedDeviceType<?>, SimulatedDeviceType<D>> device;
        public final DeferredBlock<PowerBlock<D>> block;
        public final DeferredItem<Item> item;

        Kind(Layout layout, Tier tier, Factory<D> factory) {
            this.tier = tier;
            String id = tier.prefix + layout.id();
            device = DEVICES.register(id, () -> new SimulatedDeviceType<D>(rl(id),
                    (type, level, pos, devices) -> factory.create(level, pos, devices, type, layout, tier)));
            block = BLOCKS.register(id, () -> new PowerBlock<>(metal(), layout, tier, device::get));
            item = ITEMS.register(id, () -> new TooltipBlockItem(block.get(), new Item.Properties()));
            // Выпрямители 1.x (ee_rectifier) — только лёгкие
            if (tier == Tier.LIGHT && layout.id().endsWith("_rectifier")) alias(id);
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
        LineWire.register();
        Tension.register(modBus);
        BLOCKS.register(modBus);
        ITEMS.register(modBus);
        DEVICES.register(modBus);
        BLOCK_ENTITIES.register(modBus);
        WIRES.register(modBus);
        modBus.addListener(EeExtras::addToTab);
        modBus.addListener((FMLCommonSetupEvent e) -> e.enqueueWork(Tension::tuneIronSag));
        // Нагрузка на вал — через реестр Create: её же показывают подсказка предмета и очки инженера
        modBus.addListener((FMLCommonSetupEvent e) -> e.enqueueWork(() -> BlockStressValues.IMPACTS.register(
                KINETIC_GENERATOR.get(), () -> KineticGeneratorBlockEntity.STRESS_PER_RPM)));
        modBus.addListener(EeExtras::capabilities);
        CableEvents.register(NeoForge.EVENT_BUS);
        if (FMLEnvironment.dist == Dist.CLIENT) {
            CableHud.register(modBus, NeoForge.EVENT_BUS);
            LinesClient.register(modBus, NeoForge.EVENT_BUS);
            GeneratorClient.register(modBus);
            modBus.addListener((FMLClientSetupEvent e) -> WireFixCheck.log());
        }
    }

    /** FE — только через заднюю грань (ту, которой блок стоит на конденсаторе или машине), как у преобразователя EE */
    private static void capabilities(RegisterCapabilitiesEvent event) {
        event.registerBlockEntity(Capabilities.EnergyStorage.BLOCK, CONVERTER_BE.get(), BidiConverterBlockEntity::energy);
    }

    /** Во вкладку творческого режима Electro Energetics, рядом с остальной электрикой */
    private static void addToTab(BuildCreativeModeTabContentsEvent event) {
        if (!event.getTabKey().equals(CEECreativeTab.CREATIVE_TAB.getKey())) return;
        for (Kind<?> k : POWER) event.accept(k.item.get());
        for (Supplier<? extends Item> item : new Supplier[] {KINETIC_GENERATOR_ITEM, CONVERTER_ITEM,
                FOUR_CORE_TERMINATION_ITEM, PHASE_TAP_ITEM, DUPLEX_INSULATOR_ITEM, FOUR_CORE_INSULATOR_ITEM, FOUR_CORE_SPOOL})
            event.accept(item.get());
        for (LineWire w : LineWire.values()) {
            if (w.wire != null) event.accept(w.wire.get());
            event.accept(w.spool.get());
        }
        event.accept(Tension.CLAMP_ITEM.get());
        // EE 1.1.2 сам не кладёт во вкладку двухпроводной кабель и соединитель, а переменный ток — только с
        // showACContent (по умолчанию выключен). JEI и поиск творческого режима берут предметы из вкладок — без этого
        // их не найти, хотя рецепты есть. Дважды класть нельзя (исключение), поэтому — при тех же условиях, что у EE.
        event.accept(CEEBlocks.DUPLEX_WIRE_TERMINATION.asStack());
        event.accept(CEEItems.DUPLEX_WIRE_SPOOL.asStack());
        if (FMLEnvironment.dist == Dist.CLIENT && !CEEConfigs.client().showACContent.get()) {
            event.accept(CEEBlocks.THREE_PHASE_ALTERNATOR_BRUSHES.asStack());
            event.accept(CEEBlocks.SYNCHROSCOPE.asStack());
            event.accept(CEEBlocks.FREQUENCY_METER.asStack());
        }
    }
}
