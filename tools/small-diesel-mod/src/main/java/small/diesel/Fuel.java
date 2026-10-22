package small.diesel;

import com.jesz.createdieselgenerators.CDGRegistries;
import com.jesz.createdieselgenerators.fuel_type.FuelType;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.material.Fluid;

/**
 * Топливо — из реестра Create Diesel Generators (createdieselgenerators:fuel_type, данные сборки, датапаком можно
 * поменять): берём свойства его обычного дизельного двигателя (normal). У CDG двигатель держит strength SU на
 * speed об/мин и сжигает 1 мБ за 1 / burn_rate тиков (DieselEngineBlockEntity.tick, по байткоду CDG 1.3.8), поэтому
 * 1 мБ = strength / burn_rate SU·тик. Дизель: 96 об/мин, 6 144 SU, 1 мБ за 20 тиков → 122 880 SU·тик на 1 мБ.
 */
public record Fuel(float speed, float strength, float burnRate) {
    /** Работа одного миллибакета, SU·тик (у генератора EE 1 SU ≈ 1 Вт) */
    public double perMb() {
        return strength / burnRate;
    }

    /** null — не топливо CDG (или реестра нет — например, клиент без данных) */
    public static Fuel of(Level level, Fluid fluid) {
        if (level == null) return null;
        var lookup = level.registryAccess().lookup(CDGRegistries.FUEL_TYPE).orElse(null);
        if (lookup == null) return null;
        FuelType type = FuelType.getTypeFor(lookup, fluid);
        if (type == FuelType.EMPTY) return null;
        FuelType.PerEngineProperties p = type.normal();
        return p.speed() > 0 && p.strength() > 0 && p.burn() > 0 ? new Fuel(p.speed(), p.strength(), p.burn()) : null;
    }
}
