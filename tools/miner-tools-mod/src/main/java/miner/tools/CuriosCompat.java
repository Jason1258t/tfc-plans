package miner.tools;

import java.util.List;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import top.theillusivec4.curios.api.CuriosApi;
import top.theillusivec4.curios.api.SlotResult;

/** Обращения к Curios — отдельным классом, чтобы без Curios мод не загружал его классы */
final class CuriosCompat {
    private CuriosCompat() {}

    static List<ItemStack> belts(Player player) {
        return CuriosApi.getCuriosInventory(player)
                // Не findCurios(Item): тот кеширует ответ на весь тик, и только что надетый пояс не виден до следующего
                .map(h -> h.findCurios(s -> s.is(MinerTools.BELT.get())).stream().map(SlotResult::stack).toList())
                .orElse(List.of());
    }
}
