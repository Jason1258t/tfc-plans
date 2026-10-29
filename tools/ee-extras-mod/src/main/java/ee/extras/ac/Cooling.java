package ee.extras.ac;

import com.george_vi.electroenergetics.CEEFluids;
import com.george_vi.electroenergetics.CEETags;
import java.util.HashSet;
import java.util.Set;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.tags.FluidTags;
import net.minecraft.world.level.Level;

/**
 * Охлаждение промышленного шкафа — как у трансформатора EE 1.1.2 (по байткоду TransformerCoreBlockEntity.lazyTick и
 * heatDissipatorsDFS): обход соседей не дальше 4 блоков от шкафа по блокам тега electroenergetics:transformer_heat_dissipators
 * (радиаторная панель EE, блоки железа, стали, цинка, промышленного железа…), а из блока в воде или масле — и по
 * соседней жидкости. Каждый найденный блок даёт 1/√расстояния до середины шкафа; итог — 1 + сумма, × 0,7 за каждую
 * из двух половин шкафа не в трансформаторном масле. Номинал шкафа = Tier.INDUSTRIAL.watts × множитель.
 */
public final class Cooling {
    private Cooling() {}

    /** top — верхняя половина (клеммы, устройство EE), под ней — нижняя */
    public static double factor(Level level, BlockPos top) {
        BlockPos bottom = top.below();
        Set<BlockPos> visited = new HashSet<>();
        visited.add(top);
        visited.add(bottom);
        walk(level, top, top, visited);
        walk(level, top, bottom, visited);
        double centerY = top.getY();
        double f = 1;
        for (BlockPos p : visited) {
            if (p.equals(top) || p.equals(bottom)) continue;
            double dx = p.getX() - top.getX(), dy = p.getY() + 0.5 - centerY, dz = p.getZ() - top.getZ();
            f += 1 / Math.sqrt(Math.sqrt(dx * dx + dy * dy + dz * dz));
        }
        if (!oil(level, top)) f *= 0.7;
        if (!oil(level, bottom)) f *= 0.7;
        return f;
    }

    private static boolean oil(Level level, BlockPos pos) {
        return level.getFluidState(pos).is(CEEFluids.TRANSFORMER_OIL.get().getSource());
    }

    private static void walk(Level level, BlockPos top, BlockPos current, Set<BlockPos> visited) {
        boolean wet = level.getFluidState(current).is(FluidTags.WATER) || oil(level, current);
        for (Direction d : Direction.values()) {
            BlockPos next = current.relative(d);
            if (next.distSqr(top) > 16 || !level.isLoaded(next)) continue;
            boolean ok = wet && !level.getFluidState(next).isEmpty()
                    || level.getBlockState(next).is(CEETags.TRANSFORMER_HEAT_DISSIPATORS);
            if (ok && visited.add(next)) walk(level, top, next, visited);
        }
    }
}
