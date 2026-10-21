package miner.tools;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.ModList;
import net.neoforged.neoforge.common.util.TriState;
import net.neoforged.neoforge.event.entity.player.ItemEntityPickupEvent;

/**
 * Запрет подбора. NeoForge спрашивает событие каждый тик, пока игрок касается предмета (ItemEntity.playerTouch);
 * {@code setCanPickup(FALSE)} отменяет подбор в инвентарь.
 * <p>
 * Улучшение «Подбор» рюкзаков Sophisticated Backpacks слушает то же событие и забирает предмет в рюкзак, не глядя на
 * этот флаг, но пропускает предметы с задержкой подбора (по байткоду 3.25.74: {@code pickupDelay <= 0}). Поэтому на
 * время события задержка — 1 тик, а в самом конце (LOWEST) возвращаем 0: для других игроков предмет не меняется.
 */
public final class PickupFilter {
    private PickupFilter() {}

    /** Предмет, которому сейчас поставлена временная задержка (событие одно на поток сервера) */
    private static ItemEntity held;

    @SubscribeEvent(priority = EventPriority.HIGHEST)
    public static void first(ItemEntityPickupEvent.Pre event) {
        ItemEntity item = event.getItemEntity();
        if (item.hasPickUpDelay() || !blocks(event.getPlayer(), item.getItem())) return;
        event.setCanPickup(TriState.FALSE);
        item.setPickUpDelay(1);
        held = item;
    }

    @SubscribeEvent(priority = EventPriority.LOWEST)
    public static void last(ItemEntityPickupEvent.Pre event) {
        if (held != event.getItemEntity()) return;
        held = null;
        event.getItemEntity().setPickUpDelay(0);
        event.setCanPickup(TriState.FALSE);
    }

    /** Есть ли у игрока включённый пояс, в фильтре которого этот предмет */
    public static boolean blocks(Player player, ItemStack drop) {
        if (drop.isEmpty()) return false;
        for (ItemStack belt : belts(player)) {
            if (BeltFilter.blocks(belt, drop)) return true;
        }
        return false;
    }

    /** Пояса в слотах Curios и в инвентаре (вместе с рукой и второй рукой) */
    public static List<ItemStack> belts(Player player) {
        List<ItemStack> out = new ArrayList<>();
        Inventory inv = player.getInventory();
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack s = inv.getItem(i);
            if (s.is(MinerTools.BELT.get())) out.add(s);
        }
        if (ModList.get().isLoaded("curios")) out.addAll(CuriosCompat.belts(player));
        return out;
    }
}
