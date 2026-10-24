package aero.extra;

import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.device.SimpleElectricalDevice;
import com.george_vi.electroenergetics.simulation.BridgeCollector;
import com.george_vi.electroenergetics.simulation.SimulationResults;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.Level;

/**
 * Устройство EE бортового компьютера. Состояние (модули, заряд, обороты) хранит блок-сущность, устройство каждый тик
 * берёт его оттуда и возвращает заряд обратно — как аккумулятор EE отдаёт заряд своей блок-сущности.
 *
 * Схема на клеммах «+» и «−»:
 * - есть аккумуляторные модули — батарея (BatteryPack, ячейки EE параллельно). Генераторные модули заряжают её
 *   напрямую, мимо сети EE, как генератор машины через реле-регулятор: 6 Вт на 1 об/мин на модуль, пока батарея не
 *   полна (дальше энергия пропадает, вал всё равно нагружен — как у генератора EE). Сеть берёт ток из батареи и
 *   может заряжать её сама, если её напряжение выше;
 * - только генераторы — источник как у компактного генератора EE Extras: ЭДС 0,5 В на 1 об/мин, отдача до
 *   6 Вт на 1 об/мин на модуль (energyLimitedSource с запасом на 10 тиков, как у генератора EE);
 * - модулей нет — клеммы разомкнуты.
 */
public class OnboardDevice extends SimpleElectricalDevice {
    static final double OPEN_R = 1000;
    static final double BUFFER_TICKS = 10;
    static final double TICK = 0.05;

    private final BatteryPack pack = new BatteryPack();
    private OnboardComputerBlockEntity be;
    private int cells;
    private double chargeBefore;
    /** Без аккумулятора: запас энергии генераторов на тик и его предел, ЭДС */
    private double stored;
    private double maxPower;
    private double voltage;
    private double lastOut;

    public OnboardDevice(Level level, BlockPos pos, DevicesSavedData devices, SimulatedDeviceType<?> type) {
        super(level, pos, devices, type);
    }

    private OnboardComputerBlockEntity blockEntity() {
        if (be != null && be.isRemoved()) be = null;
        if (be == null && level.isLoaded(pos) && level.getBlockEntity(pos) instanceof OnboardComputerBlockEntity found) be = found;
        return be;
    }

    @Override
    public void preTick(BridgeCollector collector) {
        BridgeCollector.Builder b = collector.builder(pos);
        OnboardComputerBlockEntity e = blockEntity();
        cells = e == null ? 0 : e.modules().batteries();
        int gens = e == null ? 0 : e.modules().generators();
        double rpm = e == null ? 0 : e.rpm();
        maxPower = OnboardComputerBlockEntity.WATTS_PER_RPM * rpm * gens;
        voltage = OnboardComputerBlockEntity.VOLTS_PER_RPM * rpm;
        if (cells > 0) {
            pack.setCells(cells);
            pack.storedCharge = chargeBefore = e.charge();
            b.connect(Terminals.PLUS, Terminals.MINUS, pack);
        } else if (gens > 0 && stored > 1 && voltage > 0.5) {
            // energyLimitedSource(«−», «+») поднимает «+» над «−» (как у компактного генератора EE Extras)
            b.energyLimitedSource(Terminals.MINUS, Terminals.PLUS, stored, voltage);
        } else {
            b.resistor(Terminals.PLUS, Terminals.MINUS, OPEN_R);
        }
    }

    @Override
    public void postTick(SimulationResults r) {
        OnboardComputerBlockEntity e = blockEntity();
        double u = r.getVoltageAt(pos, Terminals.PLUS, Terminals.MINUS);
        if (cells > 0 && e != null) {
            // Ток батареи — по убыли заряда за тик (плюс — разряд в сеть, минус — заряд от сети)
            double current = (chargeBefore - pack.storedCharge) * cells / TICK;
            lastOut = u * current;
            double before = pack.storedCharge;
            double after = BatteryPack.charge(before, maxPower * TICK / cells);
            // Сколько генераторы реально отдали в батарею (у полной — меньше выработки): dE = dq × U, как в charge()
            double gen = (after - before) * BatteryPack.chargingVoltage(before) * cells / TICK;
            e.updateFromDevice(after, u, lastOut, gen);
            stored = 0;
            return;
        }
        double out = 0;
        if (stored > 1 && voltage > 0.5)
            out = Math.min(stored, Math.abs(u * r.getCurrentThrough(pos, Terminals.PLUS, Terminals.MINUS)));
        lastOut = out;
        stored = Math.max(0, stored - out);
        // Вал крутится — энергия есть, неизрасходованное пропадает (как у генератора EE)
        double add = Math.max(0, Math.min(maxPower, maxPower * BUFFER_TICKS - stored));
        stored += add;
        if (e != null) e.updateFromDevice(e.charge(), u, out, out);
    }

    @Override
    public void read(CompoundTag tag) {
        stored = tag.getDouble("Stored");
    }

    @Override
    public void write(CompoundTag tag) {
        tag.putDouble("Stored", stored);
        tag.putDouble("OutputPower", lastOut);
        tag.putDouble("MaxPower", maxPower);
        tag.putInt("Cells", cells);
    }
}
