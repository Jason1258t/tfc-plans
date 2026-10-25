package host.tools;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.EntityArgument;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.protocol.game.ClientboundPlayerInfoUpdatePacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/** /ping [игроки] — пинг для всех. Число — то же, что рисует таб палочками; замеряет {@link PingProbe}. */
public final class PingCommand {
    public static void register(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("ping")
                .executes(c -> show(c.getSource(), c.getSource().getServer().getPlayerList().getPlayers()))
                .then(Commands.argument("players", EntityArgument.players())
                        .executes(c -> show(c.getSource(), EntityArgument.getPlayers(c, "players")))));
    }

    private static int show(CommandSourceStack source, Collection<ServerPlayer> players) {
        MinecraftServer server = source.getServer();
        List<ServerPlayer> sorted = new ArrayList<>(players);
        sorted.sort(Comparator.comparingInt((ServerPlayer p) -> p.connection.latency()).reversed());
        MutableComponent msg = Component.literal("Пинг игроков").withStyle(ChatFormatting.GOLD)
                .append(Component.literal(" (замер раз в " + probeSeconds() + ")").withStyle(ChatFormatting.GRAY));
        for (ServerPlayer p : sorted) {
            msg.append("\n  ").append(p.getDisplayName().copy()).append(" — ");
            if (server.isSingleplayerOwner(p.getGameProfile())) {
                msg.append(Component.literal("хост").withStyle(ChatFormatting.AQUA));
            } else {
                int ms = p.connection.latency();
                msg.append(Component.literal(ms + " мс").withStyle(color(ms)));
            }
        }
        source.sendSuccess(() -> msg, false);
        return sorted.size();
    }

    private static String probeSeconds() {
        int ticks = HostConfig.PROBE_TICKS.get();
        return ticks <= 0 ? "15 с и реже" : String.format(java.util.Locale.ROOT, "%.0f с", Math.max(1, ticks / 20.0));
    }

    /** Пороги — как у палочек таба (PlayerTabOverlay.renderPingIcon): 150 / 300 / 600 / 1000 мс. */
    public static ChatFormatting color(int ms) {
        if (ms < 0) return ChatFormatting.GRAY;
        if (ms < 150) return ChatFormatting.GREEN;
        if (ms < 300) return ChatFormatting.YELLOW;
        if (ms < 600) return ChatFormatting.GOLD;
        return ChatFormatting.RED;
    }

    /** Minecraft рассылает пинг для таба раз в 30 с; чаще — чтобы цифры в табе не отставали от замера. */
    public static void onServerTick(ServerTickEvent.Post event) {
        int every = HostConfig.LATENCY_BROADCAST_TICKS.get();
        MinecraftServer server = event.getServer();
        if (every <= 0 || server.getTickCount() % every != 0) return;
        List<ServerPlayer> players = server.getPlayerList().getPlayers();
        if (players.size() < 2) return;
        server.getPlayerList().broadcastAll(new ClientboundPlayerInfoUpdatePacket(
                EnumSet.of(ClientboundPlayerInfoUpdatePacket.Action.UPDATE_LATENCY), players));
    }

    private PingCommand() {}
}
