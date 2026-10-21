package ee.extras.converter;

import com.george_vi.electroenergetics.config.CEEConfigs;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.foundation.CEELang;
import com.google.common.collect.ImmutableList;
import com.simibubi.create.api.equipment.goggles.IHaveGoggleInformation;
import com.simibubi.create.foundation.blockEntity.SmartBlockEntity;
import com.simibubi.create.foundation.blockEntity.behaviour.BlockEntityBehaviour;
import com.simibubi.create.foundation.blockEntity.behaviour.ValueBoxTransform;
import com.simibubi.create.foundation.blockEntity.behaviour.ValueSettingsBoard;
import com.simibubi.create.foundation.blockEntity.behaviour.ValueSettingsFormatter;
import com.simibubi.create.foundation.blockEntity.behaviour.scrollValue.ScrollValueBehaviour;
import ee.extras.EeExtras;
import java.util.List;
import net.createmod.catnip.lang.Lang;
import net.createmod.catnip.math.VecHelper;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.energy.IEnergyStorage;

/**
 * Данные блока двустороннего преобразователя: напряжение разряда (колёсико Create, как у преобразователя EE: 0–4320 В
 * шагом 10), показания для очков инженера и FE через заднюю грань.
 */
public class BidiConverterBlockEntity extends SmartBlockEntity implements IHaveGoggleInformation {
    BidiConverterDevice device;
    ScrollValueBehaviour voltage;
    double chargePower;
    double dischargePower;
    double charge;
    double discharge;
    private final Storage storage = new Storage();

    public BidiConverterBlockEntity(BlockPos pos, BlockState state) {
        super(EeExtras.CONVERTER_BE.get(), pos, state);
    }

    @Override
    public void addBehaviours(List<BlockEntityBehaviour> behaviours) {
        voltage = new ScrollValueBehaviour(Component.translatable("electroenergetics.converter.voltage"), this, new ValueBox()) {
            @Override
            public ValueSettingsBoard createBoard(Player player, BlockHitResult hitResult) {
                return new ValueSettingsBoard(label, max, 10,
                        ImmutableList.of(Component.translatable("electroenergetics.converter.voltage_symbol")),
                        new ValueSettingsFormatter(v -> CEELang.formatVoltage(v.value() * 10).component()));
            }
        };
        voltage.between(0, 432);
        voltage.value = 10;
        voltage.withFormatter(v -> CEELang.formatVoltage(v * 10).string());
        voltage.withCallback(i -> updateVoltage());
        behaviours.add(voltage);
    }

    int volts() {
        return voltage == null ? 0 : voltage.value * 10;
    }

    private BidiConverterDevice device() {
        if ((device == null || !device.isValid()) && level instanceof ServerLevel sl)
            device = DevicesSavedData.load(sl).getDevice(getBlockPos(), BidiConverterDevice.class);
        return device;
    }

    private void updateVoltage() {
        BidiConverterDevice d = device();
        if (d != null) d.voltage = volts();
    }

    @Override
    public void tick() {
        super.tick();
        device();
    }

    /** Из устройства EE после расчёта: отправить игрокам, если показания заметно изменились */
    void update(double chargePower, double dischargePower, double charge, double discharge) {
        if (Math.abs(this.chargePower - chargePower) > 1 || Math.abs(this.dischargePower - dischargePower) > 1
                || Math.abs(this.charge - charge) > 10 || Math.abs(this.discharge - discharge) > 10) {
            this.chargePower = chargePower;
            this.dischargePower = dischargePower;
            this.charge = charge;
            this.discharge = discharge;
            sendData();
        }
    }

    /** Возможность FE: только через заднюю грань */
    public static IEnergyStorage energy(BidiConverterBlockEntity be, Direction side) {
        Direction back = be.getBlockState().getValue(BidiConverterBlock.FACING).getOpposite();
        return side != null && side != back ? null : be.storage;
    }

    IEnergyStorage energy() {
        return storage;
    }

    @Override
    public boolean addToGoggleTooltip(List<Component> tooltip, boolean isPlayerSneaking) {
        double rate = CEEConfigs.server().wattFeTConversionRate.get();
        Lang.builder(EeExtras.MOD_ID).translate("goggles.charge").style(ChatFormatting.GRAY).forGoggles(tooltip);
        Lang.builder(EeExtras.MOD_ID).add(CEELang.formatPower(chargePower)).style(ChatFormatting.AQUA).space()
                .add(Component.literal("→ ").withStyle(ChatFormatting.DARK_GRAY))
                .add(CEELang.formatFEPerTick(chargePower / rate)).style(ChatFormatting.AQUA)
                .forGoggles(tooltip, 1);
        Lang.builder(EeExtras.MOD_ID).translate("goggles.discharge").style(ChatFormatting.GRAY).forGoggles(tooltip);
        Lang.builder(EeExtras.MOD_ID).add(CEELang.formatFEPerTick(dischargePower / rate)).style(ChatFormatting.AQUA).space()
                .add(Component.literal("→ ").withStyle(ChatFormatting.DARK_GRAY))
                .add(CEELang.formatPower(dischargePower)).style(ChatFormatting.AQUA)
                .space().add(CEELang.formatVoltage(volts()).component().withStyle(ChatFormatting.DARK_GRAY))
                .forGoggles(tooltip, 1);
        return true;
    }

    @Override
    protected void write(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket) {
        super.write(tag, registries, clientPacket);
        tag.putDouble("ChargePower", chargePower);
        tag.putDouble("DischargePower", dischargePower);
        tag.putDouble("Charge", charge);
        tag.putDouble("Discharge", discharge);
    }

    @Override
    protected void read(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket) {
        super.read(tag, registries, clientPacket);
        chargePower = tag.getDouble("ChargePower");
        dischargePower = tag.getDouble("DischargePower");
        charge = tag.getDouble("Charge");
        discharge = tag.getDouble("Discharge");
    }

    /** FE от соседа: кладёт — в разряд, забирает — из заряда. Пока устройства EE нет, ничего не берёт и не отдаёт */
    class Storage implements IEnergyStorage {
        @Override
        public int receiveEnergy(int fe, boolean simulate) {
            BidiConverterDevice d = device();
            return d == null ? 0 : d.receive(fe, simulate);
        }

        @Override
        public int extractEnergy(int fe, boolean simulate) {
            BidiConverterDevice d = device();
            return d == null ? 0 : d.extract(fe, simulate);
        }

        @Override
        public int getEnergyStored() {
            double rate = CEEConfigs.server().wattFeTConversionRate.get();
            BidiConverterDevice d = device();
            return (int) ((d != null ? d.charge + d.discharge : charge + discharge) / rate);
        }

        @Override
        public int getMaxEnergyStored() {
            return (int) (2 * BidiConverterDevice.maxEnergy() / CEEConfigs.server().wattFeTConversionRate.get());
        }

        @Override
        public boolean canExtract() {
            return true;
        }

        @Override
        public boolean canReceive() {
            return true;
        }
    }

    /** Колёсико напряжения — на верхней грани (там, где клеммы), посередине между ними; как у преобразователя EE */
    static class ValueBox extends ValueBoxTransform.Sided {
        @Override
        protected Vec3 getSouthLocation() {
            return VecHelper.voxelSpace(8, 8, 5.5);
        }

        @Override
        protected boolean isSideActive(BlockState state, Direction direction) {
            return direction == state.getValue(BidiConverterBlock.FACING);
        }
    }
}
