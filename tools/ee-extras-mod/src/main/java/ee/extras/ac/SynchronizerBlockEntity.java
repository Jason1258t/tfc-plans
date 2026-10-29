package ee.extras.ac;

import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.simibubi.create.foundation.blockEntity.behaviour.BlockEntityBehaviour;
import com.simibubi.create.foundation.blockEntity.behaviour.scrollValue.ScrollOptionBehaviour;
import ee.extras.ac.SynchronizerDevice.Mode;
import ee.extras.ac.SynchronizerDevice.State;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Блок синхронизатора: режим (Авто / Отключён), показания для очков инженера и красный сигнал подгонки скорости
 * генератора — его выдаёт SynchronizerBlock на двух боковых гранях.
 */
public class SynchronizerBlockEntity extends AcBlockEntity {
    ScrollOptionBehaviour<Mode> modeOption;
    private State state = State.NO_GENERATOR;
    private double genHz, gridHz, angle, du, power, nominal;
    int signal;

    public SynchronizerBlockEntity(BlockPos pos, BlockState state) {
        super(AcBlocks.SYNCHRONIZER_BE.get(), pos, state);
    }

    @Override
    public void addBehaviours(List<BlockEntityBehaviour> behaviours) {
        modeOption = new ScrollOptionBehaviour<>(Mode.class, Component.translatable("ee_extras.synchronizer.mode"), this,
                new ValueBox());
        modeOption.withCallback(i -> {
            SynchronizerDevice d = device();
            if (d != null) d.mode = mode();
        });
        behaviours.add(modeOption);
    }

    public Mode mode() {
        return modeOption == null ? Mode.AUTO : modeOption.get();
    }

    private SynchronizerDevice device() {
        return level instanceof ServerLevel sl
                ? DevicesSavedData.load(sl).getDevice(worldPosition, SynchronizerDevice.class) : null;
    }

    @Override
    protected void applyCooling(double factor) {
        SynchronizerDevice d = device();
        if (d != null) d.cooling = factor;
    }

    void update(State state, double genHz, double gridHz, double angle, double du, double power, double nominal,
            int signal) {
        if (signal != this.signal && level != null) {
            this.signal = signal;
            level.updateNeighborsAt(worldPosition, getBlockState().getBlock());
        }
        boolean changed = this.state != state || Math.abs(this.genHz - genHz) > 0.02
                || Math.abs(this.gridHz - gridHz) > 0.02 || Math.abs(this.angle - angle) > 2
                || Math.abs(this.du - du) > 0.01 || Math.abs(this.power - power) > Math.max(5, 0.02 * Math.abs(this.power))
                || Math.abs(this.nominal - nominal) > 1;
        if (!changed) return;
        this.state = state;
        this.genHz = genHz;
        this.gridHz = gridHz;
        this.angle = angle;
        this.du = du;
        this.power = power;
        this.nominal = nominal;
        sendData();
    }

    @Override
    public boolean addToGoggleTooltip(List<Component> tooltip, boolean isPlayerSneaking) {
        lang().translate("synchronizer.title").forGoggles(tooltip);
        ChatFormatting color = state.closed() ? ChatFormatting.GREEN
                : state == State.SYNCING || state == State.DEAD_BUS ? ChatFormatting.YELLOW : ChatFormatting.GOLD;
        line(tooltip, "synchronizer.state." + state.name().toLowerCase(), color);
        line(tooltip, "goggles.generator_hz", ChatFormatting.GRAY, hz(genHz));
        line(tooltip, "goggles.grid_hz", ChatFormatting.GRAY, hz(gridHz));
        if (!state.closed() && genHz > 0 && gridHz > 0) {
            line(tooltip, "goggles.angle", ChatFormatting.GRAY, Math.round(angle));
            line(tooltip, "goggles.voltage_diff", ChatFormatting.GRAY, Math.round(du * 100));
        }
        if (signal != SynchronizerDevice.NONE)
            line(tooltip, signal == SynchronizerDevice.FASTER ? "goggles.faster" : "goggles.slower", ChatFormatting.RED);
        if (state.closed()) {
            line(tooltip, power >= 0 ? "goggles.to_grid" : "goggles.from_grid", ChatFormatting.AQUA, kw(Math.abs(power)));
        }
        if (nominal > 0) nominalLine(tooltip, Math.abs(power) / nominal, nominal);
        return true;
    }

    @Override
    protected void write(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket) {
        super.write(tag, registries, clientPacket);
        tag.putInt("Signal", signal);
        if (!clientPacket) return;
        tag.putString("State", state.name());
        tag.putDouble("GenHz", genHz);
        tag.putDouble("GridHz", gridHz);
        tag.putDouble("Angle", angle);
        tag.putDouble("Du", du);
        tag.putDouble("Power", power);
        tag.putDouble("Nominal", nominal);
        tag.putDouble("Cooling", cooling);
    }

    @Override
    protected void read(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket) {
        super.read(tag, registries, clientPacket);
        signal = tag.getInt("Signal");
        if (!clientPacket) return;
        try {
            state = State.valueOf(tag.getString("State"));
        } catch (IllegalArgumentException e) {
            state = State.NO_GENERATOR;
        }
        genHz = tag.getDouble("GenHz");
        gridHz = tag.getDouble("GridHz");
        angle = tag.getDouble("Angle");
        du = tag.getDouble("Du");
        power = tag.getDouble("Power");
        nominal = tag.getDouble("Nominal");
        cooling = tag.getDouble("Cooling");
    }
}
