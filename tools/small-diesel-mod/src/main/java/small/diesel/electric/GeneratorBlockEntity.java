package small.diesel.electric;

import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.foundation.CEELang;
import com.simibubi.create.api.equipment.goggles.IHaveGoggleInformation;
import com.simibubi.create.foundation.blockEntity.SmartBlockEntity;
import com.simibubi.create.foundation.blockEntity.behaviour.BlockEntityBehaviour;
import com.simibubi.create.foundation.blockEntity.behaviour.fluid.SmartFluidTankBehaviour;
import java.util.List;
import net.createmod.catnip.lang.Lang;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.neoforge.fluids.FluidStack;
import net.neoforged.neoforge.fluids.capability.IFluidHandler.FluidAction;
import small.diesel.Fuel;
import small.diesel.SmallDiesel;

/**
 * Бак малого дизельного генератора: топливо CDG (Fuel) → «приток» устройства EE. 1 мБ даёт strength / burn_rate × КПД
 * Вт·тик: КПД 0,75 — как у связки «двигатель + компактный генератор EE Extras» (6 Вт на 8 SU), считая 1 SU ≈ 1 Вт
 * (генератор EE). Дизель: 92 160 Вт·тик на 1 мБ, на 1,5 кВт — 1 мБ за ~61 тик (~1 ведро за 51 мин).
 */
public class GeneratorBlockEntity extends SmartBlockEntity implements IHaveGoggleInformation {
    public static final double EFFICIENCY = 0.75;
    public static final int TANK = 1000;

    SmartFluidTankBehaviour tank;
    private GeneratorDevice device;
    /** Для очков: отдача, Вт, и расход, мБ/мин (сглаженные) */
    double power;
    double burn;
    /** Что последний раз отправлено игрокам */
    private double shownPower;
    private double shownBurn;

    public GeneratorBlockEntity(BlockPos pos, BlockState state) {
        super(Electric.GENERATOR_BE.get(), pos, state);
    }

    @Override
    public void addBehaviours(List<BlockEntityBehaviour> behaviours) {
        tank = SmartFluidTankBehaviour.single(this, TANK);
        tank.getPrimaryHandler().setValidator(fs -> level == null || Fuel.of(level, fs.getFluid()) != null);
        behaviours.add(tank);
    }

    @Override
    public void tick() {
        super.tick();
        if (!(level instanceof ServerLevel sl)) return;
        if (device == null || !device.isValid()) device = DevicesSavedData.load(sl).getDevice(worldPosition, GeneratorDevice.class);
        if (device == null) return;
        FluidStack fluid = tank.getPrimaryHandler().getFluid();
        Fuel fuel = fluid.isEmpty() ? null : Fuel.of(level, fluid.getFluid());
        int burned = 0;
        while (device.pool < GeneratorDevice.MAX_POWER && fuel != null && !tank.getPrimaryHandler().getFluid().isEmpty()) {
            tank.getPrimaryHandler().drain(1, FluidAction.EXECUTE);
            device.pool += fuel.perMb() * EFFICIENCY;
            burned++;
        }
        double p = 0.95 * power + 0.05 * device.lastOut;
        double b = 0.95 * burn + 0.05 * burned * 1200;
        boolean changed = Math.abs(p - shownPower) > 5 || Math.abs(b - shownBurn) > 0.1;
        power = p;
        burn = b;
        if (changed) {
            shownPower = p;
            shownBurn = b;
            sendData();
        }
    }

    /** Для проверки: бак */
    public net.neoforged.neoforge.fluids.capability.templates.FluidTank tank() {
        return tank.getPrimaryHandler();
    }

    @Override
    public boolean addToGoggleTooltip(List<Component> tooltip, boolean isPlayerSneaking) {
        Lang.builder("electroenergetics").translate("gui.goggles.electric_stats").forGoggles(tooltip);
        Lang.builder("electroenergetics").translate("gui.goggles.energy_generation").style(ChatFormatting.GRAY).forGoggles(tooltip);
        Lang.builder(SmallDiesel.MOD_ID).add(CEELang.formatPower(power)).style(ChatFormatting.AQUA).space()
                .add(Component.literal("/ ").withStyle(ChatFormatting.DARK_GRAY))
                .add(CEELang.formatPower(GeneratorDevice.MAX_POWER)).style(ChatFormatting.DARK_GRAY)
                .space().add(CEELang.formatVoltage(GeneratorDevice.VOLTS).component().withStyle(ChatFormatting.DARK_GRAY))
                .forGoggles(tooltip, 1);
        Lang.builder(SmallDiesel.MOD_ID).translate("goggles.burn").style(ChatFormatting.GRAY).forGoggles(tooltip);
        Lang.builder(SmallDiesel.MOD_ID).text(String.format("%.1f", burn)).translate("goggles.mb_per_minute")
                .style(ChatFormatting.AQUA).forGoggles(tooltip, 1);
        containedFluidTooltip(tooltip, isPlayerSneaking, tank.getCapability());
        return true;
    }

    @Override
    protected void write(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket) {
        super.write(tag, registries, clientPacket);
        tag.putDouble("Power", power);
        tag.putDouble("Burn", burn);
    }

    @Override
    protected void read(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket) {
        super.read(tag, registries, clientPacket);
        power = tag.getDouble("Power");
        burn = tag.getDouble("Burn");
    }
}
