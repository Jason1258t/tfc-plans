package ee.extras.lantern;

import com.george_vi.electroenergetics.content.bundled_wire.BundledWireTerminationDevice;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.device.SpawnPreventingDevice;
import com.george_vi.electroenergetics.simulation.BridgeCollector;
import com.george_vi.electroenergetics.simulation.SimulationResults;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Фонарь в сети EE: резистор между жилами кабеля (узлы 1 и 2 LanternBlock). Горит, пока напряжение на нём не ниже
 * MIN_VOLTS; на переменном токе мгновенное напряжение проходит через ноль, поэтому фонарь гаснет только через HOLD тиков
 * без напряжения (иначе мигал бы с частотой сети). Как лампа EE (BulbDevice, по байткоду 1.1.2) запрещает естественный
 * спавн мобов в радиусе 20 блоков (SpawnPreventingDevice, настройка EE bulbsPreventMobSpawns), не перегорает.
 */
public class LanternDevice extends BundledWireTerminationDevice implements SpawnPreventingDevice {
    /** Сопротивление, Ом: 100 В — 10 Вт, 230 В — 53 Вт */
    static final double RESISTANCE = 1000;
    /** С какого напряжения горит, В */
    static final double MIN_VOLTS = 50;
    /** Сколько тиков горит после последнего замера не ниже MIN_VOLTS */
    static final int HOLD = 40;

    private int hold;
    /** Последний замер, В и Вт — для /cee device_data */
    private double volts;

    public LanternDevice(Level level, BlockPos pos, DevicesSavedData devices, SimulatedDeviceType<?> type) {
        super(level, pos, devices, type);
    }

    @Override
    public void preTick(BridgeCollector bridges) {
        bridges.builder(pos).resistor(1, 2, RESISTANCE);
    }

    @Override
    public void postTick(SimulationResults results) {
        volts = Math.abs(results.getVoltageAt(pos, 1, 2));
        if (volts >= MIN_VOLTS) hold = HOLD;
        else if (hold > 0) hold--;
        if (!level.isLoaded(pos)) return;
        BlockState state = level.getBlockState(pos);
        if (!(state.getBlock() instanceof LanternBlock)) return;
        boolean lit = hold > 0;
        if (state.getValue(LanternBlock.LIT) != lit) level.setBlockAndUpdate(pos, state.setValue(LanternBlock.LIT, lit));
    }

    @Override
    public void read(CompoundTag tag) {
        hold = tag.getInt("Hold");
        volts = tag.getDouble("Volts");
    }

    @Override
    public void write(CompoundTag tag) {
        tag.putInt("Hold", hold);
        tag.putDouble("Volts", volts);
        tag.putDouble("Watts", volts * volts / RESISTANCE);
    }

    @Override
    public boolean shouldRemove(BlockState oldState, BlockState newState) {
        return oldState.getBlock().getClass() != newState.getBlock().getClass();
    }
}
