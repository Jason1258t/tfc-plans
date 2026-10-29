package ee.extras.ac;

import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.device.SimpleElectricalDevice;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.simulation.BridgeCollector;
import com.george_vi.electroenergetics.simulation.SimulationResults;
import com.simibubi.create.foundation.blockEntity.behaviour.scrollValue.INamedIconOptions;
import com.simibubi.create.foundation.gui.AllIcons;
import ee.extras.Heat;
import ee.extras.Layout;
import ee.extras.Tier;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.Level;

/**
 * Синхронизатор (2.4) — генераторный выключатель с автоматической точной синхронизацией. Контакты 0…k−1 — сторона
 * генератора, k…2k−1 — сторона сети (трёхфазный: три фазы, однофазный: фаза и ноль, переключаются оба). Включён —
 * между парами контактов по R_CLOSED, отключён — 10 МОм; плюс по 1 МОм внутри каждой стороны (как у синхроскопа EE),
 * чтобы обе стороны были в расчёте и мерились, даже когда к ним ничего не подключено.
 *
 * Авто (Mode.AUTO), отключён: сети нет, а генератор есть — включает на «мёртвые шины» (запускает сеть); обе стороны
 * под напряжением — включает, когда разница частот меньше MAX_SLIP, напряжений — меньше MAX_DU, угол — меньше
 * MAX_ANGLE и порядок фаз совпадает, и всё это два тика подряд. Пока ждёт, выдаёт красный сигнал «быстрее» или
 * «медленнее» (для щёток генератора EE: у них ±1 об/мин подстройки = ±0,16 Гц), держа небольшое опережение
 * генератора (TARGET_SLIP), чтобы фазы сами сошлись.
 *
 * Включён: отключает при обратной мощности (сеть крутит генератор) больше REVERSE доли номинала дольше
 * REVERSE_TICKS и при перегрузке больше OVERLOAD номинала дольше OVERLOAD_TICKS; после отключения защитой не
 * включается COOLDOWN тиков. Нагрев — по проходящей мощности, как у выпрямителей (Heat).
 */
public class SynchronizerDevice extends SimpleElectricalDevice {
    static final double R_CLOSED = 0.002;
    static final double R_OPEN = 1e7;
    static final double R_METER = 1e6;
    /** Условия включения: Гц, доля, градусы */
    static final double MAX_SLIP = 0.1;
    static final double MAX_DU = 0.1;
    static final double MAX_ANGLE = 10;
    /** Подгонка: генератор чуть быстрее сети, Гц; коридор вокруг */
    static final double TARGET_SLIP = 0.06;
    static final double SLIP_BAND = 0.02;
    static final double REVERSE = 0.02;
    static final int REVERSE_TICKS = 20;
    static final double OVERLOAD = 1.5;
    static final int OVERLOAD_TICKS = 40;
    static final int COOLDOWN = 100;
    static final int DEAD_BUS_TICKS = 10;

    /** Режим на блоке (окно выбора Create) */
    public enum Mode implements INamedIconOptions {
        AUTO(AllIcons.I_TUNNEL_SYNCHRONIZE), OFF(AllIcons.I_DISABLE);

        private final AllIcons icon;

        Mode(AllIcons icon) {
            this.icon = icon;
        }

        @Override
        public AllIcons getIcon() {
            return icon;
        }

        @Override
        public String getTranslationKey() {
            return "ee_extras.synchronizer.mode." + name().toLowerCase();
        }
    }

    public enum State {
        OFF, NO_GENERATOR, DEAD_BUS, SYNCING, CLOSED, TRIP_REVERSE, TRIP_OVERLOAD, WRONG_ORDER;

        public boolean closed() {
            return this == CLOSED;
        }
    }

    /** Сигнал подгонки скорости генератора */
    public static final int NONE = 0, FASTER = 1, SLOWER = 2;

    private final Layout layout;
    private final Tier tier;
    private final int k;
    private final Meter gen, grid;
    public Mode mode = Mode.AUTO;
    public double cooling = 1;
    private State state = State.NO_GENERATOR;
    private boolean closed;
    private int ready;
    private int deadBus;
    private int reverse;
    private int overload;
    private int cooldown;
    private int signal = NONE;
    private float temp;
    private double power;
    private double slip, angle, du;
    private boolean sameOrder = true;
    private double[][] g, s;
    private SynchronizerBlockEntity be;

    public SynchronizerDevice(Level level, BlockPos pos, DevicesSavedData devices, SimulatedDeviceType<?> type,
            Layout layout, Tier tier) {
        super(level, pos, devices, type);
        this.layout = layout;
        this.tier = tier;
        this.k = layout.inputs();
        gen = k == 3 ? new Meter(pos, 0, 1, 2) : new Meter(pos, 0, 1);
        grid = k == 3 ? new Meter(pos, 3, 4, 5) : new Meter(pos, 2, 3);
        g = new double[k][];
        s = new double[k][];
    }

    public double nominal() {
        return tier.watts * (tier == Tier.INDUSTRIAL ? cooling : 1);
    }

    public int signal() {
        return signal;
    }

    @Override
    public void preTick(BridgeCollector collector) {
        BridgeCollector.Builder bld = collector.builder(pos);
        for (int i = 0; i < k; i++) bld.resistor(i, k + i, closed ? R_CLOSED : R_OPEN);
        for (int i = 0; i + 1 < k; i++) {
            bld.resistor(i, i + 1, R_METER);
            bld.resistor(k + i, k + i + 1, R_METER);
        }
    }

    @Override
    public void postTick(SimulationResults r) {
        gen.measure(r);
        grid.measure(r);
        power = closed ? flow(r) : 0;
        temp = Heat.update(temp, Math.abs(power), nominal());
        if (Heat.handle(level, pos, deviceSD, temp)) return;
        if (cooldown > 0) cooldown--;

        boolean genOn = gen.amp > Meter.DEAD, gridOn = grid.amp > Meter.DEAD;
        // Генераторы EE дают обратную последовательность в смысле Meter (шаг < 0) — частоты сравниваются по модулю
        slip = gen.valid && grid.valid ? Math.abs(gen.hz()) - Math.abs(grid.hz()) : 0;
        du = gridOn ? (gen.amp - grid.amp) / grid.amp : 0;
        angle = gen.valid && grid.valid ? Math.toDegrees(Ac.wrap(gen.angle - grid.angle)) : 0;
        signal = NONE;
        sameOrder = k != 3 || !gen.valid || !grid.valid || Math.signum(gen.step) == Math.signum(grid.step);

        if (mode == Mode.OFF) {
            open(State.OFF);
        } else if (closed) {
            protect();
        } else if (cooldown > 0) {
            // ждёт после защиты (state — причина отключения)
        } else if (!genOn) {
            open(State.NO_GENERATOR);
        } else if (!gridOn) {
            // Мёртвые шины: включить и запустить сеть от генератора (через несколько тиков — убедиться, что сети нет)
            state = State.DEAD_BUS;
            if (++deadBus >= DEAD_BUS_TICKS) close();
        } else {
            deadBus = 0;
            sync();
        }
        report();
    }

    private void sync() {
        if (!gen.valid || !grid.valid) {
            state = State.SYNCING;
            ready = 0;
            return;
        }
        if (!sameOrder) {
            state = State.WRONG_ORDER;
            ready = 0;
            return;
        }
        state = State.SYNCING;
        double a = Math.abs(slip);
        // Подгонка: держать генератор чуть быстрее сети, тогда угол сам проходит через ноль
        if (slip < TARGET_SLIP - SLIP_BAND) signal = FASTER;
        else if (slip > TARGET_SLIP + SLIP_BAND) signal = SLOWER;
        boolean ok = a < MAX_SLIP && Math.abs(du) < MAX_DU && Math.abs(angle) < MAX_ANGLE;
        ready = ok ? ready + 1 : 0;
        if (ready >= 2) close();
    }

    private void protect() {
        state = State.CLOSED;
        double nominal = nominal();
        reverse = power < -Math.max(REVERSE * nominal, 50) ? reverse + 1 : 0;
        overload = Math.abs(power) > OVERLOAD * nominal ? overload + 1 : 0;
        if (reverse >= REVERSE_TICKS) trip(State.TRIP_REVERSE);
        else if (overload >= OVERLOAD_TICKS) trip(State.TRIP_OVERLOAD);
    }

    private void close() {
        closed = true;
        state = State.CLOSED;
        ready = deadBus = reverse = overload = 0;
    }

    private void open(State why) {
        closed = false;
        state = why;
        ready = deadBus = reverse = overload = 0;
    }

    private void trip(State why) {
        open(why);
        cooldown = COOLDOWN;
    }

    /**
     * Мощность со стороны генератора в сеть, среднее за тик, Вт: Σ по контактам U_ген · (U_ген − U_сети) / R. Токи
     * всех полюсов в сумме — ноль (у трёхфазного — три провода, у однофазного — фаза и ноль), поэтому точка отсчёта
     * потенциалов не важна.
     */
    private double flow(SimulationResults r) {
        int n = Integer.MAX_VALUE;
        for (int i = 0; i < k; i++) {
            g[i] = r.getVoltages(new InWorldNode(i, pos), g[i]);
            s[i] = r.getVoltages(new InWorldNode(k + i, pos), s[i]);
            n = Math.min(n, Math.min(g[i].length, s[i].length));
        }
        if (n == 0) return 0;
        double p = 0;
        for (int m = 0; m < n; m++)
            for (int i = 0; i < k; i++) p += g[i][m] * (g[i][m] - s[i][m]) / R_CLOSED;
        return p / n;
    }

    private void report() {
        if (be == null || be.isRemoved()) {
            be = level.isLoaded(pos) && level.getBlockEntity(pos) instanceof SynchronizerBlockEntity b ? b : null;
        }
        if (be == null) return;
        mode = be.mode();
        be.update(state, Math.abs(gen.hz()), Math.abs(grid.hz()), angle, du, power, nominal(),
                signal);
    }

    @Override
    public void read(CompoundTag tag) {
        closed = tag.getBoolean("Closed");
        state = closed ? State.CLOSED : State.NO_GENERATOR;
        temp = tag.getFloat("Temp");
        cooldown = tag.getInt("Cooldown");
        cooling = tag.contains("Cooling") ? tag.getDouble("Cooling") : 1;
        mode = "off".equals(tag.getString("Mode")) ? Mode.OFF : Mode.AUTO;
    }

    @Override
    public void write(CompoundTag tag) {
        tag.putBoolean("Closed", closed);
        tag.putFloat("Temp", temp);
        tag.putInt("Cooldown", cooldown);
        tag.putDouble("Cooling", cooling);
        tag.putString("Mode", mode.name().toLowerCase());
        tag.putString("State", state.name().toLowerCase());
        tag.putDouble("Power", power);
        tag.putDouble("GenHz", Math.abs(gen.hz()));
        tag.putDouble("GridHz", Math.abs(grid.hz()));
        tag.putDouble("GenVolts", gen.amp);
        tag.putDouble("GridVolts", grid.amp);
        tag.putDouble("Angle", angle);
        tag.putInt("Signal", signal);
        tag.putDouble("Nominal", nominal());
        tag.putString("PhaseOrder", sameOrder ? "same" : "reversed");
    }
}
