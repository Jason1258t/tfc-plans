package small.diesel;

import com.simibubi.create.content.kinetics.base.GeneratingKineticBlockEntity;
import com.simibubi.create.foundation.blockEntity.behaviour.BlockEntityBehaviour;
import com.simibubi.create.foundation.blockEntity.behaviour.fluid.SmartFluidTankBehaviour;
import java.util.List;
import net.createmod.catnip.lang.Lang;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.neoforge.fluids.FluidStack;
import net.neoforged.neoforge.fluids.capability.IFluidHandler.FluidAction;

/**
 * Малый дизельный двигатель: те же обороты, что у обычного двигателя CDG на этом топливе, мощность — четверть его
 * (SHARE; дизель — 1 536 SU на 96 об/мин). Топливо горит по нагрузке: за тик сжигается работа
 * «доля загрузки сети × мощность двигателя» (загрузка — нагрузка сети / её мощность, оба числа Create раздаёт всем
 * блокам сети), 1 мБ = strength / burn_rate SU·тик (Fuel). Под полной нагрузкой расход — четверть расхода обычного
 * двигателя CDG (дизель: 1 мБ за 4 с), без нагрузки двигатель крутится, не сжигая ничего; у CDG двигатель жжёт
 * топливо всегда одинаково.
 */
public class EngineBlockEntity extends GeneratingKineticBlockEntity {
    public static final float SHARE = 0.25f;
    public static final int TANK = 1000;

    SmartFluidTankBehaviour tank;
    /** Оплаченная, ещё не сделанная работа, SU·тик */
    double credit;
    /** Топливо, на котором крутится двигатель (из бака или последнее сожжённое): обороты, мощность, работа 1 мБ */
    float fuelSpeed;
    float fuelStrength;
    double fuelPerMb;
    private float lastSpeed;
    private float lastCapacity;

    public EngineBlockEntity(BlockPos pos, BlockState state) {
        super(SmallDiesel.ENGINE_BE.get(), pos, state);
    }

    @Override
    public void addBehaviours(List<BlockEntityBehaviour> behaviours) {
        super.addBehaviours(behaviours);
        tank = SmartFluidTankBehaviour.single(this, TANK);
        tank.getPrimaryHandler().setValidator(fs -> level == null || Fuel.of(level, fs.getFluid()) != null);
        behaviours.add(tank);
    }

    private boolean running() {
        return fuelSpeed > 0 && (credit > 0 || !tank.getPrimaryHandler().getFluid().isEmpty());
    }

    @Override
    public float getGeneratedSpeed() {
        return running() ? convertToDirection(fuelSpeed, getBlockState().getValue(EngineBlock.FACING)) : 0;
    }

    /** Мощность Create — на 1 об/мин: SHARE × strength / speed */
    @Override
    public float calculateAddedStressCapacity() {
        float capacity = running() ? SHARE * fuelStrength / fuelSpeed : 0;
        lastCapacityProvided = capacity;
        return capacity;
    }

    /** Доля загрузки сети 0…1 */
    public double load() {
        return capacity > 0 ? Math.max(0, Math.min(1, stress / capacity)) : 0;
    }

    /** Работа за тик, SU·тик */
    double work() {
        return running() ? load() * SHARE * fuelStrength : 0;
    }

    @Override
    public void tick() {
        super.tick();
        if (level == null || level.isClientSide) return;
        FluidStack fluid = tank.getPrimaryHandler().getFluid();
        Fuel fuel = fluid.isEmpty() ? null : Fuel.of(level, fluid.getFluid());
        if (fuel != null && (fuel.speed() != fuelSpeed || fuel.strength() != fuelStrength || fuel.perMb() != fuelPerMb)) {
            fuelSpeed = fuel.speed();
            fuelStrength = fuel.strength();
            fuelPerMb = fuel.perMb();
            sendData();
        }
        double need = work();
        while (credit < need && fuel != null && !tank.getPrimaryHandler().getFluid().isEmpty()) {
            tank.getPrimaryHandler().drain(1, FluidAction.EXECUTE);
            credit += fuel.perMb();
        }
        credit = Math.max(0, credit - need);
        if (getGeneratedSpeed() != lastSpeed || calculateAddedStressCapacity() != lastCapacity) {
            lastSpeed = getGeneratedSpeed();
            lastCapacity = calculateAddedStressCapacity();
            reActivateSource = true;
        }
    }

    /** Для проверки и показаний: бак, оплаченная работа (SU·тик), работа 1 мБ текущего топлива */
    public net.neoforged.neoforge.fluids.capability.templates.FluidTank tank() {
        return tank.getPrimaryHandler();
    }

    public double credit() {
        return credit;
    }

    public double fuelPerMb() {
        return fuelPerMb;
    }

    @Override
    public boolean addToGoggleTooltip(List<Component> tooltip, boolean isPlayerSneaking) {
        super.addToGoggleTooltip(tooltip, isPlayerSneaking);
        if (running() && fuelPerMb > 0) {
            Lang.builder(SmallDiesel.MOD_ID).translate("goggles.burn").style(ChatFormatting.GRAY).forGoggles(tooltip);
            Lang.builder(SmallDiesel.MOD_ID).text(String.format("%.1f", work() * 1200 / fuelPerMb))
                    .translate("goggles.mb_per_minute").style(ChatFormatting.AQUA).forGoggles(tooltip, 1);
        }
        containedFluidTooltip(tooltip, isPlayerSneaking, tank.getCapability());
        return true;
    }

    @Override
    protected void write(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket) {
        super.write(tag, registries, clientPacket);
        tag.putDouble("Credit", credit);
        tag.putFloat("FuelSpeed", fuelSpeed);
        tag.putFloat("FuelStrength", fuelStrength);
        tag.putDouble("FuelPerMb", fuelPerMb);
    }

    @Override
    protected void read(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket) {
        super.read(tag, registries, clientPacket);
        credit = tag.getDouble("Credit");
        fuelSpeed = tag.getFloat("FuelSpeed");
        fuelStrength = tag.getFloat("FuelStrength");
        fuelPerMb = tag.getDouble("FuelPerMb");
    }
}
