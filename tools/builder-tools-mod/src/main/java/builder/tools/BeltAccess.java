package builder.tools;

import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import top.theillusivec4.curios.api.CuriosApi;

/** Работает только надетый пояс; предмет в сумке не включает автоматизацию. */
public final class BeltAccess {
    private BeltAccess() {}
    public static boolean enabled(ItemStack stack) { return stack.getOrDefault(BuilderTools.ENABLED.get(), true); }
    public static boolean active(Player player) {
        return player.isAlive() && !player.isSpectator()
                && CuriosApi.getCuriosInventory(player)
                .map(inv -> !inv.findCurios(s -> s.is(BuilderTools.BELT.get()) && enabled(s)).isEmpty())
                .orElse(false);
    }
}
