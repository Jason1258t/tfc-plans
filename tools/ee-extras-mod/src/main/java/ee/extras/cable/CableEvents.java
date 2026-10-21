package ee.extras.cable;

import com.george_vi.electroenergetics.content.bundled_wire.BundledWireItem;
import com.george_vi.electroenergetics.content.bundled_wire.BundledWireTerminationBlock;
import com.simibubi.create.content.equipment.wrench.WrenchItem;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import net.neoforged.neoforge.event.tick.LevelTickEvent;

/** События игры: катушка двухпроводного кабеля EE, ключ по соединителю EE (фаза), сверка кабелей */
public final class CableEvents {
    public static void register(IEventBus bus) {
        bus.addListener(CableEvents::rightClick);
        bus.addListener(CableEvents::tick);
    }

    /**
     * До предмета и блока: катушка двухпроводного кабеля EE прокладывает кабель (своя прокладка вместо недоделанной);
     * ключ Create по двухпроводному соединителю EE с четырёхжильным кабелем переключает фазу, а не поворачивает блок.
     * Отменяется и на клиенте (иначе он предскажет поворот) — пакет на сервер всё равно уходит (MultiPlayerGameMode).
     */
    static void rightClick(PlayerInteractEvent.RightClickBlock e) {
        ItemStack stack = e.getItemStack();
        Level level = e.getLevel();
        BlockPos pos = e.getPos();
        if (stack.getItem() instanceof BundledWireItem && !(stack.getItem() instanceof FourCoreSpoolItem)) {
            InteractionResult r = CableLaying.use(level, e.getEntity(), stack, pos, CableKind.DUPLEX);
            if (r != null) {
                e.setCanceled(true);
                e.setCancellationResult(r);
            }
            return;
        }
        if (!(stack.getItem() instanceof WrenchItem) || e.getEntity().isShiftKeyDown()) return;
        BlockState state = level.getBlockState(pos);
        if (!(state.getBlock() instanceof BundledWireTerminationBlock) || state.getBlock() instanceof CableEndBlock) return;
        boolean phase = level instanceof ServerLevel sl
                ? CableLaying.cyclePhase(sl, pos, e.getEntity())
                : CableClient.hasFourCore(CableEnd.of(pos, state));
        if (phase) {
            e.setCanceled(true);
            e.setCancellationResult(InteractionResult.SUCCESS);
        }
    }

    static void tick(LevelTickEvent.Post e) {
        if (e.getLevel() instanceof ServerLevel sl && sl.getGameTime() % CableData.CHECK_TICKS == 0)
            CableData.get(sl).check(sl);
    }

    private CableEvents() {
    }
}
