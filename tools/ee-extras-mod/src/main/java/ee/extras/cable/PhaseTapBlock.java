package ee.extras.cable;

import com.george_vi.electroenergetics.foundation.CEELang;
import ee.extras.Layout;
import net.createmod.catnip.math.VoxelShaper;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * Отвод фазы: к нему приходит четырёхжильный кабель (узел 0), наружу — две клеммы под обычные провода EE: фаза
 * (контакт 1) и ноль (контакт 2). Для кабеля он — такой же «двухпроводной конец с выбором фазы», как соединитель EE
 * (CableEnd.eeTermination): ноль кабеля — на клемму 2, выбранная фаза — на клемму 1, ключ по блоку с кабелем
 * переключает L1 → L2 → L3 (CableLaying.cyclePhase), без кабеля — поворачивает. Двухжильный кабель тоже подходит
 * (жила к жиле). Координаты — Layout.PHASE_TAP, те же — в art/cables.py.
 */
public class PhaseTapBlock extends CableEndBlock {
    static final String[] LABELS = {"node", "phase_1", "neutral"};
    /** Как у четырёхжильного соединителя: та же плита и ввод кабеля */
    private static final VoxelShaper[] SHAPES = {
            VoxelShaper.forDirectional(box(0, 0, 1, 16, 5, 13), Direction.UP),
            VoxelShaper.forDirectional(box(3, 0, 0, 15, 5, 16), Direction.UP),
            VoxelShaper.forDirectional(box(0, 0, 3, 16, 5, 15), Direction.UP),
            VoxelShaper.forDirectional(box(1, 0, 0, 13, 5, 16), Direction.UP)};

    public PhaseTapBlock(Properties properties) {
        super(properties, CableKind.DUPLEX, Layout.PHASE_TAP);
    }

    @Override
    public boolean isNodeAccessible(Level level, BlockPos pos, BlockState state, int id) {
        return id != 0;
    }

    @Override
    public MutableComponent getNodeLabel(Level level, BlockPos pos, BlockState state, int node) {
        if (node == 0) return net.minecraft.network.chat.Component.translatable("ee_extras.nodes.cable");
        if (node == 1) return net.minecraft.network.chat.Component.translatable("ee_extras.nodes.tap_phase");
        return CEELang.nodeLabel(node > 0 && node < LABELS.length ? LABELS[node] : "node");
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return SHAPES[CableOrientation.of(state)].get(state.getValue(FACING));
    }
}
