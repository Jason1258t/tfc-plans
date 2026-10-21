package ee.extras.devtest;

import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.simulation.SimulationResults;
import com.george_vi.electroenergetics.simulation.infrastructure.ConnectionEntry;
import com.george_vi.electroenergetics.simulation.infrastructure.InfrastructureSavedData;
import com.simibubi.create.AllBlocks;
import com.simibubi.create.content.kinetics.motor.CreativeMotorBlockEntity;
import ee.extras.EeExtras;
import ee.extras.RectifierDevice;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/**
 * Жалоба «через выпрямитель горят провода, хотя на выходе пара мелких потребителей»: генератор (4 статора) →
 * трёхфазный выпрямитель → лампа и помпа. /rectest small <об/мин>, /rectest smallwatch <тиков>, /rectest smallreport.
 */
final class SmallLoad {
    static final BlockPos MOTOR = new BlockPos(80, -60, 0);
    static final BlockPos ROTOR = MOTOR.east();
    static final BlockPos BRUSHES = MOTOR.east(2);
    static final BlockPos RECT = new BlockPos(80, -60, 6);
    static final BlockPos BULB = RECT.offset(0, 0, 4);
    static final BlockPos PUMP = RECT.offset(3, 0, 4);

    static int build(CommandSourceStack src, int rpm) {
        ServerLevel level = src.getLevel();
        DevTest.place(level, MOTOR, AllBlocks.CREATIVE_MOTOR.getDefaultState().setValue(BlockStateProperties.FACING, Direction.EAST));
        DevTest.place(level, ROTOR, CEEBlocks.ALTERNATOR_ROTOR.getDefaultState().setValue(BlockStateProperties.AXIS, Direction.Axis.X));
        DevTest.place(level, ROTOR.above(), AcTest.stator(Direction.DOWN));
        DevTest.place(level, ROTOR.below(), AcTest.stator(Direction.UP));
        DevTest.place(level, ROTOR.north(), AcTest.stator(Direction.SOUTH));
        DevTest.place(level, ROTOR.south(), AcTest.stator(Direction.NORTH));
        DevTest.place(level, BRUSHES, CEEBlocks.THREE_PHASE_ALTERNATOR_BRUSHES.getDefaultState().setValue(BlockStateProperties.FACING, Direction.EAST));
        if (level.getBlockEntity(MOTOR) instanceof CreativeMotorBlockEntity m) m.generatedSpeed.setValue(rpm);
        DevTest.place(level, RECT, EeExtras.THREE_PHASE.block.get().defaultBlockState());
        for (int i = 0; i < 3; i++) DevTest.wire(level, BRUSHES, 1 + i, RECT, i);
        DevTest.place(level, BULB, CEEBlocks.BULB.getDefaultState());
        DevTest.place(level, PUMP, CEEBlocks.ELECTRIC_PUMP.getDefaultState());
        DevTest.wire(level, RECT, 3, BULB, 0);
        DevTest.wire(level, RECT, 4, BULB, 1);
        DevTest.wire(level, RECT, 3, PUMP, 0);
        DevTest.wire(level, RECT, 4, PUMP, 1);
        src.sendSuccess(() -> Component.literal("собрано: генератор " + rpm + " об/мин → выпрямитель → лампа + помпа"), false);
        return 1;
    }

    static final BlockPos RECT2 = RECT.east(3);

    /** Второй выпрямитель с того же узла, выходы параллельно первому */
    static int parallel(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        DevTest.place(level, RECT2, EeExtras.THREE_PHASE.block.get().defaultBlockState());
        for (int i = 0; i < 3; i++) DevTest.wire(level, BRUSHES, 1 + i, RECT2, i);
        DevTest.wire(level, RECT2, 3, RECT, 3);
        DevTest.wire(level, RECT2, 4, RECT, 4);
        src.sendSuccess(() -> Component.literal("второй выпрямитель параллельно"), false);
        return 1;
    }

    static double field(Object o, String name) {
        try {
            Field f = RectifierDevice.class.getDeclaredField(name);
            f.setAccessible(true);
            return f.getDouble(o);
        } catch (ReflectiveOperationException e) {
            return Double.NaN;
        }
    }

    // inputR, stored, outVolts, in, out, ток фазы 1, ток в лампу, ток в помпу, макс. доля нагрева провода, проводов
    static final List<double[]> rows = new ArrayList<>();
    static int left;
    static boolean listening;

    static int watch(CommandSourceStack src, int ticks) {
        rows.clear();
        left = ticks;
        ServerLevel level = src.getLevel();
        if (!listening) {
            listening = true;
            NeoForge.EVENT_BUS.addListener((ServerTickEvent.Post e) -> {
                if (left <= 0) return;
                left--;
                InfrastructureSavedData sd = InfrastructureSavedData.load(level);
                SimulationResults r = sd.ticker.lastResults;
                RectifierDevice d = DevicesSavedData.load(level).getDevice(RECT, RectifierDevice.class);
                double[] row = new double[12];
                if (d != null) {
                    row[0] = field(d, "inputR");
                    row[1] = field(d, "stored");
                    row[2] = field(d, "outVolts");
                    row[3] = field(d, "lastIn");
                    row[4] = field(d, "lastOut");
                }
                if (r != null) {
                    row[5] = r.getCurrentThrough(new InWorldNode(1, BRUSHES), new InWorldNode(0, RECT));
                    row[6] = r.getCurrentThrough(new InWorldNode(3, RECT), new InWorldNode(0, BULB));
                    row[7] = r.getCurrentThrough(new InWorldNode(3, RECT), new InWorldNode(0, PUMP));
                    row[10] = r.getCurrentThrough(new InWorldNode(3, RECT2), new InWorldNode(3, RECT));
                    row[11] = r.getCurrentThrough(new InWorldNode(1, BRUSHES), new InWorldNode(0, RECT2));
                }
                double heat = 0;
                int n = 0;
                for (var en : sd.wireSimulationState.getAllConnections()) {
                    ConnectionEntry c = (ConnectionEntry) ((java.util.Map.Entry<?, ?>) en).getValue();
                    heat = Math.max(heat, c.wireData.temperature / c.wireData.wireType().getMaxTemperature());
                    n++;
                }
                row[8] = heat * c0max();
                row[9] = n;
                rows.add(row);
            });
        }
        src.sendSuccess(() -> Component.literal("пишу " + ticks + " тиков"), false);
        return 1;
    }

    static double c0max() {
        return com.george_vi.electroenergetics.CEEWireTypes.COPPER.get().getMaxTemperature();
    }

    static double temp(ServerLevel level) {
        double t = 0;
        for (var en : InfrastructureSavedData.load(level).wireSimulationState.getAllConnections())
            t = Math.max(t, ((ConnectionEntry) ((java.util.Map.Entry<?, ?>) en).getValue()).wireData.temperature);
        return t;
    }

    static int report(CommandSourceStack src, int from, int count) {
        StringBuilder out = new StringBuilder("пределы нагрева:");
        try {
            for (Field f : com.george_vi.electroenergetics.CEEWireTypes.class.getFields()) {
                if (!(f.get(null) instanceof net.neoforged.neoforge.registries.DeferredHolder<?, ?> h)) continue;
                var t = (com.george_vi.electroenergetics.simulation.WireType) h.get();
                out.append(" ").append(f.getName()).append("=").append(t.getMaxTemperature());
            }
        } catch (ReflectiveOperationException e) {
            out.append(e);
        }
        out.append("\nтик: R_вх, запас, U_вых, взято, отдано, I_фазы, I_лампы, I_помпы, макс. t провода, проводов, I_между выпрямителями, I_фазы второго\n");
        for (int k = from; k < Math.min(rows.size(), from + count); k++) {
            double[] w = rows.get(k);
            out.append(String.format("%d: %.3g Ом, %.3g, %.4g В, %.4g Вт, %.4g Вт, %.4g А, %.4g А, %.4g А, %.0f°, %.0f, %.4g А, %.4g А%n",
                    k, w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7], w[8], w[9], w[10], w[11]));
        }
        String msg = out.toString();
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }
}
