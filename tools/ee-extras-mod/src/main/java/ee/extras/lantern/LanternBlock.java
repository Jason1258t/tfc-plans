package ee.extras.lantern;

import com.george_vi.electroenergetics.content.bundled_wire.BundledWireTerminationDevice;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import ee.extras.EeExtras;
import ee.extras.cable.CableEndBlock;
import ee.extras.cable.CableKind;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.LevelReader;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.BooleanProperty;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * Электрический фонарь IE, подключённый к двухпроводному кабелю EE (в руки — тот же фонарь IE: из него и делается,
 * LanternConversion). Для кабеля — как изолятор двухжильного кабеля: все кабели, подведённые к фонарю, соединены жила
 * к жиле, поэтому фонари собираются в линию «кабель — фонарь — кабель — фонарь…», а сам фонарь — нагрузка между
 * жилами (LanternDevice). Узлы — в гнезде провода фонаря IE (ElectricLanternBlockEntity.getConnectionOffset: середина,
 * 1 пиксель от основания), обычный провод к ним не подключить.
 *
 * Положение — как у фонаря IE: FACING вверх — стоит основанием вниз (у IE facing=down), вниз — висит (у IE facing=up,
 * модель перевёрнута); ключ по фонарю переворачивает, как молот IE. Кабели при этом остаются (номера узлов не зависят от
 * положения).
 */
public class LanternBlock extends CableEndBlock {
    public static final BooleanProperty LIT = BooleanProperty.create("lit");
    /** Гнездо провода фонаря IE лицом вверх, {x, y, z} в пикселях; все узлы (кабель и обе жилы) — в нём */
    static final float[] SOCKET = {8, 1, 8};
    /** Как у фонаря IE (ElectricLanternBlockEntity.getBlockBounds) */
    private static final VoxelShape SHAPE = box(3, 0, 3, 13, 16, 13);

    public LanternBlock(Properties properties) {
        super(properties, CableKind.DUPLEX, points());
        registerDefaultState(defaultBlockState().setValue(LIT, false));
    }

    static float[][] points() {
        float[][] out = new float[CableKind.DUPLEX.conductors + 1][];
        for (int i = 0; i < out.length; i++) out[i] = SOCKET.clone();
        return out;
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        super.createBlockStateDefinition(builder);
        builder.add(LIT);
    }

    /** Устройство фонаря — наследник устройства соединителя EE (тип getDevice у BundledWireTerminationBlock закреплён) */
    @Override
    @SuppressWarnings("unchecked")
    public SimulatedDeviceType<BundledWireTerminationDevice> getDevice() {
        return (SimulatedDeviceType<BundledWireTerminationDevice>) (SimulatedDeviceType<?>) EeExtras.LANTERN_DEVICE.get();
    }

    /** Только стоя или вися, как фонарь IE; ставится не предметом (его нет), а превращением — это на всякий случай */
    @Override
    public BlockState getStateForPlacement(BlockPlaceContext context) {
        Direction face = context.getClickedFace() == Direction.DOWN ? Direction.DOWN : Direction.UP;
        return withWater(defaultBlockState().setValue(FACING, face), context);
    }

    @Override
    public BlockState getRotatedBlockState(BlockState state, Direction targetedFace) {
        return state.setValue(FACING, state.getValue(FACING).getOpposite());
    }

    @Override
    public boolean isNodeAccessible(Level level, BlockPos pos, BlockState state, int id) {
        return false;
    }

    @Override
    public MutableComponent getNodeLabel(Level level, BlockPos pos, BlockState state, int node) {
        return Component.translatable("ee_extras.nodes.cable");
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return SHAPE;
    }

    @Override
    public ItemStack getCloneItemStack(LevelReader level, BlockPos pos, BlockState state) {
        return LanternConversion.ieLantern();
    }

    /** Свет — как у фонаря IE: 15, пока горит */
    public static int light(BlockState state) {
        return state.getValue(LIT) ? 15 : 0;
    }
}
