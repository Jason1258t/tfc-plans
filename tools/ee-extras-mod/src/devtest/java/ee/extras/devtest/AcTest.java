package ee.extras.devtest;

import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.content.gauge.GaugeDevice;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.foundation.RMSHolder;
import com.simibubi.create.AllBlocks;
import com.simibubi.create.content.kinetics.motor.CreativeMotorBlockEntity;
import ee.extras.EeExtras;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/**
 * Выпрямители на настоящем трёхфазном генераторе (жалоба «значение нестабильно»): творческий мотор → ротор с 4
 * статорами → трёхфазный щёточный узел → три схемы на одних фазах:
 *   A — трёхфазный выпрямитель (блок аддона), B — однофазный (фаза 1 и нейтраль), C — мост из шести диодов EE.
 * На выходе каждой — нагреватель и вольтметр. /rectest ac <об/мин> — собрать; /rectest acwatch <тиков> — писать
 * последнее мгновенное напряжение вольтметров каждый тик; /rectest acreport — показать записанное.
 */
final class AcTest {
    static final BlockPos MOTOR = new BlockPos(40, -60, 0);
    static final BlockPos ROTOR = MOTOR.east();
    static final BlockPos BRUSHES = MOTOR.east(2);
    static final BlockPos[] RECT = {new BlockPos(40, -60, 6), new BlockPos(48, -60, 6), new BlockPos(56, -60, 6)};
    /** Частотомер EE на фазе 1 и нейтрали — проверка жалобы «частотомер врёт» */
    static final BlockPos FREQ = BRUSHES.offset(0, 0, -3);
    static final String[] NAMES = {"трёхфазный блок", "однофазный блок", "мост из 6 диодов EE"};

    static BlockPos heater(int i) {
        return RECT[i].offset(0, 0, 4);
    }

    static BlockPos meter(int i) {
        return RECT[i].offset(3, 0, 4);
    }

    static BlockState stator(Direction facing) {
        return CEEBlocks.STATOR.getDefaultState()
                .setValue(com.george_vi.electroenergetics.content.rotor.StatorBlock.FACING, facing)
                .setValue(com.george_vi.electroenergetics.content.rotor.StatorBlock.ROLL, true);
    }

    static int build(CommandSourceStack src, int rpm) {
        ServerLevel level = src.getLevel();
        DevTest.place(level, MOTOR, AllBlocks.CREATIVE_MOTOR.getDefaultState().setValue(BlockStateProperties.FACING, Direction.EAST));
        DevTest.place(level, ROTOR, CEEBlocks.ALTERNATOR_ROTOR.getDefaultState().setValue(BlockStateProperties.AXIS, Direction.Axis.X));
        DevTest.place(level, ROTOR.above(), stator(Direction.DOWN));
        DevTest.place(level, ROTOR.below(), stator(Direction.UP));
        DevTest.place(level, ROTOR.north(), stator(Direction.SOUTH));
        DevTest.place(level, ROTOR.south(), stator(Direction.NORTH));
        DevTest.place(level, BRUSHES, CEEBlocks.THREE_PHASE_ALTERNATOR_BRUSHES.getDefaultState().setValue(BlockStateProperties.FACING, Direction.EAST));
        if (level.getBlockEntity(MOTOR) instanceof CreativeMotorBlockEntity m) m.generatedSpeed.setValue(rpm);

        // A: трёхфазный блок — фазы узла (контакты 1–3) на входы 0–2, выход 3 (+) / 4 (−)
        DevTest.place(level, RECT[0], EeExtras.THREE_PHASE.block.get().defaultBlockState());
        for (int i = 0; i < 3; i++) DevTest.wire(level, BRUSHES, 1 + i, RECT[0], i);
        load(level, 0, RECT[0], 3, RECT[0], 4);
        // B: однофазный — фаза 1 и нейтраль (0) на входы 0 и 1, выход 2 / 3
        DevTest.place(level, RECT[1], EeExtras.SINGLE_PHASE.block.get().defaultBlockState());
        DevTest.wire(level, BRUSHES, 1, RECT[1], 0);
        DevTest.wire(level, BRUSHES, 0, RECT[1], 1);
        load(level, 1, RECT[1], 2, RECT[1], 3);
        // C: шесть диодов EE (контакт 0 — катод, 1 — анод, как в блоке диода): по паре на фазу, шины «+» и «−» —
        // катоды верхних и аноды нижних диодов
        BlockPos[] up = new BlockPos[3];
        BlockPos[] down = new BlockPos[3];
        for (int i = 0; i < 3; i++) {
            up[i] = RECT[2].offset(i * 2, 0, 0);
            down[i] = RECT[2].offset(i * 2, 0, 2);
            DevTest.place(level, up[i], CEEBlocks.DIODE.getDefaultState());
            DevTest.place(level, down[i], CEEBlocks.DIODE.getDefaultState());
            DevTest.wire(level, BRUSHES, 1 + i, up[i], 1); // фаза → анод верхнего
            DevTest.wire(level, BRUSHES, 1 + i, down[i], 0); // фаза → катод нижнего
            if (i > 0) {
                DevTest.wire(level, up[0], 0, up[i], 0); // шина «+»
                DevTest.wire(level, down[0], 1, down[i], 1); // шина «−»
            }
        }
        load(level, 2, up[0], 0, down[0], 1);
        DevTest.place(level, FREQ, CEEBlocks.FREQUENCY_METER.getDefaultState());
        DevTest.wire(level, BRUSHES, 1, FREQ, 0);
        DevTest.wire(level, BRUSHES, 0, FREQ, 1);
        src.sendSuccess(() -> Component.literal("собрано, мотор " + rpm + " об/мин"), false);
        return 1;
    }

    static int rpm(CommandSourceStack src, int rpm) {
        if (src.getLevel().getBlockEntity(MOTOR) instanceof CreativeMotorBlockEntity m) m.generatedSpeed.setValue(rpm);
        src.sendSuccess(() -> Component.literal("мотор " + rpm + " об/мин"), false);
        return 1;
    }

    /** Короткое замыкание выхода схемы i: провод между контактами её нагревателя */
    static int shortOut(CommandSourceStack src, int i) {
        DevTest.wire(src.getLevel(), heater(i), 0, heater(i), 1);
        src.sendSuccess(() -> Component.literal("выход " + i + " замкнут"), false);
        return 1;
    }

    /** Ещё n нагревателей параллельно на выход схемы 0 (перегрузка) */
    static int moreLoad(CommandSourceStack src, int n) {
        ServerLevel level = src.getLevel();
        for (int k = 0; k < n; k++) {
            BlockPos h = heater(0).offset(-2 - k % 8, 0, 2 + k / 8);
            DevTest.place(level, h, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
            DevTest.wire(level, heater(0), 0, h, 0);
            DevTest.wire(level, heater(0), 1, h, 1);
        }
        src.sendSuccess(() -> Component.literal("нагревателей ещё " + n), false);
        return 1;
    }

    static void load(ServerLevel level, int i, BlockPos plus, int np, BlockPos minus, int nm) {
        DevTest.place(level, heater(i), CEEBlocks.RESISTIVE_HEATER.getDefaultState());
        DevTest.place(level, meter(i), CEEBlocks.VOLTMETER.getDefaultState());
        DevTest.wire(level, plus, np, heater(i), 0);
        DevTest.wire(level, minus, nm, heater(i), 1);
        DevTest.wire(level, plus, np, meter(i), 0);
        DevTest.wire(level, minus, nm, meter(i), 1);
    }

    static final List<double[]> samples = new ArrayList<>();
    static int left;
    static boolean listening;

    /** Последнее мгновенное значение вольтметра — из окна RMSHolder (там хранятся сами отсчёты) */
    static double last(GaugeDevice g) {
        try {
            RMSHolder h = g.rmsVoltages;
            Field values = RMSHolder.class.getDeclaredField("values");
            Field pointer = RMSHolder.class.getDeclaredField("pointer");
            values.setAccessible(true);
            pointer.setAccessible(true);
            double[] v = (double[]) values.get(h);
            int p = pointer.getInt(h);
            return v[(p - 1 + v.length) % v.length];
        } catch (ReflectiveOperationException e) {
            return Double.NaN;
        }
    }

    /** Показание частотомера (поле блока, его же видно в очках) */
    static double frequency(ServerLevel level) {
        try {
            Object be = level.getBlockEntity(FREQ);
            if (be == null) return Double.NaN;
            Field f = be.getClass().getDeclaredField("frequency");
            f.setAccessible(true);
            return f.getFloat(be);
        } catch (ReflectiveOperationException e) {
            return Double.NaN;
        }
    }

    static int watch(CommandSourceStack src, int ticks) {
        samples.clear();
        left = ticks;
        ServerLevel level = src.getLevel();
        if (!listening) {
            listening = true;
            NeoForge.EVENT_BUS.addListener((ServerTickEvent.Post e) -> {
                if (left <= 0) return;
                left--;
                DevicesSavedData d = DevicesSavedData.load(level);
                double[] row = new double[7];
                row[6] = frequency(level);
                for (int i = 0; i < 3; i++) {
                    GaugeDevice g = d.getDevice(meter(i), GaugeDevice.class);
                    row[i * 2] = g == null ? Double.NaN : last(g);
                    row[i * 2 + 1] = g == null ? Double.NaN : g.rmsVoltages.get();
                }
                samples.add(row);
            });
        }
        src.sendSuccess(() -> Component.literal("пишу " + ticks + " тиков"), false);
        return 1;
    }

    static int report(CommandSourceStack src) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < 3; i++) {
            double min = Double.MAX_VALUE, max = -Double.MAX_VALUE, sum = 0, rmin = Double.MAX_VALUE, rmax = -Double.MAX_VALUE;
            StringBuilder seq = new StringBuilder();
            for (int k = 0; k < samples.size(); k++) {
                double v = samples.get(k)[i * 2], r = samples.get(k)[i * 2 + 1];
                min = Math.min(min, v);
                max = Math.max(max, v);
                rmin = Math.min(rmin, r);
                rmax = Math.max(rmax, r);
                sum += v;
                if (k < 20) seq.append(String.format("%.0f ", v));
            }
            out.append(String.format("%s: мгновенное %.1f…%.1f (среднее %.1f), вольтметр %.1f…%.1f; первые тики: %s| ",
                    NAMES[i], min, max, sum / Math.max(1, samples.size()), rmin, rmax, seq));
        }
        double fmin = Double.MAX_VALUE, fmax = -Double.MAX_VALUE;
        for (double[] row : samples) {
            fmin = Math.min(fmin, row[6]);
            fmax = Math.max(fmax, row[6]);
        }
        out.append(String.format("частотомер: %.2f…%.2f Гц", fmin, fmax));
        String msg = out.toString();
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }
}
