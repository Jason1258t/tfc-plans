package ie.extras;

import net.neoforged.neoforge.common.ModConfigSpec;

/** Настройки сервера (serverconfig/ie_extras-server.toml) */
public final class Config {
    static final ModConfigSpec SPEC;
    static final ModConfigSpec.DoubleValue MAX_TEMPERATURE;
    static final ModConfigSpec.IntValue FE_PER_TICK_AT_MAX;
    static final ModConfigSpec.DoubleValue BASIN_TEMPERATURE;
    static final ModConfigSpec.IntValue BASIN_FE_PER_TICK;

    static {
        ModConfigSpec.Builder b = new ModConfigSpec.Builder();
        b.push("analogHeater");
        MAX_TEMPERATURE = b.comment("Temperature (°C) of the analog heater at redstone signal 15; signal n gives n/15 of it.",
                        "1600 is TFC's «brilliant white»: melts every pack metal but tfc_alloy_ext inferior aluminum (1653).")
                .defineInRange("maxTemperature", 1600.0, 100.0, 5000.0);
        FE_PER_TICK_AT_MAX = b.comment("FE per tick the analog heater draws at signal 15; at signal n — n/15 of it (rounded up).",
                        "For comparison: TFC + IE Crossover external heater on a crucible — 20 FE/t at 2000 °C.")
                .defineInRange("fePerTickAtMax", 32, 0, 32000);
        b.pop();
        b.push("basin");
        BASIN_TEMPERATURE = b.comment("Temperature (°C) of a Create basin next to a working IE external heater (needs WoodenCog).",
                        "Same as TFC + IE Crossover gives a crucible (2000); WoodenCog: 2000 = superheated, 1350 = heated.")
                .defineInRange("externalHeaterTemperature", 2000.0, 0.0, 5000.0);
        BASIN_FE_PER_TICK = b.comment("FE per tick an IE external heater draws while heating a Create basin (crucible — 20).")
                .defineInRange("externalHeaterFePerTick", 20, 1, 32000);
        b.pop();
        SPEC = b.build();
    }

    private Config() {}

    public static float maxTemperature() {
        return SPEC.isLoaded() ? MAX_TEMPERATURE.get().floatValue() : 1600f;
    }

    public static int fePerTickAtMax() {
        return SPEC.isLoaded() ? FE_PER_TICK_AT_MAX.get() : 32;
    }

    public static float basinExternalHeaterTemperature() {
        return SPEC.isLoaded() ? BASIN_TEMPERATURE.get().floatValue() : 2000f;
    }

    public static int basinExternalHeaterFePerTick() {
        return SPEC.isLoaded() ? BASIN_FE_PER_TICK.get() : 20;
    }
}
