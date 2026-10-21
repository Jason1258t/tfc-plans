package ee.extras.devtest;

import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.CEEWireTypes;
import com.george_vi.electroenergetics.content.creative_battery.CreativeBatteryBlock;
import com.george_vi.electroenergetics.content.creative_battery.CreativeBatteryDevice;
import com.george_vi.electroenergetics.content.gauge.GaugeDevice;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.foundation.device.ElectricalDeviceBlock;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.simulation.infrastructure.InfrastructureSavedData;
import com.mojang.brigadier.CommandDispatcher;
import ee.extras.EeExtras;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

/**
 * Проверка выпрямителей в настоящей симуляции EE (test-server.sh):
 *   /rectest build  — три творческие батареи переменного тока звездой (фазы 0°/120°/240°) → трёхфазный выпрямитель →
 *                     нагреватель EE и вольтметр; одна батарея (фаза и нейтраль) → однофазный выпрямитель → то же
 *   /rectest power <вольт>  — включить батареи (переменный ток, сдвиги фаз)
 *   /rectest report — показания вольтметров на выходах
 * Провода протягиваются через InfrastructureSavedData.connect — тот же путь, что у катушки провода в руках игрока.
 */
@Mod("ee_extras_devtest")
public class DevTest {
    static final BlockPos THREE = new BlockPos(0, -60, 10);
    static final BlockPos SINGLE = new BlockPos(0, -60, 20);

    public DevTest() {
        NeoForge.EVENT_BUS.addListener(DevTest::commands);
    }

    static void commands(RegisterCommandsEvent e) {
        CommandDispatcher<CommandSourceStack> d = e.getDispatcher();
        d.register(Commands.literal("rectest")
                .then(Commands.literal("build").executes(c -> build(c.getSource())))
                .then(Commands.literal("power")
                        .then(Commands.argument("volts", com.mojang.brigadier.arguments.DoubleArgumentType.doubleArg(0))
                                .executes(c -> power(c.getSource(),
                                        com.mojang.brigadier.arguments.DoubleArgumentType.getDouble(c, "volts")))))
                .then(Commands.literal("report").executes(c -> report(c.getSource())))
                .then(Commands.literal("gen")
                        .then(Commands.argument("rpm", com.mojang.brigadier.arguments.IntegerArgumentType.integer(1, 256))
                                .executes(c -> Generator.build(c.getSource(),
                                        com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(c, "rpm")))))
                .then(Commands.literal("genload").executes(c -> Generator.load(c.getSource())))
                .then(Commands.literal("genshort").then(Commands.argument("heaters", com.mojang.brigadier.arguments.IntegerArgumentType.integer(1, 64))
                        .executes(c -> Generator.parallel(c.getSource(), com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(c, "heaters")))))
                .then(Commands.literal("genshortwire").executes(c -> Generator.shortWire(c.getSource())))
                .then(Commands.literal("ac")
                        .then(Commands.argument("rpm", com.mojang.brigadier.arguments.IntegerArgumentType.integer(1, 256))
                                .executes(c -> AcTest.build(c.getSource(),
                                        com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(c, "rpm")))))
                .then(Commands.literal("acwatch")
                        .then(Commands.argument("ticks", com.mojang.brigadier.arguments.IntegerArgumentType.integer(1, 2000))
                                .executes(c -> AcTest.watch(c.getSource(),
                                        com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(c, "ticks")))))
                .then(Commands.literal("acrpm")
                        .then(Commands.argument("rpm", com.mojang.brigadier.arguments.IntegerArgumentType.integer(1, 256))
                                .executes(c -> AcTest.rpm(c.getSource(),
                                        com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(c, "rpm")))))
                .then(Commands.literal("acshort")
                        .then(Commands.argument("i", com.mojang.brigadier.arguments.IntegerArgumentType.integer(0, 2))
                                .executes(c -> AcTest.shortOut(c.getSource(),
                                        com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(c, "i")))))
                .then(Commands.literal("acload")
                        .then(Commands.argument("n", com.mojang.brigadier.arguments.IntegerArgumentType.integer(1, 64))
                                .executes(c -> AcTest.moreLoad(c.getSource(),
                                        com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(c, "n")))))
                .then(Commands.literal("acreport").executes(c -> AcTest.report(c.getSource())))
                .then(Commands.literal("small")
                        .then(Commands.argument("rpm", com.mojang.brigadier.arguments.IntegerArgumentType.integer(1, 256))
                                .executes(c -> SmallLoad.build(c.getSource(),
                                        com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(c, "rpm")))))
                .then(Commands.literal("smallpar").executes(c -> SmallLoad.parallel(c.getSource())))
                .then(Commands.literal("smallwatch")
                        .then(Commands.argument("ticks", com.mojang.brigadier.arguments.IntegerArgumentType.integer(1, 2000))
                                .executes(c -> SmallLoad.watch(c.getSource(),
                                        com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(c, "ticks")))))
                .then(Commands.literal("smallreport")
                        .then(Commands.argument("from", com.mojang.brigadier.arguments.IntegerArgumentType.integer(0))
                                .then(Commands.argument("count", com.mojang.brigadier.arguments.IntegerArgumentType.integer(1, 100))
                                        .executes(c -> SmallLoad.report(c.getSource(),
                                                com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(c, "from"),
                                                com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(c, "count"))))))
                .then(Commands.literal("genreport").executes(c -> Generator.report(c.getSource())))
                .then(Commands.literal("bidi").executes(c -> Extras.bidi(c.getSource())))
                .then(Commands.literal("bidipower")
                        .then(Commands.argument("battery", com.mojang.brigadier.arguments.DoubleArgumentType.doubleArg(0))
                                .then(Commands.argument("out", com.mojang.brigadier.arguments.DoubleArgumentType.doubleArg(0))
                                        .executes(c -> Extras.bidiPower(c.getSource(),
                                                com.mojang.brigadier.arguments.DoubleArgumentType.getDouble(c, "battery"),
                                                com.mojang.brigadier.arguments.DoubleArgumentType.getDouble(c, "out"))))))
                .then(Commands.literal("bidireport").executes(c -> Extras.bidiReport(c.getSource())))
                .then(Commands.literal("bidiside")
                        .then(Commands.argument("dir", com.mojang.brigadier.arguments.StringArgumentType.word())
                                .then(Commands.argument("mode", com.mojang.brigadier.arguments.StringArgumentType.word())
                                        .executes(c -> Extras.bidiSide(c.getSource(),
                                                com.mojang.brigadier.arguments.StringArgumentType.getString(c, "dir"),
                                                com.mojang.brigadier.arguments.StringArgumentType.getString(c, "mode"))))))
                .then(Commands.literal("cables").executes(c -> Extras.cables(c.getSource())))
                .then(Commands.literal("cablepower")
                        .then(Commands.argument("volts", com.mojang.brigadier.arguments.DoubleArgumentType.doubleArg(0))
                                .executes(c -> Extras.cablePower(c.getSource(),
                                        com.mojang.brigadier.arguments.DoubleArgumentType.getDouble(c, "volts")))))
                .then(Commands.literal("cablereport").executes(c -> Extras.cableReport(c.getSource())))
                .then(Commands.literal("cablecut").executes(c -> Extras.cableCut(c.getSource())))
                .then(Commands.literal("phase").executes(c -> Extras.phase(c.getSource())))
                .then(Commands.literal("orient").executes(c -> Orient.run(c.getSource())))
                .then(Commands.literal("orientreport").executes(c -> Orient.report(c.getSource()))));
    }

    static BlockPos battery(BlockPos base, int i) {
        return base.offset(i * 2, 0, 0);
    }

    static BlockPos rectifier(BlockPos base) {
        return base.offset(2, 0, 3);
    }

    static BlockPos heater(BlockPos base) {
        return base.offset(0, 0, 6);
    }

    static BlockPos voltmeter(BlockPos base) {
        return base.offset(4, 0, 6);
    }

    static void place(ServerLevel level, BlockPos pos, BlockState state) {
        level.setBlock(pos, state, Block.UPDATE_ALL);
    }

    static void wire(ServerLevel level, BlockPos a, int na, BlockPos b, int nb) {
        // Узлы контактов EE регистрирует лениво — как при наведении катушки, сначала убеждаемся, что они есть
        for (BlockPos p : new BlockPos[] {a, b}) {
            BlockState st = level.getBlockState(p);
            if (st.getBlock() instanceof ElectricalDeviceBlock<?> eb) eb.ensureNodesExist(level, p, st);
        }
        InfrastructureSavedData.load(level).connect(new InWorldNode(na, a), new InWorldNode(nb, b), CEEWireTypes.COPPER.get());
    }

    static int build(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        BlockState ac = CEEBlocks.CREATIVE_BATTERY.getDefaultState().setValue(CreativeBatteryBlock.AC, true);
        for (BlockPos base : new BlockPos[] {THREE, SINGLE}) {
            boolean three = base == THREE;
            int phases = three ? 3 : 1;
            for (int i = 0; i < phases; i++) place(level, battery(base, i), ac);
            place(level, rectifier(base), (three ? EeExtras.THREE_PHASE : EeExtras.SINGLE_PHASE).block.get().defaultBlockState());
            place(level, heater(base), CEEBlocks.RESISTIVE_HEATER.getDefaultState());
            place(level, voltmeter(base), CEEBlocks.VOLTMETER.getDefaultState());
        }
        // Трёхфазный: контакт 0 батареи — фаза на вход выпрямителя, контакты 1 — общая нейтраль (звезда, к выпрямителю
        // не идёт); выход: «+» (3) и «−» (4) на нагреватель и вольтметр
        for (int i = 0; i < 3; i++) wire(level, battery(THREE, i), 0, rectifier(THREE), i);
        wire(level, battery(THREE, 0), 1, battery(THREE, 1), 1);
        wire(level, battery(THREE, 1), 1, battery(THREE, 2), 1);
        output(level, THREE, 3, 4);
        // Однофазный: фаза (0) и нейтраль (1) батареи на входы 0 и 1; выход «+» (2), «−» (3)
        wire(level, battery(SINGLE, 0), 0, rectifier(SINGLE), 0);
        wire(level, battery(SINGLE, 0), 1, rectifier(SINGLE), 1);
        output(level, SINGLE, 2, 3);
        src.sendSuccess(() -> Component.literal("собрано"), false);
        return 1;
    }

    static void output(ServerLevel level, BlockPos base, int plus, int minus) {
        wire(level, rectifier(base), plus, heater(base), 0);
        wire(level, rectifier(base), minus, heater(base), 1);
        wire(level, rectifier(base), plus, voltmeter(base), 0);
        wire(level, rectifier(base), minus, voltmeter(base), 1);
    }

    static int power(CommandSourceStack src, double volts) {
        DevicesSavedData devices = DevicesSavedData.load(src.getLevel());
        StringBuilder out = new StringBuilder();
        for (BlockPos base : new BlockPos[] {THREE, SINGLE}) {
            int phases = base == THREE ? 3 : 1;
            for (int i = 0; i < phases; i++) {
                CreativeBatteryDevice b = devices.getDevice(battery(base, i), CreativeBatteryDevice.class);
                if (b == null) {
                    out.append("нет батареи ").append(battery(base, i)).append("; ");
                    continue;
                }
                b.voltage = volts;
                b.acFrequency = 1;
                b.phaseOffset = 120f * i;
            }
        }
        String msg = out.length() == 0 ? "батареи включены: " + volts + " В" : out.toString();
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    static int report(CommandSourceStack src) {
        DevicesSavedData devices = DevicesSavedData.load(src.getLevel());
        StringBuilder out = new StringBuilder();
        for (BlockPos base : new BlockPos[] {THREE, SINGLE}) {
            GaugeDevice g = devices.getDevice(voltmeter(base), GaugeDevice.class);
            CreativeBatteryDevice b = devices.getDevice(battery(base, 0), CreativeBatteryDevice.class);
            out.append(base == THREE ? "трёхфазный" : "однофазный")
                    .append(": на выходе ")
                    .append(g == null ? "нет вольтметра" : String.format("%.2f В (со знаком %.2f)", g.rmsVoltages.get(), g.rmsVoltages.getSigned()))
                    .append(b == null ? "" : String.format("; батарея %.1f В, частота %.1f", b.voltage, b.acFrequency))
                    .append(" | ");
        }
        String msg = out.toString();
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }
}
