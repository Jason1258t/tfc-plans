package ee.extras.ac;

import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import ee.extras.Layout;
import ee.extras.Tier;
import java.util.Map;
import java.util.function.Supplier;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/**
 * Синхронизатор: красный сигнал подгонки скорости генератора на двух боковых гранях. «Быстрее» — грань со стороны
 * последней клеммы ряда генератора (L3 у трёхфазного, N у однофазного), «медленнее» — напротив (со стороны L1).
 * Направление берётся из настоящих положений клемм (NodeConfigurator EE), поэтому верно при любом повороте и крене.
 * Сигнал — как у рычага (15), только на соседа с этой грани; провести к щёткам генератора EE: у них справа
 * «быстрее», слева «медленнее».
 */
public class SynchronizerBlock extends AcBlock<SynchronizerDevice, SynchronizerBlockEntity> {
    public SynchronizerBlock(Properties properties, Layout layout, Tier tier,
            Supplier<SimulatedDeviceType<SynchronizerDevice>> device,
            Supplier<BlockEntityType<? extends SynchronizerBlockEntity>> beType) {
        super(properties, layout, tier, device, SynchronizerBlockEntity.class, beType);
    }

    /** Грань «быстрее» в мире: от первой клеммы ряда генератора к последней */
    public Direction fasterFace(Level level, BlockPos pos, BlockState state) {
        Map<Integer, Vec3> nodes = getNodePositions(level, pos, state);
        Vec3 first = nodes.get(0), last = nodes.get(layout().inputs() - 1);
        Vec3 d = last.subtract(first);
        return Direction.getNearest(d.x, d.y, d.z);
    }

    @Override
    protected boolean isSignalSource(BlockState state) {
        return true;
    }

    @Override
    protected int getSignal(BlockState state, BlockGetter getter, BlockPos pos, Direction side) {
        if (!(getter instanceof Level level) || !(level.getBlockEntity(pos) instanceof SynchronizerBlockEntity be)) return 0;
        if (be.signal == SynchronizerDevice.NONE) return 0;
        // side — направление от соседа к этому блоку: сосед за гранью f спрашивает с side = f.getOpposite()
        Direction faster = fasterFace(level, pos, state);
        Direction face = be.signal == SynchronizerDevice.FASTER ? faster : faster.getOpposite();
        return side == face.getOpposite() ? 15 : 0;
    }
}
