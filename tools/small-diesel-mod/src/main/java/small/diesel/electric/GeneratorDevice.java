package small.diesel.electric;

import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.ProperOilAndWaterloggedBlock.LoggedState;
import com.george_vi.electroenergetics.foundation.base.DirectionalRolledDeviceBlock;
import com.george_vi.electroenergetics.foundation.device.ElectricalDevice;
import com.george_vi.electroenergetics.foundation.device.SimpleElectricalDevice;
import com.george_vi.electroenergetics.simulation.BridgeCollector;
import com.george_vi.electroenergetics.simulation.SimulationResults;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Устройство EE малого дизельного генератора: источник постоянного тока с запасом, как щёточный узел генератора
 * EE 1.1.2 (GeneratingDevice, по байткоду): energyLimitedSource с ЭДС VOLTS, запас пополняется не больше чем на
 * MAX_POWER за тик и не выше MAX_POWER × 10, отдача — модуль U × I. В запас идёт только сожжённое топливо (pool,
 * его кладёт блок) — сколько ушло в запас, столько и сгорело, поэтому топливо горит по нагрузке.
 *
 * Нагрев — как у вариака EE и выпрямителей EE Extras (VariacDevice.postTick, по байткоду): тепло = мощность × 1300 /
 * (номинал / 0,75), ElectricalDevice.updateTemp и handleTemp (дым 30 000, сгорание 40 000, в масле 60 000 / 80 000;
 * только при componentDamage). Номинал 1,2 кВт при пределе 1,5 кВт: под полной нагрузкой — 125 %, дымит, но не
 * сгорает (сгорание — с ~137 %).
 */
public class GeneratorDevice extends SimpleElectricalDevice {
    public static final double MAX_POWER = 1500;
    public static final double NOMINAL = 1200;
    public static final double VOLTS = 100;
    static final double BUFFER_TICKS = 10;
    static final double OPEN_R = 1000;
    static final int PLUS = 0;
    static final int MINUS = 1;

    /** Сожжённое топливо, ещё не ушедшее в запас, Вт·тик */
    double pool;
    private double stored;
    private float temp;
    /** Последний тик: отдано в сеть, Вт */
    double lastOut;

    public GeneratorDevice(Level level, BlockPos pos, DevicesSavedData devices, SimulatedDeviceType<?> type) {
        super(level, pos, devices, type);
    }

    @Override
    public void preTick(BridgeCollector collector) {
        BridgeCollector.Builder b = collector.builder(pos);
        // energyLimitedSource(«−», «+») поднимает «+» над «−» (как у выпрямителей EE Extras)
        if (stored > 1) b.energyLimitedSource(MINUS, PLUS, stored, VOLTS);
        else b.resistor(PLUS, MINUS, OPEN_R);
    }

    @Override
    public void postTick(SimulationResults r) {
        double out = 0;
        if (stored > 1) out = Math.min(stored, Math.abs(r.getVoltageAt(pos, PLUS, MINUS) * r.getCurrentThrough(pos, PLUS, MINUS)));
        lastOut = out;
        stored = Math.max(0, stored - out);
        double add = Math.max(0, Math.min(Math.min(pool, MAX_POWER), MAX_POWER * BUFFER_TICKS - stored));
        stored += add;
        pool -= add;
        double heat = out * 1300 / (NOMINAL / 0.75);
        temp = ElectricalDevice.updateTemp(temp, (float) Math.min(heat, 10_000));
        boolean oil = false;
        if (level.isLoaded(pos)) {
            BlockState state = level.getBlockState(pos);
            oil = state.hasProperty(DirectionalRolledDeviceBlock.LOGGED_STATE)
                    && state.getValue(DirectionalRolledDeviceBlock.LOGGED_STATE) == LoggedState.OILLOGGED;
        }
        ElectricalDevice.handleTemp(level, pos, deviceSD, temp, oil ? 60_000 : 30_000, oil ? 80_000 : 40_000);
    }

    @Override
    public void read(CompoundTag tag) {
        stored = tag.getDouble("Stored");
        pool = tag.getDouble("Pool");
        temp = tag.getFloat("Temp");
    }

    @Override
    public void write(CompoundTag tag) {
        tag.putDouble("Stored", stored);
        tag.putDouble("Pool", pool);
        tag.putDouble("OutputPower", lastOut);
        tag.putFloat("Temp", temp);
    }
}
