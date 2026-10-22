package ee.extras.devtest;

import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.content.creative_battery.CreativeBatteryBlock;
import com.george_vi.electroenergetics.content.creative_battery.CreativeBatteryDevice;
import com.george_vi.electroenergetics.content.gauge.GaugeDevice;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDevice;
import com.simibubi.create.AllBlocks;
import com.simibubi.create.content.kinetics.motor.CreativeMotorBlockEntity;
import ee.extras.EeExtras;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/**
 * Ступени мощности и инверторы (2.2):
 *   /rectest heat <нагревателей>, /rectest heatv <вольт> — батареи переменного тока звездой → лёгкий и тяжёлый трёхфазные выпрямители,
 *       на выходе у каждого одинаковые нагреватели параллельно; /rectest heatreport — мощность, температура, цел ли блок
 *   /rectest island — творческая батарея постоянного тока → лёгкие инверторы (трёхфазный: нагреватели
 *       треугольником; однофазный: нагреватель) — свой переменный ток без сети
 *   /rectest grid <об/мин> — генератор (4 статора, трёхфазный узел) с нагревателями треугольником; к тем же фазам
 *       трёхфазный инвертор от батареи, к фазе 1 и нейтрали — однофазный
 *   /rectest dc <вольт> — поменять напряжение батарей постоянного тока; /rectest pwatch <тиков> — записать каждый тик
 *       отдачу и режим инверторов и выработку узла; /rectest preport — устройства и записанное
 */
final class Power {
    static final BlockPos HEAT = new BlockPos(120, -60, 0);
    static final BlockPos ISLAND = new BlockPos(120, -60, 20);
    static final BlockPos GRID = new BlockPos(120, -60, 40);

    static final Map<String, BlockPos> WATCH = new LinkedHashMap<>();
    static final List<String> LOG = new ArrayList<>();
    static int left;

    static BlockState acBattery() {
        return CEEBlocks.CREATIVE_BATTERY.getDefaultState().setValue(CreativeBatteryBlock.AC, true);
    }

    static int heat(CommandSourceStack src, int heaters) {
        ServerLevel level = src.getLevel();
        for (int r = 0; r < 2; r++) {
            BlockPos base = HEAT.offset(r * 12, 0, 0);
            for (int i = 0; i < 3; i++) DevTest.place(level, base.offset(i * 2, 0, 0), acBattery());
            BlockPos rect = base.offset(2, 0, 3);
            DevTest.place(level, rect, (r == 0 ? EeExtras.THREE_PHASE : EeExtras.HEAVY_THREE_PHASE).block.get().defaultBlockState());
            for (int i = 0; i < 3; i++) DevTest.wire(level, base.offset(i * 2, 0, 0), 0, rect, i);
            DevTest.wire(level, base, 1, base.offset(2, 0, 0), 1);
            DevTest.wire(level, base.offset(2, 0, 0), 1, base.offset(4, 0, 0), 1);
            for (int h = 0; h < heaters; h++) {
                BlockPos hp = base.offset(h, 0, 6);
                DevTest.place(level, hp, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
                DevTest.wire(level, rect, 3, hp, 0);
                DevTest.wire(level, rect, 4, hp, 1);
            }
            WATCH.put(r == 0 ? "лёгкий выпр." : "тяжёлый выпр.", rect);
        }
        src.sendSuccess(() -> Component.literal("собрано: " + heaters + " нагр. на выпрямитель"), false);
        return 1;
    }

    static int heatVolts(CommandSourceStack src, double volts) {
        DevicesSavedData devices = DevicesSavedData.load(src.getLevel());
        int n = 0;
        for (int r = 0; r < 2; r++)
            for (int i = 0; i < 3; i++) {
                CreativeBatteryDevice b = devices.getDevice(HEAT.offset(r * 12 + i * 2, 0, 0), CreativeBatteryDevice.class);
                if (b == null) continue;
                b.voltage = volts;
                b.acFrequency = 1;
                b.phaseOffset = 120f * i;
                n++;
            }
        int count = n;
        src.sendSuccess(() -> Component.literal("батарей переменного тока: " + count + ", " + volts + " В"), false);
        return 1;
    }

    /** Батарея постоянного тока: у творческой батареи EE контакт 0 — «−», 1 — «+» (getNodeLabel) */
    static void dcSource(ServerLevel level, BlockPos battery, BlockPos inverter, int plus, int minus) {
        DevTest.place(level, battery, CEEBlocks.CREATIVE_BATTERY.getDefaultState());
        DevTest.wire(level, battery, 1, inverter, plus);
        DevTest.wire(level, battery, 0, inverter, minus);
    }

    static int island(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        BlockPos inv3 = ISLAND.offset(0, 0, 3), inv1 = ISLAND.offset(10, 0, 3);
        DevTest.place(level, inv3, EeExtras.THREE_PHASE_INVERTER.block.get().defaultBlockState());
        DevTest.place(level, inv1, EeExtras.SINGLE_PHASE_INVERTER.block.get().defaultBlockState());
        dcSource(level, ISLAND, inv3, 3, 4);
        dcSource(level, ISLAND.offset(10, 0, 0), inv1, 2, 3);
        for (int i = 0; i < 3; i++) {
            BlockPos h = ISLAND.offset(i * 2, 0, 6);
            DevTest.place(level, h, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
            DevTest.wire(level, inv3, i, h, 0);
            DevTest.wire(level, inv3, (i + 1) % 3, h, 1);
        }
        BlockPos h1 = ISLAND.offset(10, 0, 6), m1 = ISLAND.offset(12, 0, 6), m3 = ISLAND.offset(6, 0, 6);
        DevTest.place(level, h1, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
        DevTest.wire(level, inv1, 0, h1, 0);
        DevTest.wire(level, inv1, 1, h1, 1);
        meter(level, m1, inv1, 0, inv1, 1);
        meter(level, m3, inv3, 0, inv3, 1);
        WATCH.put("инв.3 остров", inv3);
        WATCH.put("инв.1 остров", inv1);
        WATCH.put("вольтм. инв.3", m3);
        WATCH.put("вольтм. инв.1", m1);
        src.sendSuccess(() -> Component.literal("собрано: инверторы без сети"), false);
        return 1;
    }

    static void meter(ServerLevel level, BlockPos m, BlockPos a, int na, BlockPos b, int nb) {
        DevTest.place(level, m, CEEBlocks.VOLTMETER.getDefaultState());
        DevTest.wire(level, a, na, m, 0);
        DevTest.wire(level, b, nb, m, 1);
    }

    static int grid(CommandSourceStack src, int rpm) {
        ServerLevel level = src.getLevel();
        BlockPos motor = GRID, rotor = GRID.east(), brushes = GRID.east(2);
        DevTest.place(level, motor, AllBlocks.CREATIVE_MOTOR.getDefaultState().setValue(BlockStateProperties.FACING, Direction.EAST));
        DevTest.place(level, rotor, CEEBlocks.ALTERNATOR_ROTOR.getDefaultState().setValue(BlockStateProperties.AXIS, Direction.Axis.X));
        DevTest.place(level, rotor.above(), AcTest.stator(Direction.DOWN));
        DevTest.place(level, rotor.below(), AcTest.stator(Direction.UP));
        DevTest.place(level, rotor.north(), AcTest.stator(Direction.SOUTH));
        DevTest.place(level, rotor.south(), AcTest.stator(Direction.NORTH));
        DevTest.place(level, brushes, CEEBlocks.THREE_PHASE_ALTERNATOR_BRUSHES.getDefaultState().setValue(BlockStateProperties.FACING, Direction.EAST));
        if (level.getBlockEntity(motor) instanceof CreativeMotorBlockEntity m) m.generatedSpeed.setValue(rpm);
        for (int i = 0; i < 3; i++) {
            BlockPos h = GRID.offset(i * 2, 0, 4);
            DevTest.place(level, h, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
            DevTest.wire(level, brushes, 1 + i, h, 0);
            DevTest.wire(level, brushes, 1 + (i + 1) % 3, h, 1);
        }
        BlockPos inv3 = GRID.offset(0, 0, 8), inv1 = GRID.offset(8, 0, 8);
        DevTest.place(level, inv3, EeExtras.THREE_PHASE_INVERTER.block.get().defaultBlockState());
        DevTest.place(level, inv1, EeExtras.SINGLE_PHASE_INVERTER.block.get().defaultBlockState());
        for (int i = 0; i < 3; i++) DevTest.wire(level, brushes, 1 + i, inv3, i);
        DevTest.wire(level, brushes, 1, inv1, 0);
        DevTest.wire(level, brushes, 0, inv1, 1);
        dcSource(level, GRID.offset(0, 0, 11), inv3, 3, 4);
        dcSource(level, GRID.offset(8, 0, 11), inv1, 2, 3);
        BlockPos m = GRID.offset(4, 0, 8);
        meter(level, m, brushes, 1, brushes, 2);
        WATCH.put("узел", brushes);
        WATCH.put("инв.3 сеть", inv3);
        WATCH.put("инв.1 сеть", inv1);
        WATCH.put("вольтм. фазы 1-2", m);
        src.sendSuccess(() -> Component.literal("собрано: генератор " + rpm + " об/мин + инверторы"), false);
        return 1;
    }

    static int dc(CommandSourceStack src, double volts) {
        DevicesSavedData devices = DevicesSavedData.load(src.getLevel());
        for (BlockPos p : new BlockPos[] {ISLAND, ISLAND.offset(10, 0, 0), GRID.offset(0, 0, 11), GRID.offset(8, 0, 11)}) {
            CreativeBatteryDevice b = devices.getDevice(p, CreativeBatteryDevice.class);
            if (b != null) b.voltage = volts;
        }
        src.sendSuccess(() -> Component.literal("батареи постоянного тока: " + volts + " В"), false);
        return 1;
    }

    static String describe(String name, SimulatedDevice d) {
        if (d == null) return name + ": нет";
        if (d instanceof GaugeDevice g) return String.format("%s: %.1f В", name, g.rmsVoltages.get());
        CompoundTag t = new CompoundTag();
        d.write(t);
        StringBuilder s = new StringBuilder(name).append(':');
        for (String k : t.getAllKeys()) {
            if (k.contains("Data") || k.contains("Voltages")) continue;
            String v = t.get(k).getAsString();
            try {
                v = String.format("%.1f", Double.parseDouble(v.replaceAll("[dfL]$", "")));
            } catch (NumberFormatException ignored) {
            }
            s.append(' ').append(k).append('=').append(v);
        }
        return s.toString();
    }

    static int watch(CommandSourceStack src, int ticks) {
        LOG.clear();
        left = ticks;
        src.sendSuccess(() -> Component.literal("запись " + ticks + " тиков"), false);
        return 1;
    }

    static void tick(ServerTickEvent.Post e) {
        if (left <= 0) return;
        left--;
        DevicesSavedData devices = DevicesSavedData.load(e.getServer().overworld());
        StringBuilder s = new StringBuilder();
        for (var w : WATCH.entrySet()) {
            SimulatedDevice d = devices.getDevice(w.getValue());
            if (d == null) continue;
            CompoundTag t = new CompoundTag();
            d.write(t);
            if (t.contains("OutputPower"))
                s.append(String.format("%s %s %.0f%s | ", w.getKey(), t.getString("Mode"), t.getDouble("OutputPower"),
                        t.contains("PhaseError") ? String.format(" (фаза %+.1f°)", t.getDouble("PhaseError")) : ""));
            else if (d instanceof GaugeDevice g)
                s.append(String.format("%s %.0f | ", w.getKey(), g.rmsVoltages.getSigned()));
        }
        LOG.add(s.toString());
    }

    static int report(CommandSourceStack src) {
        DevicesSavedData devices = DevicesSavedData.load(src.getLevel());
        StringBuilder out = new StringBuilder();
        for (var w : WATCH.entrySet()) out.append(describe(w.getKey(), devices.getDevice(w.getValue()))).append('\n');
        for (int i = 0; i < LOG.size(); i++) out.append(i).append(": ").append(LOG.get(i)).append('\n');
        String msg = out.toString();
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    static void register() {
        NeoForge.EVENT_BUS.addListener(Power::tick);
    }
}
