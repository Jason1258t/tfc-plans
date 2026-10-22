package ee.extras;

import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.device.SimpleElectricalDevice;
import com.george_vi.electroenergetics.simulation.BridgeCollector;
import com.george_vi.electroenergetics.simulation.SimulationResults;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.Level;

/**
 * Сетевой инвертор: постоянный ток → переменный, в такт сети. Выпрямитель наоборот: вход — нагрузка (резистор между
 * «+» и «−»), выход — источники ЭДС за внутренним сопротивлением (у трёхфазного — треугольником между фазами, как
 * обмотки), запас энергии между ними честный: пополняется тем, что вход забрал (U² / R), тратится на отданное.
 *
 * ЭДС — как у идеального преобразователя с постоянным коэффициентом (обратный выпрямителю этого мода): амплитуда
 * линейного напряжения трёхфазного = (π/3) × U пост., однофазного = (π/2) × U пост. Поэтому сколько он отдаёт, решает
 * напряжение со стороны постоянного тока, как у трансформатора: выше сети — отдаёт, ниже — молчит (обратно ток не
 * пускает). Внутреннее сопротивление — «10 % на номинал»: напряжение на 10 % выше сетевого даёт номинальную мощность
 * ступени; дальше блок греется (Heat), как выпрямитель. Источник ограничен запасом так же, как energyLimitedSource EE
 * (сопротивление не меньше U² / 4 × запас на фазу).
 *
 * Такт сети. Отключён (OFF) — меряет сеть: трёхфазный по трём линейным напряжениям знает угол сразу (разложение
 * Кларк: α = ⅔(u_ab − ½u_bc − ½u_ca), β = (u_bc − u_ca)/√3), шаг угла за тик — по двум замерам; однофазный копит
 * отсчёты: у любой синусоиды по отсчётам u(n+1) + u(n−1) = c·u(n), c = 2 cos шага (c — по наименьшим квадратам), угол —
 * по двум последним отсчётам, амплитуда сети — по среднему квадрату (только чтобы решить, выше ли своя ЭДС). В сети
 * (GRID) ставит ЭДС на следующий тик в фазе с сетью; амплитуда ЭДС всегда своя, от постоянного напряжения. Сети нет — сам задаёт переменный ток 1 Гц (ISLAND, 18° за тик: при microTicks = 1 ровная синусоида).
 * Сеть пересилила (сглаженная отданная мощность < 0) — снова OFF и замер. Замеры берутся по SimulationResults: при microTicks > 1
 * EE отдаёт напряжение без знака, подстройка к сети работает только при microTicks = 1 (как на сервере сборки).
 */
public class InverterDevice extends SimpleElectricalDevice {
    static final double MIN_BUFFER = 2000;
    static final double BUFFER_TICKS = 20;
    static final double MIN_R = 0.01;
    static final double OPEN_R = 1e6;
    static final double R_STEP = 1.25;
    static final double TARGET_FILL = 0.5;
    static final double START_R = 1000;
    /** Доля номинала: на сколько ЭДС выше сети при номинальной мощности */
    static final double Z_PU = 0.1;
    /** Сети нет, если её амплитуда ниже, В */
    static final double GRID_MIN = 5;
    /** Свой переменный ток без сети: шаг угла за тик (1 Гц) */
    static final double ISLAND_STEP = Math.toRadians(18);
    static final double VOLTS_FOLLOW = 0.3;
    static final int WINDOW = 40;
    static final double SHIFT = 2 * Math.PI / 3;

    static final int OFF = 0, GRID = 1, ISLAND = 2;

    private final Layout layout;
    private final Tier tier;
    private float temp;
    private double stored;
    private double outAvg;
    private double netAvg;
    private double inputR = OPEN_R;
    private double dcVolts;
    private int mode = OFF;
    /** Угол ЭДС на этот тик и шаг за тик, рад (трёхфазный и свой переменный ток однофазного) */
    private double theta;
    private double step = ISLAND_STEP;
    /** Прошлый замер угла сети (трёхфазный) */
    private double lastAngle = Double.NaN;
    /** ЭДС на этот тик: амплитуда, сопротивление, мгновенные значения по парам контактов */
    private double amp;
    private double rOut = OPEN_R;
    private final double[] emf = new double[3];
    private boolean active;
    /** Однофазный: отсчёты u(n), u(n−1), суммы для c, окно среднего квадрата */
    private double u0, u1;
    private int samples;
    private double cNum, cDen;
    private final double[] window = new double[WINDOW];
    private int pointer;
    private double lastIn;
    private double lastOut;
    private double phaseError;

    public InverterDevice(Level level, BlockPos pos, DevicesSavedData devices, SimulatedDeviceType<?> type, Layout layout,
            Tier tier) {
        super(level, pos, devices, type);
        this.layout = layout;
        this.tier = tier;
    }

    private boolean three() {
        return layout.inputs() == 3;
    }

    private double bufferMax() {
        return Math.max(MIN_BUFFER, BUFFER_TICKS * outAvg);
    }

    /** Пары контактов переменного тока: трёхфазный — ab, bc, ca; однофазный — фаза и нейтраль */
    private int pairs() {
        return three() ? 3 : 1;
    }

    private static int a(int i) {
        return i;
    }

    private static int b(int i) {
        return (i + 1) % 3;
    }

    @Override
    public void preTick(BridgeCollector collector) {
        BridgeCollector.Builder bld = collector.builder(pos);
        bld.resistor(layout.plus(), layout.minus(), inputR);
        active = mode != OFF && stored > 1 && amp > 0.5;
        if (active) {
            // «Сопротивление на номинал»: P = ΔU × U / … → R = доля × U² / P (трёхфазный треугольник — 1,5 U² на пару)
            double rNom = (three() ? 1.5 : 0.5) * Z_PU * amp * amp / tier.watts;
            // Не отдать больше запаса за тик (как energyLimitedSource: в согласованную нагрузку — U²эфф / 4R на пару)
            double rEnergy = pairs() * amp * amp / (8 * stored);
            rOut = Math.max(MIN_R, Math.max(rNom, rEnergy));
        }
        for (int i = 0; i < pairs(); i++) {
            int na = three() ? a(i) : 0, nb = three() ? b(i) : 1;
            // voltageSourceWithResistance(n1, n2, …, E) поднимает n2 над n1 на E (у творческой батареи EE 0 — «−»),
            // а getVoltageAt(a, b) = U(a) − U(b) — поэтому n2 = na: ЭДС и замер в одном знаке
            if (active) bld.voltageSourceWithResistance(nb, na, rOut, emf[i]);
            else bld.resistor(na, nb, OPEN_R);
        }
    }

    @Override
    public void postTick(SimulationResults r) {
        double dc = r.getVoltageAt(pos, layout.plus(), layout.minus());
        double in = dc * dc / inputR;
        dcVolts += (Math.max(0, dc) - dcVolts) * VOLTS_FOLLOW;

        // Отдано в сеть: на каждой паре U × (ЭДС − U) / R
        double[] u = new double[pairs()];
        double out = 0;
        for (int i = 0; i < pairs(); i++) {
            u[i] = three() ? r.getVoltageAt(pos, a(i), b(i)) : r.getVoltageAt(pos, 0, 1);
            if (active) out += u[i] * (emf[i] - u[i]) / rOut;
        }

        lastIn = in;
        lastOut = out;
        stored = Math.max(0, Math.min(bufferMax(), stored + in - out));
        temp = Heat.update(temp, Math.max(in, Math.abs(out)), tier);
        if (Heat.handle(level, pos, deviceSD, temp)) return;
        outAvg = 0.8 * outAvg + 0.2 * Math.max(0, out);
        // «Сеть пересилила» — по сглаженной отдаче: у однофазного мгновенная мощность у нуля синусоиды скачет
        netAvg = active ? 0.7 * netAvg + 0.3 * out : 0;

        amp = (three() ? Math.PI / 3 : Math.PI / 2) * dcVolts;
        if (three()) syncThree(u, netAvg);
        else syncSingle(u[0], netAvg);

        // Вход на следующий тик: сопротивление, при котором вход забирает столько, сколько ушло, ±25 % на запас, и
        // дозаряжает запас до половины за BUFFER_TICKS (иначе пустой запас и малая отдача долго тянут друг друга)
        double fill = stored / bufferMax();
        double correction = Math.max(1 / R_STEP, Math.min(R_STEP, 1 + (TARGET_FILL - fill)));
        double deficit = Math.max(0, TARGET_FILL * bufferMax() - stored);
        double want = Math.min(tier.watts * 2, outAvg * correction + deficit / BUFFER_TICKS);
        double next = want > 1e-6 ? dcVolts * dcVolts / want : OPEN_R;
        // Пустой запас — подзарядить, чтобы было с чего начать
        if (stored < 1) next = Math.min(next, START_R);
        // Постоянного напряжения почти нет — вход отключён (иначе подзарядка тянула бы сопротивление к нулю)
        if (dcVolts < GRID_MIN) next = OPEN_R;
        next = Math.max(inputR / R_STEP, Math.min(inputR * R_STEP, next));
        inputR = Math.max(MIN_R, Math.min(OPEN_R, next));
    }

    private void syncThree(double[] u, double out) {
        double alpha = 2.0 / 3.0 * (u[0] - 0.5 * u[1] - 0.5 * u[2]);
        double beta = (u[1] - u[2]) / Math.sqrt(3);
        double grid = Math.hypot(alpha, beta);
        double angle = Math.atan2(beta, alpha);
        double measured = Double.isNaN(lastAngle) ? Double.NaN : wrap(angle - lastAngle);
        lastAngle = grid > GRID_MIN ? angle : Double.NaN;

        if (mode == OFF) {
            if (grid > GRID_MIN) {
                // Сеть есть: включаться, когда известен шаг (два замера подряд) и своя ЭДС выше сетевой
                if (!Double.isNaN(measured) && amp > grid) {
                    step = measured;
                    mode = GRID;
                }
            } else if (amp > GRID_MIN) {
                mode = ISLAND;
                step = ISLAND_STEP;
            }
        } else if (out < 0) {
            mode = OFF;
        } else if (mode == GRID && !Double.isNaN(measured)) {
            step = 0.7 * step + 0.3 * measured;
        }

        // Насколько сеть ушла от ЭДС этого тика (только для /cee device_data): в сети должно быть около нуля
        phaseError = active && grid > GRID_MIN ? Math.toDegrees(wrap(angle - theta)) : 0;
        if (mode == GRID) theta = angle + step;
        else if (mode == ISLAND) theta = wrap(theta + step);
        for (int i = 0; i < 3; i++) emf[i] = amp * Math.cos(theta - i * SHIFT);
    }

    private void syncSingle(double v, double out) {
        // Отсчёты сети (и свои, пока включён): c = Σ (u(n) + u(n−2)) u(n−1) / Σ u(n−1)²
        if (samples >= 2) {
            cNum = 0.9 * cNum + (v + u1) * u0;
            cDen = 0.9 * cDen + u0 * u0;
        }
        u1 = u0;
        u0 = v;
        samples++;
        window[pointer] = v * v;
        pointer = (pointer + 1) % WINDOW;
        double s = 0;
        for (double x : window) s += x;
        double grid = Math.sqrt(2 * s / WINDOW);
        boolean known = samples > WINDOW && cDen > 1e-9;

        if (mode == OFF) {
            if (grid > GRID_MIN) {
                if (known && amp > grid) mode = GRID;
            } else if (amp > GRID_MIN && samples > WINDOW) {
                mode = ISLAND;
                theta = 0;
            }
        } else if (out < 0) {
            mode = OFF;
        }

        if (mode == GRID && known) {
            // Шаг угла ω из c = 2 cos ω; угол по двум отсчётам: U cos θ = u(n), U sin θ = (u(n−1) − u(n) cos ω) / sin ω.
            // Амплитуда — своя (от постоянного напряжения), а не по сети: по сети он подхватывал бы сам себя
            double c = Math.max(-2, Math.min(2, cNum / cDen));
            double w = Math.acos(c / 2);
            if (Math.sin(w) > 0.2) {
                double angle = Math.atan2((u1 - u0 * Math.cos(w)) / Math.sin(w), u0);
                emf[0] = amp * Math.cos(angle + w);
            } else {
                // Шаг почти 0° или 180° — по отсчётам это постоянный ток или смена знака каждый тик
                emf[0] = amp * Math.signum(u0) * (c > 0 ? 1 : -1);
            }
        } else if (mode == ISLAND) {
            theta = wrap(theta + ISLAND_STEP);
            emf[0] = amp * Math.cos(theta);
        } else {
            emf[0] = 0;
        }
    }

    private static double wrap(double a) {
        a = (a + Math.PI) % (2 * Math.PI);
        if (a < 0) a += 2 * Math.PI;
        return a - Math.PI;
    }

    @Override
    public void read(CompoundTag tag) {
        stored = tag.getDouble("Stored");
        outAvg = tag.getDouble("OutAvg");
        inputR = tag.contains("InputR") ? tag.getDouble("InputR") : OPEN_R;
        dcVolts = tag.getDouble("DcVolts");
        temp = tag.getFloat("Temp");
        // Такт сети после загрузки мира — заново, с замера
        mode = OFF;
    }

    @Override
    public void write(CompoundTag tag) {
        tag.putDouble("Stored", stored);
        tag.putDouble("OutAvg", outAvg);
        tag.putDouble("InputR", inputR);
        tag.putDouble("DcVolts", dcVolts);
        tag.putFloat("Temp", temp);
        tag.putString("Mode", mode == GRID ? "grid" : mode == ISLAND ? "island" : "off");
        tag.putDouble("InputPower", lastIn);
        tag.putDouble("OutputPower", lastOut);
        tag.putDouble("Amplitude", amp);
        if (three()) tag.putDouble("PhaseError", phaseError);
    }
}
