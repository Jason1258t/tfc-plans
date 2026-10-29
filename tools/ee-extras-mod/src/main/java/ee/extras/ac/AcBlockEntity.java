package ee.extras.ac;

import com.george_vi.electroenergetics.foundation.CEELang;
import com.george_vi.electroenergetics.foundation.base.DirectionalRolledDeviceBlock;
import com.simibubi.create.api.equipment.goggles.IHaveGoggleInformation;
import com.simibubi.create.foundation.blockEntity.SmartBlockEntity;
import com.simibubi.create.foundation.blockEntity.behaviour.ValueBoxTransform;
import ee.extras.EeExtras;
import ee.extras.PowerBlock;
import ee.extras.Tier;
import java.util.List;
import net.createmod.catnip.lang.LangBuilder;
import net.createmod.catnip.lang.Lang;
import net.createmod.catnip.math.VecHelper;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/**
 * Общее у блоков преобразователя частоты и синхронизатора: ступень (из блока), охлаждение промышленного шкафа (раз в
 * lazyTick — Cooling, как у трансформатора EE), строки для очков инженера, окно значения на грани с клеммами.
 */
public abstract class AcBlockEntity extends SmartBlockEntity implements IHaveGoggleInformation {
    protected double cooling = 1;

    protected AcBlockEntity(BlockEntityType<?> type, BlockPos pos, BlockState state) {
        super(type, pos, state);
        setLazyTickRate(40);
    }

    public Tier tier() {
        return getBlockState().getBlock() instanceof PowerBlock<?> b ? b.tier() : Tier.LIGHT;
    }

    @Override
    public void lazyTick() {
        super.lazyTick();
        if (level == null || level.isClientSide || tier() != Tier.INDUSTRIAL) return;
        double c = Cooling.factor(level, worldPosition);
        if (Math.abs(c - cooling) > 1e-3) {
            cooling = c;
            applyCooling(c);
            sendData();
        } else {
            applyCooling(c);
        }
    }

    protected abstract void applyCooling(double factor);

    protected static LangBuilder lang() {
        return Lang.builder(EeExtras.MOD_ID);
    }

    protected static void line(List<Component> tooltip, String key, ChatFormatting style, Object... args) {
        lang().translate(key, args).style(style).forGoggles(tooltip, 1);
    }

    protected void nominalLine(List<Component> tooltip, double load, double nominal) {
        lang().translate("goggles.load", Math.round(load * 100), kw(nominal))
                .style(load > 1 ? ChatFormatting.RED : ChatFormatting.GRAY).forGoggles(tooltip, 1);
        if (tier() == Tier.INDUSTRIAL)
            line(tooltip, "goggles.cooling", ChatFormatting.DARK_GRAY, String.format("%.2f", cooling));
    }

    protected static Component kw(double watts) {
        return CEELang.formatPower(watts).component();
    }

    protected static Component volts(double volts) {
        return CEELang.formatVoltage(volts).component();
    }

    protected static String hz(double hz) {
        return String.format("%.2f", hz);
    }

    /** Окно значения — посередине грани с клеммами, на её высоте (плита — 7 пикселей, шкаф — целый блок) */
    static class ValueBox extends ValueBoxTransform.Sided {
        @Override
        protected Vec3 getSouthLocation() {
            return VecHelper.voxelSpace(8, 8, 16);
        }

        @Override
        public Vec3 getLocalOffset(net.minecraft.world.level.LevelAccessor level, BlockPos pos, BlockState state) {
            Vec3 v = super.getLocalOffset(level, pos, state);
            if (state.getBlock() instanceof PowerBlock<?> b && b.tier() == Tier.LIGHT) {
                Direction f = state.getValue(DirectionalRolledDeviceBlock.FACING);
                v = v.subtract(Vec3.atLowerCornerOf(f.getNormal()).scale(9 / 16.0));
            }
            return v;
        }

        @Override
        protected boolean isSideActive(BlockState state, Direction direction) {
            return direction == state.getValue(DirectionalRolledDeviceBlock.FACING);
        }
    }
}
