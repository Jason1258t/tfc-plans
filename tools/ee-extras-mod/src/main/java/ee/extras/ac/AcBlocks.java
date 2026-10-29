package ee.extras.ac;

import com.george_vi.electroenergetics.devices.device.SimulatedDevice;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import ee.extras.EeExtras;
import ee.extras.Layout;
import ee.extras.Tier;
import ee.extras.TooltipBlockItem;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;

/**
 * Регистрация блоков переменного тока (2.4): преобразователи частоты и синхронизаторы — лёгкие и тяжёлые, одно- и
 * трёхфазные, промышленные (трёхфазные, в два блока). id = приставка ступени + id раскладки
 * (industrial_three_phase_synchronizer). Блок-сущность — одна на вид устройства.
 */
public final class AcBlocks {
    private AcBlocks() {}

    interface Factory<D extends SimulatedDevice> {
        D create(net.minecraft.world.level.Level level, net.minecraft.core.BlockPos pos,
                com.george_vi.electroenergetics.devices.device.DevicesSavedData devices, SimulatedDeviceType<?> type,
                Layout layout, Tier tier);
    }

    /** Блок, предмет, тип устройства EE и (у промышленного) нижняя половина */
    public static final class Kind {
        public final Tier tier;
        public final Layout layout;
        public final DeferredBlock<? extends AcBlock<?, ?>> block;
        public final DeferredItem<Item> item;
        public DeferredBlock<TallBaseBlock> base;

        Kind(Tier tier, Layout layout, DeferredBlock<? extends AcBlock<?, ?>> block, DeferredItem<Item> item) {
            this.tier = tier;
            this.layout = layout;
            this.block = block;
            this.item = item;
        }

        public String id() {
            return tier.prefix + layout.id();
        }
    }

    public static final List<Kind> CONVERTERS = new ArrayList<>();
    public static final List<Kind> SYNCHRONIZERS = new ArrayList<>();

    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<FrequencyConverterBlockEntity>> FREQUENCY_CONVERTER_BE =
            EeExtras.BLOCK_ENTITIES.register("frequency_converter", () -> BlockEntityType.Builder
                    .of(FrequencyConverterBlockEntity::new, blocks(CONVERTERS)).build(null));
    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<SynchronizerBlockEntity>> SYNCHRONIZER_BE =
            EeExtras.BLOCK_ENTITIES.register("synchronizer", () -> BlockEntityType.Builder
                    .of(SynchronizerBlockEntity::new, blocks(SYNCHRONIZERS)).build(null));

    static {
        for (Tier tier : Tier.values()) {
            for (boolean three : new boolean[] {false, true}) {
                if (tier == Tier.INDUSTRIAL && !three) continue;
                CONVERTERS.add(converter(tier, three ? Layout.THREE_PHASE_FREQUENCY_CONVERTER
                        : Layout.SINGLE_PHASE_FREQUENCY_CONVERTER));
                SYNCHRONIZERS.add(synchronizer(tier, three ? Layout.THREE_PHASE_SYNCHRONIZER
                        : Layout.SINGLE_PHASE_SYNCHRONIZER));
            }
        }
    }

    /** Вызывается из конструктора мода: загрузка класса регистрирует всё выше */
    public static void init() {}

    private static Block[] blocks(List<Kind> kinds) {
        return kinds.stream().map(k -> k.block.get()).toArray(Block[]::new);
    }

    private static <D extends SimulatedDevice> DeferredHolder<SimulatedDeviceType<?>, SimulatedDeviceType<D>> device(
            String id, Layout layout, Tier tier, Factory<D> factory) {
        return EeExtras.DEVICES.register(id, () -> new SimulatedDeviceType<D>(EeExtras.rl(id),
                (type, level, pos, devices) -> factory.create(level, pos, devices, type, layout, tier)));
    }

    private static Kind converter(Tier tier, Layout layout) {
        String id = tier.prefix + layout.id();
        var device = device(id, layout, tier, FrequencyConverterDevice::new);
        DeferredBlock<AcBlock<FrequencyConverterDevice, FrequencyConverterBlockEntity>> block = EeExtras.BLOCKS.register(id,
                () -> new AcBlock<>(EeExtras.metal(), layout, tier, device::get, FrequencyConverterBlockEntity.class,
                        FREQUENCY_CONVERTER_BE::get));
        return finish(tier, layout, block);
    }

    private static Kind synchronizer(Tier tier, Layout layout) {
        String id = tier.prefix + layout.id();
        var device = device(id, layout, tier, SynchronizerDevice::new);
        DeferredBlock<SynchronizerBlock> block = EeExtras.BLOCKS.register(id,
                () -> new SynchronizerBlock(EeExtras.metal(), layout, tier, device::get, SYNCHRONIZER_BE::get));
        return finish(tier, layout, block);
    }

    private static Kind finish(Tier tier, Layout layout, DeferredBlock<? extends AcBlock<?, ?>> block) {
        String id = tier.prefix + layout.id();
        DeferredItem<Item> item = EeExtras.ITEMS.register(id, () -> tier == Tier.INDUSTRIAL
                ? new TallBlockItem(block.get(), new Item.Properties())
                : new TooltipBlockItem(block.get(), new Item.Properties()));
        Kind kind = new Kind(tier, layout, block, item);
        if (tier == Tier.INDUSTRIAL) {
            kind.base = EeExtras.BLOCKS.register(id + "_base", () -> {
                TallBaseBlock base = new TallBaseBlock(EeExtras.metal(), block);
                block.get().base = () -> base;
                return base;
            });
        }
        return kind;
    }

    /** Во вкладку EE после выпрямителей и инверторов: сначала преобразователи частоты, потом синхронизаторы */
    public static void addToTab(BuildCreativeModeTabContentsEvent event) {
        for (Kind k : CONVERTERS) event.accept(k.item.get());
        for (Kind k : SYNCHRONIZERS) event.accept(k.item.get());
    }
}
