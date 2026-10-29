package builder.tools.client;

import builder.tools.ToolSelection;
import net.minecraft.client.Minecraft;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.InputEvent;

/** Событие приходит и при первом ударе, и при удержании ЛКМ, до расчёта прогресса добычи. */
@EventBusSubscriber(modid = "builder_tools", value = Dist.CLIENT)
public final class BuilderClient {
    private BuilderClient() {}

    @SubscribeEvent(priority = EventPriority.LOWEST)
    public static void attack(InputEvent.InteractionKeyMappingTriggered event) {
        if (!event.isAttack()) return;
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.level == null || mc.gameMode == null || mc.screen != null
                || mc.player.isUsingItem() || mc.player.isHandsBusy()
                || mc.player.containerMenu != mc.player.inventoryMenu
                || !mc.player.inventoryMenu.getCarried().isEmpty()
                || !(mc.hitResult instanceof BlockHitResult hit) || hit.getType() != HitResult.Type.BLOCK) return;
        int source = ToolSelection.find(mc.player, mc.level.getBlockState(hit.getBlockPos()));
        if (source < 0) return;
        // SWAP оставляет выбранный слот прежним; прежний предмет занимает место инструмента, даже при полном инвентаре.
        int menuSlot = ToolSelection.menuSlot(mc.player, source);
        if (menuSlot < 0) return;
        mc.gameMode.handleInventoryMouseClick(mc.player.inventoryMenu.containerId, menuSlot,
                mc.player.getInventory().selected, ClickType.SWAP, mc.player);
    }
}
