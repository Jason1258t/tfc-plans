package ee.extras.ac;

import com.george_vi.electroenergetics.config.CEEConfigs;

/** Общее для переменного тока: перевод шага угла за микротик EE в герцы и обратно, угол в (−π, π]. */
public final class Ac {
    private Ac() {}

    public static int microTicks() {
        return Math.max(1, CEEConfigs.server().simulationConfig.microTicks.get());
    }

    /** Шаг угла за микротик, рад → Гц (20 тиков в секунду) */
    public static double hz(double step) {
        return step * microTicks() * 20 / (2 * Math.PI);
    }

    public static double step(double hz) {
        return hz * 2 * Math.PI / (microTicks() * 20.0);
    }

    public static double wrap(double a) {
        a = (a + Math.PI) % (2 * Math.PI);
        if (a < 0) a += 2 * Math.PI;
        return a - Math.PI;
    }
}
