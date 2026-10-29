package ee.extras.ac;

import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.simulation.SimulationResults;
import net.minecraft.core.BlockPos;

/**
 * Замер одной стороны переменного тока по мгновенным напряжениям микротиков EE (SimulationResults.getVoltages; в
 * сборке microTicks = 8, т. е. 160 отсчётов в секунду, getVoltageAt при этом отдаёт действующее без знака). Итог —
 * вектор: амплитуда (линейная у трёхфазного, фаза–ноль у однофазного), угол на последнем отсчёте, шаг угла за
 * микротик (рад) и частота. Угол — в смысле u = U·cos θ.
 *
 * Трёхфазный — по трём линейным напряжениям, разложением Кларк: α = ⅔(u_ab − ½u_bc − ½u_ca), β = (u_bc − u_ca)/√3;
 * угол и амплитуда известны на каждом отсчёте, шаг — средний за тик. Обратный порядок фаз — шаг < 0.
 *
 * Однофазный — у синусоиды u(n+1) + u(n−1) = c·u(n), c = 2 cos шага (c — наименьшими квадратами с забыванием), угол —
 * по двум последним отсчётам: U cos θ = u(n), U sin θ = (u(n−1) − u(n) cos ω) / sin ω.
 */
public final class Meter {
    /** Напряжения ниже — «нет напряжения», В (амплитуда) */
    public static final double DEAD = 5;
    static final double FOLLOW = 0.3;

    private final BlockPos pos;
    private final int[] nodes;
    private final boolean three;
    private double[][] buf;

    /** Результат последнего замера */
    public double amp;
    public double angle;
    public double step;
    public boolean valid;

    /** Трёхфазный: прошлый угол; однофазный: прошлые отсчёты и суммы для c */
    private double lastAngle = Double.NaN;
    private double u0, u1;
    private int samples;
    private double cNum, cDen;
    private double ampAvg;

    /** nodes: трёхфазный — три фазы, однофазный — фаза и ноль */
    public Meter(BlockPos pos, int... nodes) {
        this.pos = pos;
        this.nodes = nodes;
        this.three = nodes.length == 3;
        this.buf = new double[nodes.length][];
    }

    public boolean three() {
        return three;
    }

    /** Частота, Гц (у обратного порядка фаз — со знаком минус) */
    public double hz() {
        return valid ? Ac.hz(step) : 0;
    }

    /** Угол на i-м микротике следующего тика */
    public double predict(int microTick) {
        return angle + step * (microTick + 1);
    }

    public void measure(SimulationResults r) {
        int n = Integer.MAX_VALUE;
        for (int i = 0; i < nodes.length; i++) {
            buf[i] = r.getVoltages(new InWorldNode(nodes[i], pos), buf[i]);
            n = Math.min(n, buf[i].length);
        }
        if (n == 0 || n == Integer.MAX_VALUE) {
            valid = false;
            lastAngle = Double.NaN;
            samples = 0;
            return;
        }
        if (three) measureThree(n);
        else measureSingle(n);
    }

    private void measureThree(int n) {
        double sumStep = 0, sumAmp = 0;
        int steps = 0;
        for (int k = 0; k < n; k++) {
            double uab = buf[0][k] - buf[1][k], ubc = buf[1][k] - buf[2][k], uca = buf[2][k] - buf[0][k];
            double alpha = 2.0 / 3.0 * (uab - 0.5 * ubc - 0.5 * uca);
            double beta = (ubc - uca) / Math.sqrt(3);
            double a = Math.atan2(beta, alpha);
            sumAmp += Math.hypot(alpha, beta);
            if (!Double.isNaN(lastAngle)) {
                sumStep += Ac.wrap(a - lastAngle);
                steps++;
            }
            lastAngle = a;
            angle = a;
        }
        amp = sumAmp / n;
        boolean was = valid;
        valid = amp > DEAD && steps > 0;
        if (!valid) {
            lastAngle = amp > DEAD ? lastAngle : Double.NaN;
            return;
        }
        double s = sumStep / steps;
        step = was ? step + (s - step) * FOLLOW * 2 : s;
    }

    private void measureSingle(int n) {
        for (int k = 0; k < n; k++) {
            double v = buf[0][k] - buf[1][k];
            if (samples >= 2) {
                cNum = 0.97 * cNum + (v + u1) * u0;
                cDen = 0.97 * cDen + u0 * u0;
            }
            u1 = u0;
            u0 = v;
            samples++;
        }
        if (samples < 3 * n || cDen < 1e-9) {
            valid = false;
            return;
        }
        double c = Math.max(-2, Math.min(2, cNum / cDen));
        double w = Math.acos(c / 2);
        double sin = Math.sin(w);
        double a;
        double u;
        if (sin > 1e-3) {
            double s = (u1 - u0 * Math.cos(w)) / sin;
            a = Math.atan2(s, u0);
            u = Math.hypot(u0, s);
        } else {
            // Шаг почти 0 (постоянный ток) или π: угол — по знаку
            a = u0 >= 0 ? 0 : Math.PI;
            u = Math.abs(u0);
        }
        ampAvg += (u - ampAvg) * FOLLOW;
        amp = ampAvg;
        angle = a;
        step = w;
        // Постоянный ток — не переменный: частоты нет
        valid = amp > DEAD && w > 1e-3;
    }
}
