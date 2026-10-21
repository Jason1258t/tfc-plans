package ee.extras.cable;

import com.george_vi.electroenergetics.CEEItems;
import com.george_vi.electroenergetics.CEEPartialModels;
import com.george_vi.electroenergetics.config.CEEConfigs;
import com.george_vi.electroenergetics.simulation.WireType;
import dev.engine_room.flywheel.lib.model.baked.PartialModel;
import ee.extras.EeExtras;
import net.neoforged.neoforge.registries.DeferredHolder;

/**
 * Провода EE, из которых складывается кабель. Видимый — «оболочка»: декоративный провод EE (ток не проводит, как
 * двухпроводной кабель самого EE) между узлами кабеля соединителей. Жилы — невидимые изолированные провода между
 * контактами жил, по одному на жилу; их свойства — как у изолированного провода EE (сопротивление, предельное
 * напряжение изоляции и нагрев из настроек EE). Целостность «оболочка + жилы» держит CableData.
 *
 * Катушка у всех частей кабеля — его катушка: пустой катушкой EE можно смотать и оболочку, и (случайно) жилу — вернётся
 * катушка кабеля, остальное CableData уберёт без выпадения.
 */
public final class CableWires {
    /** Пустая модель: жилы не рисуются. Слабые ссылки в PartialModel.ALL — держим полями */
    public static final PartialModel EMPTY_SEGMENT = PartialModel.of(EeExtras.rl("block/empty_wire_segment"));
    public static final PartialModel FOUR_CORE_SEGMENT = PartialModel.of(EeExtras.rl("block/four_core_cable_segment"));

    public static final DeferredHolder<WireType, WireType> DUPLEX = EeExtras.WIRES.register("duplex_cable",
            () -> new WireType.Builder(CEEPartialModels.DUPLEX_WIRE_SEGMENT)
                    .resistance(() -> 1.0E11)
                    .droppedItem(CEEItems.INSULATED_WIRE)
                    .spoolItem(CEEItems.DUPLEX_WIRE_SPOOL::get)
                    .maxLength(CEEConfigs.server().maxBundledWireLength::get)
                    .decorative()
                    .build());
    public static final DeferredHolder<WireType, WireType> FOUR_CORE = EeExtras.WIRES.register("four_core_cable",
            () -> new WireType.Builder(FOUR_CORE_SEGMENT)
                    .resistance(() -> 1.0E11)
                    .droppedItem(CEEItems.INSULATED_WIRE)
                    .spoolItem(() -> EeExtras.FOUR_CORE_SPOOL.get())
                    .maxLength(CEEConfigs.server().maxBundledWireLength::get)
                    .thickness(0.125f)
                    .decorative()
                    .build());
    public static final DeferredHolder<WireType, WireType> DUPLEX_CORE = core("duplex_cable_core", CableKind.DUPLEX);
    public static final DeferredHolder<WireType, WireType> FOUR_CORE_CORE = core("four_core_cable_core", CableKind.FOUR_CORE);

    private static DeferredHolder<WireType, WireType> core(String id, CableKind kind) {
        return EeExtras.WIRES.register(id, () -> new WireType.Builder(EMPTY_SEGMENT)
                .resistance(CEEConfigs.server().resistanceValues.wireResistance::get)
                .spoolItem(() -> spool(kind))
                .maxInsulationVoltage(CEEConfigs.server().voltageValues.wireMaxVoltage::get)
                .insulationResistance(330000.0)
                .maxTemperature(() -> 3540.0)
                .maxLength(() -> Integer.MAX_VALUE)
                .build());
    }

    public static net.minecraft.world.item.Item spool(CableKind kind) {
        return kind == CableKind.DUPLEX ? CEEItems.DUPLEX_WIRE_SPOOL.get() : EeExtras.FOUR_CORE_SPOOL.get();
    }

    public static WireType sheath(CableKind kind) {
        return (kind == CableKind.DUPLEX ? DUPLEX : FOUR_CORE).get();
    }

    public static WireType core(CableKind kind) {
        return (kind == CableKind.DUPLEX ? DUPLEX_CORE : FOUR_CORE_CORE).get();
    }

    /** Загрузить класс при создании мода: PartialModel должны появиться до загрузки моделей */
    public static void init() {
    }

    private CableWires() {
    }
}
