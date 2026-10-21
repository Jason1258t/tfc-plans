package ee.extras.cable;

import com.george_vi.electroenergetics.content.bundled_wire.BundledWireTerminationBlock;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Конец кабеля в блоке: какой кабель сюда подходит и номера узлов. У своих блоков узел кабеля 0, жилы 1…n. У
 * двухпроводного соединителя EE (BundledWireNodeConfigurator, по байткоду 1.1.2) четыре стороны: сторона
 * s = 2·FLIP + ROLL, узлы 0x1000 | s << 4 | k — k = 0 кабель (скрыт), 1 и 2 — клеммы жил.
 *
 * @param eeTermination двухпроводной конец с выбором фазы — соединитель EE или отвод фазы (PhaseTapBlock): к нему можно
 *                      подвести и четырёхжильный кабель (ноль и фаза, фазу меняет ключ)
 */
public record CableEnd(BlockPos pos, CableKind kind, boolean eeTermination, int base) {
    /** Жила соединителя EE, на которую приходит ноль четырёхжильного кабеля; фаза — на жилу 1 */
    public static final int EE_NEUTRAL = 2;

    public static CableEnd of(BlockPos pos, BlockState state) {
        if (state.getBlock() instanceof PhaseTapBlock) return new CableEnd(pos, CableKind.DUPLEX, true, 0);
        if (state.getBlock() instanceof CableEndBlock b) return new CableEnd(pos, b.kind, false, 0);
        if (state.getBlock() instanceof BundledWireTerminationBlock) {
            int side = (state.getValue(BundledWireTerminationBlock.FLIP) ? 2 : 0)
                    + (state.getValue(BundledWireTerminationBlock.ROLL) ? 1 : 0);
            return new CableEnd(pos, CableKind.DUPLEX, true, 0x1000 | side << 4);
        }
        return null;
    }

    public InWorldNode cable() {
        return new InWorldNode(base, pos);
    }

    public InWorldNode conductor(int k) {
        return new InWorldNode(base + k, pos);
    }
}
