package aero.extra.devtest;

import aero.extra.AeroExtra;
import aero.extra.BatteryPack;
import aero.extra.ModuleItem;
import aero.extra.OnboardComputerBlock;
import aero.extra.OnboardComputerBlockEntity;
import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.CEEWireTypes;
import com.george_vi.electroenergetics.content.gauge.GaugeDevice;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.foundation.device.ElectricalDeviceBlock;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.simulation.infrastructure.InfrastructureSavedData;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.simibubi.create.AllBlocks;
import com.simibubi.create.content.kinetics.motor.CreativeMotorBlockEntity;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.phys.AABB;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

/**
 * Проверка бортового компьютера на сервере разработки. Стенды A, B — творческий мотор снизу, компьютер лицом вверх
 * (вал снизу); стенд E — мотор с запада, компьютер лицом на восток (вал входит сзади в другом положении).
 *   /aetest build <стенд 0–2> <об/мин> <генер.> <аккум.> <заряд %> <нагревателей> — собрать стенд: модули, нагреватели
 *       EE параллельно на клеммах и вольтметр
 *   /aetest rpm <стенд> <об/мин>; /aetest add <стенд> <генер.|аккум.: 0|1> — поставить ещё модуль
 *   /aetest pair — соединить клеммы стендов A и B проводами (заряд одного аккумулятора от другого)
 *   /aetest mark; /aetest report — обороты, нагрузка на вал и сеть вращения, модули, заряд (Кл и %), напряжение,
 *       отдача, выработка, вольтметр; после mark — изменение заряда против расчёта (выработка и отдача × время / U)
 *   /aetest remove <стенд> — вынуть последний модуль (что вынулось и с каким зарядом)
 *   /aetest break <стенд> — сломать блок и пересчитать выпавшее
 *   /aetest devices — все бортовые компьютеры по устройствам EE, где бы они ни стояли (после сборки корабля Sable
 *       блоки уезжают на участок подуровня): позиция, обороты, модули, заряд, напряжение, отдача, выработка
 */
@Mod("create_aeronautics_extra_devtest")
public class AeTest {
    static final BlockPos[] MOTOR = {new BlockPos(0, -60, 0), new BlockPos(12, -60, 0), new BlockPos(24, -60, 0)};
    static final String[] NAME = {"A", "B", "E"};
    static final Map<Integer, double[]> MARK = new LinkedHashMap<>();
    static long markTime;

    public AeTest() {
        NeoForge.EVENT_BUS.addListener(AeTest::commands);
    }

    static int i(CommandContext<CommandSourceStack> c, String n) {
        return IntegerArgumentType.getInteger(c, n);
    }

    static void commands(RegisterCommandsEvent e) {
        CommandDispatcher<CommandSourceStack> d = e.getDispatcher();
        d.register(Commands.literal("aetest")
                .then(Commands.literal("build").then(Commands.argument("s", IntegerArgumentType.integer(0, 2))
                        .then(Commands.argument("rpm", IntegerArgumentType.integer(0, 256))
                        .then(Commands.argument("g", IntegerArgumentType.integer(0, 8))
                        .then(Commands.argument("b", IntegerArgumentType.integer(0, 8))
                        .then(Commands.argument("pct", IntegerArgumentType.integer(0, 100))
                        .then(Commands.argument("h", IntegerArgumentType.integer(0, 16))
                        .executes(c -> build(c.getSource(), i(c, "s"), i(c, "rpm"), i(c, "g"), i(c, "b"), i(c, "pct"), i(c, "h"))))))))))
                .then(Commands.literal("rpm").then(Commands.argument("s", IntegerArgumentType.integer(0, 2))
                        .then(Commands.argument("rpm", IntegerArgumentType.integer(0, 256))
                        .executes(c -> rpm(c.getSource(), i(c, "s"), i(c, "rpm"))))))
                .then(Commands.literal("add").then(Commands.argument("s", IntegerArgumentType.integer(0, 2))
                        .then(Commands.argument("kind", IntegerArgumentType.integer(0, 1))
                        .executes(c -> add(c.getSource(), i(c, "s"), i(c, "kind"))))))
                .then(Commands.literal("pair").executes(c -> pair(c.getSource())))
                .then(Commands.literal("mark").executes(c -> mark(c.getSource())))
                .then(Commands.literal("report").executes(c -> report(c.getSource())))
                .then(Commands.literal("remove").then(Commands.argument("s", IntegerArgumentType.integer(0, 2))
                        .executes(c -> remove(c.getSource(), i(c, "s")))))
                .then(Commands.literal("devices").executes(c -> devices(c.getSource())))
                .then(Commands.literal("break").then(Commands.argument("s", IntegerArgumentType.integer(0, 2))
                        .executes(c -> breakIt(c.getSource(), i(c, "s"))))));
    }

    static BlockPos computer(int s) {
        return s == 2 ? MOTOR[s].east() : MOTOR[s].above();
    }

    static BlockPos meter(int s) {
        return MOTOR[s].offset(0, 0, 4);
    }

    static void place(ServerLevel level, BlockPos pos, BlockState state) {
        level.setBlock(pos, state, Block.UPDATE_ALL);
    }

    static void wire(ServerLevel level, BlockPos a, int na, BlockPos b, int nb) {
        for (BlockPos p : new BlockPos[] {a, b}) {
            BlockState st = level.getBlockState(p);
            if (st.getBlock() instanceof ElectricalDeviceBlock<?> eb) eb.ensureNodesExist(level, p, st);
        }
        InfrastructureSavedData.load(level).connect(new InWorldNode(na, a), new InWorldNode(nb, b), CEEWireTypes.COPPER.get());
    }

    static OnboardComputerBlockEntity be(ServerLevel level, int s) {
        return level.getBlockEntity(computer(s)) instanceof OnboardComputerBlockEntity be ? be : null;
    }

    static boolean use(ServerLevel level, int s, ItemStack stack) {
        return be(level, s).insert(stack);
    }

    static ItemStack removeLast(ServerLevel level, int s) {
        return be(level, s).removeLast();
    }

    static int build(CommandSourceStack src, int s, int rpm, int gens, int bats, int pct, int heaters) {
        ServerLevel level = src.getLevel();
        Direction facing = s == 2 ? Direction.EAST : Direction.UP;
        place(level, MOTOR[s], AllBlocks.CREATIVE_MOTOR.getDefaultState().setValue(BlockStateProperties.FACING, facing));
        place(level, computer(s), AeroExtra.ONBOARD_COMPUTER.get().defaultBlockState().setValue(OnboardComputerBlock.FACING, facing));
        double charge = BatteryPack.getNominalCharge() * pct / 100.0;
        for (int k = 0; k < gens; k++) use(level, s, new ItemStack(AeroExtra.GENERATOR_MODULE.get()));
        for (int k = 0; k < bats; k++) use(level, s, ModuleItem.battery(charge));
        for (int k = 0; k < heaters; k++) {
            BlockPos h = MOTOR[s].offset(2 + k % 4, 0, 2 + k / 4);
            place(level, h, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
            wire(level, computer(s), 0, h, 0);
            wire(level, computer(s), 1, h, 1);
        }
        place(level, meter(s), CEEBlocks.VOLTMETER.getDefaultState());
        wire(level, computer(s), 0, meter(s), 0);
        wire(level, computer(s), 1, meter(s), 1);
        speed(level, s, rpm);
        src.sendSuccess(() -> Component.literal(String.format("стенд %s: %d об/мин, генер. %d, аккум. %d по %d %%, нагревателей %d",
                NAME[s], rpm, gens, bats, pct, heaters)), false);
        return 1;
    }

    static void speed(ServerLevel level, int s, int rpm) {
        if (level.getBlockEntity(MOTOR[s]) instanceof CreativeMotorBlockEntity m) m.generatedSpeed.setValue(rpm);
    }

    static int rpm(CommandSourceStack src, int s, int rpm) {
        speed(src.getLevel(), s, rpm);
        src.sendSuccess(() -> Component.literal("стенд " + NAME[s] + ": мотор " + rpm + " об/мин"), false);
        return 1;
    }

    static int add(CommandSourceStack src, int s, int kind) {
        ServerLevel level = src.getLevel();
        OnboardComputerBlockEntity be = be(level, s);
        double before = be.hasNetwork() ? be.getOrCreateNetwork().calculateStress() : 0;
        boolean ok = use(level, s, kind == 0 ? new ItemStack(AeroExtra.GENERATOR_MODULE.get()) : ModuleItem.battery(0));
        double after = be.hasNetwork() ? be.getOrCreateNetwork().calculateStress() : 0;
        src.sendSuccess(() -> Component.literal(String.format("стенд %s: модуль %s, нагрузка сети %.0f → %.0f SU, модулей %d",
                NAME[s], ok ? "поставлен" : "НЕ поставлен", before, after, be.modules().total())), false);
        return 1;
    }

    static int pair(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        wire(level, computer(0), 0, computer(1), 0);
        wire(level, computer(0), 1, computer(1), 1);
        src.sendSuccess(() -> Component.literal("клеммы A и B соединены"), false);
        return 1;
    }

    static CompoundTag data(ServerLevel level, BlockPos p) {
        var d = DevicesSavedData.load(level).getDevice(p);
        CompoundTag t = new CompoundTag();
        if (d != null) d.write(t);
        return t;
    }

    /** Показания блок-сущности для клиента (те же, что видят очки инженера) */
    static CompoundTag shown(ServerLevel level, int s) {
        return be(level, s).getUpdateTag(level.registryAccess());
    }

    static int mark(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        MARK.clear();
        markTime = level.getGameTime();
        for (int s = 0; s < 3; s++) {
            OnboardComputerBlockEntity be = be(level, s);
            if (be != null) MARK.put(s, new double[] {be.charge()});
        }
        src.sendSuccess(() -> Component.literal("отметка, тик " + markTime), false);
        return 1;
    }

    static int report(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        long dt = level.getGameTime() - markTime;
        StringBuilder out = new StringBuilder();
        for (int s = 0; s < 3; s++) {
            OnboardComputerBlockEntity be = be(level, s);
            if (be == null) continue;
            CompoundTag t = shown(level, s);
            var m = be.modules();
            double nominal = BatteryPack.getNominalCharge();
            out.append(String.format("%s: %.0f об/мин, вал %.0f SU/об → %.0f SU, сеть %.0f/%.0f SU, перегруз %s; генер. %d, аккум. %d; "
                            + "заряд %.0f Кл (%.1f %%), ЭДС ячейки %.2f В; клеммы %.2f В, отдача %.0f Вт, выработка %.0f Вт",
                    NAME[s], be.rpm(), be.calculateStressApplied(), be.calculateStressApplied() * be.rpm(),
                    be.hasNetwork() ? be.getOrCreateNetwork().calculateStress() : 0,
                    be.hasNetwork() ? be.getOrCreateNetwork().calculateCapacity() : 0, be.isOverStressed(),
                    m.generators(), m.batteries(), be.charge(), 100 * be.charge() / nominal,
                    m.batteries() > 0 ? BatteryPack.openVoltage(be.charge()) : 0,
                    t.getDouble("Voltage"), t.getDouble("Output"), t.getDouble("Generation")));
            if (DevicesSavedData.load(level).getDevice(meter(s)) instanceof GaugeDevice v)
                out.append(String.format("; вольтметр %.2f В", v.rmsVoltages.get()));
            double[] mk = MARK.get(s);
            if (mk != null && m.batteries() > 0 && dt > 0) {
                double dq = (be.charge() - mk[0]) * m.batteries();
                double u = Math.max(BatteryPack.openVoltage(be.charge()), 6);
                double expected = (t.getDouble("Generation") - t.getDouble("Output")) * dt * 0.05 / u;
                out.append(String.format("; за %d тиков заряд %+.0f Кл (все ячейки), по нынешним выработке и отдаче %+.0f Кл",
                        dt, dq, expected));
            }
            out.append(" | устройство ").append(data(level, computer(s))).append('\n');
        }
        String msg = out.toString();
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    static int devices(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        StringBuilder out = new StringBuilder();
        for (var d : DevicesSavedData.load(level).getDevices()) {
            if (!(d instanceof aero.extra.OnboardDevice)) continue;
            out.append(d.pos.toShortString()).append(": ");
            if (level.getBlockEntity(d.pos) instanceof OnboardComputerBlockEntity be) {
                CompoundTag t = be.getUpdateTag(level.registryAccess());
                out.append(String.format("%.0f об/мин, вал %.0f SU, модулей %d, заряд %.0f Кл, клеммы %.2f В, отдача %.0f Вт, выработка %.0f Вт",
                        be.rpm(), be.calculateStressApplied() * be.rpm(), be.modules().total(), be.charge(),
                        t.getDouble("Voltage"), t.getDouble("Output"), t.getDouble("Generation")));
            } else out.append("нет блок-сущности");
            out.append('\n');
        }
        String msg = out.length() == 0 ? "бортовых компьютеров нет" : out.toString();
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    static int remove(CommandSourceStack src, int s) {
        ServerLevel level = src.getLevel();
        ItemStack out = removeLast(level, s);
        double c = ModuleItem.charge(out);
        src.sendSuccess(() -> Component.literal(String.format("стенд %s: вынут %s, заряд %.0f Кл; осталось модулей %d, заряд ячейки %.0f Кл",
                NAME[s], out.isEmpty() ? "ничего" : out.getItem().toString(), c, be(level, s).modules().total(), be(level, s).charge())), false);
        return 1;
    }

    static int breakIt(CommandSourceStack src, int s) {
        ServerLevel level = src.getLevel();
        BlockPos p = computer(s);
        level.destroyBlock(p, true);
        List<ItemEntity> items = level.getEntitiesOfClass(ItemEntity.class, new AABB(p).inflate(2));
        StringBuilder out = new StringBuilder("стенд " + NAME[s] + " сломан, выпало:");
        for (ItemEntity it : items) {
            ItemStack st = it.getItem();
            out.append(' ').append(st.getCount()).append('×').append(st.getItem());
            if (st.has(AeroExtra.CHARGE.get())) out.append(String.format("(%.0f Кл)", ModuleItem.charge(st)));
        }
        out.append(level.getBlockState(p).is(Blocks.AIR) ? "; блока нет" : "; блок на месте!");
        String msg = out.toString();
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }
}
