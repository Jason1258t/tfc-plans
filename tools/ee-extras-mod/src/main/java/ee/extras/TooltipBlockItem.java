package ee.extras;

import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.block.Block;

/** Предмет блока с подсказкой из языкового файла: что делает (.tooltip) и где какие контакты (.tooltip.nodes) */
public class TooltipBlockItem extends BlockItem {
    public TooltipBlockItem(Block block, Properties properties) {
        super(block, properties);
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip, TooltipFlag flag) {
        tooltip(getDescriptionId(), tooltip);
    }

    public static void tooltip(String key, List<Component> tooltip) {
        tooltip.add(Component.translatable(key + ".tooltip").withStyle(ChatFormatting.GRAY));
        tooltip.add(Component.translatable(key + ".tooltip.nodes").withStyle(ChatFormatting.DARK_GRAY));
    }
}
