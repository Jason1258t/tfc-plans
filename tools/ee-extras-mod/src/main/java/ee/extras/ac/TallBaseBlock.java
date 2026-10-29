package ee.extras.ac;

import com.george_vi.electroenergetics.CEEFluids;
import com.george_vi.electroenergetics.foundation.ProperOilAndWaterloggedBlock;
import com.george_vi.electroenergetics.foundation.ProperOilAndWaterloggedBlock.LoggedState;
import com.simibubi.create.content.equipment.wrench.IWrenchable;
import java.util.function.Supplier;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.LevelAccessor;
import net.minecraft.world.level.LevelReader;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.EnumProperty;
import net.minecraft.world.level.material.FluidState;
import net.minecraft.world.level.material.Fluids;

/**
 * Нижняя половина промышленного шкафа (без своего предмета и устройства EE): держит верхнюю, бывает в воде и масле
 * (масло охлаждает, как у трансформатора EE). Без верхней половины исчезает; сломанная — выпадает предмет шкафа
 * (таблица добычи), верхняя половина при этом исчезает без выпадения.
 */
public class TallBaseBlock extends Block implements ProperOilAndWaterloggedBlock, IWrenchable {
    public static final EnumProperty<LoggedState> LOGGED_STATE = ProperOilAndWaterloggedBlock.LOGGED_STATE;
    private final Supplier<? extends Block> top;

    public TallBaseBlock(Properties properties, Supplier<? extends Block> top) {
        super(properties);
        this.top = top;
        registerDefaultState(defaultBlockState().setValue(LOGGED_STATE, LoggedState.DRY));
    }

    static BlockState placed(Block base, Level level, BlockPos pos) {
        FluidState fluid = level.getFluidState(pos);
        LoggedState logged = fluid.getType() == Fluids.WATER ? LoggedState.WATERLOGGED
                : fluid.getType() == CEEFluids.TRANSFORMER_OIL.getSource() ? LoggedState.OILLOGGED : LoggedState.DRY;
        return base.defaultBlockState().setValue(LOGGED_STATE, logged);
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(LOGGED_STATE);
    }

    @Override
    protected FluidState getFluidState(BlockState state) {
        return fluidState(state);
    }

    @Override
    protected BlockState updateShape(BlockState state, Direction direction, BlockState neighbor, LevelAccessor level,
            BlockPos pos, BlockPos neighborPos) {
        updateWater(level, state, pos);
        if (direction == Direction.UP && !neighbor.is(top.get())) return Blocks.AIR.defaultBlockState();
        return super.updateShape(state, direction, neighbor, level, pos, neighborPos);
    }

    @Override
    public ItemStack getCloneItemStack(LevelReader level, BlockPos pos, BlockState state) {
        return new ItemStack(top.get());
    }

    @Override
    protected boolean propagatesSkylightDown(BlockState state, BlockGetter level, BlockPos pos) {
        return false;
    }
}
