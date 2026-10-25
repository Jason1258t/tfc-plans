package host.tools;

import host.tools.mixin.ServerConnectionListenerAccessor;
import io.netty.channel.ChannelFuture;
import io.netty.channel.local.LocalServerChannel;
import java.io.IOException;
import java.net.BindException;
import java.net.ServerSocket;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;
import javax.annotation.Nullable;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.network.Connection;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.ComponentUtils;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.TickTask;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

/**
 * Открытие и закрытие мира хоста для сети. Порты пробуются по одному отдельными задачами сервера, чтобы игра не
 * висела и в строке над хотбаром был виден прогресс. Не по тикам: в мире хоста, не открытом для сети, сервер на паузе
 * (меню, окно не в фокусе) не тикает, а задачи выполняет. Тексты — строками, не ключами: сообщения уходят с сервера, у гостя мода может не быть.
 */
public final class HostService {
    /** Клиент хоста обновляет заголовок окна («Мир хоста» / «Одиночная игра»). */
    public static volatile Runnable onPublishChanged = () -> {};

    private static final class Opening {
        final CommandSourceStack source;
        final Deque<Integer> ports;
        final int total;
        final boolean random;
        int attempt;
        String lastError = "";

        Opening(CommandSourceStack source, List<Integer> ports, boolean random) {
            this.source = source;
            this.ports = new ArrayDeque<>(ports);
            this.total = ports.size();
            this.random = random;
        }
    }

    @Nullable private static Opening opening;

    public static boolean isHostWorld(MinecraftServer server) {
        return server instanceof LanHost;
    }

    public static boolean isOpening() {
        return opening != null;
    }

    /** Запустить открытие: порты пробуются следующими задачами сервера. */
    static void open(CommandSourceStack source, List<Integer> ports, boolean random) {
        Opening o = new Opening(source, ports, random);
        opening = o;
        schedule(o);
        if (random) {
            progress(source, Component.literal("Ищу свободный порт (до " + ports.size() + " попыток)…"));
        } else {
            progress(source, Component.literal("Открываю мир для сети на порте " + ports.get(0) + "…"));
        }
    }

    static List<Integer> randomPorts() {
        int from = Math.min(HostConfig.RANDOM_FROM.get(), HostConfig.RANDOM_TO.get());
        int to = Math.max(HostConfig.RANDOM_FROM.get(), HostConfig.RANDOM_TO.get());
        int count = Math.min(HostConfig.RANDOM_ATTEMPTS.get(), to - from + 1);
        Set<Integer> ports = new LinkedHashSet<>();
        ThreadLocalRandom rnd = ThreadLocalRandom.current();
        while (ports.size() < count) ports.add(rnd.nextInt(from, to + 1));
        return new ArrayList<>(ports);
    }

    private static void schedule(Opening o) {
        MinecraftServer server = o.source.getServer();
        server.tell(new TickTask(server.getTickCount(), () -> attempt(o)));
    }

    private static void attempt(Opening o) {
        if (opening != o) return; // мир закрыли или открыли заново
        MinecraftServer server = o.source.getServer();
        if (server.isPublished()) { // открыли другим способом (окно «Открыть для сети», /publish)
            opening = null;
            return;
        }
        int port = o.ports.poll();
        o.attempt++;
        String error = tryPublish(server, port);
        if (error == null) {
            opening = null;
            HostTools.LOGGER.info("Мир открыт для сети на порте {} (попытка {})", port, o.attempt);
            MutableComponent msg = Component.literal("Мир открыт для сети на порте ")
                    .append(ComponentUtils.copyOnClickText(String.valueOf(port)));
            if (o.attempt > 1) msg.append(Component.literal(" (с попытки " + o.attempt + ")").withStyle(ChatFormatting.GRAY));
            o.source.sendSuccess(() -> msg, false);
            progress(o.source, Component.literal("Открыто: порт " + port).withStyle(ChatFormatting.GREEN));
            onPublishChanged.run();
            return;
        }
        HostTools.LOGGER.info("Порт {} не открылся: {}", port, error);
        o.lastError = error;
        if (o.ports.isEmpty()) {
            opening = null;
            progress(o.source, Component.empty());
            if (o.random) {
                o.source.sendFailure(Component.literal("Не удалось открыть мир для сети: " + o.total
                        + " портов не открылись. Последняя ошибка: " + error));
            } else {
                o.source.sendFailure(Component.literal("Порт " + port + " не открылся: " + error
                        + ". Другой порт: /host <порт> или /host random"));
            }
            return;
        }
        progress(o.source, Component.literal("Порт " + port + " не открылся — пробую " + o.ports.peek()
                + " (" + (o.attempt + 1) + "/" + o.total + ")"));
        schedule(o);
    }

    public static void onServerStopping(ServerStoppingEvent event) {
        opening = null;
    }

    /** null — открыто; иначе причина для игрока. */
    @Nullable
    private static String tryPublish(MinecraftServer server, int port) {
        // Тот же адрес, что берёт Netty в startTcpServerListener (все адреса, порт); так видна причина отказа
        try (ServerSocket probe = new ServerSocket(port)) {
            probe.setReuseAddress(false);
        } catch (BindException e) {
            return "порт занят или закрыт системой (" + e.getMessage() + ")";
        } catch (IOException e) {
            return String.valueOf(e.getMessage());
        }
        try {
            if (server.publishServer(HostConfig.gameMode(server), HostConfig.allowCommands(server), port)) return null;
            return "Minecraft не смог открыть порт (подробности в логе)";
        } catch (RuntimeException e) {
            HostTools.LOGGER.warn("Открытие для сети на порте {}", port, e);
            return String.valueOf(e.getMessage());
        }
    }

    /**
     * Закрыть мир для сети без выхода из него: отключить гостей, закрыть порт, снять «открыт для сети».
     * Только на потоке сервера. Возвращает число отключённых игроков.
     */
    public static int closeLan(MinecraftServer server) {
        Component reason = Component.literal("Хост закрыл мир для сети");
        int kicked = 0;
        for (ServerPlayer player : List.copyOf(server.getPlayerList().getPlayers())) {
            if (server.isSingleplayerOwner(player.getGameProfile())) continue;
            player.connection.disconnect(reason);
            kicked++;
        }
        ServerConnectionListenerAccessor listener = (ServerConnectionListenerAccessor) server.getConnection();
        List<ChannelFuture> channels = listener.hosttools$channels();
        synchronized (channels) {
            for (Iterator<ChannelFuture> it = channels.iterator(); it.hasNext(); ) {
                ChannelFuture channel = it.next();
                if (channel.channel() instanceof LocalServerChannel) continue; // соединение самого хоста
                channel.channel().close().syncUninterruptibly();
                it.remove();
            }
        }
        // Кто ещё не вошёл (вход, загрузка, запрос списка серверов) — закрыть сразу
        List<Connection> connections = server.getConnection().getConnections();
        synchronized (connections) {
            for (Connection connection : connections) {
                if (connection.isMemoryConnection() || !connection.isConnected()) continue;
                if (connection.getPacketListener() instanceof ServerGamePacketListenerImpl) continue; // уже отключён выше
                connection.disconnect(reason);
            }
        }
        ((LanHost) server).hosttools$unpublish();
        HostTools.LOGGER.info("Мир закрыт для сети, отключено игроков: {}", kicked);
        onPublishChanged.run();
        return kicked;
    }

    private static void progress(CommandSourceStack source, Component text) {
        ServerPlayer player = source.getPlayer();
        if (player != null) player.displayClientMessage(text, true);
        else if (!text.getString().isEmpty()) source.sendSystemMessage(text);
    }

    private HostService() {}
}
