package ie.extras;

import net.dries007.tfc.common.component.heat.HeatCapability;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.neoforge.energy.EnergyStorage;

/**
 * Аналоговый нагреватель. Каждый тик:
 * - цель = сигнал красного камня (0–15) / 15 × maxTemperature (настройка, 1600 °C);
 * - берёт fePerTickAtMax × сигнал / 15 FE; не хватило — цель 0 (остывает);
 * - своя температура идёт к цели с той же скоростью, что у угольного горна TFC (HeatCapability.adjustTempTowards,
 *   deviceHeatingModifier — 1 °C за тик);
 * - отдаёт её блоку перед лицевой гранью — HeatCapability.provideHeatTo, как горн тиглю. Тигель (по байткоду TFC 4.2.9)
 *   принимает только температуру выше своей, а выше нашей остывает сам — по 1 °C за тик.
 */
public class AnalogHeaterBlockEntity extends BlockEntity {
    static final int CAPACITY = 32000;
    static final int MAX_RECEIVE = 1024;

    public final Energy energy = new Energy();
    private float temperature;
    private int signal;
    private boolean powered;

    public AnalogHeaterBlockEntity(BlockPos pos, BlockState state) {
        super(IeExtras.ANALOG_HEATER_BE.get(), pos, state);
    }

    public static void serverTick(Level level, BlockPos pos, BlockState state, AnalogHeaterBlockEntity be) {
        be.tick(level, pos, state);
    }

    void tick(Level level, BlockPos pos, BlockState state) {
        signal = level.getBestNeighborSignal(pos);
        float target = 0;
        powered = false;
        if (signal > 0) {
            int need = Mth.ceil(Config.fePerTickAtMax() * signal / 15f);
            if (energy.draw(need)) {
                powered = true;
                target = Config.maxTemperature() * signal / 15f;
            }
        }
        int before = comparatorLevel();
        if (temperature != target) {
            temperature = HeatCapability.adjustTempTowards(temperature, target);
            setChanged();
        }
        if (temperature > 0) {
            Direction face = state.getValue(AnalogHeaterBlock.FACING);
            HeatCapability.provideHeatTo(level, pos.relative(face), face.getOpposite(), temperature);
        }
        boolean lit = temperature >= 1;
        if (lit != state.getValue(AnalogHeaterBlock.LIT)) level.setBlockAndUpdate(pos, state.setValue(AnalogHeaterBlock.LIT, lit));
        if (comparatorLevel() != before) level.updateNeighbourForOutputSignal(pos, state.getBlock());
    }

    Direction facing() {
        return getBlockState().getValue(AnalogHeaterBlock.FACING);
    }

    public float temperature() {
        return temperature;
    }

    public int signal() {
        return signal;
    }

    public int energyStored() {
        return energy.getEnergyStored();
    }

    /** Компаратор: температура в долях maxTemperature, 0–15 (с округлением вверх: тёплый — хотя бы 1) */
    public int comparatorLevel() {
        return Mth.clamp(Mth.ceil(temperature / Config.maxTemperature() * 15f), 0, 15);
    }

    public Component status() {
        int target = Math.round(Config.maxTemperature() * signal / 15f);
        String key = "block.ie_extras.analog_heater.status";
        if (signal > 0 && !powered) key += ".no_power";
        return Component.translatable(key, Math.round(temperature), target, signal, energy.getEnergyStored());
    }

    @Override
    protected void saveAdditional(CompoundTag tag, HolderLookup.Provider registries) {
        super.saveAdditional(tag, registries);
        tag.put("energy", energy.serializeNBT(registries));
        tag.putFloat("temperature", temperature);
    }

    @Override
    protected void loadAdditional(CompoundTag tag, HolderLookup.Provider registries) {
        super.loadAdditional(tag, registries);
        if (tag.contains("energy")) energy.deserializeNBT(registries, tag.get("energy"));
        temperature = tag.getFloat("temperature");
    }

    /** Запас FE: принимает снаружи (до 1024 FE/т), наружу не отдаёт; тратит сам нагреватель (draw) */
    public final class Energy extends EnergyStorage {
        Energy() {
            super(CAPACITY, MAX_RECEIVE, 0);
        }

        @Override
        public int receiveEnergy(int toReceive, boolean simulate) {
            int got = super.receiveEnergy(toReceive, simulate);
            if (got > 0 && !simulate) setChanged();
            return got;
        }

        boolean draw(int amount) {
            if (energy < amount) return false;
            energy -= amount;
            setChanged();
            return true;
        }

        /** Только для проверочного мода */
        public void setStored(int value) {
            energy = Math.min(value, capacity);
        }
    }
}
