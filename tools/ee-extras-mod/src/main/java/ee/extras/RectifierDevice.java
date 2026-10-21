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
 * Выпрямитель «входом и выходом», без диодов внутри (1.1). Диоды EE линеаризуются по прошлому расчёту и на быстром
 * переменном токе не успевают за фазой (при microTicks = 1 — выше ~4 об/мин); блоку они не нужны.
 *
 * Вход — нагрузка: резисторы между входами (у трёхфазного — треугольником между фазами, у однофазного — между фазой и
 * нейтралью). Выход — источник постоянного напряжения с запасом энергии (energyLimitedSource, как у генератора EE).
 * Энергия честная: запас пополняется ровно тем, что вход забрал из сети (U² / R), и тратится на то, что ушло с
 * выхода. Сопротивление входа — как у настоящего моста: нагрузка выхода, пересчитанная на переменную сторону
 * (π²/6 × R_нагр треугольником, π²/8 у однофазного), с поправкой ±25 % на заполнение запаса. Для сети это обычная
 * резистивная нагрузка, поэтому генератор под перегрузкой ведёт себя устойчиво (запас сам ограничивает подачу, а
 * следящий за сетью вход «постоянной мощности» раскачивал бы генератор — так было в первом варианте, проверено).
 *
 * Напряжение на выходе — среднее идеального моста: трёхфазный — (3/π) × амплитуда линейного напряжения, которая для
 * трёх фаз видна в любой момент: U_лин² = ⅔ (u_ab² + u_bc² + u_ca²) — от угла ротора не зависит, «снимки» раз в тик
 * не мешают. Однофазный — (2/π) × амплитуда, амплитуда — по среднему квадрату за последние WINDOW тиков.
 */
public class RectifierDevice extends SimpleElectricalDevice {
    /** Запас не меньше этого, Вт·тик, и не меньше BUFFER_TICKS тиков отдачи */
    static final double MIN_BUFFER = 2000;
    static final double BUFFER_TICKS = 20;
    /** Окно усреднения однофазного входа, тиков */
    static final int WINDOW = 40;
    static final double MIN_R = 0.01;
    static final double OPEN_R = 1e6;
    /** Сопротивление входа меняется не больше чем в R_STEP раз за тик */
    static final double R_STEP = 1.25;
    /** К какой доле заполнения тянуть запас */
    static final double TARGET_FILL = 0.5;
    /** Сопротивление входа, с которого начинается зарядка пустого запаса, Ом */
    static final double START_R = 1000;
    /** Доля разницы, на которую выходное напряжение догоняет вход за тик */
    static final double VOLTS_FOLLOW = 0.3;

    private final Layout layout;
    private double stored;
    private double outAvg;
    private double inputR = OPEN_R;
    private double outVolts;
    private final double[] window = new double[WINDOW];
    private int pointer;
    /** Последний тик: взято со входа и отдано на выход, Вт — для /cee device_data */
    private double lastIn;
    private double lastOut;

    public RectifierDevice(Level level, BlockPos pos, DevicesSavedData devices, SimulatedDeviceType<?> type, Layout layout) {
        super(level, pos, devices, type);
        this.layout = layout;
    }

    private boolean three() {
        return layout.inputs() == 3;
    }

    private double bufferMax() {
        return Math.max(MIN_BUFFER, BUFFER_TICKS * outAvg);
    }

    @Override
    public void preTick(BridgeCollector collector) {
        BridgeCollector.Builder b = collector.builder(pos);
        if (three()) {
            b.resistor(0, 1, inputR);
            b.resistor(1, 2, inputR);
            b.resistor(2, 0, inputR);
        } else {
            b.resistor(0, 1, inputR);
        }
        if (stored > 1 && outVolts > 0.5) b.energyLimitedSource(layout.minus(), layout.plus(), stored, outVolts);
        else b.resistor(layout.plus(), layout.minus(), OPEN_R);
    }

    @Override
    public void postTick(SimulationResults r) {
        // Вход: что забрали резисторы (U² / R) и по чему судить об амплитуде
        double sumSq;
        double meanSq;
        if (three()) {
            double ab = r.getVoltageAt(pos, 0, 1), bc = r.getVoltageAt(pos, 1, 2), ca = r.getVoltageAt(pos, 2, 0);
            sumSq = ab * ab + bc * bc + ca * ca;
            meanSq = sumSq;
        } else {
            double v = r.getVoltageAt(pos, 0, 1);
            sumSq = v * v;
            window[pointer] = sumSq;
            pointer = (pointer + 1) % WINDOW;
            double s = 0;
            for (double x : window) s += x;
            meanSq = s / WINDOW;
        }
        double in = sumSq / inputR;

        // Выход: что ушло в нагрузку за тик (как у генератора EE — модуль U × I), не больше запаса
        double out = 0;
        if (stored > 1 && outVolts > 0.5)
            out = Math.min(stored, Math.abs(r.getVoltageAt(pos, layout.plus(), layout.minus())
                    * r.getCurrentThrough(pos, layout.plus(), layout.minus())));

        lastIn = in;
        lastOut = out;
        stored = Math.max(0, Math.min(bufferMax(), stored + in - out));
        outAvg = 0.8 * outAvg + 0.2 * out;

        // Напряжение на выходе — среднее идеального моста; сглажено, чтобы просадка сети не раскачивала нагрузку
        double target = three()
                ? (3 / Math.PI) * Math.sqrt(2.0 / 3.0 * meanSq)
                : (2 / Math.PI) * Math.sqrt(2 * meanSq);
        outVolts += (target - outVolts) * VOLTS_FOLLOW;

        // Вход на следующий тик — как у настоящего моста: сеть видит сопротивление нагрузки выхода, пересчитанное на
        // переменную сторону (мощность та же): треугольник π²/6 × R_нагр, однофазный π²/8 × R_нагр. Для генератора это
        // обычная резистивная нагрузка — устойчива и под перегрузкой. Запас лишь подправляет её в пределах ±25 %.
        double vOut = Math.abs(r.getVoltageAt(pos, layout.plus(), layout.minus()));
        double loadR = out > 1e-6 ? vOut * vOut / out : OPEN_R;
        double k = three() ? Math.PI * Math.PI / 6 : Math.PI * Math.PI / 8;
        double fill = stored / bufferMax();
        double correction = Math.max(1 / R_STEP, Math.min(R_STEP, 1 + (TARGET_FILL - fill)));
        double next = k * loadR / correction;
        // Не быстрее R_STEP раз за тик — сеть успевает ответить; пустой запас — разрешить подтянуть вход
        if (stored < 1 && out < 1e-6) next = Math.min(next, START_R);
        next = Math.max(inputR / R_STEP, Math.min(inputR * R_STEP, next));
        inputR = Math.max(MIN_R, Math.min(OPEN_R, next));
    }

    @Override
    public void read(CompoundTag tag) {
        stored = tag.getDouble("Stored");
        outAvg = tag.getDouble("OutAvg");
        inputR = tag.contains("InputR") ? tag.getDouble("InputR") : OPEN_R;
        outVolts = tag.getDouble("OutVolts");
    }

    @Override
    public void write(CompoundTag tag) {
        tag.putDouble("Stored", stored);
        tag.putDouble("OutAvg", outAvg);
        tag.putDouble("InputR", inputR);
        tag.putDouble("OutVolts", outVolts);
        tag.putDouble("InputPower", lastIn);
        tag.putDouble("OutputPower", lastOut);
    }
}
