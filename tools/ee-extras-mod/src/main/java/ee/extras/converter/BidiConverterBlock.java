package ee.extras.converter;

import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.CEELang;
import com.george_vi.electroenergetics.foundation.base.DirectionalRolledDeviceBlock;
import com.george_vi.electroenergetics.foundation.nodes.NodeConfigurator;
import com.simibubi.create.foundation.block.IBE;
import ee.extras.EeExtras;
import ee.extras.Layout;
import ee.extras.RectifierBlock;
import java.util.Map;
import net.createmod.catnip.math.VoxelShaper;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * Двусторонний преобразователь: плита как у выпрямителей, четыре клеммы сверху (Layout.CONVERTER), снизу — FE.
 * Ставится задней гранью на конденсатор IE (или другой блок с FE); режим не переключается — заряд и разряд работают
 * одновременно, каждый на своей паре клемм.
 */
public class BidiConverterBlock extends DirectionalRolledDeviceBlock<BidiConverterDevice> implements IBE<BidiConverterBlockEntity> {
    private static final VoxelShaper SHAPE = VoxelShaper.forDirectional(box(0, 0, 0, 16, 7, 16), Direction.UP);
    private static final Layout LAYOUT = Layout.CONVERTER;
    private final NodeConfigurator nodes = RectifierBlock.nodes(LAYOUT, false);
    private final NodeConfigurator nodesRolled = RectifierBlock.nodes(LAYOUT, true);

    public BidiConverterBlock(Properties properties) {
        super(properties);
    }

    private NodeConfigurator config(BlockState state) {
        return state.getValue(ROLL) ? nodesRolled : nodes;
    }

    @Override
    public SimulatedDeviceType<BidiConverterDevice> getDevice() {
        return EeExtras.CONVERTER_DEVICE.get();
    }

    /** Новое устройство EE сразу с напряжением из колёсика (после перестановки блока его помнит блок) */
    @Override
    public CompoundTag getDefaultDeviceData(Level level, BlockPos pos, BlockState state) {
        CompoundTag tag = new CompoundTag();
        if (level.getBlockEntity(pos) instanceof BidiConverterBlockEntity be) tag.putDouble("Voltage", be.volts());
        return tag;
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
        // Свои подписи (ee_extras.nodes.*): у EE нет «заряд/разряд», а «вход/выход» здесь путает — оба про сеть EE
        String[] labels = LAYOUT.labels();
        return node >= 0 && node < labels.length ? Component.translatable("ee_extras.nodes." + labels[node])
                : CEELang.nodeLabel("node");
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return SHAPE.get(state.getValue(FACING));
    }

    @Override
    public Class<BidiConverterBlockEntity> getBlockEntityClass() {
        return BidiConverterBlockEntity.class;
    }

    @Override
    public BlockEntityType<? extends BidiConverterBlockEntity> getBlockEntityType() {
        return EeExtras.CONVERTER_BE.get();
    }
}
