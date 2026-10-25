package host.tools;

import java.util.Map;
import java.util.WeakHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import net.minecraft.network.protocol.common.ClientboundPingPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/**
 * Свой замер пинга. Minecraft замеряет keep-alive раз в 15 с и сглаживает (¾ старого + ¼ нового), а Packet Fixer
 * (в сборке) подменяет эти 15 с своим таймаутом — 120 с по умолчанию (ModifyConstant 15000L в keepConnectionAlive):
 * пинг гостя первые 2 минуты 0 и до настоящего доходит минут за десять. Здесь — ping/pong раз в probeTicks, новое
 * значение — среднее старого и замера, записывается в то же поле, что читают таб и /ping.
 */
public final class PingProbe {
    /** Метка наших id: чужие ping/pong (если появятся) не трогаем. */
    private static final int MAGIC = 0x48540000;
    private static final int STALE_MS = 30_000;
    private static final AtomicInteger counter = new AtomicInteger();
    /** Только для проверки в клиенте разработки: мерить и хоста (у него соединение в памяти). */
    private static final boolean PROBE_OWNER = Boolean.getBoolean("host_tools.probeOwner");

    public interface LatencyHolder {
        int hosttools$latency();

        void hosttools$setLatency(int value);
    }

    private record Pending(int id, long sentNanos) {}

    private static final Map<Object, Pending> pending = new WeakHashMap<>();

    public static void onServerTick(ServerTickEvent.Post event) {
        int every = HostConfig.PROBE_TICKS.get();
        MinecraftServer server = event.getServer();
        if (every <= 0 || server.getTickCount() % every != 0) return;
        long now = System.nanoTime();
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (!PROBE_OWNER && server.isSingleplayerOwner(player.getGameProfile())) continue;
            synchronized (pending) {
                Pending p = pending.get(player.connection);
                if (p != null && (now - p.sentNanos) / 1_000_000 < STALE_MS) continue; // ждём ответа на прошлый
                int id = MAGIC | (counter.incrementAndGet() & 0xFFFF);
                pending.put(player.connection, new Pending(id, System.nanoTime()));
                player.connection.send(new ClientboundPingPacket(id));
            }
        }
    }

    /** Поток сети. */
    public static void onPong(LatencyHolder listener, int id) {
        if ((id & 0xFFFF0000) != MAGIC) return;
        long now = System.nanoTime();
        Pending p;
        synchronized (pending) {
            p = pending.get(listener);
            if (p == null || p.id != id) return;
            pending.remove(listener);
        }
        int sample = (int) Math.max(1, (now - p.sentNanos) / 1_000_000);
        int old = listener.hosttools$latency();
        listener.hosttools$setLatency(old <= 0 ? sample : (old + sample) / 2);
    }

    private PingProbe() {}
}
