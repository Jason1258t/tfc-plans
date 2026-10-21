package ee.extras.cable;

import com.george_vi.electroenergetics.content.bundled_wire.BundledWireNodeConfigurator;
import com.george_vi.electroenergetics.content.bundled_wire.BundledWireTerminationBlock;
import java.util.function.IntFunction;
import net.minecraft.core.Direction;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/**
 * Четыре положения блока кабеля вокруг грани, на которой он стоит: o = ROLL + 2·FLIP. У EE ключ меняет только ROLL
 * (DirectionalRolledDeviceBlock.getRotatedBlockState), а FLIP ставит лишь установка — по четверти грани, куда
 * кликнули (AccumulatorBlock.desirableState), поэтому ключом доступны два положения из четырёх. Здесь — все четыре.
 *
 * У двухпроводного соединителя EE сторона кабеля s = o (BundledWireNodeConfigurator, по байткоду 1.1.2): лицом вверх
 * 0 — юг, 1 — восток, 2 — север, 3 — запад. У своих блоков o — o раз крен (x, z) → (16 − z, x): юг, запад, север, восток.
 */
public final class CableOrientation {
    public static int of(BlockState state) {
        return (state.getValue(BundledWireTerminationBlock.ROLL) ? 1 : 0)
                + (state.getValue(BundledWireTerminationBlock.FLIP) ? 2 : 0);
    }

    public static BlockState with(BlockState state, int o) {
        return state.setValue(BundledWireTerminationBlock.ROLL, (o & 1) != 0)
                .setValue(BundledWireTerminationBlock.FLIP, (o & 2) != 0);
    }

    /** Куда при установке смотрит вывод кабеля: на полу и потолке — от игрока, на стене — вверх */
    public static Vec3 desired(Direction face, Direction look) {
        return face.getAxis().isVertical() ? Vec3.atLowerCornerOf(look.getNormal()) : new Vec3(0, 1, 0);
    }

    /** Положение, в котором точка кабеля (в блоке, 0…1) дальше всего в сторону want; при равенстве — меньшее */
    public static int best(IntFunction<Vec3> cablePoint, Vec3 want) {
        int best = 0;
        double score = Double.NEGATIVE_INFINITY;
        for (int o = 0; o < 4; o++) {
            double s = cablePoint.apply(o).subtract(0.5, 0.5, 0.5).dot(want);
            if (s > score + 1e-6) {
                score = s;
                best = o;
            }
        }
        return best;
    }

    /** Точка кабеля двухпроводного соединителя EE в положении o */
    public static Vec3 eeCablePoint(Direction facing, int o) {
        return BundledWireNodeConfigurator.getPos(facing, 0x1000 | o << 4);
    }

    /** Следующее положение по ключу: по часовой стрелке, если смотреть на лицевую сторону блока, стоящего на полу */
    public static int nextEe(int o) {
        return (o + 3) % 4;
    }

    public static int nextOwn(int o) {
        return (o + 1) % 4;
    }

    private CableOrientation() {
    }
}
