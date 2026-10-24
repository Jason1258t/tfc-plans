package aero.extra;

import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;

/** Модуль бортового компьютера. Аккумуляторный хранит заряд своей ячейки (Кл) — его можно вынуть заряженным и переставить */
public class ModuleItem extends Item {
    public enum Kind {
        GENERATOR,
        BATTERY
    }

    public final Kind kind;

    public ModuleItem(Kind kind, Properties properties) {
        super(properties);
        this.kind = kind;
    }

    public static double charge(ItemStack stack) {
        Double c = stack.get(AeroExtra.CHARGE.get());
        return c == null ? 0 : c;
    }

    public static ItemStack battery(double charge) {
        ItemStack stack = new ItemStack(AeroExtra.BATTERY_MODULE.get());
        if (charge > 0) stack.set(AeroExtra.CHARGE.get(), charge);
        return stack;
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip, TooltipFlag flag) {
        tooltip.add(Component.translatable(getDescriptionId() + ".tooltip").withStyle(ChatFormatting.GRAY));
        if (kind == Kind.BATTERY)
            tooltip.add(Component.translatable(AeroExtra.MOD_ID + ".tooltip.charge",
                    Math.round(100 * charge(stack) / BatteryPack.nominalSafe())).withStyle(ChatFormatting.AQUA));
    }
}
