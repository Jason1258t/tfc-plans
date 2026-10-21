package ee.extras.cable;

import com.george_vi.electroenergetics.CEEDataComponents;
import com.george_vi.electroenergetics.CEEItems;
import com.george_vi.electroenergetics.config.CEEConfigs;
import com.george_vi.electroenergetics.content.bundled_wire.BundledWireTerminationBlock;
import com.george_vi.electroenergetics.content.bundled_wire.BundledWireTerminationState;
import com.george_vi.electroenergetics.foundation.CEELang;
import com.george_vi.electroenergetics.foundation.device.ElectricalDeviceBlock;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNodeConnection;
import com.george_vi.electroenergetics.simulation.infrastructure.InfrastructureSavedData;
import com.simibubi.create.AllSoundEvents;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Прокладка кабеля катушкой — вместо недоделанной в EE 1.1.2 (BundledWireItem.useOn второго клика ничего не
 * соединяет). Как у катушки провода EE: первый клик по соединителю запоминает его (тот же компонент предмета, что у EE,
 * — по нему EE рисует «пунктир» будущего кабеля), второй — прокладывает кабель, катушка расходуется (возвращается
 * пустая, если в EE не включено alternateWirePlacement), Shift + клик — отмена.
 *
 * Кабель — оболочка (декоративный провод EE между узлами кабеля) и по жиле на каждую пару контактов (CableWires).
 * Двухжильный кабель — между двухпроводными соединителями EE и двухжильными изоляторами: жила 1 — к 1, 2 — к 2.
 * Четырёхжильный — между четырёхжильными соединителями и изоляторами, 1–4 к 1–4, а ещё от четырёхжильного блока к
 * двухпроводному соединителю EE: ноль (N) — на его жилу 2, фаза — на жилу 1, какая фаза — переключается ключом по
 * соединителю EE (cyclePhase).
 */
public final class CableLaying {
    /** Клик катушкой кабеля вида kind; null — блок не конец кабеля (клик обрабатывается как обычно) */
    public static InteractionResult use(Level level, Player player, ItemStack stack, BlockPos pos, CableKind kind) {
        if (player == null) return null;
        if (player.isShiftKeyDown()) {
            if (stack.has(CEEDataComponents.SELECTED_WIRE_TERMINATION)) {
                stack.remove(CEEDataComponents.SELECTED_WIRE_TERMINATION);
                if (level.isClientSide) player.displayClientMessage(CEELang.translateDirect("wire_spool.cancelled_connection"), true);
            }
            return InteractionResult.SUCCESS;
        }
        BlockState state = level.getBlockState(pos);
        CableEnd end = CableEnd.of(pos, state);
        if (end == null) return null;
        if (!(level instanceof ServerLevel sl)) return InteractionResult.SUCCESS;
        if (!fits(kind, end)) return deny(level, player, pos, kind == CableKind.DUPLEX ? "needs_duplex" : "needs_four_core");

        BundledWireTerminationState selected = stack.get(CEEDataComponents.SELECTED_WIRE_TERMINATION);
        if (selected == null) {
            stack.set(CEEDataComponents.SELECTED_WIRE_TERMINATION, new BundledWireTerminationState(pos,
                    state.getValue(BundledWireTerminationBlock.FACING), state.getValue(BundledWireTerminationBlock.ROLL),
                    state.getValue(BundledWireTerminationBlock.FLIP)));
            AllSoundEvents.WRENCH_ROTATE.playOnServer(level, pos);
            return InteractionResult.SUCCESS;
        }

        CableEnd first = CableEnd.of(selected.pos(), level.getBlockState(selected.pos()));
        String problem = problem(sl, kind, first, end);
        if (problem != null) {
            // Выбранный блок сломан или заменён — выбор сбрасываем; остальное — оставляем, можно кликнуть по другому
            if (first == null || !fits(kind, first)) stack.remove(CEEDataComponents.SELECTED_WIRE_TERMINATION);
            return deny(level, player, pos, problem);
        }
        if (!connect(sl, kind, first, end)) return deny(level, player, pos, "no_nodes");

        AllSoundEvents.WRENCH_REMOVE.playOnServer(level, pos);
        stack.remove(CEEDataComponents.SELECTED_WIRE_TERMINATION);
        if (!player.isCreative()) {
            stack.shrink(1);
            if (!CEEConfigs.server().alternateWirePlacement.get())
                player.getInventory().placeItemBackInInventory(CEEItems.EMPTY_SPOOL.asStack());
        }
        if (first.eeTermination() || end.eeTermination()) {
            CableEnd ee = first.eeTermination() ? first : end;
            if (kind == CableKind.FOUR_CORE)
                player.displayClientMessage(Component.translatable("ee_extras.cable.phase", "L" + CableData.get(sl).phase(ee.pos())), true);
        }
        return InteractionResult.SUCCESS;
    }

    static boolean fits(CableKind kind, CableEnd end) {
        return kind == CableKind.DUPLEX ? end.kind() == CableKind.DUPLEX
                : end.kind() == CableKind.FOUR_CORE || end.eeTermination();
    }

    /** Ключ языкового файла (ee_extras.cable.*) — почему нельзя проложить, или null */
    static String problem(ServerLevel level, CableKind kind, CableEnd a, CableEnd b) {
        if (a == null || !fits(kind, a)) return "lost_selection";
        if (a.pos().equals(b.pos())) return "same_block";
        // Четырёхжильный кабель между двумя двухпроводными соединителями — жилам 3 и 4 некуда идти
        if (kind == CableKind.FOUR_CORE && a.kind() != CableKind.FOUR_CORE && b.kind() != CableKind.FOUR_CORE)
            return "needs_four_core";
        int max = CEEConfigs.server().maxBundledWireLength.get();
        if (a.pos().distSqr(b.pos()) > (double) max * max) return "too_far";
        if (InfrastructureSavedData.load(level).isConnected(a.cable(), b.cable())) return "exists";
        return null;
    }

    /** Проложить кабель: оболочка, жилы, запись в CableData. false — EE не создал узлы блоков */
    public static boolean connect(ServerLevel level, CableKind kind, CableEnd a, CableEnd b) {
        for (BlockPos p : new BlockPos[] {a.pos(), b.pos()}) {
            BlockState st = level.getBlockState(p);
            if (st.getBlock() instanceof ElectricalDeviceBlock<?> eb) eb.ensureNodesExist(level, p, st);
        }
        InfrastructureSavedData sd = InfrastructureSavedData.load(level);
        CableData data = CableData.get(level);
        int mixed = kind == CableKind.FOUR_CORE ? (a.eeTermination() ? 1 : b.eeTermination() ? 2 : 0) : 0;
        List<InWorldNode[]> cores = new ArrayList<>();
        if (mixed == 0) {
            for (int k = 1; k <= kind.conductors; k++) cores.add(new InWorldNode[] {a.conductor(k), b.conductor(k)});
        } else {
            CableEnd ee = mixed == 1 ? a : b;
            int phase = data.phase(ee.pos());
            cores.add(mixedCore(a, b, mixed, phase, 1));
            cores.add(mixedCore(a, b, mixed, CableKind.NEUTRAL, CableEnd.EE_NEUTRAL));
        }
        for (InWorldNode n : new InWorldNode[] {a.cable(), b.cable()}) if (!sd.getNodes().contains(n)) return false;
        for (InWorldNode[] core : cores)
            for (InWorldNode n : core) if (!sd.getNodes().contains(n)) return false;

        sd.connect(a.cable(), b.cable(), CableWires.sheath(kind));
        for (InWorldNode[] core : cores) sd.connect(core[0], core[1], CableWires.core(kind));
        data.add(new CableData.Cable(kind, a.cable(), b.cable(), cores, mixed));
        return true;
    }

    /** Жила смешанного кабеля: жила four четырёхжильного конца к жиле ee соединителя EE, в порядке {a, b} */
    static InWorldNode[] mixedCore(CableEnd a, CableEnd b, int mixed, int four, int ee) {
        return mixed == 1 ? new InWorldNode[] {a.conductor(ee), b.conductor(four)}
                : new InWorldNode[] {a.conductor(four), b.conductor(ee)};
    }

    /**
     * Ключ по двухпроводному соединителю EE, к которому подведён четырёхжильный кабель: следующая фаза L1 → L2 → L3
     * для всех таких кабелей у него (жила фазы перекладывается). false — четырёхжильных кабелей у блока нет.
     */
    public static boolean cyclePhase(ServerLevel level, BlockPos pos, Player player) {
        CableData data = CableData.get(level);
        List<CableData.Cable> mixed = data.mixedAt(pos);
        if (mixed.isEmpty()) return false;
        int phase = data.phase(pos) % 3 + 1;
        data.phases.put(pos, phase);
        InfrastructureSavedData sd = InfrastructureSavedData.load(level);
        for (CableData.Cable c : mixed) {
            InWorldNode[] old = c.cores.get(0);
            if (sd.isConnected(old[0], old[1])) sd.removeConnectionNoDrops(new InWorldNodeConnection(old[0], old[1]));
            BlockState sa = level.getBlockState(c.a.sourcePos());
            BlockState sb = level.getBlockState(c.b.sourcePos());
            CableEnd a = CableEnd.of(c.a.sourcePos(), sa);
            CableEnd b = CableEnd.of(c.b.sourcePos(), sb);
            if (a == null || b == null) continue;
            InWorldNode[] core = mixedCore(a, b, c.mixedEnd, phase, 1);
            sd.connect(core[0], core[1], CableWires.core(c.kind));
            c.cores.set(0, core);
        }
        data.setDirty();
        AllSoundEvents.WRENCH_ROTATE.playOnServer(level, pos);
        if (player != null) player.displayClientMessage(Component.translatable("ee_extras.cable.phase", "L" + phase), true);
        return true;
    }

    static InteractionResult deny(Level level, Player player, BlockPos pos, String key) {
        AllSoundEvents.DENY.playOnServer(level, pos);
        player.displayClientMessage(Component.translatable("ee_extras.cable." + key), true);
        return InteractionResult.FAIL;
    }

    private CableLaying() {
    }
}
