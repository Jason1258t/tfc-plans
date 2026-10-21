package ee.extras.devtest;

import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.content.gauge.GaugeDevice;
import com.george_vi.electroenergetics.content.rotor.AlternatorBrushesDevice;
import com.george_vi.electroenergetics.content.rotor.AlternatorRotorBlockEntity;
import com.george_vi.electroenergetics.content.rotor.StatorBlock;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.simibubi.create.AllBlocks;
import com.simibubi.create.content.kinetics.motor.CreativeMotorBlockEntity;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;

/**
 * Проверка генератора EE для справочника: творческий мотор → два ротора по оси X (у первого 4 статора, у второго 2)
 * → обычный щёточный узел; /rectest genload — нагреватель и вольтметр на контакты узла.
 * /rectest genreport — обороты и нагрузка на вал у роторов, напряжение и выработка узла, показания вольтметра.
 */
final class Generator {
    static final BlockPos MOTOR = new BlockPos(20, -60, 0);
    static final BlockPos BRUSHES = MOTOR.offset(3, 0, 0);
    static final BlockPos HEATER = MOTOR.offset(3, 0, 4);
    static final BlockPos VOLTMETER = MOTOR.offset(5, 0, 4);

    static BlockPos rotor(int i) {
        return MOTOR.offset(1 + i, 0, 0);
    }

    static BlockState stator(Direction facing) {
        // Ось ротора у статора: «лицом» вверх/вниз с креном — X; лицом на север/юг с креном — X (getRotorAxis)
        return CEEBlocks.STATOR.getDefaultState().setValue(StatorBlock.FACING, facing).setValue(StatorBlock.ROLL, true);
    }

    static int build(CommandSourceStack src, int rpm) {
        ServerLevel level = src.getLevel();
        DevTest.place(level, MOTOR, AllBlocks.CREATIVE_MOTOR.getDefaultState().setValue(BlockStateProperties.FACING, Direction.EAST));
        for (int i = 0; i < 2; i++)
            DevTest.place(level, rotor(i), CEEBlocks.ALTERNATOR_ROTOR.getDefaultState().setValue(BlockStateProperties.AXIS, Direction.Axis.X));
        // Ротор 0: все четыре статора; ротор 1: сверху и снизу
        DevTest.place(level, rotor(0).above(), stator(Direction.DOWN));
        DevTest.place(level, rotor(0).below(), stator(Direction.UP));
        DevTest.place(level, rotor(0).north(), stator(Direction.SOUTH));
        DevTest.place(level, rotor(0).south(), stator(Direction.NORTH));
        DevTest.place(level, rotor(1).above(), stator(Direction.DOWN));
        DevTest.place(level, rotor(1).below(), stator(Direction.UP));
        DevTest.place(level, BRUSHES, CEEBlocks.ALTERNATOR_BRUSHES.getDefaultState().setValue(BlockStateProperties.FACING, Direction.EAST));
        if (level.getBlockEntity(MOTOR) instanceof CreativeMotorBlockEntity m) m.generatedSpeed.setValue(rpm);
        src.sendSuccess(() -> Component.literal("генератор собран, мотор " + rpm + " об/мин"), false);
        return 1;
    }

    static int load(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        DevTest.place(level, HEATER, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
        DevTest.place(level, VOLTMETER, CEEBlocks.VOLTMETER.getDefaultState());
        DevTest.wire(level, BRUSHES, 0, HEATER, 0);
        DevTest.wire(level, BRUSHES, 1, HEATER, 1);
        DevTest.wire(level, BRUSHES, 0, VOLTMETER, 0);
        DevTest.wire(level, BRUSHES, 1, VOLTMETER, 1);
        src.sendSuccess(() -> Component.literal("нагрузка подключена"), false);
        return 1;
    }

    /** Ещё n нагревателей параллельно — перегрузка генератора (ток больше rotorFullLoadCurrent) */
    static int parallel(CommandSourceStack src, int n) {
        ServerLevel level = src.getLevel();
        for (int i = 0; i < n; i++) {
            BlockPos h = HEATER.offset(0, 0, 2 + i);
            DevTest.place(level, h, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
            DevTest.wire(level, BRUSHES, 0, h, 0);
            DevTest.wire(level, BRUSHES, 1, h, 1);
        }
        src.sendSuccess(() -> Component.literal("ещё нагревателей: " + n), false);
        return 1;
    }

    /** Короткое замыкание: провод между контактами нагревателя (через провода к узлу) */
    static int shortWire(CommandSourceStack src) {
        DevTest.wire(src.getLevel(), HEATER, 0, HEATER, 1);
        src.sendSuccess(() -> Component.literal("замкнуто"), false);
        return 1;
    }

    static int report(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < 2; i++) {
            if (level.getBlockEntity(rotor(i)) instanceof AlternatorRotorBlockEntity r)
                out.append(String.format("ротор %d: %.1f об/мин, нагрузка %.3f SU на 1 об/мин | ", i, r.getSpeed(), r.calculateStressApplied()));
            else out.append("ротор ").append(i).append(": нет | ");
        }
        DevicesSavedData devices = DevicesSavedData.load(level);
        AlternatorBrushesDevice b = devices.getDevice(BRUSHES, AlternatorBrushesDevice.class);
        out.append(b == null ? "узла нет" : String.format("узел: ЭДС %.2f В, выработка %.1f Вт, запас %.1f Дж", b.voltage, b.stress, b.storedEnergy));
        GaugeDevice g = devices.getDevice(VOLTMETER, GaugeDevice.class);
        if (g != null) out.append(String.format(" | вольтметр %.2f В", g.rmsVoltages.get()));
        String msg = out.toString();
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }
}
