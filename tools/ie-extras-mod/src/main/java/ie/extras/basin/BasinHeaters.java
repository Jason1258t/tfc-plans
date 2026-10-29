package ie.extras.basin;

import blusunrize.immersiveengineering.api.tool.ExternalHeaterHandler;
import blusunrize.immersiveengineering.api.tool.ExternalHeaterHandler.IExternalHeatable;
import com.simibubi.create.AllBlockEntityTypes;
import com.simibubi.create.content.processing.basin.BasinBlockEntity;
import com.simibubi.create.content.processing.burner.BlazeBurnerBlock.HeatLevel;
import ie.extras.AnalogHeaterBlock;
import ie.extras.AnalogHeaterBlockEntity;
import ie.extras.Config;
import net.chauvedev.woodencog.utils.CogUtil;
import net.minecraft.core.Direction;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.neoforge.capabilities.RegisterCapabilitiesEvent;

/**
 * Нагрев чаши Create (WoodenCog 1.2.18 — температура предметов TFC в чаше и «нагретые» рецепты). WoodenCog берёт
 * температуру только у блока под чашей и знает лишь горн, жаровню и горелки Create/дополнений — нагреватель EE,
 * внешний нагреватель IE и аналоговый нагреватель для него — 0 °C. Здесь три недостающих источника:
 * - внешний нагреватель IE с любой стороны чаши — как тигель в TFC + IE Crossover: 20 FE/т, 2000 °C (настройки);
 * - аналоговый нагреватель под чашей решёткой вверх — его температура;
 * - любой блок под чашей, который Create считает нагревом (нагреватель EE: свойство HEAT_LEVEL), — температура этого
 *   уровня из настроек WoodenCog (как у горелки всполоха: 750 / 1350 / 2000 °C).
 * Уровень нагрева для рецептов Create (heated / superheated) — из температуры по порогам WoodenCog.
 */
public final class BasinHeaters {
    /** Сколько тиков чаша держит тепло после последнего тика внешнего нагревателя (как TFC + IE Crossover у тигля) */
    static final int HOLD_TICKS = 5;

    private BasinHeaters() {}

    public static void registerCapabilities(RegisterCapabilitiesEvent e) {
        e.registerBlockEntity(ExternalHeaterHandler.CAPABILITY, AllBlockEntityTypes.BASIN.get(),
                (basin, side) -> (IExternalHeatable) (energy, redstone) -> heatTick(basin, energy, redstone));
    }

    /** Тик внешнего нагревателя IE. Красный камень на нагревателе — выключен (как у тигля в TFC + IE Crossover) */
    static int heatTick(BasinBlockEntity basin, int energy, boolean redstone) {
        Level level = basin.getLevel();
        if (level == null || !(basin instanceof BasinHeat heat)) return 0;
        int cost = Config.basinExternalHeaterFePerTick();
        if (redstone || energy < cost) return 0;
        long now = level.getGameTime();
        boolean wasCold = heat.ieExtras$externalHeat(now - 1) <= 0;
        heat.ieExtras$setExternalHeat(Config.basinExternalHeaterTemperature(), now + HOLD_TICKS);
        if (wasCold) basin.notifyUpdate(); // клиенту — для строки температуры в очках инженера
        return cost;
    }

    /** Температура от наших источников (0 — их нет); WoodenCog возьмёт большую из своей и этой */
    public static float temperature(BasinBlockEntity basin) {
        Level level = basin.getLevel();
        if (level == null) return 0;
        float t = Math.max(ownTemperature(basin, level), 0);
        HeatLevel below = BasinBlockEntity.getHeatLevelOf(level.getBlockState(basin.getBlockPos().below()));
        if (below != HeatLevel.NONE) t = Math.max(t, CogUtil.heatLevelToTemp(below));
        return t;
    }

    /** Уровень нагрева Create от внешнего и аналогового нагревателя (у нагревателя EE он и так в свойстве блока) */
    public static HeatLevel heatLevel(BasinBlockEntity basin) {
        Level level = basin.getLevel();
        if (level == null) return HeatLevel.NONE;
        float t = ownTemperature(basin, level);
        return t > 0 ? CogUtil.tempToHeatLevel(t) : HeatLevel.NONE;
    }

    private static float ownTemperature(BasinBlockEntity basin, Level level) {
        float t = basin instanceof BasinHeat heat ? heat.ieExtras$externalHeat(level.getGameTime()) : 0;
        BlockState below = level.getBlockState(basin.getBlockPos().below());
        if (below.getBlock() instanceof AnalogHeaterBlock && below.getValue(AnalogHeaterBlock.FACING) == Direction.UP
                && level.getBlockEntity(basin.getBlockPos().below()) instanceof AnalogHeaterBlockEntity heater) {
            t = Math.max(t, heater.temperature());
        }
        return t;
    }
}
