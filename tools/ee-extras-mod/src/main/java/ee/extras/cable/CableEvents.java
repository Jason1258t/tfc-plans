package ee.extras.cable;

import com.george_vi.electroenergetics.content.bundled_wire.BundledWireItem;
import com.george_vi.electroenergetics.content.bundled_wire.BundledWireTerminationBlock;
import com.george_vi.electroenergetics.simulation.infrastructure.InWorldNodeData;
import com.george_vi.electroenergetics.simulation.infrastructure.InfrastructureSavedData;
import com.simibubi.create.AllSoundEvents;
import ee.extras.lantern.LanternConversion;
import ee.extras.lines.Tension;
import com.simibubi.create.content.equipment.wrench.WrenchItem;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import net.neoforged.neoforge.event.level.BlockEvent;
import net.neoforged.neoforge.event.tick.LevelTickEvent;

/**
 * События игры: катушка двухпроводного кабеля EE (и по фонарю IE — LanternConversion), ключ и установка
 * двухпроводного соединителя EE (фаза, четыре положения вместо двух), сверка кабелей
 */
public final class CableEvents {
    public static void register(IEventBus bus) {
        bus.addListener(CableEvents::rightClick);
        bus.addListener(CableEvents::placed);
        bus.addListener(CableEvents::tick);
    }

    /**
     * До предмета и блока: катушка двухпроводного кабеля EE прокладывает кабель (своя прокладка вместо недоделанной);
     * ключ Create по двухпроводному соединителю EE с четырёхжильным кабелем переключает фазу, а не поворачивает блок;
     * без него ключ по лицевой или задней грани перебирает четыре положения (у EE — только крен, два).
     * Отменяется и на клиенте (иначе он предскажет поворот) — пакет на сервер всё равно уходит (MultiPlayerGameMode).
     */
    static void rightClick(PlayerInteractEvent.RightClickBlock e) {
        ItemStack stack = e.getItemStack();
        Level level = e.getLevel();
        BlockPos pos = e.getPos();
        if (stack.getItem() instanceof BundledWireItem && !(stack.getItem() instanceof FourCoreSpoolItem)) {
            // Фонарь IE сначала становится фонарём в сети EE, затем клик идёт в прокладку как обычно
            if (LanternConversion.isIeLantern(level.getBlockState(pos))) {
                InteractionResult c = LanternConversion.convert(level, pos, e.getEntity());
                if (c != null) {
                    e.setCanceled(true);
                    e.setCancellationResult(c);
                    return;
                }
            }
            InteractionResult r = CableLaying.use(level, e.getEntity(), stack, pos, CableKind.DUPLEX);
            if (r != null) {
                e.setCanceled(true);
                e.setCancellationResult(r);
            }
            return;
        }
        if (!(stack.getItem() instanceof WrenchItem) || e.getEntity().isShiftKeyDown()) return;
        BlockState state = level.getBlockState(pos);
        boolean tap = state.getBlock() instanceof PhaseTapBlock;
        if (!(state.getBlock() instanceof BundledWireTerminationBlock) || state.getBlock() instanceof CableEndBlock && !tap) return;
        boolean phase = level instanceof ServerLevel sl
                ? CableLaying.cyclePhase(sl, pos, e.getEntity())
                : CableClient.hasFourCore(CableEnd.of(pos, state));
        if (phase) {
            e.setCanceled(true);
            e.setCancellationResult(InteractionResult.SUCCESS);
            return;
        }
        if (tap) return; // без кабеля — поворот самим блоком (CableEndBlock.getRotatedBlockState)
        Direction face = e.getHitVec().getDirection();
        if (face.getAxis() != state.getValue(BundledWireTerminationBlock.FACING).getAxis()) return;
        e.setCanceled(true);
        e.setCancellationResult(level instanceof ServerLevel sl ? rotateEe(sl, pos, state, e.getEntity()) : InteractionResult.SUCCESS);
    }

    /**
     * Поворот соединителя EE ключом. Номера узлов у него зависят от положения (сторона в номере), поэтому EE при
     * повороте сбросил бы подключённые провода (registerOrUpdateNodes) — с проводами не поворачиваем, просим снять.
     */
    public static InteractionResult rotateEe(ServerLevel level, BlockPos pos, BlockState state, Player player) {
        InfrastructureSavedData sd = InfrastructureSavedData.load(level);
        for (InWorldNodeData node : sd.getNodesAt(pos))
            if (!sd.getConnections(node).isEmpty()) return CableLaying.deny(level, player, pos, "rotate_wired");
        int o = CableOrientation.nextEe(CableOrientation.of(state));
        level.setBlock(pos, CableOrientation.with(state, o), Block.UPDATE_ALL);
        AllSoundEvents.WRENCH_ROTATE.playOnServer(level, pos);
        return InteractionResult.SUCCESS;
    }

    /**
     * Установка двухпроводного соединителя EE: EE выбирает положение по четверти грани, куда кликнули
     * (AccumulatorBlock.desirableState) — выглядит случайным. Как у своих блоков: вывод кабеля от игрока на полу и
     * потолке, вверх на стене. Событие приходит и на клиенте (CommonHooks.onPlaceItemIntoWorld) — он ставит то же.
     */
    static void placed(BlockEvent.EntityPlaceEvent e) {
        BlockState state = e.getPlacedBlock();
        if (!(state.getBlock() instanceof BundledWireTerminationBlock) || state.getBlock() instanceof CableEndBlock) return;
        if (e.getEntity() == null) return;
        Direction facing = state.getValue(BundledWireTerminationBlock.FACING);
        Vec3 want = CableOrientation.desired(facing, e.getEntity().getDirection());
        int o = CableOrientation.best(i -> CableOrientation.eeCablePoint(facing, i), want);
        if (o != CableOrientation.of(state)) e.getLevel().setBlock(e.getPos(), CableOrientation.with(state, o), Block.UPDATE_ALL);
    }

    static void tick(LevelTickEvent.Post e) {
        if (e.getLevel() instanceof ServerLevel sl && sl.getGameTime() % CableData.CHECK_TICKS == 0)
            CableData.get(sl).check(sl);
        if (e.getLevel() instanceof ServerLevel sl && sl.getGameTime() % Tension.CHECK_TICKS == 0) Tension.check(sl);
    }

    private CableEvents() {
    }
}
