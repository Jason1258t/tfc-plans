package host.tools.client;

import host.tools.PingCommand;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.network.chat.Component;

/** Текст пинга в табе: «42 мс» цветом по тем же порогам, что палочки; у хоста (0 мс, соединение в памяти) — пусто. */
public final class TabPing {
    private static final int GAP = 2;

    static Component text(PlayerInfo info) {
        int ms = info.getLatency();
        if (ms <= 0) return Component.empty();
        return Component.translatable("host_tools.tab.ping", ms).withStyle(PingCommand.color(ms));
    }

    /** Добавка к ширине колонки: под самый длинный текст среди видимых игроков. */
    public static int extraWidth(Minecraft minecraft) {
        ClientPacketListener connection = minecraft.getConnection();
        if (connection == null) return 0;
        int max = 0;
        for (PlayerInfo info : connection.getListedOnlinePlayers()) max = Math.max(max, minecraft.font.width(text(info)));
        return max == 0 ? 0 : max + GAP;
    }

    /** right — левый край палочек. */
    public static void draw(GuiGraphics graphics, Font font, int right, int y, PlayerInfo info) {
        Component text = text(info);
        int width = font.width(text);
        if (width == 0) return;
        graphics.pose().pushPose();
        graphics.pose().translate(0.0F, 0.0F, 100.0F); // поверх фона строки, как палочки
        graphics.drawString(font, text, right - GAP - width, y, -1);
        graphics.pose().popPose();
    }

    private TabPing() {}
}
