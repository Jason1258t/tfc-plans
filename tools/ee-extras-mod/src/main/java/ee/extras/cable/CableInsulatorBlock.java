package ee.extras.cable;

import com.george_vi.electroenergetics.CEEShapes;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * Кабельный изолятор: опора и развилка кабеля одного вида. Как опорный изолятор EE (форма и точка — его), только
 * провод к нему не прицепить: все узлы скрыты. Жилы всех кабелей, пришедших на изолятор, сходятся в его узлах 1…n —
 * так кабель продолжается и ветвится.
 */
public class CableInsulatorBlock extends CableEndBlock {
    public CableInsulatorBlock(Properties properties, CableKind kind) {
        super(properties, kind, points(kind));
    }

    /** Все узлы в одной точке — там, где у опорного изолятора EE (короткий, 0,3125 блока над основанием) */
    static float[][] points(CableKind kind) {
        float[][] out = new float[kind.conductors + 1][];
        for (int i = 0; i < out.length; i++) out[i] = new float[] {8, 5, 8};
        return out;
    }

    @Override
    public boolean isNodeAccessible(Level level, BlockPos pos, BlockState state, int id) {
        return false;
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return CEEShapes.CONNECTOR.get(state.getValue(FACING));
    }
}
