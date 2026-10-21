package ee.extras.devtest;

import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.CEEWireTypes;
import com.george_vi.electroenergetics.config.CEEConfigs;
import com.george_vi.electroenergetics.content.creative_battery.CreativeBatteryDevice;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.foundation.device.ElectricalDeviceBlock;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNodeConnection;
import com.george_vi.electroenergetics.foundation.nodes.NodeConnectionPoint;
import com.george_vi.electroenergetics.simulation.WireType;
import com.george_vi.electroenergetics.simulation.infrastructure.InfrastructureSavedData;
import com.george_vi.electroenergetics.simulation.infrastructure.WireData;
import ee.extras.lines.LineWire;
import ee.extras.lines.Tension;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.common.util.FakePlayerFactory;

/**
 * Провода ЛЭП (2.1):
 *   /rectest lines — для каждого провода: творческая батарея → два провода этого типа длиной SPAN → нагреватель,
 *                    вольтметр на нагревателе. Натяжной зажим (тем же путём, что клик игрока) на проводе ПС и попытка
 *                    на медном EE; длины, «укороченные как Alt + колесом EE», у ПС с зажимом и у А без зажима.
 *   /rectest linespower — батареи 100 В; /rectest linesreport — напряжения против расчёта по сопротивлению, длины после
 *                    проверки Tension, провис железного провода EE.
 */
final class Lines {
    static final int SPAN = 60;
    static final double VOLTS = 100;

    static BlockPos bat(int i) {
        return new BlockPos(0, -60, 120 + 4 * i);
    }

    static BlockPos heater(int i) {
        return bat(i).east(SPAN);
    }

    static BlockPos vm(int i) {
        return heater(i).south(2);
    }

    static InWorldNodeConnection conn(int i, int node) {
        return new InWorldNodeConnection(new InWorldNode(node, bat(i)), new InWorldNode(node, heater(i)));
    }

    static void ensure(ServerLevel level, BlockPos p) {
        BlockState st = level.getBlockState(p);
        if (st.getBlock() instanceof ElectricalDeviceBlock<?> eb) eb.ensureNodesExist(level, p, st);
    }

    static int build(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        InfrastructureSavedData sd = InfrastructureSavedData.load(level);
        LineWire[] all = LineWire.values();
        for (int i = 0; i < all.length; i++) {
            DevTest.place(level, bat(i), CEEBlocks.CREATIVE_BATTERY.getDefaultState());
            DevTest.place(level, heater(i), CEEBlocks.RESISTIVE_HEATER.getDefaultState());
            DevTest.place(level, vm(i), CEEBlocks.VOLTMETER.getDefaultState());
            for (BlockPos p : new BlockPos[] {bat(i), heater(i), vm(i)}) ensure(level, p);
            for (int n = 0; n < 2; n++) sd.connect(new InWorldNode(n, bat(i)), new InWorldNode(n, heater(i)), all[i].type.get());
            DevTest.wire(level, heater(i), 0, vm(i), 0);
            DevTest.wire(level, heater(i), 1, vm(i), 1);
        }
        List<String> out = new ArrayList<>();
        var player = FakePlayerFactory.getMinecraft(level);
        ItemStack clamp = new ItemStack(Tension.CLAMP_ITEM.get(), 4);
        int steel = LineWire.STEEL.ordinal(), alu = LineWire.ALUMINUM.ordinal();
        // Зажим на ПС (провод 0): у ближнего к клику конца, длина — пролёт − 0,8
        Tension.CLAMP_BEHAVIOUR.get().interactWire(new NodeConnectionPoint(conn(steel, 0).node1(), conn(steel, 0).node2(), 0.1f), level, player, clamp);
        WireData d = sd.getConnectionData(conn(steel, 0));
        double dist = dist(sd, conn(steel, 0));
        out.add(String.format("ПС с зажимом: длина %.2f при пролёте %.2f (нужно %.2f), зажим %s, точка %.3f, зажимов осталось %d",
                d.length, dist, dist - 0.8, Tension.hasClamp(d), d.attachments().isEmpty() ? -1f : d.attachments().get(0).getFirst(), clamp.getCount()));
        // Зажим на медный провод EE — нельзя
        DevTest.place(level, bat(10), CEEBlocks.CREATIVE_BATTERY.getDefaultState());
        DevTest.place(level, heater(10), CEEBlocks.RESISTIVE_HEATER.getDefaultState());
        ensure(level, bat(10));
        ensure(level, heater(10));
        sd.connect(conn(10, 0).node1(), conn(10, 0).node2(), CEEWireTypes.COPPER.get());
        Tension.CLAMP_BEHAVIOUR.get().interactWire(new NodeConnectionPoint(conn(10, 0).node1(), conn(10, 0).node2(), 0.5f), level, player, clamp);
        out.add("медный EE: зажим " + Tension.hasClamp(sd.getConnectionData(conn(10, 0))) + ", зажимов осталось " + clamp.getCount());
        // Как Alt + колесо EE: укоротить ПС с зажимом на 3 и А без зажима на 0,5 — проверка Tension должна вернуть
        shorten(sd, conn(steel, 1), 0); // второй провод ПС без зажима — не трогаем, контроль
        shorten(sd, conn(steel, 0), 3);
        shorten(sd, conn(alu, 0), 0.5);
        src.sendSuccess(() -> Component.literal(String.join("; ", out)), false);
        return 1;
    }

    static double dist(InfrastructureSavedData sd, InWorldNodeConnection c) {
        Vec3 a = sd.getNodePosition(c.node1()), b = sd.getNodePosition(c.node2());
        return a.distanceTo(b);
    }

    static void shorten(InfrastructureSavedData sd, InWorldNodeConnection c, double by) {
        if (by == 0) return;
        WireData d = sd.getConnectionData(c);
        sd.setConnectionData(c, new WireData(d.wireType(), d.temperature(), d.attachments(), d.length - by));
    }

    static int power(CommandSourceStack src) {
        DevicesSavedData devices = DevicesSavedData.load(src.getLevel());
        for (int i = 0; i < LineWire.values().length; i++) {
            CreativeBatteryDevice b = devices.getDevice(bat(i), CreativeBatteryDevice.class);
            if (b != null) b.voltage = VOLTS;
        }
        src.sendSuccess(() -> Component.literal("батареи проводов: " + VOLTS + " В"), false);
        return 1;
    }

    static int report(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        InfrastructureSavedData sd = InfrastructureSavedData.load(level);
        DevicesSavedData devices = DevicesSavedData.load(level);
        double rh = CEEConfigs.server().resistanceValues.resistiveHeaterResistance.get();
        List<String> out = new ArrayList<>();
        LineWire[] all = LineWire.values();
        for (int i = 0; i < all.length; i++) {
            WireData a = sd.getConnectionData(conn(i, 0)), b = sd.getConnectionData(conn(i, 1));
            if (a == null || b == null) {
                out.add(all[i].id + ": провода нет");
                continue;
            }
            double rw = a.wireType().getResistance() * a.length + b.wireType().getResistance() * b.length;
            double expect = VOLTS * rh / (rh + rw);
            out.add(String.format("%s: %s В (расчёт %.2f, R провода %.3f Ом, I макс %.0f А)", all[i].id,
                    Extras.vm(devices, vm(i)), expect, rw, a.wireType().getMaxTemperature() / 30 + 100.0 / 3));
        }
        int steel = LineWire.STEEL.ordinal(), alu = LineWire.ALUMINUM.ordinal();
        WireData s0 = sd.getConnectionData(conn(steel, 0)), al = sd.getConnectionData(conn(alu, 0));
        out.add(String.format("после проверки: ПС с зажимом %.2f (нужно %.2f), А без зажима %.2f (нужно %.2f)",
                s0.length, dist(sd, conn(steel, 0)) - 0.8, al.length, dist(sd, conn(alu, 0))));
        WireType iron = CEEWireTypes.IRON.get();
        out.add("провис железного EE " + iron.getSag() + ", провис ПС на " + SPAN + " бл.: с зажимом "
                + String.format("%.2f", 0.05 * s0.getSag(dist(sd, conn(steel, 0))) * dist(sd, conn(steel, 0)))
                + " бл., второй провод (без зажима) "
                + String.format("%.2f", 0.05 * sd.getConnectionData(conn(steel, 1)).getSag(dist(sd, conn(steel, 1))) * dist(sd, conn(steel, 1))) + " бл.");
        src.sendSuccess(() -> Component.literal(String.join("\n", out)), false);
        return 1;
    }

    private Lines() {
    }
}
