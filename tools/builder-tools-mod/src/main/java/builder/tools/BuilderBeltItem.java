package builder.tools;

import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.Level;

public final class BuilderBeltItem extends Item {
    public BuilderBeltItem(Properties properties) { super(properties); }

    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        ItemStack belt = player.getItemInHand(hand);
        if (!player.isShiftKeyDown()) return InteractionResultHolder.pass(belt);
        if (!level.isClientSide) {
            boolean on = !BeltAccess.enabled(belt);
            belt.set(BuilderTools.ENABLED.get(), on);
            player.displayClientMessage(Component.translatable(on ? "builder_tools.on" : "builder_tools.off"), true);
        }
        return InteractionResultHolder.sidedSuccess(belt, level.isClientSide);
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> lines, TooltipFlag flag) {
        lines.add(Component.translatable(BeltAccess.enabled(stack) ? "builder_tools.on" : "builder_tools.off")
                .withStyle(BeltAccess.enabled(stack) ? ChatFormatting.GREEN : ChatFormatting.RED));
        lines.add(Component.translatable("builder_tools.tooltip.equip").withStyle(ChatFormatting.GRAY));
        lines.add(Component.translatable("builder_tools.tooltip.refill").withStyle(ChatFormatting.GRAY));
        lines.add(Component.translatable("builder_tools.tooltip.tool").withStyle(ChatFormatting.GRAY));
        lines.add(Component.translatable("builder_tools.tooltip.toggle").withStyle(ChatFormatting.DARK_AQUA));
    }
}
