package small.diesel.electric;

import com.george_vi.electroenergetics.CEERegistries;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.capabilities.RegisterCapabilitiesEvent;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;
import small.diesel.SmallDiesel;

/**
 * Малый дизельный генератор — только при Electro Energetics: класс грузится, лишь когда EE стоит
 * (SmallDiesel проверяет ModList), иначе аддон работает без него — один двигатель.
 */
public final class Electric {
    static final DeferredRegister<SimulatedDeviceType<?>> DEVICES =
            DeferredRegister.create(CEERegistries.SIMULATED_DEVICE_TYPE, SmallDiesel.MOD_ID);
    static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES =
            DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, SmallDiesel.MOD_ID);

    public static final DeferredHolder<SimulatedDeviceType<?>, SimulatedDeviceType<GeneratorDevice>> GENERATOR_DEVICE =
            DEVICES.register("small_diesel_generator", () -> new SimulatedDeviceType<GeneratorDevice>(
                    SmallDiesel.rl("small_diesel_generator"),
                    (type, level, pos, devices) -> new GeneratorDevice(level, pos, devices, type)));
    public static final DeferredBlock<GeneratorBlock> GENERATOR = SmallDiesel.BLOCKS.register("small_diesel_generator",
            () -> new GeneratorBlock(SmallDiesel.metal()));
    public static final DeferredItem<Item> GENERATOR_ITEM = SmallDiesel.ITEMS.register("small_diesel_generator",
            () -> new SmallDiesel.TooltipBlockItem(GENERATOR.get(), new Item.Properties()));
    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<GeneratorBlockEntity>> GENERATOR_BE =
            BLOCK_ENTITIES.register("small_diesel_generator", () -> BlockEntityType.Builder
                    .of(GeneratorBlockEntity::new, GENERATOR.get()).build(null));

    private Electric() {}

    public static void register(IEventBus modBus) {
        DEVICES.register(modBus);
        BLOCK_ENTITIES.register(modBus);
        modBus.addListener((RegisterCapabilitiesEvent e) -> e.registerBlockEntity(Capabilities.FluidHandler.BLOCK,
                GENERATOR_BE.get(), (be, side) -> be.tank.getCapability()));
    }

    public static Item item() {
        return GENERATOR_ITEM.get();
    }
}
