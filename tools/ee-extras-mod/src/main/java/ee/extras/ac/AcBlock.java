package ee.extras.ac;

import com.george_vi.electroenergetics.devices.device.SimulatedDevice;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.simibubi.create.foundation.block.IBE;
import ee.extras.Layout;
import ee.extras.PowerBlock;
import ee.extras.Tier;
import java.util.function.Supplier;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.LevelAccessor;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import org.jetbrains.annotations.Nullable;

/**
 * Блок преобразователя частоты или синхронизатора: как выпрямитель (PowerBlock — клеммы сверху, поворот и крен как у
 * EE), плюс блок-сущность с окном значения. Промышленный — шкаф в два блока: этот блок — верхний (клеммы и
 * устройство EE: EE ищет клеммы только у блока, по которому кликнули), снизу — TallBaseBlock; стоит только вертикально,
 * ключ по любой грани меняет крен. Ставит его TallBlockItem (на блок выше места клика).
 */
public class AcBlock<D extends SimulatedDevice, B extends AcBlockEntity> extends PowerBlock<D> implements IBE<B> {
    private final Class<B> beClass;
    private final Supplier<BlockEntityType<? extends B>> beType;
    /** Нижняя половина промышленного шкафа */
    Supplier<? extends Block> base;

    public AcBlock(Properties properties, Layout layout, Tier tier, Supplier<SimulatedDeviceType<D>> device,
            Class<B> beClass, Supplier<BlockEntityType<? extends B>> beType) {
        super(properties, layout, tier, device);
        this.beClass = beClass;
        this.beType = beType;
    }

    boolean tall() {
        return tier() == Tier.INDUSTRIAL;
    }

    @Override
    public MutableComponent getNodeLabel(Level level, BlockPos pos, BlockState state, int node) {
        String[] labels = layout().labels();
        return Component.translatable("ee_extras.nodes." + (node >= 0 && node < labels.length ? labels[node] : "node"));
    }

    @Override
    public Class<B> getBlockEntityClass() {
        return beClass;
    }

    @Override
    public BlockEntityType<? extends B> getBlockEntityType() {
        return beType.get();
    }

    @Nullable
    @Override
    public BlockState getStateForPlacement(BlockPlaceContext context) {
        if (!tall()) return super.getStateForPlacement(context);
        return withWater(defaultBlockState().setValue(FACING, Direction.UP)
                .setValue(ROLL, context.getHorizontalDirection().getAxis() == Direction.Axis.X), context);
    }

    @Override
    public void setPlacedBy(Level level, BlockPos pos, BlockState state, @Nullable LivingEntity placer, ItemStack stack) {
        super.setPlacedBy(level, pos, state, placer, stack);
        if (tall() && !level.isClientSide) level.setBlock(pos.below(), TallBaseBlock.placed(base.get(), level, pos.below()), 3);
    }

    @Override
    protected BlockState updateShape(BlockState state, Direction direction, BlockState neighbor, LevelAccessor level,
            BlockPos pos, BlockPos neighborPos) {
        // Нижней половины не стало — шкаф разбирается целиком (выпадает предмет с той половины, которую сломали)
        if (tall() && direction == Direction.DOWN && !neighbor.is(base.get())) return Blocks.AIR.defaultBlockState();
        return super.updateShape(state, direction, neighbor, level, pos, neighborPos);
    }

    @Override
    public BlockState getRotatedBlockState(BlockState state, Direction face) {
        return tall() ? state.cycle(ROLL) : super.getRotatedBlockState(state, face);
    }

    @Override
    protected BlockState rotate(BlockState state, Rotation rotation) {
        if (!tall()) return super.rotate(state, rotation);
        return rotation == Rotation.CLOCKWISE_90 || rotation == Rotation.COUNTERCLOCKWISE_90 ? state.cycle(ROLL) : state;
    }
}
