package ee.extras;

import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.device.SimpleElectricalDevice;
import com.george_vi.electroenergetics.simulation.BridgeCollector;
import com.george_vi.electroenergetics.simulation.SimulationResults;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import ee.extras.ac.Ac;
import ee.extras.ac.Meter;
import ee.extras.ac.Sine;
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
 * Такт сети (2.5.1) — как у преобразователя частоты: Meter меряет выход по мгновенным напряжениям микротиков EE (в
 * сборке microTicks = 8; getVoltageAt там — действующее без знака), выход — источники Sine на парах (ЭДС меняется на
 * каждом микротике; пара ab = U·cos θ, bc и ca — со сдвигом 120°). Отключён (OFF) — замер. Сеть есть и своя ЭДС выше
 * сетевой — GRID: угол и шаг — из замера (theta = predict(0)), трёхфазный идёт за сетью при любом порядке фаз. Сети нет
 * — свой переменный ток 1 Гц (ISLAND; трёхфазный — с порядком фаз генераторов EE, шаг < 0). Сеть пересилила
 * (сглаженная отданная мощность < 0) — снова OFF и замер.
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
    /** Свой переменный ток без сети, Гц */
    static final double ISLAND_HZ = 1;
    static final double VOLTS_FOLLOW = 0.3;
    static final double SHIFT = 2 * Math.PI / 3;

    static final int OFF = 0, GRID = 1, ISLAND = 2;

    private final Layout layout;
    private final Tier tier;
    private final Sine[] sines;
    private final Meter meter;
    private float temp;
    private double stored;
    private double outAvg;
    private double netAvg;
    private double inputR = OPEN_R;
    private double dcVolts;
    private int mode = OFF;
    /** Угол ЭДС на микротике 0 следующего тика */
    private double theta;
    private double amp;
    private double rOut = OPEN_R;
    private boolean active;
    private double[] dcPlus, dcMinus;
    private double lastIn;
    private double lastOut;
    private double phaseError;

    public InverterDevice(Level level, BlockPos pos, DevicesSavedData devices, SimulatedDeviceType<?> type, Layout layout,
            Tier tier) {
        super(level, pos, devices, type);
        this.layout = layout;
        this.tier = tier;
        int pairs = three() ? 3 : 1;
        sines = new Sine[pairs];
        for (int i = 0; i < pairs; i++) sines[i] = new Sine(-i * SHIFT);
        meter = three() ? new Meter(pos, 0, 1, 2) : new Meter(pos, 0, 1);
    }

    private boolean three() {
        return layout.inputs() == 3;
    }

    private double bufferMax() {
        return Math.max(MIN_BUFFER, BUFFER_TICKS * outAvg);
    }

    /** Пары контактов переменного тока: трёхфазный — ab, bc, ca; однофазный — фаза и нейтраль */
    private int a(int i) {
        return three() ? i : 0;
    }

    private int b(int i) {
        return three() ? (i + 1) % 3 : 1;
    }

    @Override
    public void preTick(BridgeCollector collector) {
        BridgeCollector.Builder bld = collector.builder(pos);
        bld.resistor(layout.plus(), layout.minus(), inputR);
        active = mode != OFF && stored > 1 && amp > Meter.DEAD;
        if (active) {
            // «Сопротивление на номинал»: R = доля × U² / P (трёхфазный треугольник — 1,5 U² на пару)
            double rNom = (three() ? 1.5 : 0.5) * Z_PU * amp * amp / tier.watts;
            // Не отдать больше запаса за тик (как energyLimitedSource: в согласованную нагрузку — U²эфф / 4R на пару)
            double rEnergy = sines.length * amp * amp / (8 * stored);
            rOut = Math.max(MIN_R, Math.max(rNom, rEnergy));
        }
        for (int i = 0; i < sines.length; i++) {
            Sine s = sines[i];
            s.amp = active ? amp : 0;
            s.r = active ? rOut : OPEN_R;
            s.theta = theta;
            s.step = mode == GRID ? meter.step : (three() ? -1 : 1) * Ac.step(ISLAND_HZ);
            // Sine поднимает n2 над n1, замер пары — U(a) − U(b): n2 = a
            bld.connect(b(i), a(i), s);
        }
    }

    @Override
    public void postTick(SimulationResults r) {
        // Постоянная сторона — по микротикам: среднее со знаком (обратная полярность — 0), мощность — по среднему квадрату
        dcPlus = r.getVoltages(new InWorldNode(layout.plus(), pos), dcPlus);
        dcMinus = r.getVoltages(new InWorldNode(layout.minus(), pos), dcMinus);
        int n = Math.min(dcPlus.length, dcMinus.length);
        double mean = 0, sq = 0;
        for (int k = 0; k < n; k++) {
            double v = dcPlus[k] - dcMinus[k];
            mean += v;
            sq += v * v;
        }
        if (n > 0) {
            mean /= n;
            sq /= n;
        }
        double in = sq / inputR;
        dcVolts += (Math.max(0, mean) - dcVolts) * VOLTS_FOLLOW;

        // Фаза ЭДС на последнем микротике прошлого тика — до замера (для PhaseError)
        double emfAngle = theta + sines[0].step * (Ac.microTicks() - 1);
        double out = 0;
        for (Sine s : sines) out += s.take();
        if (!active) out = 0;

        lastIn = in;
        lastOut = out;
        stored = Math.max(0, Math.min(bufferMax(), stored + in - out));
        temp = Heat.update(temp, Math.max(in, Math.abs(out)), tier);
        if (Heat.handle(level, pos, deviceSD, temp)) return;
        outAvg = 0.8 * outAvg + 0.2 * Math.max(0, out);
        // «Сеть пересилила» — по сглаженной отдаче: у однофазного мгновенная мощность у нуля синусоиды скачет
        netAvg = active ? 0.7 * netAvg + 0.3 * out : 0;

        amp = (three() ? Math.PI / 3 : Math.PI / 2) * dcVolts;
        meter.measure(r);
        phaseError = active && meter.valid ? Math.toDegrees(Ac.wrap(meter.angle - emfAngle)) : 0;
        control();

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
        if (dcVolts < Meter.DEAD) next = OPEN_R;
        next = Math.max(inputR / R_STEP, Math.min(inputR * R_STEP, next));
        inputR = Math.max(MIN_R, Math.min(OPEN_R, next));
    }

    private void control() {
        if (mode != OFF && netAvg < 0) {
            mode = OFF;
        } else if (mode == OFF) {
            if (meter.valid) {
                // Сеть есть: включаться, только если своя ЭДС выше сетевой (ниже сети — не отдаёт)
                if (amp > meter.amp) mode = GRID;
            } else if (meter.amp <= Meter.DEAD && amp > Meter.DEAD) {
                mode = ISLAND;
                theta = 0;
            }
        }
        int mt = Ac.microTicks();
        if (mode == GRID && meter.valid) theta = meter.predict(0);
        else if (mode == ISLAND) theta = Ac.wrap(theta + sines[0].step * mt);
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
        tag.putDouble("GridHz", Math.abs(meter.hz()));
        tag.putDouble("PhaseError", phaseError);
    }
}
