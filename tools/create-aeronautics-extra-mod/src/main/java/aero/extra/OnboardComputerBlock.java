package aero.extra;

import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.CEELang;
import com.george_vi.electroenergetics.foundation.ProperOilAndWaterloggedBlock;
import com.george_vi.electroenergetics.foundation.ProperOilAndWaterloggedBlock.LoggedState;
import com.george_vi.electroenergetics.foundation.base.DirectionalKineticElectricBlock;
import com.george_vi.electroenergetics.foundation.base.DirectionalRolledDeviceBlock;
import com.george_vi.electroenergetics.foundation.nodes.NodeConfigurator;
import com.simibubi.create.foundation.block.IBE;
import java.util.Map;
import net.createmod.catnip.math.VoxelShaper;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.Direction.Axis;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.ItemInteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
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
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * Бортовой компьютер: вал Create — в задней грани (FACING смотрит лицевой панелью), клеммы «+» и «−» EE — на корпусе
 * (Terminals). Блок кинетический, как щёточный узел EE (DirectionalKineticElectricBlock), вода, масло, крен и повороты —
 * как у плит EE и компактного генератора EE Extras.
 *
 * Модуль в руке, правый клик — поставить; пустой рукой с Shift — вынуть последний. Сломанный блок роняет модули.
 */
public class OnboardComputerBlock extends DirectionalKineticElectricBlock<OnboardDevice>
        implements IBE<OnboardComputerBlockEntity>, ProperOilAndWaterloggedBlock {
    public static final BooleanProperty ROLL = DirectionalRolledDeviceBlock.ROLL;
    public static final EnumProperty<LoggedState> LOGGED_STATE = ProperOilAndWaterloggedBlock.LOGGED_STATE;
    private static final VoxelShaper SHAPE = VoxelShaper.forDirectional(box(1, 0, 1, 15, 16, 15), Direction.UP);
    private static final NodeConfigurator NODES = Terminals.nodes(false);
    private static final NodeConfigurator NODES_ROLLED = Terminals.nodes(true);

    public OnboardComputerBlock(Properties properties) {
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
    protected ItemInteractionResult useItemOn(ItemStack stack, BlockState state, Level level, BlockPos pos, Player player,
            InteractionHand hand, BlockHitResult hit) {
        if (!(stack.getItem() instanceof ModuleItem)) return ItemInteractionResult.PASS_TO_DEFAULT_BLOCK_INTERACTION;
        if (level.isClientSide) return ItemInteractionResult.SUCCESS;
        if (!(level.getBlockEntity(pos) instanceof OnboardComputerBlockEntity be)) return ItemInteractionResult.FAIL;
        if (!be.insert(stack)) {
            player.displayClientMessage(Component.translatable(AeroExtra.MOD_ID + ".message.full",
                    OnboardComputerBlockEntity.MAX_MODULES), true);
            return ItemInteractionResult.FAIL;
        }
        stack.consume(1, player);
        level.playSound(null, pos, SoundEvents.ITEM_FRAME_ADD_ITEM, SoundSource.BLOCKS, 1, 0.8f);
        return ItemInteractionResult.SUCCESS;
    }

    @Override
    protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player, BlockHitResult hit) {
        if (!player.isShiftKeyDown()) return InteractionResult.PASS;
        if (level.isClientSide) return InteractionResult.SUCCESS;
        if (!(level.getBlockEntity(pos) instanceof OnboardComputerBlockEntity be)) return InteractionResult.FAIL;
        ItemStack out = be.removeLast();
        if (out.isEmpty()) {
            player.displayClientMessage(Component.translatable(AeroExtra.MOD_ID + ".message.empty"), true);
            return InteractionResult.FAIL;
        }
        if (!player.addItem(out)) player.drop(out, false);
        level.playSound(null, pos, SoundEvents.ITEM_FRAME_REMOVE_ITEM, SoundSource.BLOCKS, 1, 0.8f);
        return InteractionResult.SUCCESS;
    }

    @Override
    public void onRemove(BlockState state, Level level, BlockPos pos, BlockState newState, boolean isMoving) {
        if (!state.is(newState.getBlock()) && !level.isClientSide
                && level.getBlockEntity(pos) instanceof OnboardComputerBlockEntity be)
            for (ItemStack stack : be.drops()) popResource(level, pos, stack);
        super.onRemove(state, level, pos, newState, isMoving);
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
    public SimulatedDeviceType<OnboardDevice> getDevice() {
        return AeroExtra.ONBOARD_COMPUTER_DEVICE.get();
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
        // Подписи из языковых файлов EE: «Выходной контакт — положительный» и т. п.
        return CEELang.nodeLabel(node >= 0 && node < Terminals.LABELS.length ? Terminals.LABELS[node] : "node");
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return SHAPE.get(state.getValue(FACING));
    }

    @Override
    public Class<OnboardComputerBlockEntity> getBlockEntityClass() {
        return OnboardComputerBlockEntity.class;
    }

    @Override
    public BlockEntityType<? extends OnboardComputerBlockEntity> getBlockEntityType() {
        return AeroExtra.ONBOARD_COMPUTER_BE.get();
    }
}
