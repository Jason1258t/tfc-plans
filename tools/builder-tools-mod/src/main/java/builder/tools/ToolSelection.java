package builder.tools;

import net.minecraft.core.component.DataComponents;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;

/** Общий выбор слота: клиент применяет обычный обмен инвентаря до пакета начала добычи. */
public final class ToolSelection {
    private ToolSelection() {}

    /** Номер ячейки меню определяется по контейнеру, а не предполагаемой ванильной раскладке. */
    public static int menuSlot(Player player, int inventorySlot) {
        for (var slot : player.inventoryMenu.slots) {
            if (slot.container == player.getInventory() && slot.getContainerSlot() == inventorySlot) return slot.index;
        }
        return -1;
    }

    public static int find(Player player, BlockState state) {
        if (!BeltAccess.active(player) || player.isCreative() || !player.getAbilities().mayBuild || state.isAir()) return -1;
        var inv = player.getInventory();
        ItemStack held = player.getMainHandItem();
        boolean correct = held.isCorrectToolForDrops(state);
        float speed = held.getDestroySpeed(state);
        int best = -1;
        // Только 36 обычных слотов: броня, вторая рука и содержимое сумок не перемещаются.
        for (int slot = 0; slot < inv.items.size(); slot++) {
            if (slot == inv.selected) continue;
            ItemStack stack = inv.getItem(slot);
            if (!stack.has(DataComponents.TOOL) || stack.isEmpty()) continue;
            if (stack.isDamageableItem() && stack.getDamageValue() >= stack.getMaxDamage() - 1) continue;
            boolean candidateCorrect = stack.isCorrectToolForDrops(state);
            float candidateSpeed = stack.getDestroySpeed(state);
            // На блоке без требования инструмента приоритет имеет скорость. На руде сначала нужен дроп.
            boolean improve = state.requiresCorrectToolForDrops() && candidateCorrect != correct
                    ? candidateCorrect : candidateSpeed > speed;
            if (!improve || (state.requiresCorrectToolForDrops() && !candidateCorrect && correct)) continue;
            if (candidateSpeed <= 1 && !candidateCorrect) continue;
            best = slot;
            correct = candidateCorrect;
            speed = candidateSpeed;
        }
        return best;
    }
}
