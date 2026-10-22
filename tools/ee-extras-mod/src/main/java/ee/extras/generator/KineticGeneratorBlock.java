package ee.extras.generator;

import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.CEELang;
import com.george_vi.electroenergetics.foundation.ProperOilAndWaterloggedBlock;
import com.george_vi.electroenergetics.foundation.ProperOilAndWaterloggedBlock.LoggedState;
import com.george_vi.electroenergetics.foundation.base.DirectionalKineticElectricBlock;
import com.george_vi.electroenergetics.foundation.base.DirectionalRolledDeviceBlock;
import com.george_vi.electroenergetics.foundation.nodes.NodeConfigurator;
import com.simibubi.create.foundation.block.IBE;
import ee.extras.EeExtras;
import ee.extras.Layout;
import ee.extras.PowerBlock;
import java.util.Map;
import net.createmod.catnip.math.VoxelShaper;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.Direction.Axis;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.LevelAccessor;
import net.minecraft.world.level.LevelReader;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.BooleanProperty;
import net.minecraft.world.level.block.state.properties.EnumProperty;
import net.minecraft.world.level.material.FluidState;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * Компактный кинетический генератор: вал Create — в задней грани, клеммы постоянного тока «+» и «−» — на лицевой
 * (FACING, раскладка Layout.COMPACT_GENERATOR). Блок кинетический, как щёточный узел EE (DirectionalKineticElectricBlock),
 * а поведение в воде и масле, крен и повороты — как у плит EE (DirectionalRolledDeviceBlock).
 */
public class KineticGeneratorBlock extends DirectionalKineticElectricBlock<GeneratorDevice>
        implements IBE<KineticGeneratorBlockEntity>, ProperOilAndWaterloggedBlock {
    public static final BooleanProperty ROLL = DirectionalRolledDeviceBlock.ROLL;
    public static final EnumProperty<LoggedState> LOGGED_STATE = ProperOilAndWaterloggedBlock.LOGGED_STATE;
    private static final VoxelShaper SHAPE = VoxelShaper.forDirectional(box(1, 0, 1, 15, 16, 15), Direction.UP);
    private static final NodeConfigurator NODES = PowerBlock.nodes(Layout.COMPACT_GENERATOR, false, Layout.GENERATOR_Y);
    private static final NodeConfigurator NODES_ROLLED = PowerBlock.nodes(Layout.COMPACT_GENERATOR, true, Layout.GENERATOR_Y);

    public KineticGeneratorBlock(Properties properties) {
        super(properties);
        registerDefaultState(defaultBlockState().setValue(LOGGED_STATE, LoggedState.DRY).setValue(ROLL, false));
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        super.createBlockStateDefinition(builder);
        builder.add(LOGGED_STATE, ROLL);
    }

    /** Лицом от грани, по которой кликнули: задняя грань (вал) — к блоку под рукой, как у вала на торце */
    @Override
    public BlockState getStateForPlacement(BlockPlaceContext context) {
        Direction face = context.getClickedFace();
        BlockState state = defaultBlockState().setValue(FACING, face);
        if (face.getAxis().isVertical()) state = state.setValue(ROLL, context.getHorizontalDirection().getAxis() == Axis.X);
        return withWater(state, context);
    }

    @Override
    protected FluidState getFluidState(BlockState state) {
        return fluidState(state);
    }

    @Override
    protected BlockState updateShape(BlockState state, Direction direction, BlockState neighborState, LevelAccessor level,
            BlockPos pos, BlockPos neighborPos) {
        updateWater(level, state, pos);
        return super.updateShape(state, direction, neighborState, level, pos, neighborPos);
    }

    @Override
    public BlockState getRotatedBlockState(BlockState originalState, Direction targetedFace) {
        return targetedFace.getAxis() == originalState.getValue(FACING).getAxis()
                ? originalState.cycle(ROLL)
                : super.getRotatedBlockState(originalState, targetedFace);
    }

    @Override
    public BlockState rotate(BlockState state, Rotation rotation) {
        return state.getValue(FACING).getAxis() == Axis.Y
                && (rotation == Rotation.CLOCKWISE_90 || rotation == Rotation.COUNTERCLOCKWISE_90)
                ? state.cycle(ROLL)
                : state.setValue(FACING, rotation.rotate(state.getValue(FACING)));
    }

    @Override
    public BlockState mirror(BlockState state, Mirror mirror) {
        return state.setValue(FACING, mirror.mirror(state.getValue(FACING)));
    }

    @Override
    public Axis getRotationAxis(BlockState state) {
        return state.getValue(FACING).getAxis();
    }

    @Override
    public boolean hasShaftTowards(LevelReader world, BlockPos pos, BlockState state, Direction face) {
        return face == state.getValue(FACING).getOpposite();
    }

    private static NodeConfigurator config(BlockState state) {
        return state.getValue(ROLL) ? NODES_ROLLED : NODES;
    }

    @Override
    public SimulatedDeviceType<GeneratorDevice> getDevice() {
        return EeExtras.KINETIC_GENERATOR_DEVICE.get();
    }

    @Override
    public Map<Integer, Vec3> getNodePositions(Level level, BlockPos pos, BlockState state) {
        return config(state).getNodes(state.getValue(FACING));
    }

    @Override
    public Vec3 getNodePosition(Level level, BlockPos pos, BlockState state, int node) {
        return config(state).getNodePos(state.getValue(FACING), node);
    }

    @Override
    public MutableComponent getNodeLabel(Level level, BlockPos pos, BlockState state, int node) {
        String[] labels = Layout.COMPACT_GENERATOR.labels();
        return CEELang.nodeLabel(node >= 0 && node < labels.length ? labels[node] : "node");
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return SHAPE.get(state.getValue(FACING));
    }

    @Override
    protected VoxelShape getOcclusionShape(BlockState state, BlockGetter level, BlockPos pos) {
        return net.minecraft.world.phys.shapes.Shapes.empty();
    }

    @Override
    public Class<KineticGeneratorBlockEntity> getBlockEntityClass() {
        return KineticGeneratorBlockEntity.class;
    }

    @Override
    public BlockEntityType<? extends KineticGeneratorBlockEntity> getBlockEntityType() {
        return EeExtras.KINETIC_GENERATOR_BE.get();
    }
}
