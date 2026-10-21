package ee.extras.cable;

import com.george_vi.electroenergetics.foundation.CEELang;
import ee.extras.Layout;
import net.createmod.catnip.math.VoxelShaper;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * Четырёхжильный соединитель: четыре клеммы под обычные провода (L1, L2, L3, N — контакты 1–4) и вывод кабеля
 * (узел 0). Внутри ничего нет — жилы кабеля приходят прямо на клеммы. Координаты — Layout.FOUR_CORE_TERMINATION, те же — в art/cables.py.
 */
public class FourCoreTerminationBlock extends CableEndBlock {
    static final String[] LABELS = {"node", "phase_1", "phase_2", "phase_3", "neutral"};
    private static final VoxelShaper SHAPE = VoxelShaper.forDirectional(box(0, 0, 1, 16, 5, 13), Direction.UP);
    private static final VoxelShaper SHAPE_ROLLED = VoxelShaper.forDirectional(box(3, 0, 0, 15, 5, 16), Direction.UP);

    public FourCoreTerminationBlock(Properties properties) {
        super(properties, CableKind.FOUR_CORE, Layout.FOUR_CORE_TERMINATION);
    }

    @Override
    public boolean isNodeAccessible(Level level, BlockPos pos, BlockState state, int id) {
        return id != 0;
    }

    @Override
    public MutableComponent getNodeLabel(Level level, BlockPos pos, BlockState state, int node) {
        return CEELang.nodeLabel(node >= 0 && node < LABELS.length ? LABELS[node] : "node");
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return (state.getValue(ROLL) ? SHAPE_ROLLED : SHAPE).get(state.getValue(FACING));
    }
}
