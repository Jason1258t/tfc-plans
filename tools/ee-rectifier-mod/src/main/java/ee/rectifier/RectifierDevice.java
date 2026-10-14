package ee.rectifier;

import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.device.SimpleElectricalDevice;
import com.george_vi.electroenergetics.foundation.electrical_properties.DiodeProperties;
import com.george_vi.electroenergetics.simulation.BridgeCollector;
import com.george_vi.electroenergetics.simulation.SimulationResults;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.Level;

/**
 * Диодный мост из диодов EE: на каждый вход два диода — «вход → +» и «− → вход». Три входа — трёхфазный мост
 * (Ларионова, 6 диодов), два — однофазный (4 диода). У диода EE connect(катод, анод): ток идёт от анода к катоду.
 * Как у блока диода EE, между расчётами хранится только напряжение на каждом диоде (точка линеаризации модели Шокли).
 */
public class RectifierDevice extends SimpleElectricalDevice {
    private final Layout layout;
    private final DiodeProperties[] diodes;
    private final double[] lastVoltage;

    public RectifierDevice(Level level, BlockPos pos, DevicesSavedData devices, SimulatedDeviceType<?> type, Layout layout) {
        super(level, pos, devices, type);
        this.layout = layout;
        this.diodes = new DiodeProperties[layout.inputs() * 2];
        this.lastVoltage = new double[diodes.length];
        for (int i = 0; i < diodes.length; i++) diodes[i] = new DiodeProperties();
    }

    @Override
    public void preTick(BridgeCollector collector) {
        BridgeCollector.Builder b = collector.builder(pos);
        int n = layout.inputs();
        for (int input = 0; input < n; input++) {
            DiodeProperties up = diodes[input];
            DiodeProperties down = diodes[n + input];
            up.lastVoltage = lastVoltage[input];
            down.lastVoltage = lastVoltage[n + input];
            b.connect(layout.plus(), input, up); // катод «+», анод — вход
            b.connect(input, layout.minus(), down); // катод — вход, анод «−»
        }
    }

    @Override
    public void postTick(SimulationResults results) {
        for (int i = 0; i < diodes.length; i++) lastVoltage[i] = diodes[i].lastVoltage;
    }

    @Override
    public void read(CompoundTag tag) {
        for (int i = 0; i < lastVoltage.length; i++) lastVoltage[i] = tag.getDouble("Voltage" + i);
    }

    @Override
    public void write(CompoundTag tag) {
        for (int i = 0; i < lastVoltage.length; i++) tag.putDouble("Voltage" + i, lastVoltage[i]);
    }
}
