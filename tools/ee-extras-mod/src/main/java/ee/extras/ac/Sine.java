package ee.extras.ac;

import com.george_vi.electroenergetics.simulation.electrical_properties.MicroTickingElectricalProperties;

/**
 * Источник синусоидальной ЭДС за внутренним сопротивлением, меняется на каждом микротике EE — как обмотки трёхфазного
 * генератора EE (ThreePhaseAlternatorBrushesDevice.PhaseWindingProperties): источник тока E/R параллельно R. Подключение
 * connect(n1, n2, источник): без нагрузки U(n2) − U(n1) = E (так же у обмоток EE: в afterTick напряжение на обмотке —
 * V[n2] − V[n1]). ЭДС на микротике k = amp · cos(theta + step · k + shift).
 *
 * Отданную мощность считает сам (среднее за тик) — устройство забирает её в postTick через take().
 */
public final class Sine extends MicroTickingElectricalProperties {
    final double shift;
    public double amp;
    public double theta;
    public double step;
    public double r = 1e6;
    private double out;

    public Sine(double shift) {
        this.shift = shift;
        this.resistance = 1e6;
    }

    double emf(int microTick) {
        return amp * Math.cos(theta + step * microTick + shift);
    }

    @Override
    public void tick(double[] voltages, int microTick, int total, int n1, int n2) {
        resistance = r;
        currentSource = emf(microTick) / r;
    }

    @Override
    public void afterTick(double[] voltages, int n1, int n2, int microTick, int total) {
        double u = voltages[n2 * total + microTick] - voltages[n1 * total + microTick];
        out += u * (emf(microTick) - u) / r / total;
    }

    /** Отдано в сеть за прошлый тик, Вт (и обнулить) */
    public double take() {
        double o = out;
        out = 0;
        return o;
    }
}
