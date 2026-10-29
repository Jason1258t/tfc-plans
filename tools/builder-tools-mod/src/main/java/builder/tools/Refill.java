package builder.tools;

import java.util.Map;
import java.util.WeakHashMap;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import net.neoforged.neoforge.event.tick.PlayerTickEvent;

/** Снимок руки до размещения; перенос только после расходования последнего блока. */
public final class Refill {
    private Refill() {}
    private record Pending(InteractionHand hand, int selected, ItemStack sample, ItemStack original) {}
    private static final Map<ServerPlayer, Pending> PENDING = new WeakHashMap<>();

    @SubscribeEvent(priority = EventPriority.LOWEST)
    public static void before(PlayerInteractEvent.RightClickBlock event) {
        if (!(event.getEntity() instanceof ServerPlayer player) || !BeltAccess.active(player) || player.isCreative()
                || event.getUseItem().isFalse()) return;
        ItemStack stack = event.getItemStack();
        if (stack.getItem() instanceof BlockItem && stack.getCount() == 1) {
            PENDING.put(player, new Pending(event.getHand(), player.getInventory().selected, stack.copy(), stack));
        }
    }

    @SubscribeEvent
    public static void after(PlayerTickEvent.Post event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) return;
        Pending pending = PENDING.remove(player);
        if (pending == null || !pending.original().isEmpty() || !BeltAccess.active(player)) return;
        if (pending.hand() == InteractionHand.MAIN_HAND && player.getInventory().selected != pending.selected()) return;
        replenish(player, pending.hand(), pending.sample());
    }

    /** Строго тот же блок со всеми компонентами (название, состояние и данные), без создания новых предметов. */
    public static boolean replenish(ServerPlayer player, InteractionHand hand, ItemStack sample) {
        if (!BeltAccess.active(player) || player.isCreative() || !player.getItemInHand(hand).isEmpty()
                || !(sample.getItem() instanceof BlockItem)) return false;
        var inv = player.getInventory();
        for (int slot = 0; slot < inv.items.size(); slot++) {
            if (slot == inv.selected) continue;
            ItemStack stack = inv.getItem(slot);
            if (stack.isEmpty() || !ItemStack.isSameItemSameComponents(sample, stack)) continue;
            inv.setItem(slot, ItemStack.EMPTY);
            player.setItemInHand(hand, stack);
            inv.setChanged();
            player.containerMenu.broadcastChanges();
            return true;
        }
        return false;
    }

    @SubscribeEvent
    public static void logout(PlayerEvent.PlayerLoggedOutEvent event) { PENDING.remove(event.getEntity()); }
}
