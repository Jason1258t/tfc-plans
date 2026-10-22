package ee.extras.generator;

import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.device.SimpleElectricalDevice;
import com.george_vi.electroenergetics.simulation.BridgeCollector;
import com.george_vi.electroenergetics.simulation.SimulationResults;
import ee.extras.Heat;
import ee.extras.Layout;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.Level;

/**
 * Устройство EE компактного генератора: источник постоянного тока с запасом энергии — как щёточный узел генератора
 * EE 1.1.2 (GeneratingDevice, по байткоду): energyLimitedSource с ЭДС voltage, запас пополняется не больше чем на
 * maxPower за тик и не выше maxPower × 10 (у EE — так же), отдача — модуль U × I, не больше запаса.
 *
 * Откуда энергия — решает блок: кинетический каждый тик ставит «приток» = maxPower (вал крутится — энергия есть,
 * неизрасходованное пропадает, как у EE), топливный копит в притоке сожжённое топливо (supply) — тратится только то,
 * что ушло в запас, поэтому топливо горит по нагрузке. Нагрев — Heat с номиналом блока.
 */
public class GeneratorDevice extends SimpleElectricalDevice {
    static final double OPEN_R = 1000;
    /** Запас — столько тиков полной мощности (у генератора EE — 10) */
    static final double BUFFER_TICKS = 10;

    private final double nominal;
    /** Сколько можно отдать за тик, Вт, и ЭДС, В — ставит блок */
    double maxPower;
    double voltage;
    /** Приток: энергия, готовая уйти в запас, Вт·тик */
    double pool;
    private double stored;
    private float temp;
    /** Последний тик: отдано в сеть, Вт */
    double lastOut;

    public GeneratorDevice(Level level, BlockPos pos, DevicesSavedData devices, SimulatedDeviceType<?> type, double nominal) {
        super(level, pos, devices, type);
        this.nominal = nominal;
    }

    private static int plus() {
        return Layout.COMPACT_GENERATOR.plus();
    }

    private static int minus() {
        return Layout.COMPACT_GENERATOR.minus();
    }

    @Override
    public void preTick(BridgeCollector collector) {
        BridgeCollector.Builder b = collector.builder(pos);
        // energyLimitedSource(«−», «+») поднимает «+» над «−» (так же — у выпрямителей)
        if (stored > 1 && voltage > 0.5) b.energyLimitedSource(minus(), plus(), stored, voltage);
        else b.resistor(plus(), minus(), OPEN_R);
    }

    @Override
    public void postTick(SimulationResults r) {
        double out = 0;
        if (stored > 1 && voltage > 0.5)
            out = Math.min(stored, Math.abs(r.getVoltageAt(pos, plus(), minus()) * r.getCurrentThrough(pos, plus(), minus())));
        lastOut = out;
        stored = Math.max(0, stored - out);
        double add = Math.max(0, Math.min(Math.min(pool, maxPower), maxPower * BUFFER_TICKS - stored));
        stored += add;
        pool -= add;
        temp = Heat.update(temp, out, nominal);
        Heat.handle(level, pos, deviceSD, temp);
    }

    @Override
    public void read(CompoundTag tag) {
        stored = tag.getDouble("Stored");
        pool = tag.getDouble("Pool");
        maxPower = tag.getDouble("MaxPower");
        voltage = tag.getDouble("Voltage");
        temp = tag.getFloat("Temp");
    }

    @Override
    public void write(CompoundTag tag) {
        tag.putDouble("Stored", stored);
        tag.putDouble("Pool", pool);
        tag.putDouble("MaxPower", maxPower);
        tag.putDouble("Voltage", voltage);
        tag.putDouble("OutputPower", lastOut);
        tag.putFloat("Temp", temp);
    }
}
