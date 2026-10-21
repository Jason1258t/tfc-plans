package ee.extras.devtest;

import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.content.bundled_wire.BundledWireTerminationBlock;
import com.george_vi.electroenergetics.content.creative_battery.CreativeBatteryBlock;
import com.george_vi.electroenergetics.content.creative_battery.CreativeBatteryDevice;
import com.george_vi.electroenergetics.content.gauge.GaugeDevice;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNodeConnection;
import com.george_vi.electroenergetics.simulation.infrastructure.InfrastructureSavedData;
import ee.extras.EeExtras;
import ee.extras.cable.CableEnd;
import ee.extras.cable.CableKind;
import ee.extras.cable.CableLaying;
import ee.extras.converter.BidiConverterDevice;
import java.lang.reflect.Field;
import java.util.Map;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.energy.IEnergyStorage;

/**
 * Проверка блоков 2.0 в настоящей симуляции EE:
 *   /rectest bidi — творческая батарея постоянного тока → заряд двустороннего преобразователя; под ним конденсатор IE
 *                   (верх — вход, север — выход); разряд → нагреватель и вольтметр. /rectest bidireport, bidioff
 *                   (батарея 0 В), bidiside <сторона> <input|output|none> — настройка грани конденсатора.
 *   /rectest cables — двухжильный кабель: батарея → соединитель EE → изолятор → соединитель EE → нагреватель;
 *                   четырёхжильный: три батареи звездой → соединитель → изолятор → соединитель → (смешанный) соединитель
 *                   EE. /rectest cablereport, cablecut (смотать оболочку одного кабеля), phase (ключ по соединителю EE).
 */
final class Extras {
    static final BlockPos CAP = new BlockPos(40, -60, 40);
    static final BlockPos CONV = CAP.above();
    static final BlockPos BAT = CONV.west(4);
    static final BlockPos HEAT = CONV.east(4);
    static final BlockPos VM = HEAT.south(3);

    // Двухжильный
    static final BlockPos D_BAT = new BlockPos(0, -60, 50);
    static final BlockPos D_A = D_BAT.east(2);
    static final BlockPos D_I = D_BAT.east(8);
    static final BlockPos D_B = D_BAT.east(14);
    static final BlockPos D_HEAT = D_B.south(3);
    static final BlockPos D_VM = D_HEAT.east(2);
    // Четырёхжильный
    static final BlockPos F_BAT = new BlockPos(0, -60, 60);
    static final BlockPos F = F_BAT.east(6);
    static final BlockPos J = F_BAT.east(12);
    static final BlockPos G = F_BAT.east(18);
    static final BlockPos H = F_BAT.east(24);
    static final BlockPos VG_LN = G.south(3);
    static final BlockPos VG_LL = G.offset(2, 0, 3);
    static final BlockPos H_HEAT = H.offset(-2, 0, 3);
    static final BlockPos VH = H.south(3);
    static final BlockPos VH_L1 = H.offset(2, 0, 3);
    static final BlockPos VG_L2N = G.offset(4, 0, 6);
    static final BlockPos VG_L3N = G.offset(6, 0, 6);
    static final BlockPos VB2 = F_BAT.offset(2, 0, -3);

    // ---------------------------------------------------------------- преобразователь

    static int bidi(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        DevTest.place(level, CAP, BuiltInRegistries.BLOCK.get(ResourceLocation.parse("immersiveengineering:capacitor_lv")).defaultBlockState());
        DevTest.place(level, CONV, EeExtras.CONVERTER.get().defaultBlockState().setValue(BundledWireTerminationBlock.FACING, Direction.UP));
        DevTest.place(level, BAT, CEEBlocks.CREATIVE_BATTERY.getDefaultState());
        DevTest.place(level, HEAT, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
        DevTest.place(level, VM, CEEBlocks.VOLTMETER.getDefaultState());
        side(level, Direction.NORTH, "OUTPUT");
        DevTest.wire(level, BAT, 0, CONV, 0);
        DevTest.wire(level, BAT, 1, CONV, 1);
        DevTest.wire(level, CONV, 2, HEAT, 0);
        DevTest.wire(level, CONV, 3, HEAT, 1);
        DevTest.wire(level, CONV, 2, VM, 0);
        DevTest.wire(level, CONV, 3, VM, 1);
        src.sendSuccess(() -> Component.literal("собрано: батарея → заряд, разряд → нагреватель; конденсатор IE: верх вход, север выход"), false);
        return 1;
    }

    /** Батарея постоянного тока и напряжение разряда */
    static int bidiPower(CommandSourceStack src, double batteryVolts, double outVolts) {
        DevicesSavedData devices = DevicesSavedData.load(src.getLevel());
        CreativeBatteryDevice b = devices.getDevice(BAT, CreativeBatteryDevice.class);
        BidiConverterDevice c = devices.getDevice(CONV, BidiConverterDevice.class);
        if (b != null) b.voltage = batteryVolts;
        if (c != null) c.voltage = outVolts;
        src.sendSuccess(() -> Component.literal("батарея " + batteryVolts + " В, разряд " + outVolts + " В"
                + (b == null ? " (нет батареи)" : "") + (c == null ? " (нет устройства преобразователя)" : "")), false);
        return 1;
    }

    static int bidiReport(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        DevicesSavedData devices = DevicesSavedData.load(level);
        BidiConverterDevice c = devices.getDevice(CONV, BidiConverterDevice.class);
        GaugeDevice g = devices.getDevice(VM, GaugeDevice.class);
        IEnergyStorage cap = level.getCapability(Capabilities.EnergyStorage.BLOCK, CAP, null);
        String msg = String.format("конденсатор %s FE; заряд %.1f Вт (запас %.0f, R %.1f Ом), разряд %.1f Вт (запас %.0f, %.0f В); на нагрузке %s",
                cap == null ? "нет" : cap.getEnergyStored() + "/" + cap.getMaxEnergyStored(),
                c == null ? -1 : c.chargePower, c == null ? -1 : c.charge, c == null ? -1 : c.resistance,
                c == null ? -1 : c.dischargePower, c == null ? -1 : c.discharge, c == null ? -1 : c.voltage,
                g == null ? "нет вольтметра" : String.format("%.2f В", g.rmsVoltages.get()));
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    /** Грань конденсатора IE: sideConfig — публичное поле CapacitorBlockEntity (EnumMap<Direction, IOSideConfig>) */
    @SuppressWarnings({"unchecked", "rawtypes"})
    static String side(ServerLevel level, Direction dir, String mode) {
        try {
            Object be = level.getBlockEntity(CAP);
            Field f = be.getClass().getField("sideConfig");
            Map map = (Map) f.get(be);
            Class<? extends Enum> cls = (Class<? extends Enum>) map.get(Direction.UP).getClass();
            map.put(dir, Enum.valueOf(cls, mode));
            be.getClass().getMethod("setChanged").invoke(be);
            return dir + " = " + mode;
        } catch (ReflectiveOperationException e) {
            return "ошибка: " + e;
        }
    }

    static int bidiSide(CommandSourceStack src, String dir, String mode) {
        String msg = side(src.getLevel(), Direction.byName(dir), mode.toUpperCase());
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    // ---------------------------------------------------------------- кабели

    static BlockState eeTermination() {
        return CEEBlocks.DUPLEX_WIRE_TERMINATION.getDefaultState()
                .setValue(BundledWireTerminationBlock.FACING, Direction.UP)
                .setValue(BundledWireTerminationBlock.ROLL, false)
                .setValue(BundledWireTerminationBlock.FLIP, false);
    }

    static BlockState up(BlockState s) {
        return s.setValue(BundledWireTerminationBlock.FACING, Direction.UP);
    }

    static CableEnd end(ServerLevel level, BlockPos pos) {
        return CableEnd.of(pos, level.getBlockState(pos));
    }

    static int cables(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        BlockState ac = CEEBlocks.CREATIVE_BATTERY.getDefaultState().setValue(CreativeBatteryBlock.AC, true);
        // Двухжильный: батарея → A (жилы 1, 2) → изолятор → B → нагреватель и вольтметр
        DevTest.place(level, D_BAT, ac);
        DevTest.place(level, D_A, eeTermination());
        DevTest.place(level, D_I, up(EeExtras.DUPLEX_INSULATOR.get().defaultBlockState()));
        DevTest.place(level, D_B, eeTermination());
        DevTest.place(level, D_HEAT, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
        DevTest.place(level, D_VM, CEEBlocks.VOLTMETER.getDefaultState());
        CableEnd a = end(level, D_A), i = end(level, D_I), b = end(level, D_B);
        DevTest.wire(level, D_BAT, 0, D_A, a.conductor(1).id());
        DevTest.wire(level, D_BAT, 1, D_A, a.conductor(2).id());
        boolean ok1 = CableLaying.connect(level, CableKind.DUPLEX, a, i);
        boolean ok2 = CableLaying.connect(level, CableKind.DUPLEX, i, b);
        DevTest.wire(level, D_B, b.conductor(1).id(), D_HEAT, 0);
        DevTest.wire(level, D_B, b.conductor(2).id(), D_HEAT, 1);
        DevTest.wire(level, D_B, b.conductor(1).id(), D_VM, 0);
        DevTest.wire(level, D_B, b.conductor(2).id(), D_VM, 1);

        // Четырёхжильный: батареи звездой → F → изолятор J → G; от G — смешанный к соединителю EE H
        for (int k = 0; k < 3; k++) DevTest.place(level, F_BAT.east(2 * k), ac);
        DevTest.place(level, F, up(EeExtras.FOUR_CORE_TERMINATION.get().defaultBlockState()));
        DevTest.place(level, J, up(EeExtras.FOUR_CORE_INSULATOR.get().defaultBlockState()));
        DevTest.place(level, G, up(EeExtras.FOUR_CORE_TERMINATION.get().defaultBlockState()));
        DevTest.place(level, H, eeTermination());
        for (BlockPos p : new BlockPos[] {VG_LN, VG_LL, VH, VH_L1}) DevTest.place(level, p, CEEBlocks.VOLTMETER.getDefaultState());
        DevTest.place(level, H_HEAT, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
        for (int k = 0; k < 3; k++) DevTest.wire(level, F_BAT.east(2 * k), 0, F, 1 + k);
        DevTest.wire(level, F_BAT, 1, F_BAT.east(2), 1);
        DevTest.wire(level, F_BAT.east(2), 1, F_BAT.east(4), 1);
        DevTest.wire(level, F_BAT, 1, F, 4);
        CableEnd f = end(level, F), j = end(level, J), g = end(level, G), h = end(level, H);
        boolean ok3 = CableLaying.connect(level, CableKind.FOUR_CORE, f, j);
        boolean ok4 = CableLaying.connect(level, CableKind.FOUR_CORE, j, g);
        boolean ok5 = CableLaying.connect(level, CableKind.FOUR_CORE, g, h);
        DevTest.wire(level, G, 1, VG_LN, 0);
        DevTest.wire(level, G, 4, VG_LN, 1);
        DevTest.wire(level, G, 1, VG_LL, 0);
        DevTest.wire(level, G, 2, VG_LL, 1);
        DevTest.wire(level, H, h.conductor(1).id(), VH, 0);
        DevTest.wire(level, H, h.conductor(2).id(), VH, 1);
        DevTest.wire(level, H, h.conductor(1).id(), H_HEAT, 0);
        DevTest.wire(level, H, h.conductor(2).id(), H_HEAT, 1);
        DevTest.wire(level, H, h.conductor(1).id(), VH_L1, 0);
        DevTest.wire(level, G, 1, VH_L1, 1);
        for (BlockPos p : new BlockPos[] {VG_L2N, VG_L3N, VB2}) DevTest.place(level, p, CEEBlocks.VOLTMETER.getDefaultState());
        DevTest.wire(level, G, 2, VG_L2N, 0);
        DevTest.wire(level, G, 4, VG_L2N, 1);
        DevTest.wire(level, G, 3, VG_L3N, 0);
        DevTest.wire(level, G, 4, VG_L3N, 1);
        DevTest.wire(level, F_BAT.east(2), 0, VB2, 0);
        DevTest.wire(level, F_BAT.east(2), 1, VB2, 1);
        String msg = "кабели проложены: " + ok1 + " " + ok2 + " " + ok3 + " " + ok4 + " " + ok5;
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    static int cablePower(CommandSourceStack src, double volts) {
        DevicesSavedData devices = DevicesSavedData.load(src.getLevel());
        BlockPos[] bats = {D_BAT, F_BAT, F_BAT.east(2), F_BAT.east(4)};
        float[] phase = {0, 0, 120, 240};
        for (int k = 0; k < bats.length; k++) {
            CreativeBatteryDevice b = devices.getDevice(bats[k], CreativeBatteryDevice.class);
            if (b == null) continue;
            b.voltage = volts;
            b.acFrequency = 1;
            b.phaseOffset = phase[k];
        }
        src.sendSuccess(() -> Component.literal("батареи кабелей: " + volts + " В"), false);
        return 1;
    }

    static String vm(DevicesSavedData d, BlockPos p) {
        GaugeDevice g = d.getDevice(p, GaugeDevice.class);
        return g == null ? "нет" : String.format("%.1f", g.rmsVoltages.get());
    }

    static int cableReport(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        DevicesSavedData d = DevicesSavedData.load(level);
        InfrastructureSavedData sd = InfrastructureSavedData.load(level);
        int wires = 0;
        for (BlockPos p : new BlockPos[] {D_A, D_I, D_B, F, J, G, H})
            for (InWorldNode n : sd.getNodes()) if (n.sourcePos().equals(p)) wires += sd.getConnections(n).size();
        String msg = String.format("двухжильный: на нагрузке %s В; четырёхжильный: L1–N %s, L1–L2 %s; смешанный: фаза–N %s, "
                        + "фаза–L1(G) %s; L2–N %s, L3–N %s, батарея L2 напрямую %s; концов проводов у кабельных блоков %d",
                vm(d, D_VM), vm(d, VG_LN), vm(d, VG_LL), vm(d, VH), vm(d, VH_L1), vm(d, VG_L2N), vm(d, VG_L3N), vm(d, VB2), wires);
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    /** Смотать оболочку кабеля A–изолятор, как пустой катушкой игрока (без выпадения) */
    static int cableCut(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        InfrastructureSavedData sd = InfrastructureSavedData.load(level);
        CableEnd a = end(level, D_A), i = end(level, D_I);
        Object r = sd.removeConnection(new InWorldNodeConnection(a.cable(), i.cable()));
        src.sendSuccess(() -> Component.literal("оболочка A–изолятор снята: " + (r != null)), false);
        return 1;
    }

    static int phase(CommandSourceStack src) {
        boolean r = CableLaying.cyclePhase(src.getLevel(), H, null);
        src.sendSuccess(() -> Component.literal("фаза переключена: " + r), false);
        return 1;
    }
}
