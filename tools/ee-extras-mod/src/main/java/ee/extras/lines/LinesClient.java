package ee.extras.lines;

import com.george_vi.electroenergetics.client.ElectricStatsTooltipModifier;
import com.george_vi.electroenergetics.client.ElectricStatsTooltipModifier.ElectricStatSet;
import com.simibubi.create.foundation.item.TooltipModifier;
import java.util.Locale;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.neoforge.event.entity.player.ItemTooltipEvent;

/**
 * Только клиент: подсказки катушек проводов ЛЭП. Сопротивление, предельный ток (и напряжение у кабеля) — тем же
 * механизмом, что у катушек EE (ElectricStatsTooltipModifier через реестр подсказок Create; у EE его подключает
 * Registrate, наши предметы — без него). Пролёт и провис — своей строкой.
 */
public final class LinesClient {
    public static void register(IEventBus modBus, IEventBus gameBus) {
        modBus.addListener(LinesClient::setup);
        gameBus.addListener(LinesClient::tooltip);
    }

    static void setup(FMLClientSetupEvent e) {
        e.enqueueWork(() -> {
            for (LineWire w : LineWire.values()) {
                Item spool = w.spool.get();
                ElectricStatSet stats = new ElectricStatSet().addResistancePerMeter(() -> w.resistance);
                if (w.maxVoltage > 0) stats.addMaxVoltage(() -> w.maxVoltage);
                stats.addMaxCurrent(() -> w.maxCurrent);
                ElectricStatsTooltipModifier.ALL_ENTRIES.register(spool, stats);
                TooltipModifier.REGISTRY.register(spool, new ElectricStatsTooltipModifier(spool));
            }
        });
    }

    static void tooltip(ItemTooltipEvent e) {
        ItemStack stack = e.getItemStack();
        if (Tension.CLAMP_ITEM != null && stack.is(Tension.CLAMP_ITEM.get())) {
            e.getToolTip().add(Component.translatable("item.ee_extras.tension_clamp.tooltip").withStyle(ChatFormatting.GRAY));
            return;
        }
        for (LineWire w : LineWire.values()) {
            if (!stack.is(w.spool.get())) continue;
            e.getToolTip().add(Component.translatable("item.ee_extras." + w.id + "_spool.tooltip").withStyle(ChatFormatting.GRAY));
            Component sag = w.sag == 0 ? Component.translatable("ee_extras.line.rigid")
                    : w.minFactor < 1 ? Component.translatable("ee_extras.line.sag_tension", pct(w.sagPercent()), pct(w.sagPercent() * w.minFactor))
                    : Component.translatable("ee_extras.line.sag", pct(w.sagPercent()));
            e.getToolTip().add(Component.translatable("ee_extras.line.span", w.span).append(" · ").append(sag)
                    .withStyle(ChatFormatting.DARK_GRAY));
            return;
        }
    }

    static String pct(double v) {
        return String.format(Locale.ROOT, Math.abs(v - Math.round(v)) < 0.05 ? "%.0f" : "%.1f", v).replace('.', ',');
    }

    private LinesClient() {
    }
}
