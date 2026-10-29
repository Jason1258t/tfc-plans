package ee.extras.devtest;

import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.CEEItems;
import com.george_vi.electroenergetics.content.creative_battery.CreativeBatteryBlock;
import com.george_vi.electroenergetics.content.creative_battery.CreativeBatteryDevice;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.simulation.infrastructure.InfrastructureSavedData;
import blusunrize.immersiveengineering.api.wires.Connection;
import blusunrize.immersiveengineering.api.wires.ConnectionPoint;
import blusunrize.immersiveengineering.api.wires.GlobalWireNetwork;
import blusunrize.immersiveengineering.api.wires.WireType;
import ee.extras.cable.CableEnd;
import ee.extras.lantern.LanternBlock;
import ee.extras.lantern.LanternConversion;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.common.util.FakePlayer;
import net.neoforged.neoforge.common.util.FakePlayerFactory;

/**
 * Фонарь IE в сети EE (нужен IE=1):
 *   /rectest lanterns — батарея → соединитель EE → три фонаря IE в линию; кабель кладёт FakePlayer катушкой
 *                       двухпроводного кабеля настоящим путём (useItemOn → PlayerInteractEvent.RightClickBlock):
 *                       соединитель, фонарь 1 (превращается и принимает кабель), фонарь 1, фонарь 2, фонарь 2, фонарь 3.
 *                       Фонарь 3 ставится висячим (facing=up у IE). Вольтметр — на жилах фонаря 3.
 *   /rectest lanternpower V — напряжение батареи (переменный ток 1 Гц)
 *   /rectest lanternreport — горят ли, напряжение, кабели у фонарей, что лежит на месте сломанного
 *   /rectest lanterncut — сломать фонарь 2 с выпадением (линия за ним гаснет)
 *   /rectest lanternie — фонарь с проводом IE катушкой EE не превращается
 */
final class Lantern {
    static final BlockPos BAT = new BlockPos(0, -60, 120);
    static final BlockPos A = BAT.east(2);
    static final BlockPos[] L = {BAT.east(8), BAT.east(14), BAT.east(20)};
    static final BlockPos VM = L[2].south(2);
    static final List<String> log = new ArrayList<>();

    static BlockState ieLantern(boolean hanging) {
        BlockState s = BuiltInRegistries.BLOCK.get(LanternConversion.IE_LANTERN).defaultBlockState();
        for (var p : s.getProperties())
            if (p.getName().equals("facing")) s = with(s, p, hanging ? Direction.UP : Direction.DOWN);
        return s;
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static BlockState with(BlockState s, net.minecraft.world.level.block.state.properties.Property p, Comparable v) {
        return s.setValue(p, v);
    }

    static InteractionResult click(ServerLevel level, FakePlayer player, BlockPos pos) {
        ItemStack stack = player.getItemInHand(InteractionHand.MAIN_HAND);
        BlockHitResult hit = new BlockHitResult(Vec3.atCenterOf(pos), Direction.UP, pos, false);
        InteractionResult r = player.gameMode.useItemOn(player, level, stack, InteractionHand.MAIN_HAND, hit);
        log.add(pos.getX() + ":" + r + "/" + BuiltInRegistries.BLOCK.getKey(level.getBlockState(pos).getBlock()).getPath());
        return r;
    }

    static int build(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        log.clear();
        DevTest.place(level, BAT, CEEBlocks.CREATIVE_BATTERY.getDefaultState().setValue(CreativeBatteryBlock.AC, true));
        DevTest.place(level, A, Extras.eeTermination());
        for (int i = 0; i < L.length; i++) DevTest.place(level, L[i], ieLantern(i == 2));
        DevTest.place(level, VM, CEEBlocks.VOLTMETER.getDefaultState());
        CableEnd a = Extras.end(level, A);
        DevTest.wire(level, BAT, 0, A, a.conductor(1).id());
        DevTest.wire(level, BAT, 1, A, a.conductor(2).id());

        FakePlayer player = FakePlayerFactory.getMinecraft(level);
        player.setItemInHand(InteractionHand.MAIN_HAND, new ItemStack(CEEItems.DUPLEX_WIRE_SPOOL.get(), 16));
        click(level, player, A);
        click(level, player, L[0]);
        click(level, player, L[0]);
        click(level, player, L[1]);
        click(level, player, L[1]);
        click(level, player, L[2]);
        DevTest.wire(level, L[2], 1, VM, 0);
        DevTest.wire(level, L[2], 2, VM, 1);
        src.sendSuccess(() -> Component.literal("клики: " + String.join(" ", log)
                + "; катушек осталось " + player.getItemInHand(InteractionHand.MAIN_HAND).getCount()), false);
        return 1;
    }

    static int power(CommandSourceStack src, double volts) {
        CreativeBatteryDevice b = DevicesSavedData.load(src.getLevel()).getDevice(BAT, CreativeBatteryDevice.class);
        if (b != null) {
            b.voltage = volts;
            b.acFrequency = 1;
        }
        src.sendSuccess(() -> Component.literal("батарея фонарей: " + volts + " В"), false);
        return 1;
    }

    static int report(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        InfrastructureSavedData sd = InfrastructureSavedData.load(level);
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < L.length; i++) {
            BlockState st = level.getBlockState(L[i]);
            int wires = 0;
            for (InWorldNode n : sd.getNodes()) if (n.sourcePos().equals(L[i])) wires += sd.getConnections(n).size();
            out.append("фонарь ").append(i + 1).append(": ");
            if (st.getBlock() instanceof LanternBlock)
                out.append(st.getValue(LanternBlock.LIT) ? "горит" : "не горит").append(", ").append(st.getValue(LanternBlock.FACING))
                        .append(", свет ").append(st.getLightEmission(level, L[i]));
            else out.append(BuiltInRegistries.BLOCK.getKey(st.getBlock()));
            out.append(", концов проводов ").append(wires);
            List<ItemEntity> drops = level.getEntitiesOfClass(ItemEntity.class, new AABB(L[i]).inflate(1));
            for (ItemEntity e : drops) out.append(", выпало ").append(e.getItem());
            out.append("; ");
        }
        out.append("вольтметр на фонаре 3: ").append(Extras.vm(DevicesSavedData.load(level), VM)).append(" В");
        src.sendSuccess(() -> Component.literal(out.toString()), false);
        return 1;
    }

    static final BlockPos[] IE = {BAT.offset(8, 0, 4), BAT.offset(14, 0, 4)};

    /** Два фонаря IE, соединённые медным проводом IE; клик катушкой EE по первому — должен отказать, фонарь остаётся IE */
    static int ieWired(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        for (BlockPos p : IE) DevTest.place(level, p, ieLantern(false));
        GlobalWireNetwork net = GlobalWireNetwork.getNetwork(level);
        net.addConnection(new Connection(WireType.COPPER, new ConnectionPoint(IE[0], 0), new ConnectionPoint(IE[1], 0), net));
        FakePlayer player = FakePlayerFactory.getMinecraft(level);
        player.setItemInHand(InteractionHand.MAIN_HAND, new ItemStack(CEEItems.DUPLEX_WIRE_SPOOL.get(), 16));
        log.clear();
        click(level, player, IE[0]);
        int ie = net.getLocalNet(new ConnectionPoint(IE[0], 0)).getConnections(new ConnectionPoint(IE[0], 0)).size();
        src.sendSuccess(() -> Component.literal("фонарь с проводом IE: " + log.get(0) + ", проводов IE у него " + ie), false);
        return 1;
    }

    static int cut(CommandSourceStack src) {
        boolean ok = src.getLevel().destroyBlock(L[1], true);
        src.sendSuccess(() -> Component.literal("фонарь 2 сломан: " + ok), false);
        return 1;
    }


    private Lantern() {
    }
}
