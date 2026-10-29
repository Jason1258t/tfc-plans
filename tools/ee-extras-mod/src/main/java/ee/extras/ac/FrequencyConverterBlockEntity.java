package ee.extras.ac;

import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.google.common.collect.ImmutableList;
import com.simibubi.create.foundation.blockEntity.behaviour.BlockEntityBehaviour;
import com.simibubi.create.foundation.blockEntity.behaviour.ValueSettingsBoard;
import com.simibubi.create.foundation.blockEntity.behaviour.ValueSettingsFormatter;
import com.simibubi.create.foundation.blockEntity.behaviour.scrollValue.ScrollValueBehaviour;
import ee.extras.ac.FrequencyConverterDevice.State;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;

/** Блок преобразователя частоты: заданная частота (окно значения Create, 1–40 Гц) и показания для очков инженера */
public class FrequencyConverterBlockEntity extends AcBlockEntity {
    ScrollValueBehaviour frequency;
    private State state = State.NO_INPUT;
    private double inVolts, outHz, inPower, outPower, nominal;

    public FrequencyConverterBlockEntity(BlockPos pos, BlockState state) {
        super(AcBlocks.FREQUENCY_CONVERTER_BE.get(), pos, state);
    }

    @Override
    public void addBehaviours(List<BlockEntityBehaviour> behaviours) {
        Component symbol = Component.translatable("ee_extras.frequency_converter.hz");
        frequency = new ScrollValueBehaviour(Component.translatable("ee_extras.frequency_converter.frequency"), this,
                new ValueBox()) {
            @Override
            public ValueSettingsBoard createBoard(Player player, BlockHitResult hitResult) {
                return new ValueSettingsBoard(label, max, 5, ImmutableList.of(symbol),
                        new ValueSettingsFormatter(v -> Component.literal(v.value() + " ").append(symbol)));
            }
        };
        frequency.between(FrequencyConverterDevice.MIN_HZ, FrequencyConverterDevice.MAX_HZ);
        frequency.value = FrequencyConverterDevice.DEFAULT_HZ;
        frequency.withCallback(i -> {
            FrequencyConverterDevice d = device();
            if (d != null) d.setHz = hz();
        });
        behaviours.add(frequency);
    }

    public int hz() {
        return frequency == null ? FrequencyConverterDevice.DEFAULT_HZ : frequency.getValue();
    }

    private FrequencyConverterDevice device() {
        return level instanceof ServerLevel sl
                ? DevicesSavedData.load(sl).getDevice(worldPosition, FrequencyConverterDevice.class) : null;
    }

    @Override
    protected void applyCooling(double factor) {
        FrequencyConverterDevice d = device();
        if (d != null) d.cooling = factor;
    }

    /** Из устройства EE после расчёта: отправить игрокам, если показания заметно изменились */
    void update(State state, double inVolts, double outHz, double inPower, double outPower, double nominal, float temp) {
        boolean changed = this.state != state || Math.abs(this.inVolts - inVolts) > 2 || Math.abs(this.outHz - outHz) > 0.05
                || Math.abs(this.inPower - inPower) > Math.max(5, 0.02 * this.inPower)
                || Math.abs(this.outPower - outPower) > Math.max(5, 0.02 * this.outPower)
                || Math.abs(this.nominal - nominal) > 1;
        if (!changed) return;
        this.state = state;
        this.inVolts = inVolts;
        this.outHz = outHz;
        this.inPower = inPower;
        this.outPower = outPower;
        this.nominal = nominal;
        sendData();
    }

    @Override
    public boolean addToGoggleTooltip(List<Component> tooltip, boolean isPlayerSneaking) {
        lang().translate("frequency_converter.title").forGoggles(tooltip);
        line(tooltip, "frequency_converter.state." + state.name().toLowerCase(),
                state.on() ? ChatFormatting.GREEN : ChatFormatting.GOLD);
        line(tooltip, "goggles.input", ChatFormatting.GRAY, volts(inVolts), kw(inPower));
        line(tooltip, "goggles.output_hz", ChatFormatting.GRAY, hz(outHz), hz());
        line(tooltip, "goggles.output", ChatFormatting.AQUA, kw(outPower));
        if (nominal > 0) nominalLine(tooltip, Math.max(inPower, outPower) / nominal, nominal);
        return true;
    }

    @Override
    protected void write(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket) {
        super.write(tag, registries, clientPacket);
        if (!clientPacket) return;
        tag.putString("State", state.name());
        tag.putDouble("InVolts", inVolts);
        tag.putDouble("OutHz", outHz);
        tag.putDouble("InPower", inPower);
        tag.putDouble("OutPower", outPower);
        tag.putDouble("Nominal", nominal);
        tag.putDouble("Cooling", cooling);
    }

    @Override
    protected void read(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket) {
        super.read(tag, registries, clientPacket);
        if (!clientPacket) return;
        try {
            state = State.valueOf(tag.getString("State"));
        } catch (IllegalArgumentException e) {
            state = State.NO_INPUT;
        }
        inVolts = tag.getDouble("InVolts");
        outHz = tag.getDouble("OutHz");
        inPower = tag.getDouble("InPower");
        outPower = tag.getDouble("OutPower");
        nominal = tag.getDouble("Nominal");
        cooling = tag.getDouble("Cooling");
    }
}
