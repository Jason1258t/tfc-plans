package miner.tools;

import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.Level;

public class MinerBeltItem extends Item {
    public MinerBeltItem(Properties properties) {
        super(properties);
    }

    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        ItemStack belt = player.getItemInHand(hand);
        if (level.isClientSide) return InteractionResultHolder.success(belt);
        if (player.isShiftKeyDown()) {
            boolean on = !BeltFilter.enabled(belt);
            belt.set(MinerTools.ENABLED.get(), on);
            player.displayClientMessage(Component.translatable(on ? "miner_belt.on" : "miner_belt.off"), true);
        } else if (player instanceof ServerPlayer sp) {
            sp.openMenu(new SimpleMenuProvider((id, inv, p) -> new BeltMenu(id, inv, hand), belt.getHoverName()),
                    buf -> buf.writeEnum(hand));
        }
        return InteractionResultHolder.consume(belt);
    }

    /** Блестит, пока работает */
    @Override
    public boolean isFoil(ItemStack stack) {
        return BeltFilter.enabled(stack) && !BeltFilter.samples(stack).isEmpty();
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> lines, TooltipFlag flag) {
        List<ItemStack> samples = BeltFilter.samples(stack);
        lines.add(Component.translatable(BeltFilter.enabled(stack) ? "miner_belt.tooltip.on" : "miner_belt.tooltip.off")
                .withStyle(BeltFilter.enabled(stack) ? ChatFormatting.GREEN : ChatFormatting.RED));
        if (samples.isEmpty()) {
            lines.add(Component.translatable("miner_belt.tooltip.empty").withStyle(ChatFormatting.GRAY));
        } else {
            lines.add(Component.translatable(BeltFilter.anyVariant(stack)
                    ? "miner_belt.tooltip.filter_any" : "miner_belt.tooltip.filter").withStyle(ChatFormatting.GRAY));
            for (ItemStack s : samples) {
                lines.add(Component.literal(" • ").append(s.getHoverName()).withStyle(ChatFormatting.DARK_GRAY));
            }
        }
        lines.add(Component.translatable("miner_belt.tooltip.use").withStyle(ChatFormatting.DARK_AQUA));
        lines.add(Component.translatable("miner_belt.tooltip.toggle").withStyle(ChatFormatting.DARK_AQUA));
    }
}
