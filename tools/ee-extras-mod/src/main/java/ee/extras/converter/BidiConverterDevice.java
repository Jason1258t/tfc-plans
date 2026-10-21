package ee.extras.converter;

import com.george_vi.electroenergetics.config.CEEConfigs;
import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.devices.device.SimulatedDeviceType;
import com.george_vi.electroenergetics.foundation.device.SimpleElectricalDevice;
import com.george_vi.electroenergetics.simulation.BridgeCollector;
import com.george_vi.electroenergetics.simulation.SimulationResults;
import ee.extras.EeExtras;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.util.Mth;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.energy.IEnergyStorage;

/**
 * Два преобразователя EE в одном блоке (EE 1.1.2, ConverterDevice — по байткоду): контакты 0–1 — нагрузка, как у
 * преобразователя в режиме «потребитель» (берёт из сети EE, отдаёт FE), 2–3 — источник, как в режиме «генератор»
 * (берёт FE, держит заданное напряжение). У каждой половины свой запас — не больше converterMaxPowerKw из настроек EE,
 * перевод Вт ↔ FE/t — wattFeTConversionRate. Формулы — те же, что у EE.
 *
 * FE — с блока за задней гранью: сначала через грань, которой он касается (как у EE), а если она не принимает или не
 * отдаёт энергию — через любую его грань, которая может. У конденсатора IE грань либо вход, либо выход (IOSideConfig),
 * поэтому для обмена в обе стороны нужно, чтобы у конденсатора была хоть одна грань-вход и хоть одна грань-выход.
 */
public class BidiConverterDevice extends SimpleElectricalDevice {
    static final double OPEN_R = 999999;
    /** Запас «заряда»: взято из сети EE, ещё не отдано в FE, Вт·тик */
    public double charge;
    /** Запас «разряда»: взято из FE, ещё не отдано в сеть EE, Вт·тик */
    public double discharge;
    public double voltage;
    public double resistance;
    /** Мощность за последний тик, Вт: заряд (вход EE) и разряд (выход EE) — для очков и /cee device_data */
    public double chargePower;
    public double dischargePower;
    public BidiConverterBlockEntity be;

    public BidiConverterDevice(Level level, BlockPos pos, DevicesSavedData devices, SimulatedDeviceType<?> type) {
        super(level, pos, devices, type);
    }

    static double maxEnergy() {
        return CEEConfigs.server().converterMaxPowerKw.get() * 1000.0;
    }

    static double rate() {
        return CEEConfigs.server().wattFeTConversionRate.get();
    }

    @Override
    public void preTick(BridgeCollector bridges) {
        super.preTick(bridges);
        BridgeCollector.Builder b = bridges.builder(pos);
        b.resistor(0, 1, resistance == 0 ? OPEN_R : resistance);
        // energyLimitedSource(«−», «+»): «+» на контакте 2 (так же — у выпрямителей)
        if (discharge > 1 && voltage > 0) b.energyLimitedSource(3, 2, discharge, voltage);
        else b.resistor(2, 3, OPEN_R);
    }

    @Override
    public void postTick(SimulationResults results) {
        double max = maxEnergy();
        // Заряд: нагрузка как у преобразователя EE — сопротивление подбирается так, чтобы за тик взять столько,
        // сколько осталось места в запасе (U² / R = свободно), не меньше 20 Ом
        double vIn = Math.abs(results.getVoltageAt(pos, 0, 1));
        chargePower = Math.abs(vIn * results.getCurrentThrough(pos, 0, 1));
        charge += chargePower;
        if (vIn > 1) resistance = Math.max(20, vIn / (Math.max(max - charge, 0.01) / vIn));

        // Разряд: что ушло в сеть за тик
        dischargePower = 0;
        if (discharge > 1 && voltage > 0)
            dischargePower = Math.abs(results.getCurrentThrough(pos, 2, 3)) * Math.abs(results.getVoltageAt(pos, 2, 3));
        discharge -= dischargePower;
        charge = Mth.clamp(charge, 0, max);
        discharge = Mth.clamp(discharge, 0, max);

        BlockState state = level.isLoaded(pos) ? level.getBlockState(pos) : null;
        if (state != null && state.is(EeExtras.CONVERTER.get())) exchange(state, max);

        if (be == null && level.isLoaded(pos) && level.getBlockEntity(pos) instanceof BidiConverterBlockEntity found)
            be = found;
        if (be != null) {
            if (be.isRemoved()) be = null;
            else be.update(chargePower, dischargePower, charge, discharge);
        }
    }

    /** Обмен FE с блоком за задней гранью: отдать заряд, добрать разряд */
    private void exchange(BlockState state, double max) {
        Direction facing = state.getValue(BidiConverterBlock.FACING);
        BlockPos behind = pos.relative(facing.getOpposite());
        double rate = rate();
        int give = (int) (charge / rate);
        int take = (int) ((max - discharge) / rate);
        // Сначала грань, которой сосед касается блока (контекст — как у EE), потом остальные
        for (Direction side : order(facing)) {
            if (give <= 0 && take <= 0) break;
            IEnergyStorage storage = level.getCapability(Capabilities.EnergyStorage.BLOCK, behind, side);
            if (storage == null) continue;
            if (give > 0 && storage.canReceive()) {
                int moved = storage.receiveEnergy(give, false);
                give -= moved;
                charge -= moved * rate;
            }
            if (take > 0 && storage.canExtract()) {
                int moved = storage.extractEnergy(take, false);
                take -= moved;
                discharge += moved * rate;
            }
        }
    }

    static Direction[] order(Direction facing) {
        Direction[] out = new Direction[6];
        out[0] = facing;
        int i = 1;
        for (Direction d : Direction.values()) if (d != facing) out[i++] = d;
        return out;
    }

    /** FE, которое сосед сам кладёт в блок (грань-выход конденсатора IE): в запас разряда */
    int receive(int fe, boolean simulate) {
        double rate = rate();
        int room = (int) Math.max(0, (maxEnergy() - discharge) / rate);
        int moved = Math.min(fe, room);
        if (!simulate) discharge += moved * rate;
        return moved;
    }

    /** FE, которое сосед сам забирает из блока: из запаса заряда */
    int extract(int fe, boolean simulate) {
        int moved = Math.min(fe, (int) (charge / rate()));
        if (!simulate) charge -= moved * rate();
        return moved;
    }

    @Override
    public void read(CompoundTag tag) {
        voltage = tag.getDouble("Voltage");
        resistance = tag.getDouble("Resistance");
        charge = tag.getDouble("Charge");
        discharge = tag.getDouble("Discharge");
    }

    @Override
    public void write(CompoundTag tag) {
        tag.putDouble("Voltage", voltage);
        tag.putDouble("Resistance", resistance);
        tag.putDouble("Charge", charge);
        tag.putDouble("Discharge", discharge);
        tag.putDouble("InputPower", chargePower);
        tag.putDouble("OutputPower", dischargePower);
    }
}
