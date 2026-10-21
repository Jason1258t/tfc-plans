package ee.extras.cable;

import com.george_vi.electroenergetics.content.bundled_wire.BundledWireItem;
import com.george_vi.electroenergetics.content.bundled_wire.BundledWireType;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.item.context.UseOnContext;

/**
 * Катушка четырёхжильного кабеля. Наследник катушки двухпроводного кабеля EE — ради «пунктира» будущего кабеля, который
 * EE рисует для BundledWireItem; клик — своя прокладка (CableLaying).
 */
public class FourCoreSpoolItem extends BundledWireItem {
    public FourCoreSpoolItem(Properties properties) {
        super(properties, BundledWireType.DUPLEX);
    }

    @Override
    public InteractionResult useOn(UseOnContext context) {
        InteractionResult r = CableLaying.use(context.getLevel(), context.getPlayer(), context.getItemInHand(),
                context.getClickedPos(), CableKind.FOUR_CORE);
        return r == null ? InteractionResult.PASS : r;
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip, TooltipFlag flag) {
        tooltip.add(Component.translatable(getDescriptionId() + ".tooltip").withStyle(ChatFormatting.GRAY));
    }
}
