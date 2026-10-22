package small.diesel.electric;

import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.CEELang;
import com.george_vi.electroenergetics.foundation.base.DirectionalRolledDeviceBlock;
import com.george_vi.electroenergetics.foundation.nodes.NodeConfigurator;
import com.simibubi.create.foundation.block.IBE;
import java.util.Map;
import net.createmod.catnip.math.VoxelShaper;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.ItemInteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;
import net.neoforged.neoforge.fluids.FluidUtil;

/**
 * Малый дизельный генератор: направленный блок EE с креном (как преобразователь EE), клеммы постоянного тока на
 * лицевой грани — 0 «+» (красная), 1 «−» (синяя), раскладка — Terminals. Топливо — трубой с любой грани или ведром рукой.
 */
public class GeneratorBlock extends DirectionalRolledDeviceBlock<GeneratorDevice> implements IBE<GeneratorBlockEntity> {
    private static final VoxelShaper SHAPE = VoxelShaper.forDirectional(box(1, 0, 1, 15, 16, 15), Direction.UP);
    private static final NodeConfigurator NODES = Terminals.nodes(false);
    private static final NodeConfigurator NODES_ROLLED = Terminals.nodes(true);

    public GeneratorBlock(Properties properties) {
        super(properties);
    }

    private static NodeConfigurator config(BlockState state) {
        return state.getValue(ROLL) ? NODES_ROLLED : NODES;
    }

    @Override
    public SimulatedDeviceType<GeneratorDevice> getDevice() {
        return Electric.GENERATOR_DEVICE.get();
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
        // Подписи EE: «Выходной контакт — положительный / отрицательный»
        return CEELang.nodeLabel(node >= 0 && node < Terminals.LABELS.length ? Terminals.LABELS[node] : "node");
    }

    @Override
    protected ItemInteractionResult useItemOn(ItemStack stack, BlockState state, Level level, BlockPos pos, Player player,
            InteractionHand hand, BlockHitResult hit) {
        return FluidUtil.interactWithFluidHandler(player, hand, level, pos, null)
                ? ItemInteractionResult.sidedSuccess(level.isClientSide)
                : super.useItemOn(stack, state, level, pos, player, hand, hit);
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return SHAPE.get(state.getValue(FACING));
    }

    @Override
    public Class<GeneratorBlockEntity> getBlockEntityClass() {
        return GeneratorBlockEntity.class;
    }

    @Override
    public BlockEntityType<? extends GeneratorBlockEntity> getBlockEntityType() {
        return Electric.GENERATOR_BE.get();
    }
}
