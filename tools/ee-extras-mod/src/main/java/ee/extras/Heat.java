package ee.extras;

import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.george_vi.electroenergetics.foundation.ProperOilAndWaterloggedBlock.LoggedState;
import com.george_vi.electroenergetics.foundation.base.DirectionalRolledDeviceBlock;
import com.george_vi.electroenergetics.foundation.device.ElectricalDevice;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Нагрев выпрямителей и инверторов — как у вариака EE 1.1.2 (по байткоду VariacDevice.postTick): тепло за тик =
 * мощность × 1300 / предельная мощность (не больше 10 000), температура — ElectricalDevice.updateTemp, дым и сгорание —
 * ElectricalDevice.handleTemp (только при componentDamage в настройках сервера EE; сгоревший блок — огонь, без
 * выпадения). Пороги: на воздухе дым с 30 000, сгорание с 40 000; в масле — 60 000 и 80 000.
 *
 * Установившаяся температура при тепле h — 1000 × ((h + 30) / 33,3 − 1). Предельная мощность = номинал / 0,75,
 * поэтому на воздухе: номинал — около 29 000 (без дыма), дым с ~103 % номинала, сгорает от ~137 %;
 * в масле дым с ~200 %, сгорает от ~270 %, и то не сразу — температура растёт медленнее с каждым градусом.
 */
public final class Heat {
    static final double NOMINAL_SHARE = 0.75;

    private Heat() {}

    static float update(float temp, double watts, Tier tier) {
        return update(temp, watts, tier.watts);
    }

    /** То же для блока со своим номиналом (компактные генераторы), Вт */
    public static float update(float temp, double watts, double nominal) {
        double heat = Math.abs(watts) * 1300 / (nominal / NOMINAL_SHARE);
        return ElectricalDevice.updateTemp(temp, (float) Math.min(heat, 10_000));
    }

    /** true — блок сгорел (устройство EE уже удалено, дальше в этом тике его не трогать) */
    public static boolean handle(Level level, BlockPos pos, DevicesSavedData devices, float temp) {
        boolean oil = false;
        if (level.isLoaded(pos)) {
            BlockState state = level.getBlockState(pos);
            oil = state.hasProperty(DirectionalRolledDeviceBlock.LOGGED_STATE)
                    && state.getValue(DirectionalRolledDeviceBlock.LOGGED_STATE) == LoggedState.OILLOGGED;
        }
        float smoke = oil ? 60_000 : 30_000, burn = oil ? 80_000 : 40_000;
        ElectricalDevice.handleTemp(level, pos, devices, temp, smoke, burn);
        return devices.getDevice(pos) == null;
    }
}
