package ee.extras.ac;

import ee.extras.TooltipBlockItem;
import net.minecraft.core.BlockPos;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.block.Block;
import org.jetbrains.annotations.Nullable;

/**
 * Предмет промышленного шкафа: ставит верхнюю половину (с клеммами) на блок выше места клика, нижнюю дорисует
 * AcBlock.setPlacedBy. Оба места должны быть свободны — иначе не ставится.
 */
public class TallBlockItem extends TooltipBlockItem {
    public TallBlockItem(Block block, Properties properties) {
        super(block, properties);
    }

    @Nullable
    @Override
    public BlockPlaceContext updatePlacementContext(BlockPlaceContext context) {
        BlockPos up = context.getClickedPos().above();
        if (!context.getLevel().getBlockState(up).canBeReplaced(context) || up.getY() >= context.getLevel().getMaxBuildHeight())
            return null;
        return BlockPlaceContext.at(context, up, context.getClickedFace());
    }
}
