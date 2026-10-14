package ee.rectifier;

import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.block.Block;

/** Предмет блока с подсказкой: что делает и где какие контакты */
public class RectifierItem extends BlockItem {
    public RectifierItem(Block block, Properties properties) {
        super(block, properties);
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip, TooltipFlag flag) {
        String key = getDescriptionId();
        tooltip.add(Component.translatable(key + ".tooltip").withStyle(ChatFormatting.GRAY));
        tooltip.add(Component.translatable(key + ".tooltip.nodes").withStyle(ChatFormatting.DARK_GRAY));
    }
}
