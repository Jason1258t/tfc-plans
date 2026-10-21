package miner.tools.helmet;

import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import top.theillusivec4.curios.api.CuriosApi;
import top.theillusivec4.curios.api.SlotResult;

/** Обращения к Curios — отдельным классом, чтобы без Curios мод не загружал его классы */
final class HelmetCurios {
    private HelmetCurios() {}

    /** Каска в слоте «голова» (его даёт игроку Create — для очков инженера) */
    static ItemStack worn(LivingEntity entity) {
        return CuriosApi.getCuriosInventory(entity)
                // Не findFirstCurio(Item): тот кеширует ответ на весь тик
                .flatMap(h -> h.findFirstCurio(s -> s.is(Helmet.HELMET.get()), "head"))
                .map(SlotResult::stack)
                .orElse(ItemStack.EMPTY);
    }
}
