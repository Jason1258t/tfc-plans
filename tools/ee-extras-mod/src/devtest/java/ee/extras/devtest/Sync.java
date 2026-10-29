package ee.extras.devtest;

import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.content.rotor.ThreePhaseAlternatorBrushesDevice;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDevice;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.simibubi.create.AllBlocks;
import com.simibubi.create.content.kinetics.motor.CreativeMotorBlockEntity;
import ee.extras.ac.AcBlocks;
import ee.extras.ac.FrequencyConverterBlockEntity;
import ee.extras.ac.SynchronizerBlock;
import ee.extras.ac.SynchronizerBlockEntity;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/**
 * Преобразователь частоты и синхронизатор (2.4) на настоящих генераторах EE (творческий мотор → ротор с 4 статорами →
 * трёхфазные щётки). Мир — с MICROTICKS=8, как на сервере сборки.
 *
 *   /rectest fc <об/мин> <тип>  — генератор → преобразователь (тип: light, heavy, industrial) трёхфазный (три
 *                                 нагревателя треугольником + частотомер EE) и однофазный лёгкий (нагреватель + частотомер)
 *   /rectest fchz <Гц>          — задать частоту обоим (как окном значения)
 *   /rectest fcpar              — второй трёхфазный преобразователь параллельно первому (вход тот же, выходы вместе)
 *   /rectest fcreport           — данные устройств и частотомеров
 *   /rectest sy <сеть> <ген>    — два генератора: «сеть» с тремя нагревателями, «ген» через синхронизатор;
 *                                 сигнал синхронизатора каждый тик передаётся щёткам «ген» (как провод красного камня)
 *   /rectest syrpm <a> <b>      — обороты моторов сети и генератора
 *   /rectest syreport           — синхронизатор, генераторы, момент включения (угол, бросок мощности)
 *   /rectest symode <auto|off>  — режим синхронизатора
 *   /rectest syfaces            — грани сигнала «быстрее/медленнее» во всех положениях блока
 */
final class Sync {
    static final BlockPos FC = new BlockPos(100, -60, 100);
    static final BlockPos SY = new BlockPos(100, -60, 140);

    static BlockPos fc3() {
        return FC.offset(0, 0, 5);
    }

    static BlockPos fc1() {
        return FC.offset(12, 0, 5);
    }

    static BlockPos fc3b() {
        return FC.offset(0, 0, 14);
    }

    static BlockPos fm3() {
        return FC.offset(8, 0, 9);
    }

    static BlockPos fm1() {
        return FC.offset(16, 0, 9);
    }

    static BlockPos gridMotor() {
        return SY;
    }

    static BlockPos genMotor() {
        return SY.offset(0, 0, 8);
    }

    static BlockPos sync() {
        return SY.offset(6, 0, 4);
    }

    static void register(CommandDispatcher<CommandSourceStack> d) {
        d.register(Commands.literal("rectest")
                .then(Commands.literal("fc").then(Commands.argument("rpm", IntegerArgumentType.integer(0, 256))
                        .then(Commands.argument("tier", StringArgumentType.word())
                                .executes(c -> fc(c.getSource(), IntegerArgumentType.getInteger(c, "rpm"),
                                        StringArgumentType.getString(c, "tier"))))))
                .then(Commands.literal("fchz").then(Commands.argument("hz", IntegerArgumentType.integer(1, 40))
                        .executes(c -> fcHz(c.getSource(), IntegerArgumentType.getInteger(c, "hz")))))
                .then(Commands.literal("fcpar").executes(c -> fcPar(c.getSource())))
                .then(Commands.literal("fcreport").executes(c -> fcReport(c.getSource())))
                .then(Commands.literal("fcorder").executes(c -> fcOrder(c.getSource())))
                .then(Commands.literal("fcrad").executes(c -> fcRad(c.getSource())))
                .then(Commands.literal("fcbreak").executes(c -> fcBreak(c.getSource())))
                .then(Commands.literal("sy").then(Commands.argument("grid", IntegerArgumentType.integer(0, 256))
                        .then(Commands.argument("gen", IntegerArgumentType.integer(0, 256))
                                .executes(c -> sy(c.getSource(), IntegerArgumentType.getInteger(c, "grid"),
                                        IntegerArgumentType.getInteger(c, "gen"))))))
                .then(Commands.literal("syrpm").then(Commands.argument("grid", IntegerArgumentType.integer(0, 256))
                        .then(Commands.argument("gen", IntegerArgumentType.integer(0, 256))
                                .executes(c -> syRpm(c.getSource(), IntegerArgumentType.getInteger(c, "grid"),
                                        IntegerArgumentType.getInteger(c, "gen"))))))
                .then(Commands.literal("syreport").executes(c -> syReport(c.getSource())))
                .then(Commands.literal("symode").then(Commands.argument("mode", StringArgumentType.word())
                        .executes(c -> syMode(c.getSource(), StringArgumentType.getString(c, "mode")))))
                .then(Commands.literal("syfaces").executes(c -> syFaces(c.getSource()))));
    }

    /** Генератор: мотор → ротор (4 статора) → трёхфазные щётки на восток; щётки — motor.east(2) */
    static BlockPos generator(ServerLevel level, BlockPos motor, int rpm) {
        BlockPos rotor = motor.east(), brushes = motor.east(2);
        DevTest.place(level, motor, AllBlocks.CREATIVE_MOTOR.getDefaultState().setValue(BlockStateProperties.FACING, Direction.EAST));
        DevTest.place(level, rotor, CEEBlocks.ALTERNATOR_ROTOR.getDefaultState().setValue(BlockStateProperties.AXIS, Direction.Axis.X));
        DevTest.place(level, rotor.above(), AcTest.stator(Direction.DOWN));
        DevTest.place(level, rotor.below(), AcTest.stator(Direction.UP));
        DevTest.place(level, rotor.north(), AcTest.stator(Direction.SOUTH));
        DevTest.place(level, rotor.south(), AcTest.stator(Direction.NORTH));
        DevTest.place(level, brushes, CEEBlocks.THREE_PHASE_ALTERNATOR_BRUSHES.getDefaultState().setValue(BlockStateProperties.FACING, Direction.EAST));
        setRpm(level, motor, rpm);
        return brushes;
    }

    static void setRpm(ServerLevel level, BlockPos motor, int rpm) {
        if (level.getBlockEntity(motor) instanceof CreativeMotorBlockEntity m) m.generatedSpeed.setValue(rpm);
    }

    static BlockState up(Block b) {
        return b.defaultBlockState();
    }

    static AcBlocks.Kind kind(List<AcBlocks.Kind> kinds, String tier, boolean three) {
        for (AcBlocks.Kind k : kinds)
            if (k.tier.name().equalsIgnoreCase(tier) && (k.layout.inputs() == 3) == three) return k;
        return null;
    }

    /** Промышленный ставится в два блока: верх — устройство, низ — подставка */
    static void placeKind(ServerLevel level, AcBlocks.Kind k, BlockPos pos) {
        if (k.base != null) {
            DevTest.place(level, pos.below(), k.base.get().defaultBlockState());
        }
        DevTest.place(level, pos, k.block.get().defaultBlockState());
    }

    static int fc(CommandSourceStack src, int rpm, String tier) {
        ServerLevel level = src.getLevel();
        BlockPos brushes = generator(level, FC, rpm);
        AcBlocks.Kind k3 = kind(AcBlocks.CONVERTERS, tier, true), k1 = kind(AcBlocks.CONVERTERS, "light", false);
        if (k3 == null) {
            src.sendFailure(Component.literal("нет ступени " + tier));
            return 0;
        }
        BlockPos at3 = k3.base != null ? fc3().above() : fc3();
        placeKind(level, k3, at3);
        for (int i = 0; i < 3; i++) DevTest.wire(level, brushes, 1 + i, at3, i);
        for (int i = 0; i < 3; i++) {
            BlockPos h = FC.offset(i * 2, 0, 9);
            DevTest.place(level, h, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
            DevTest.wire(level, at3, 3 + i, h, 0);
            DevTest.wire(level, at3, 3 + (i + 1) % 3, h, 1);
        }
        DevTest.place(level, fm3(), CEEBlocks.FREQUENCY_METER.getDefaultState());
        DevTest.wire(level, at3, 3, fm3(), 0);
        DevTest.wire(level, at3, 4, fm3(), 1);

        placeKind(level, k1, fc1());
        DevTest.wire(level, brushes, 1, fc1(), 0);
        DevTest.wire(level, brushes, 0, fc1(), 1);
        BlockPos h1 = fc1().offset(0, 0, 4);
        DevTest.place(level, h1, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
        DevTest.wire(level, fc1(), 2, h1, 0);
        DevTest.wire(level, fc1(), 3, h1, 1);
        DevTest.place(level, fm1(), CEEBlocks.FREQUENCY_METER.getDefaultState());
        DevTest.wire(level, fc1(), 2, fm1(), 0);
        DevTest.wire(level, fc1(), 3, fm1(), 1);
        fc3pos = at3;
        src.sendSuccess(() -> Component.literal("собрано: генератор " + rpm + " об/мин (" + rpm * 0.15625 + " Гц), "
                + k3.id() + " и " + k1.id()), false);
        return 1;
    }

    static BlockPos fc3pos = fc3();

    static int fcHz(CommandSourceStack src, int hz) {
        ServerLevel level = src.getLevel();
        for (BlockPos p : new BlockPos[] {fc3pos, fc1(), fc3b()})
            if (level.getBlockEntity(p) instanceof FrequencyConverterBlockEntity be) setScroll(be, "frequency", hz);
        src.sendSuccess(() -> Component.literal("частота " + hz + " Гц"), false);
        return 1;
    }

    /** Значение окна Create — тем же путём, что у игрока (setValue вызывает обратный вызов) */
    static void setScroll(Object be, String field, int value) {
        try {
            Field f = be.getClass().getDeclaredField(field);
            f.setAccessible(true);
            Object behaviour = f.get(be);
            behaviour.getClass().getMethod("setValue", int.class).invoke(behaviour, value);
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }

    static int fcPar(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        BlockPos brushes = FC.east(2);
        DevTest.place(level, fc3b(), AcBlocks.CONVERTERS.get(1).block.get().defaultBlockState());
        for (int i = 0; i < 3; i++) DevTest.wire(level, brushes, 1 + i, fc3b(), i);
        for (int i = 0; i < 3; i++) DevTest.wire(level, fc3pos, 3 + i, fc3b(), 3 + i);
        src.sendSuccess(() -> Component.literal("второй преобразователь параллельно: " + fc3b()), false);
        return 1;
    }

    /** Радиаторные панели EE вокруг шкафа: по бокам ±X обеих половин (±Z заняты проводами — не трогаем) */
    static int fcRad(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        int n = 0;
        for (BlockPos half : new BlockPos[] {fc3pos, fc3pos.below()})
            for (Direction d : new Direction[] {Direction.EAST, Direction.WEST}) {
                BlockPos p = half.relative(d);
                if (!level.getBlockState(p).isAir()) continue;
                DevTest.place(level, p, CEEBlocks.RADIATOR_PANEL.getDefaultState()
                        .setValue(BlockStateProperties.FACING, d));
                n++;
            }
        int placed = n;
        src.sendSuccess(() -> Component.literal("радиаторов: " + placed), false);
        return 1;
    }

    /** Сломать нижнюю половину шкафа: верхняя (устройство EE) должна исчезнуть тоже */
    static int fcBreak(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        level.destroyBlock(fc3pos.below(), true);
        String top = level.getBlockState(fc3pos).getBlock().getDescriptionId();
        boolean device = DevicesSavedData.load(level).getDevice(fc3pos) != null;
        long drops = level.getEntitiesOfClass(net.minecraft.world.entity.item.ItemEntity.class,
                new net.minecraft.world.phys.AABB(fc3pos).inflate(3)).size();
        src.sendSuccess(() -> Component.literal("низ сломан: верх = " + top + ", устройство EE " + (device ? "осталось" : "убрано")
                + ", предметов выпало: " + drops), false);
        return 1;
    }

    static BlockPos order() {
        return FC.offset(20, 0, 5);
    }

    /** Синхронизатор (режим «Отключён»): генератор EE ↔ выход преобразователя — порядок фаз и разница частот */
    static int fcOrder(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        DevTest.place(level, order(), AcBlocks.SYNCHRONIZERS.get(1).block.get().defaultBlockState());
        for (int i = 0; i < 3; i++) {
            DevTest.wire(level, FC.east(2), 1 + i, order(), i);
            DevTest.wire(level, fc3pos, 3 + i, order(), 3 + i);
        }
        if (level.getBlockEntity(order()) instanceof SynchronizerBlockEntity be) setScroll(be, "modeOption", 1);
        src.sendSuccess(() -> Component.literal("синхронизатор-прибор: " + order()), false);
        return 1;
    }

    static String data(ServerLevel level, BlockPos pos, String... keys) {
        SimulatedDevice d = DevicesSavedData.load(level).getDevice(pos);
        if (d == null) return "нет устройства " + pos.toShortString();
        CompoundTag t = new CompoundTag();
        d.write(t);
        StringBuilder sb = new StringBuilder();
        for (String key : keys) {
            if (!t.contains(key)) continue;
            sb.append(key).append('=');
            if (t.get(key) instanceof net.minecraft.nbt.NumericTag n) sb.append(String.format("%.2f", n.getAsDouble()));
            else sb.append(t.getString(key));
            sb.append(' ');
        }
        return sb.toString();
    }

    static String fm(ServerLevel level, BlockPos pos) {
        return String.format("частотомер EE %.2f Гц", frequency(level, pos));
    }

    static double frequency(ServerLevel level, BlockPos pos) {
        try {
            Object be = level.getBlockEntity(pos);
            if (be == null) return Double.NaN;
            Field f = be.getClass().getDeclaredField("frequency");
            f.setAccessible(true);
            return f.getFloat(be);
        } catch (ReflectiveOperationException e) {
            return Double.NaN;
        }
    }

    static final String[] FC_KEYS = {"State", "SetHz", "OutHz", "InVolts", "Amplitude", "InputPower", "OutputPower",
            "Nominal", "Cooling", "Temp", "Stored", "ROut", "InputR", "OutVolts"};

    static int fcReport(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        String gen = data(level, FC.east(2), "RPM", "Voltage");
        String msg = "генератор: " + gen + "| трёхфазный: " + data(level, fc3pos, FC_KEYS) + fm(level, fm3())
                + " | однофазный: " + data(level, fc1(), FC_KEYS) + fm(level, fm1())
                + (DevicesSavedData.load(level).getDevice(fc3b()) != null ? " | второй: " + data(level, fc3b(), FC_KEYS) : "")
                + (DevicesSavedData.load(level).getDevice(order()) != null
                        ? " | ген ↔ выход: " + data(level, order(), "State", "PhaseOrder", "GenHz", "GridHz", "Angle") : "");
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    // --- синхронизатор ---

    static boolean linked;
    static final List<String> events = new ArrayList<>();
    static boolean wasClosed;
    static int sinceClose = -1;
    static double peak;
    static long tick;

    static int sy(CommandSourceStack src, int gridRpm, int genRpm) {
        ServerLevel level = src.getLevel();
        BlockPos g1 = generator(level, gridMotor(), gridRpm);
        BlockPos g2 = generator(level, genMotor(), genRpm);
        for (int i = 0; i < 3; i++) {
            BlockPos h = SY.offset(i * 2, 0, -4);
            DevTest.place(level, h, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
            DevTest.wire(level, g1, 1 + i, h, 0);
            DevTest.wire(level, g1, 1 + (i + 1) % 3, h, 1);
        }
        DevTest.place(level, sync(), AcBlocks.SYNCHRONIZERS.get(1).block.get().defaultBlockState());
        for (int i = 0; i < 3; i++) {
            DevTest.wire(level, g2, 1 + i, sync(), i);
            DevTest.wire(level, g1, 1 + i, sync(), 3 + i);
        }
        events.clear();
        wasClosed = false;
        sinceClose = -1;
        if (!linked) {
            linked = true;
            NeoForge.EVENT_BUS.addListener((ServerTickEvent.Post e) -> link(level));
        }
        src.sendSuccess(() -> Component.literal("собрано: сеть " + gridRpm + " об/мин, генератор " + genRpm + " об/мин"), false);
        return 1;
    }

    /** Каждый тик: сигнал синхронизатора → щётки генератора (fast/slow), запись момента включения */
    static void link(ServerLevel level) {
        tick++;
        DevicesSavedData d = DevicesSavedData.load(level);
        ThreePhaseAlternatorBrushesDevice brushes = d.getDevice(genMotor().east(2), ThreePhaseAlternatorBrushesDevice.class);
        if (!(level.getBlockEntity(sync()) instanceof SynchronizerBlockEntity be) || brushes == null) return;
        CompoundTag t = new CompoundTag();
        SimulatedDevice sy = d.getDevice(sync());
        if (sy == null) return;
        sy.write(t);
        int signal = t.getInt("Signal");
        brushes.fast = signal == 1;
        brushes.slow = signal == 2;
        boolean closed = t.getBoolean("Closed");
        if (closed && !wasClosed) {
            events.add(String.format("тик %d: включён (%s), угол до включения %.1f°, ген %.3f Гц, сеть %.3f Гц, подстройка %.2f об/мин",
                    tick, lastState, lastAngle, lastGen, lastGrid, brushes.controlModifier));
            sinceClose = 0;
            peak = 0;
        }
        if (!closed && wasClosed) events.add(String.format("тик %d: отключён — %s", tick, t.getString("State")));
        if (sinceClose >= 0 && sinceClose < 40) {
            peak = Math.max(peak, Math.abs(t.getDouble("Power")));
            if (++sinceClose == 40) events.add(String.format("за 2 с после включения бросок до %.0f Вт, теперь %.0f Вт", peak, t.getDouble("Power")));
        }
        wasClosed = closed;
        lastState = t.getString("State");
        lastAngle = t.getDouble("Angle");
        lastGen = t.getDouble("GenHz");
        lastGrid = t.getDouble("GridHz");
    }

    static String lastState = "";
    static double lastAngle, lastGen, lastGrid;

    static int syRpm(CommandSourceStack src, int gridRpm, int genRpm) {
        setRpm(src.getLevel(), gridMotor(), gridRpm);
        setRpm(src.getLevel(), genMotor(), genRpm);
        src.sendSuccess(() -> Component.literal("сеть " + gridRpm + ", генератор " + genRpm), false);
        return 1;
    }

    static int syMode(CommandSourceStack src, String mode) {
        if (src.getLevel().getBlockEntity(sync()) instanceof SynchronizerBlockEntity be)
            setScroll(be, "modeOption", "off".equals(mode) ? 1 : 0);
        src.sendSuccess(() -> Component.literal("режим " + mode), false);
        return 1;
    }

    static int syReport(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        ThreePhaseAlternatorBrushesDevice b = DevicesSavedData.load(level).getDevice(genMotor().east(2),
                ThreePhaseAlternatorBrushesDevice.class);
        String msg = "синхронизатор: " + data(level, sync(), "State", "Mode", "Closed", "GenHz", "GridHz", "GenVolts",
                "GridVolts", "Angle", "Signal", "Power", "Nominal", "Temp", "PhaseOrder")
                + "| ген. щётки: " + data(level, genMotor().east(2), "RPM", "Voltage", "ControlModifier")
                + (b != null ? String.format(" fast=%s slow=%s", b.fast, b.slow) : "")
                + " | сеть: " + data(level, gridMotor().east(2), "RPM", "Voltage")
                + " | события: " + String.join("; ", events);
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    /** Грань «быстрее» во всех 12 положениях (6 граней × крен): должна быть со стороны L3, перпендикулярно лицу */
    static int syFaces(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        SynchronizerBlock block = (SynchronizerBlock) AcBlocks.SYNCHRONIZERS.get(1).block.get();
        StringBuilder sb = new StringBuilder();
        BlockPos p = SY.offset(20, 5, 0);
        int bad = 0;
        for (Direction f : Direction.values()) {
            for (boolean roll : new boolean[] {false, true}) {
                BlockState st = block.defaultBlockState().setValue(SynchronizerBlock.FACING, f).setValue(SynchronizerBlock.ROLL, roll);
                DevTest.place(level, p, st);
                Direction fast = block.fasterFace(level, p, st);
                if (fast.getAxis() == f.getAxis()) bad++;
                sb.append(f.getName()).append(roll ? "/крен" : "").append("→").append(fast.getName()).append(' ');
            }
        }
        int b = bad;
        src.sendSuccess(() -> Component.literal("грань «быстрее»: " + sb + "| вдоль лица: " + b), false);
        return 1;
    }
}
