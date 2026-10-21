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
 * наследников (BundledWireApplyingBehaviour, только клиент; в EE 1.1.2 его никто не вызывает — вызывает CableHud),
 * а катушку обслуживает CableLaying. Положение — FACING и четыре поворота вокруг него (ROLL и FLIP от EE,
 * CableOrientation): ключ по лицевой грани перебирает все четыре.
 */
public abstract class CableEndBlock extends BundledWireTerminationBlock {
    public final CableKind kind;
    private final NodeConfigurator[] nodes = new NodeConfigurator[4];

    protected CableEndBlock(Properties properties, CableKind kind, float[][] points) {
        super(properties, BundledWireType.DUPLEX);
        this.kind = kind;
        for (int o = 0; o < 4; o++) nodes[o] = configurator(points, o);
    }

    /** Точки {x, y, z} в пикселях для блока лицом вверх, o раз повёрнутые креном (x, z) → (16 − z, x), как у выпрямителей */
    static NodeConfigurator configurator(float[][] points, int o) {
        NodeConfigurator.Builder b = new NodeConfigurator.Builder();
        for (float[] p : points) {
            float x = p[0], z = p[2];
            for (int i = 0; i < o; i++) {
                float t = x;
                x = 16 - z;
                z = t;
            }
            b.add(x, p[1], z);
        }
        return b.simple();
    }

    NodeConfigurator config(BlockState state) {
        return nodes[CableOrientation.of(state)];
    }

    @Override
    public BlockState getStateForPlacement(BlockPlaceContext context) {
        // Лицом к грани, по которой кликнули (как у блоков EE); вывод кабеля — от игрока на полу и потолке, вверх на стене
        Direction face = context.getClickedFace();
        Vec3 want = CableOrientation.desired(face, context.getHorizontalDirection());
        int o = CableOrientation.best(i -> nodes[i].getNodePos(face, 0), want);
        return withWater(CableOrientation.with(defaultBlockState().setValue(FACING, face), o), context);
    }

    /** Ключ по лицевой или задней грани — следующее из четырёх положений (у EE — только крен, два положения) */
    @Override
    public BlockState getRotatedBlockState(BlockState state, Direction targetedFace) {
        if (targetedFace.getAxis() != state.getValue(FACING).getAxis()) return super.getRotatedBlockState(state, targetedFace);
        return CableOrientation.with(state, CableOrientation.nextOwn(CableOrientation.of(state)));
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
