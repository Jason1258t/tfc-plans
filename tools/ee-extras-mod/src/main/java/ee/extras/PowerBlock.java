package ee.extras;

import com.george_vi.electroenergetics.devices.device.SimulatedDevice;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.CEELang;
import com.george_vi.electroenergetics.foundation.base.DirectionalRolledDeviceBlock;
import com.george_vi.electroenergetics.foundation.nodes.NodeConfigurator;
import java.util.Map;
import java.util.function.Supplier;
import net.createmod.catnip.math.VoxelShaper;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * Блок выпрямителя или инвертора: лёгкий — плита как у преобразователя EE, тяжёлый — целый блок (Tier); клеммы
 * сверху (раскладка — Layout). Поворот по FACING делает NodeConfigurator EE (так же, как у его блоков), крен (ROLL) —
 * отдельная раскладка, повёрнутая на 90° вокруг оси блока.
 */
public class PowerBlock<D extends SimulatedDevice> extends DirectionalRolledDeviceBlock<D> {
    private static final VoxelShaper LIGHT_SHAPE = VoxelShaper.forDirectional(box(0, 0, 0, 16, 7, 16), Direction.UP);
    private static final VoxelShaper HEAVY_SHAPE = VoxelShaper.forDirectional(box(0, 0, 0, 16, 16, 16), Direction.UP);

    final Layout layout;
    final Tier tier;
    private final NodeConfigurator nodes;
    private final NodeConfigurator nodesRolled;
    private final Supplier<SimulatedDeviceType<D>> device;

    public PowerBlock(Properties properties, Layout layout, Tier tier, Supplier<SimulatedDeviceType<D>> device) {
        super(properties);
        this.layout = layout;
        this.tier = tier;
        this.device = device;
        this.nodes = nodes(layout, false, tier.terminalY);
        this.nodesRolled = nodes(layout, true, tier.terminalY);
    }

    public static NodeConfigurator nodes(Layout layout, boolean rolled) {
        return nodes(layout, rolled, Tier.LIGHT.terminalY);
    }

    public static NodeConfigurator nodes(Layout layout, boolean rolled, float y) {
        NodeConfigurator.Builder b = new NodeConfigurator.Builder();
        for (float[] t : layout.terminals()) {
            float[] p = rolled ? Layout.roll(t) : t;
            b.add(p[0], y, p[1]);
        }
        return b.simple();
    }

    public Tier tier() {
        return tier;
    }

    public Layout layout() {
        return layout;
    }

    private NodeConfigurator config(BlockState state) {
        return state.getValue(ROLL) ? nodesRolled : nodes;
    }

    @Override
    public SimulatedDeviceType<D> getDevice() {
        return device.get();
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
        // Подписи из языковых файлов EE: «Фаза 1», «Нейтральный контакт», «Выходной контакт — положительный»…
        String[] labels = layout.labels();
        return CEELang.nodeLabel(node >= 0 && node < labels.length ? labels[node] : "node");
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return (tier == Tier.LIGHT ? LIGHT_SHAPE : HEAVY_SHAPE).get(state.getValue(FACING));
    }
}
