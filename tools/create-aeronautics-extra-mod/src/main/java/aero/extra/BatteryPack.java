package aero.extra;

import com.george_vi.electroenergetics.foundation.electrical_properties.AccumulatorProperties;
import net.minecraft.util.Mth;

/**
 * Аккумуляторные модули — n ячеек аккумулятора EE 1.1.2 параллельно (AccumulatorProperties, по байткоду): ЭДС ячейки
 * = baseOpenCircuitVoltage(soc) × 24 В, внутреннее сопротивление 0,1 Ом, ёмкость — maxAccumulatorCharge из настроек
 * сервера EE (в сборке 36 000 Кл = 10 А·ч). Ячейки одинаковые и всегда при одном напряжении, поэтому делят ток поровну:
 * одна «ячейка» с сопротивлением 0,1 / n, а storedCharge — заряд одной ячейки (тогда soc() EE считает верно).
 * afterTick — как у EE, только ток делится на n.
 */
public class BatteryPack extends AccumulatorProperties {
    public static final double CELL_RESISTANCE = 0.1;

    int cells = 1;

    void setCells(int cells) {
        this.cells = Math.max(1, cells);
        internalResistance = CELL_RESISTANCE / this.cells;
    }

    @Override
    public void afterTick(double[] allVoltages, int n1, int n2, int microTick, int totalMicroTicks) {
        double lastVoltage = allVoltages[n1 * totalMicroTicks + microTick] - allVoltages[n2 * totalMicroTicks + microTick];
        double dt = 0.05 / totalMicroTicks;
        double sourceVoltage = baseOpenCircuitVoltage(soc()) * cellVoltage;
        double lastCurrent = (sourceVoltage - lastVoltage) / internalResistance;
        storedCharge = Mth.clamp(storedCharge - lastCurrent * dt / cells, 0, getNominalCharge());
    }

    /** Ёмкость ячейки для подсказок: настройки сервера EE до входа в мир не загружены — тогда значение сборки */
    public static double nominalSafe() {
        try {
            return getNominalCharge();
        } catch (IllegalStateException | NullPointerException e) {
            return 36_000;
        }
    }

    /** Напряжение ячейки без нагрузки при заряде одной ячейки charge, В */
    public static double openVoltage(double charge) {
        return baseOpenCircuitVoltage(charge / getNominalCharge()) * 24;
    }

    /** Заряд одной ячейки после того, как в каждую ушло joules Дж: dq = dE / U(q) — так же EE считает энергию (energyFromSOC) */
    public static double charge(double charge, double joules) {
        return Mth.clamp(charge + joules / chargingVoltage(charge), 0, getNominalCharge());
    }

    /** Напряжение для пересчёта энергии в заряд: пустая ячейка у EE — 0 В, считаем её как 6 В (¼ полного — столько у EE при soc 0,1 %) */
    public static double chargingVoltage(double charge) {
        return Math.max(openVoltage(charge), 6);
    }
}
