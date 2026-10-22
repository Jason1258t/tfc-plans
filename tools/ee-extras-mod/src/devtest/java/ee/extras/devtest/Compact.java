package ee.extras.devtest;

import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.simibubi.create.AllBlocks;
import com.simibubi.create.content.kinetics.base.KineticBlockEntity;
import com.simibubi.create.content.kinetics.motor.CreativeMotorBlockEntity;
import ee.extras.EeExtras;
import ee.extras.generator.KineticGeneratorBlock;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;

/**
 * Компактный кинетический генератор (2.3):
 *   /rectest kgen <об/мин> <нагревателей> — творческий мотор → генератор (лицом вверх, вал снизу), на клеммах n
 *       нагревателей EE параллельно и вольтметр; второй генератор лицом на восток (вал с запада) от того же мотора
 *       через вал — проверка, что вал входит сзади в другом положении
 *   /rectest krpm <об/мин> — поменять обороты мотора; /rectest kreport — обороты, нагрузка сети вращения (SU),
 *       данные устройств (выработка, ЭДС, запас, температура), вольтметр
 */
final class Compact {
    static final BlockPos MOTOR = new BlockPos(160, -60, 0);
    static final BlockPos GEN = MOTOR.above();
    static final BlockPos MOTOR2 = MOTOR.offset(0, 0, 10);
    static final BlockPos GEN2 = MOTOR2.east();

    static int build(CommandSourceStack src, int rpm, int heaters) {
        ServerLevel level = src.getLevel();
        DevTest.place(level, MOTOR, AllBlocks.CREATIVE_MOTOR.getDefaultState().setValue(BlockStateProperties.FACING, Direction.UP));
        DevTest.place(level, GEN, EeExtras.KINETIC_GENERATOR.get().defaultBlockState().setValue(KineticGeneratorBlock.FACING, Direction.UP));
        DevTest.place(level, MOTOR2, AllBlocks.CREATIVE_MOTOR.getDefaultState().setValue(BlockStateProperties.FACING, Direction.EAST));
        DevTest.place(level, GEN2, EeExtras.KINETIC_GENERATOR.get().defaultBlockState().setValue(KineticGeneratorBlock.FACING, Direction.EAST));
        for (int i = 0; i < heaters; i++) {
            BlockPos h = MOTOR.offset(2 + i, 0, 2);
            DevTest.place(level, h, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
            DevTest.wire(level, GEN, 0, h, 0);
            DevTest.wire(level, GEN, 1, h, 1);
        }
        Power.meter(level, MOTOR.offset(0, 0, 4), GEN, 0, GEN, 1);
        Power.meter(level, MOTOR2.offset(0, 0, 3), GEN2, 0, GEN2, 1);
        speed(level, rpm);
        Power.WATCH.put("ген. вверх", GEN);
        Power.WATCH.put("ген. восток", GEN2);
        Power.WATCH.put("вольтм. вверх", MOTOR.offset(0, 0, 4));
        Power.WATCH.put("вольтм. восток", MOTOR2.offset(0, 0, 3));
        src.sendSuccess(() -> Component.literal("собрано: " + rpm + " об/мин, нагревателей " + heaters), false);
        return 1;
    }

    static void speed(ServerLevel level, int rpm) {
        for (BlockPos m : new BlockPos[] {MOTOR, MOTOR2})
            if (level.getBlockEntity(m) instanceof CreativeMotorBlockEntity be) be.generatedSpeed.setValue(rpm);
    }

    static int rpm(CommandSourceStack src, int rpm) {
        speed(src.getLevel(), rpm);
        src.sendSuccess(() -> Component.literal("мотор " + rpm + " об/мин"), false);
        return 1;
    }

    static int report(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        StringBuilder out = new StringBuilder();
        for (BlockPos g : new BlockPos[] {GEN, GEN2}) {
            if (level.getBlockEntity(g) instanceof KineticBlockEntity be)
                out.append(String.format("%s: %.1f об/мин, нагрузка %.2f SU на 1 об/мин → %.0f SU, сеть %.0f/%.0f SU, перегруз %s%n",
                        g.toShortString(), be.getSpeed(), be.calculateStressApplied(),
                        be.calculateStressApplied() * Math.abs(be.getSpeed()), be.hasNetwork() ? be.getOrCreateNetwork().calculateStress() : 0,
                        be.hasNetwork() ? be.getOrCreateNetwork().calculateCapacity() : 0, be.isOverStressed()));
            else out.append(g.toShortString()).append(": нет блок-сущности\n");
        }
        DevicesSavedData devices = DevicesSavedData.load(level);
        for (var w : Power.WATCH.entrySet())
            out.append(Power.describe(w.getKey(), devices.getDevice(w.getValue()))).append('\n');
        String msg = out.toString();
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }
}
