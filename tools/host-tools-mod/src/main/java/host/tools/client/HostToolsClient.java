package host.tools.client;

import host.tools.HostConfig;
import host.tools.HostService;
import host.tools.HostTools;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.ShareToLanScreen;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.contents.TranslatableContents;
import net.minecraft.util.HttpUtil;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ScreenEvent;
import net.neoforged.neoforge.common.NeoForge;

@Mod(value = HostTools.MOD_ID, dist = Dist.CLIENT)
public final class HostToolsClient {
    public HostToolsClient() {
        HostService.onPublishChanged = () -> Minecraft.getInstance().execute(() -> Minecraft.getInstance().updateTitle());
        NeoForge.EVENT_BUS.addListener(HostToolsClient::onScreenInit);
    }

    private static void onScreenInit(ScreenEvent.Init.Post event) {
        Minecraft mc = Minecraft.getInstance();
        IntegratedServer server = mc.getSingleplayerServer();
        if (server == null) return;
        if (event.getScreen() instanceof PauseScreen && server.isPublished()) addCloseButton(event, mc, server);
        if (event.getScreen() instanceof ShareToLanScreen) presetPort(event);
    }

    /**
     * Мир открыт для сети: на месте «Открыть для сети» Minecraft ставит «Жалобы на игроков» (PauseScreen.createPauseMenu);
     * её место занимает «Закрыть для сети».
     */
    private static void addCloseButton(ScreenEvent.Init.Post event, Minecraft mc, IntegratedServer server) {
        for (var listener : event.getListenersList()) {
            if (!(listener instanceof Button button) || !isKey(button, "menu.playerReporting")) continue;
            Button close = Button.builder(Component.translatable("host_tools.menu.close_lan"), b -> {
                b.active = false;
                server.submit(() -> HostService.closeLan(server)).thenAcceptAsync(kicked -> {
                    mc.gui.getChat().addMessage(Component.translatable(
                            kicked > 0 ? "host_tools.closed.kicked" : "host_tools.closed", kicked));
                    mc.setScreen(new PauseScreen(true));
                }, mc);
            }).bounds(button.getX(), button.getY(), button.getWidth(), button.getHeight()).build();
            event.removeListener(button);
            event.addListener(close);
            return;
        }
    }

    /** Окно «Открыть для сети»: порт из настроек вместо случайного, если он свободен. */
    private static void presetPort(ScreenEvent.Init.Post event) {
        int port = HostConfig.PORT.get();
        if (!HttpUtil.isPortAvailable(port)) return;
        for (var listener : event.getListenersList()) {
            if (listener instanceof EditBox box && box.getValue().isEmpty()) {
                box.setValue(String.valueOf(port));
                return;
            }
        }
    }

    private static boolean isKey(AbstractWidget widget, String key) {
        return widget.getMessage().getContents() instanceof TranslatableContents t && t.getKey().equals(key);
    }

}
