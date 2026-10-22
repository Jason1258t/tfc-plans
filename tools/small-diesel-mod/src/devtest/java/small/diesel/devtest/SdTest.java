package small.diesel.devtest;

import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.CEEWireTypes;
import com.george_vi.electroenergetics.content.gauge.GaugeDevice;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDevice;
import com.george_vi.electroenergetics.foundation.device.ElectricalDeviceBlock;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.simulation.infrastructure.InfrastructureSavedData;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.simibubi.create.AllBlocks;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.material.Fluid;
import net.minecraft.world.level.material.Fluids;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.fluids.FluidStack;
import net.neoforged.neoforge.fluids.capability.IFluidHandler.FluidAction;
import small.diesel.EngineBlock;
import small.diesel.EngineBlockEntity;
import small.diesel.SmallDiesel;
import small.diesel.electric.Electric;
import small.diesel.electric.GeneratorBlockEntity;

/**
 * Проверка Small Diesel на сервере разработки:
 *   /sdtest engines — четыре малых двигателя на дизеле: 1) вентилятор Create; 2) коробка передач и 3 вентилятора;
 *       3) вентилятор, в баке 2 мБ (должен остановиться); 4) без нагрузки (не должен жечь)
 *   /sdtest generator <нагревателей> — малый дизельный генератор на дизеле, n нагревателей EE параллельно и вольтметр;
 *   /sdtest heaters <n> — ещё n нагревателей (перегрузка)
 *   /sdtest mark — запомнить баки и время; /sdtest report — обороты, мощность, загрузка сети, расход за время с mark
 *       против расчёта (двигатель: загрузка × мощность × тики; генератор: отдача × тики / работа 1 мБ / КПД)
 *   /sdtest water — налить воду в двигатель 1 (бак должен не принять)
 */
@Mod("small_diesel_devtest")
public class SdTest {
    static final BlockPos[] ENGINES = {new BlockPos(0, -60, 0), new BlockPos(0, -60, 6), new BlockPos(0, -60, 12), new BlockPos(0, -60, 18)};
    static final BlockPos GEN = new BlockPos(10, -60, 0);
    static final Map<BlockPos, double[]> MARK = new LinkedHashMap<>();
    static long markTime;
    static int heaters;

    public SdTest() {
        NeoForge.EVENT_BUS.addListener(SdTest::commands);
    }

    static void commands(RegisterCommandsEvent e) {
        CommandDispatcher<CommandSourceStack> d = e.getDispatcher();
        d.register(Commands.literal("sdtest")
                .then(Commands.literal("engines").executes(c -> engines(c.getSource())))
                .then(Commands.literal("generator").then(Commands.argument("n", IntegerArgumentType.integer(0, 32))
                        .executes(c -> generator(c.getSource(), IntegerArgumentType.getInteger(c, "n")))))
                .then(Commands.literal("heaters").then(Commands.argument("n", IntegerArgumentType.integer(1, 32))
                        .executes(c -> addHeaters(c.getSource(), IntegerArgumentType.getInteger(c, "n")))))
                .then(Commands.literal("mark").executes(c -> mark(c.getSource())))
                .then(Commands.literal("report").executes(c -> report(c.getSource())))
                .then(Commands.literal("water").executes(c -> water(c.getSource()))));
    }

    static Fluid diesel() {
        return BuiltInRegistries.FLUID.get(ResourceLocation.fromNamespaceAndPath("createdieselgenerators", "diesel"));
    }

    static void place(ServerLevel level, BlockPos pos, BlockState state) {
        level.setBlock(pos, state, Block.UPDATE_ALL);
    }

    static BlockState fan(Direction facing) {
        return AllBlocks.ENCASED_FAN.getDefaultState().setValue(BlockStateProperties.FACING, facing);
    }

    static BlockState engine(Direction facing) {
        return SmallDiesel.ENGINE.get().defaultBlockState().setValue(EngineBlock.FACING, facing);
    }

    static int engines(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        // 1, 3, 4: двигатель валом на восток; вентилятор к востоку валом к двигателю (у вентилятора вал — с обратной от FACING стороны)
        for (int i : new int[] {0, 2, 3}) {
            place(level, ENGINES[i], engine(Direction.EAST));
            if (i != 3) place(level, ENGINES[i].east(), fan(Direction.EAST));
        }
        // 2: валом вверх, над ним коробка передач, вокруг неё 4 вентилятора
        BlockPos e2 = ENGINES[1], box = e2.above();
        place(level, e2, engine(Direction.UP));
        // Коробка с осью X: валы вверх-вниз и на север-юг (ось — та, где валов нет)
        place(level, box, AllBlocks.GEARBOX.getDefaultState().setValue(BlockStateProperties.AXIS, Direction.Axis.X));
        for (Direction dir : new Direction[] {Direction.NORTH, Direction.SOUTH, Direction.UP}) place(level, box.relative(dir), fan(dir));
        for (int i = 0; i < ENGINES.length; i++) {
            if (level.getBlockEntity(ENGINES[i]) instanceof EngineBlockEntity be)
                be.tank().fill(new FluidStack(diesel(), i == 2 ? 2 : 1000), FluidAction.EXECUTE);
        }
        src.sendSuccess(() -> Component.literal("двигатели собраны и заправлены"), false);
        return 1;
    }

    static void wire(ServerLevel level, BlockPos a, int na, BlockPos b, int nb) {
        for (BlockPos p : new BlockPos[] {a, b}) {
            BlockState st = level.getBlockState(p);
            if (st.getBlock() instanceof ElectricalDeviceBlock<?> eb) eb.ensureNodesExist(level, p, st);
        }
        InfrastructureSavedData.load(level).connect(new InWorldNode(na, a), new InWorldNode(nb, b), CEEWireTypes.COPPER.get());
    }

    static int generator(CommandSourceStack src, int n) {
        ServerLevel level = src.getLevel();
        place(level, GEN, Electric.GENERATOR.get().defaultBlockState());
        if (level.getBlockEntity(GEN) instanceof GeneratorBlockEntity be)
            be.tank().fill(new FluidStack(diesel(), 1000), FluidAction.EXECUTE);
        BlockPos meter = GEN.offset(0, 0, 3);
        place(level, meter, CEEBlocks.VOLTMETER.getDefaultState());
        wire(level, GEN, 0, meter, 0);
        wire(level, GEN, 1, meter, 1);
        heaters = 0;
        addHeaters(src, n);
        return 1;
    }

    static int addHeaters(CommandSourceStack src, int n) {
        ServerLevel level = src.getLevel();
        for (int i = 0; i < n; i++, heaters++) {
            BlockPos h = GEN.offset(2 + heaters, 0, 0);
            place(level, h, CEEBlocks.RESISTIVE_HEATER.getDefaultState());
            wire(level, GEN, 0, h, 0);
            wire(level, GEN, 1, h, 1);
        }
        int total = heaters;
        src.sendSuccess(() -> Component.literal("нагревателей на генераторе: " + total), false);
        return 1;
    }

    static int mark(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        MARK.clear();
        markTime = level.getGameTime();
        for (BlockPos p : ENGINES)
            if (level.getBlockEntity(p) instanceof EngineBlockEntity be) MARK.put(p, new double[] {be.tank().getFluidAmount(), be.credit()});
        if (level.getBlockEntity(GEN) instanceof GeneratorBlockEntity g) MARK.put(GEN, new double[] {g.tank().getFluidAmount(), pool(level)});
        src.sendSuccess(() -> Component.literal("отметка, тик " + markTime), false);
        return 1;
    }

    static CompoundTag data(ServerLevel level, BlockPos p) {
        SimulatedDevice d = DevicesSavedData.load(level).getDevice(p);
        CompoundTag t = new CompoundTag();
        if (d != null) d.write(t);
        return t;
    }

    static double pool(ServerLevel level) {
        CompoundTag t = data(level, GEN);
        return t.getDouble("Pool") + t.getDouble("Stored");
    }

    static int report(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        long dt = level.getGameTime() - markTime;
        StringBuilder out = new StringBuilder("за " + dt + " тиков\n");
        for (int i = 0; i < ENGINES.length; i++) {
            if (!(level.getBlockEntity(ENGINES[i]) instanceof EngineBlockEntity be)) continue;
            double[] m = MARK.getOrDefault(ENGINES[i], new double[] {0, 0});
            double drained = m[0] - be.tank().getFluidAmount();
            double work = drained * be.fuelPerMb() + m[1] - be.credit();
            double cap = be.calculateAddedStressCapacity() * Math.abs(be.getSpeed());
            double expected = be.load() * cap * dt;
            out.append(String.format("двиг. %d: %.0f об/мин, мощность %.0f SU, загрузка %.3f, бак %d мБ, сожжено %.0f мБ, работа %.0f, расчёт %.0f SU·тик%n",
                    i + 1, be.getSpeed(), cap, be.load(), be.tank().getFluidAmount(), drained, work, expected));
        }
        if (level.getBlockEntity(GEN) instanceof GeneratorBlockEntity g) {
            double[] m = MARK.getOrDefault(GEN, new double[] {0, 0});
            CompoundTag t = data(level, GEN);
            double drained = m[0] - g.tank().getFluidAmount();
            // Энергия: сожжено × работа 1 мБ × КПД + запас и приток на отметке − сейчас = отдано за dt
            double perMb = 6144 / 0.05 * GeneratorBlockEntity.EFFICIENCY;
            double given = drained * perMb + m[1] - pool(level);
            out.append(String.format("генератор: отдача %.0f Вт, темп. %.0f, бак %d мБ, сожжено %.0f мБ, отдано по топливу %.0f, по отдаче %.0f Вт·тик%n",
                    t.getDouble("OutputPower"), t.getFloat("Temp"), g.tank().getFluidAmount(), drained, given, t.getDouble("OutputPower") * dt));
            if (DevicesSavedData.load(level).getDevice(GEN.offset(0, 0, 3)) instanceof GaugeDevice v)
                out.append(String.format("вольтметр %.1f В%n", v.rmsVoltages.get()));
        }
        String msg = out.toString();
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    static int water(CommandSourceStack src) {
        int n = 0;
        if (src.getLevel().getBlockEntity(ENGINES[3]) instanceof EngineBlockEntity be)
            n = be.tank().fill(new FluidStack(Fluids.WATER, 100), FluidAction.SIMULATE);
        int accepted = n;
        src.sendSuccess(() -> Component.literal("вода в двигатель 4 (с дизелем): принято " + accepted + " мБ"), false);
        return 1;
    }
}
