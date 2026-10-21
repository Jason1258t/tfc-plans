package miner.tools.client;

import miner.tools.BeltMenu;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.player.Inventory;

/** Окно фильтра: фон сундука на один ряд (как у ванильного ContainerScreen) и две кнопки справа от окна. */
public class BeltScreen extends AbstractContainerScreen<BeltMenu> {
    private static final ResourceLocation BACKGROUND =
            ResourceLocation.withDefaultNamespace("textures/gui/container/generic_54.png");
    private static final int BUTTON_W = 130;

    private Button any, enabled;

    public BeltScreen(BeltMenu menu, Inventory inv, Component title) {
        super(menu, inv, title);
        imageHeight = 114 + 18;
        inventoryLabelY = imageHeight - 94;
    }

    @Override
    protected void init() {
        super.init();
        // Справа от окна, а если не помещается — слева
        int x = leftPos + imageWidth + 4;
        if (x + BUTTON_W > width) x = Math.max(0, leftPos - BUTTON_W - 4);
        enabled = addRenderableWidget(Button.builder(Component.empty(), b -> press(BeltMenu.BUTTON_ENABLED))
                .bounds(x, topPos, BUTTON_W, 20)
                .tooltip(Tooltip.create(Component.translatable("miner_belt.gui.enabled.hint"))).build());
        any = addRenderableWidget(Button.builder(Component.empty(), b -> press(BeltMenu.BUTTON_ANY))
                .bounds(x, topPos + 24, BUTTON_W, 20)
                .tooltip(Tooltip.create(Component.translatable("miner_belt.gui.any.hint"))).build());
        updateLabels();
    }

    private void press(int id) {
        if (minecraft != null && minecraft.gameMode != null) minecraft.gameMode.handleInventoryButtonClick(menu.containerId, id);
    }

    private void updateLabels() {
        enabled.setMessage(Component.translatable(menu.enabled() ? "miner_belt.gui.enabled.on" : "miner_belt.gui.enabled.off"));
        any.setMessage(Component.translatable(menu.anyVariant() ? "miner_belt.gui.any.on" : "miner_belt.gui.any.off"));
    }

    @Override
    protected void containerTick() {
        super.containerTick();
        updateLabels();
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        renderTooltip(g, mouseX, mouseY);
    }

    @Override
    protected void renderBg(GuiGraphics g, float partialTick, int mouseX, int mouseY) {
        g.blit(BACKGROUND, leftPos, topPos, 0, 0, imageWidth, 18 + 17);
        g.blit(BACKGROUND, leftPos, topPos + 18 + 17, 0, 126, imageWidth, 96);
    }
}
