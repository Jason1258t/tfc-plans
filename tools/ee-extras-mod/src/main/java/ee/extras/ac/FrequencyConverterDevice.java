package ee.extras.ac;

import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.device.SimpleElectricalDevice;
import com.george_vi.electroenergetics.simulation.BridgeCollector;
import com.george_vi.electroenergetics.simulation.SimulationResults;
import ee.extras.Heat;
import ee.extras.Layout;
import ee.extras.Tier;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.Level;

/**
 * Преобразователь частоты (2.4): вход — любой переменный (или постоянный) ток, выход — синусоида заданной частоты с
 * тем же напряжением (действующее линейное на выходе = на входе). Внутри — звено постоянного тока: запас энергии
 * пополняется тем, что забрал вход (резисторы, сопротивление подстраивается под отдачу, как у инвертора 2.2), и
 * тратится на выход.
 *
 * Выход — источники Sine на каждой паре (трёхфазный — треугольником, ЭДС пары ab = U·cos θ, bc и ca — со сдвигом
 * 120°), внутреннее сопротивление «10 % на номинал» и не меньше ограничения запасом (как energyLimitedSource EE).
 * Порядок фаз — как у трёхфазного генератора EE (фаза 2 на 120° впереди фазы 1): угол θ убывает, в Meter шаг < 0.
 *
 * Такт. Отключён (OFF) — меряет выход (Meter). Чужого напряжения нет — задаёт свою частоту (ISLAND). Есть, и его
 * частота в пределах ±5 % (не меньше 0,5 Гц) от заданной и порядок фаз прямой — включается в фазе с ним (GRID):
 * несколько преобразователей на одной сети работают параллельно. Чужая частота — не включается (FOREIGN). Сеть
 * пересилила (сглаженная отдача < 0) — снова замер.
 */
public class FrequencyConverterDevice extends SimpleElectricalDevice {
    static final double MIN_BUFFER = 2000;
    static final double BUFFER_TICKS = 20;
    static final double MIN_R = 0.01;
    static final double OPEN_R = 1e6;
    static final double R_STEP = 1.25;
    static final double TARGET_FILL = 0.5;
    static final double START_R = 1000;
    static final double Z_PU = 0.1;
    static final double VOLTS_FOLLOW = 0.3;
    static final double SHIFT = 2 * Math.PI / 3;
    public static final int MIN_HZ = 1, MAX_HZ = 40, DEFAULT_HZ = 10;

    public enum State {
        NO_INPUT, WAIT, FOREIGN, ISLAND, GRID;

        public boolean on() {
            return this == ISLAND || this == GRID;
        }
    }

    private final Layout layout;
    private final Tier tier;
    private final int k;
    private final Sine[] sines;
    private final Meter out;
    /** Заданная частота, Гц — из блока (окно значения), хранится и здесь: блок может быть не загружен */
    public double setHz = DEFAULT_HZ;
    /** Множитель номинала от радиаторов (только промышленный; ставит блок) */
    public double cooling = 1;
    private State state = State.NO_INPUT;
    private float temp;
    private double stored;
    private double outAvg;
    private double netAvg;
    private double inputR = OPEN_R;
    private double inVolts;
    private double amp;
    private double theta;
    private double rOut = OPEN_R;
    private boolean active;
    private double lastIn, lastOut;
    private FrequencyConverterBlockEntity be;

    public FrequencyConverterDevice(Level level, BlockPos pos, DevicesSavedData devices, SimulatedDeviceType<?> type,
            Layout layout, Tier tier) {
        super(level, pos, devices, type);
        this.layout = layout;
        this.tier = tier;
        this.k = layout.inputs();
        int pairs = three() ? 3 : 1;
        sines = new Sine[pairs];
        for (int i = 0; i < pairs; i++) sines[i] = new Sine(-i * SHIFT);
        out = three() ? new Meter(pos, k, k + 1, k + 2) : new Meter(pos, k, k + 1);
    }

    private boolean three() {
        return k == 3;
    }

    public double nominal() {
        return tier.watts * (tier == Tier.INDUSTRIAL ? cooling : 1);
    }

    private double bufferMax() {
        return Math.max(MIN_BUFFER, BUFFER_TICKS * outAvg);
    }

    /** Пары контактов: трёхфазный — ab, bc, ca; однофазный — фаза и ноль. base — 0 (вход) или k (выход) */
    private int a(int i, int base) {
        return base + (three() ? i : 0);
    }

    private int b(int i, int base) {
        return base + (three() ? (i + 1) % 3 : 1);
    }

    @Override
    public void preTick(BridgeCollector collector) {
        BridgeCollector.Builder bld = collector.builder(pos);
        for (int i = 0; i < sines.length; i++) bld.resistor(a(i, 0), b(i, 0), inputR);
        active = state.on() && stored > 1 && amp > Meter.DEAD;
        if (active) {
            double rNom = (three() ? 1.5 : 0.5) * Z_PU * amp * amp / nominal();
            double rEnergy = sines.length * amp * amp / (8 * stored);
            rOut = Math.max(MIN_R, Math.max(rNom, rEnergy));
        }
        for (int i = 0; i < sines.length; i++) {
            Sine s = sines[i];
            s.amp = active ? amp : 0;
            s.r = active ? rOut : OPEN_R;
            s.step = -Ac.step(setHz);
            s.theta = theta;
            if (state == State.GRID) s.step = out.step;
            // Sine поднимает n2 над n1, замер пары — U(a) − U(b): n2 = a
            bld.connect(b(i, k), a(i, k), s);
        }
    }

    @Override
    public void postTick(SimulationResults r) {
        double in = 0, sq = 0;
        for (int i = 0; i < sines.length; i++) {
            double v2 = r.getVoltageAtSqr(pos, a(i, 0), b(i, 0));
            sq += v2;
            in += v2 / inputR;
        }
        // Действующее на входе: линейное у трёхфазного, фаза–ноль у однофазного; на постоянном — само напряжение
        inVolts += (Math.sqrt(sq / sines.length) - inVolts) * VOLTS_FOLLOW;
        double o = 0;
        for (Sine s : sines) o += s.take();
        if (!active) o = 0;

        lastIn = in;
        lastOut = o;
        stored = Math.max(0, Math.min(bufferMax(), stored + in - o));
        temp = Heat.update(temp, Math.max(in, Math.abs(o)), nominal());
        if (Heat.handle(level, pos, deviceSD, temp)) return;
        outAvg = 0.8 * outAvg + 0.2 * Math.max(0, o);
        netAvg = active ? 0.7 * netAvg + 0.3 * o : 0;
        amp = Math.sqrt(2) * inVolts;

        out.measure(r);
        control();

        double fill = stored / bufferMax();
        double correction = Math.max(1 / R_STEP, Math.min(R_STEP, 1 + (TARGET_FILL - fill)));
        double deficit = Math.max(0, TARGET_FILL * bufferMax() - stored);
        double want = Math.min(nominal() * 2, outAvg * correction + deficit / BUFFER_TICKS);
        double next = want > 1e-6 ? inVolts * inVolts / want * sines.length : OPEN_R;
        if (stored < 1) next = Math.min(next, START_R);
        if (inVolts < Meter.DEAD) next = OPEN_R;
        next = Math.max(inputR / R_STEP, Math.min(inputR * R_STEP, next));
        inputR = Math.max(MIN_R, Math.min(OPEN_R, next));

        report();
    }

    private void control() {
        int mt = Ac.microTicks();
        double set = Ac.step(setHz);
        if (amp <= Meter.DEAD) {
            state = State.NO_INPUT;
        } else if (state.on() && netAvg < 0) {
            // Сеть сильнее: отдать управление и мерить заново
            state = State.WAIT;
        } else if (!state.on()) {
            if (!out.valid) {
                if (out.amp <= Meter.DEAD) {
                    state = State.ISLAND;
                    theta = 0;
                } else {
                    state = State.WAIT;
                }
            } else {
                // Однофазный шаг всегда > 0 (направления нет), трёхфазный — < 0 при порядке фаз генераторов EE
                double tolerance = Math.max(Ac.step(0.5), 0.05 * set);
                boolean order = !three() || out.step < 0;
                boolean close = order && Math.abs(Math.abs(out.step) - set) <= tolerance;
                state = close && amp > out.amp ? State.GRID : close ? State.WAIT : State.FOREIGN;
            }
        }
        // Угол на микротике 0 следующего тика
        if (state == State.GRID) theta = out.predict(0);
        else if (state == State.ISLAND) theta = Ac.wrap(theta - set * mt);
    }

    private void report() {
        if (be == null || be.isRemoved()) {
            be = level.isLoaded(pos) && level.getBlockEntity(pos) instanceof FrequencyConverterBlockEntity b ? b : null;
        }
        if (be == null) return;
        setHz = be.hz();
        be.update(state, inVolts, Math.abs(out.hz()), Math.max(lastIn, 0), Math.max(lastOut, 0), nominal(),
                temp);
    }

    @Override
    public void read(CompoundTag tag) {
        stored = tag.getDouble("Stored");
        outAvg = tag.getDouble("OutAvg");
        inputR = tag.contains("InputR") ? tag.getDouble("InputR") : OPEN_R;
        inVolts = tag.getDouble("InVolts");
        temp = tag.getFloat("Temp");
        if (tag.contains("SetHz")) setHz = tag.getDouble("SetHz");
        cooling = tag.contains("Cooling") ? tag.getDouble("Cooling") : 1;
        state = State.NO_INPUT;
    }

    @Override
    public void write(CompoundTag tag) {
        tag.putDouble("Stored", stored);
        tag.putDouble("OutAvg", outAvg);
        tag.putDouble("InputR", inputR);
        tag.putDouble("InVolts", inVolts);
        tag.putFloat("Temp", temp);
        tag.putDouble("SetHz", setHz);
        tag.putDouble("Cooling", cooling);
        tag.putString("State", state.name().toLowerCase());
        tag.putDouble("InputPower", lastIn);
        tag.putDouble("OutputPower", lastOut);
        tag.putDouble("Amplitude", amp);
        tag.putDouble("OutHz", Math.abs(out.hz()));
        tag.putDouble("Nominal", nominal());
        tag.putDouble("ROut", rOut);
        tag.putDouble("OutVolts", out.amp / Math.sqrt(2));
    }
}
