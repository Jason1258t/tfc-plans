package ee.extras.devtest;

import com.george_vi.electroenergetics.CEEBlocks;
import com.george_vi.electroenergetics.content.bundled_wire.BundledWireTerminationBlock;
import com.george_vi.electroenergetics.content.creative_battery.CreativeBatteryBlock;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.simulation.infrastructure.InfrastructureSavedData;
import ee.extras.EeExtras;
import ee.extras.cable.CableEnd;
import ee.extras.cable.CableEndBlock;
import ee.extras.cable.CableEvents;
import ee.extras.cable.CableKind;
import ee.extras.cable.CableLaying;
import ee.extras.cable.CableOrientation;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.UseOnContext;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.common.util.FakePlayer;
import net.neoforged.neoforge.common.util.FakePlayerFactory;

/**
 * Положения кабельных блоков (2.0.2):
 *   /rectest orient — установка предметом от лица FakePlayer (настоящий путь: useOn → CommonHooks.onPlaceItemIntoWorld →
 *                     EntityPlaceEvent) четырёхжильного соединителя и двухпроводного соединителя EE на все 6 граней с
 *                     4 направлений взгляда: вывод кабеля — от игрока на полу/потолке, вверх на стене. Ключ: 4 поворота
 *                     возвращают в начало через 4 разных направления вывода. Соединитель EE с проводом не поворачивается.
 *                     Четырёхжильный соединитель с кабелем поворачивается — кабель остаётся (проверка — orientreport).
 */
final class Orient {
    static final BlockPos BASE = new BlockPos(0, -50, 90);
    static final BlockPos F = new BlockPos(0, -60, 80);
    static final BlockPos FI = F.east(6);
    static final BlockPos E = new BlockPos(12, -60, 80);
    static final BlockPos EBAT = E.west(2);

    static Vec3 offset(Vec3 nodePos) {
        return nodePos.subtract(0.5, 0.5, 0.5);
    }

    static int run(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        FakePlayer player = FakePlayerFactory.getMinecraft(level);
        List<String> bad = new ArrayList<>();
        int total = 0;

        // Установка: опора — камень, клик по грани face, блок встаёт на соседнюю клетку
        int i = 0;
        for (Direction face : Direction.values()) {
            for (Direction look : Direction.Plane.HORIZONTAL) {
                for (int kind = 0; kind < 2; kind++, i++) {
                    BlockPos support = BASE.offset((i % 12) * 4, 0, (i / 12) * 4);
                    BlockPos at = support.relative(face);
                    level.setBlock(support, Blocks.STONE.defaultBlockState(), 3);
                    level.setBlock(at, Blocks.AIR.defaultBlockState(), 3);
                    ItemStack stack = new ItemStack(kind == 0 ? EeExtras.FOUR_CORE_TERMINATION_ITEM.get()
                            : CEEBlocks.DUPLEX_WIRE_TERMINATION.asStack().getItem());
                    player.setItemInHand(InteractionHand.MAIN_HAND, stack);
                    player.setYRot(look.toYRot());
                    player.setXRot(0);
                    Vec3 hitAt = Vec3.atCenterOf(support).add(Vec3.atLowerCornerOf(face.getNormal()).scale(0.5));
                    InteractionResult r = stack.useOn(new UseOnContext(player, InteractionHand.MAIN_HAND,
                            new BlockHitResult(hitAt, face, support, false)));
                    BlockState st = level.getBlockState(at);
                    total++;
                    if (!(st.getBlock() instanceof BundledWireTerminationBlock)) {
                        bad.add((kind == 0 ? "4ж" : "EE") + " не встал " + face + "/" + look + " " + r);
                        continue;
                    }
                    Vec3 want = CableOrientation.desired(face, look);
                    Vec3 cable = offset(cablePoint(level, at, st));
                    if (st.getValue(BundledWireTerminationBlock.FACING) != face || cable.dot(want) < 0.2)
                        bad.add((kind == 0 ? "4ж" : "EE") + " " + face + "/" + look + ": положение "
                                + CableOrientation.of(st) + ", вывод " + fmt(cable));
                }
            }
        }

        // Ключ по лицевой грани: 4 разных направления вывода, через 4 поворота — снова начальное
        BlockPos tmp = BASE.offset(0, 0, -6);
        for (Direction face : Direction.values()) {
            for (int kind = 0; kind < 2; kind++) {
                BlockState st = kind == 0
                        ? EeExtras.FOUR_CORE_TERMINATION.get().defaultBlockState().setValue(BundledWireTerminationBlock.FACING, face)
                        : Extras.eeTermination().setValue(BundledWireTerminationBlock.FACING, face);
                level.setBlock(tmp, st, 3);
                Set<String> dirs = new HashSet<>();
                for (int k = 0; k < 4; k++) {
                    BlockState cur = level.getBlockState(tmp);
                    dirs.add(fmt(offset(cablePoint(level, tmp, cur))));
                    if (kind == 0) level.setBlock(tmp, ((CableEndBlock) cur.getBlock()).getRotatedBlockState(cur, face), 3);
                    else CableEvents.rotateEe(level, tmp, cur, player);
                }
                total++;
                BlockState end = level.getBlockState(tmp);
                if (dirs.size() != 4 || !end.equals(st))
                    bad.add("ключ " + (kind == 0 ? "4ж " : "EE ") + face + ": направлений " + dirs.size() + ", вернулся " + end.equals(st));
            }
        }
        level.setBlock(tmp, Blocks.AIR.defaultBlockState(), 3);

        // Соединитель EE с проводом: ключ отказывает, положение то же
        level.setBlock(EBAT, CEEBlocks.CREATIVE_BATTERY.getDefaultState().setValue(CreativeBatteryBlock.AC, true), 3);
        level.setBlock(E, Extras.eeTermination(), 3);
        DevTest.wire(level, EBAT, 0, E, CableEnd.of(E, level.getBlockState(E)).conductor(1).id());
        BlockState before = level.getBlockState(E);
        InteractionResult r = CableEvents.rotateEe(level, E, before, player);
        total++;
        if (r != InteractionResult.FAIL || !level.getBlockState(E).equals(before)) bad.add("EE с проводом повернулся: " + r);

        // Четырёхжильный соединитель с кабелем к изолятору: поворот ключом (дальше orientreport после пары тиков)
        level.setBlock(F, EeExtras.FOUR_CORE_TERMINATION.get().defaultBlockState().setValue(BundledWireTerminationBlock.FACING, Direction.UP), 3);
        level.setBlock(FI, EeExtras.FOUR_CORE_INSULATOR.get().defaultBlockState().setValue(BundledWireTerminationBlock.FACING, Direction.UP), 3);
        boolean laid = CableLaying.connect(level, CableKind.FOUR_CORE, CableEnd.of(F, level.getBlockState(F)), CableEnd.of(FI, level.getBlockState(FI)));
        BlockState f = level.getBlockState(F);
        level.setBlock(F, ((CableEndBlock) f.getBlock()).getRotatedBlockState(f, Direction.UP), 3);
        total++;
        if (!laid) bad.add("кабель 4ж не проложен");

        String msg = bad.isEmpty() ? "положения: все " + total + " проверок прошли" : "положения: ошибок " + bad.size() + " из " + total + ": " + String.join("; ", bad);
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    /** Кабель 4ж после поворота: оболочка и 4 жилы на месте (CableData за это время мог бы их убрать) */
    static int report(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        InfrastructureSavedData sd = InfrastructureSavedData.load(level);
        int wires = 0;
        for (InWorldNode n : sd.getNodes()) if (n.sourcePos().equals(F)) wires += sd.getConnections(n).size();
        BlockState st = level.getBlockState(F);
        String msg = "4ж после поворота: положение " + CableOrientation.of(st) + ", концов проводов у соединителя " + wires + " (нужно 5)";
        src.sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    static Vec3 cablePoint(ServerLevel level, BlockPos pos, BlockState st) {
        if (st.getBlock() instanceof CableEndBlock b) return b.getNodePosition(level, pos, st, 0);
        return CableOrientation.eeCablePoint(st.getValue(BundledWireTerminationBlock.FACING), CableOrientation.of(st));
    }

    static String fmt(Vec3 v) {
        return String.format("(%.2f %.2f %.2f)", v.x, v.y, v.z);
    }

    private Orient() {
    }
}
