package ee.extras.cable;

import com.george_vi.electroenergetics.content.bundled_wire.BundledWireTerminationBlock;
import com.george_vi.electroenergetics.content.bundled_wire.BundledWireType;
import com.george_vi.electroenergetics.foundation.nodes.NodeConfigurator;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/**
 * Блок, к которому подходит кабель: узел 0 — точка кабеля (оболочки), узлы 1…n — жилы. Наследник соединителя
 * двухпроводного кабеля EE: подсветку узла и «пунктир» будущего кабеля при катушке в руке EE рисует для всех его
 * наследников (BundledWireApplyingBehaviour, только клиент), а катушку обслуживает CableLaying. Свойство FLIP
 * от EE остаётся в блокстейте, но не используется: положение — FACING и ROLL, как у остальных блоков EE.
 */
public abstract class CableEndBlock extends BundledWireTerminationBlock {
    public final CableKind kind;
    private final NodeConfigurator nodes;
    private final NodeConfigurator nodesRolled;

    protected CableEndBlock(Properties properties, CableKind kind, float[][] points) {
        super(properties, BundledWireType.DUPLEX);
        this.kind = kind;
        this.nodes = configurator(points, false);
        this.nodesRolled = configurator(points, true);
    }

    /** Точки {x, y, z} в пикселях для блока лицом вверх; крен — (x, z) → (16 − z, x), как у выпрямителей */
    static NodeConfigurator configurator(float[][] points, boolean rolled) {
        NodeConfigurator.Builder b = new NodeConfigurator.Builder();
        for (float[] p : points) {
            if (rolled) b.add(16 - p[2], p[1], p[0]);
            else b.add(p[0], p[1], p[2]);
        }
        return b.simple();
    }

    NodeConfigurator config(BlockState state) {
        return state.getValue(ROLL) ? nodesRolled : nodes;
    }

    @Override
    public BlockState getStateForPlacement(BlockPlaceContext context) {
        // Как DirectionalRolledDeviceBlock EE: лицом к грани, по которой кликнули; на полу и потолке крен — по взгляду
        Direction face = context.getClickedFace();
        BlockState state = defaultBlockState().setValue(FACING, face).setValue(FLIP, false);
        if (face.getAxis().isVertical())
            state = state.setValue(ROLL, context.getHorizontalDirection().getAxis() == Direction.Axis.X);
        return withWater(state, context);
    }

    @Override
    public Map<Integer, Vec3> getNodePositions(Level level, BlockPos pos, BlockState state) {
        return config(state).getNodes(state.getValue(FACING));
    }

    @Override
    public Vec3 getNodePosition(Level level, BlockPos pos, BlockState state, int id) {
        return config(state).getNodePos(state.getValue(FACING), id);
    }
}
