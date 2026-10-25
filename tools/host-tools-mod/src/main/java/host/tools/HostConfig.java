package host.tools;

import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.GameType;
import net.neoforged.neoforge.common.ModConfigSpec;

/** config/host_tools-common.toml — настройки хоста (у гостей и на выделенном сервере не используются). */
public final class HostConfig {
    public enum Mode { WORLD, SURVIVAL, CREATIVE, ADVENTURE, SPECTATOR }

    public enum Cheats { WORLD, ON, OFF }

    public static final ModConfigSpec SPEC;
    public static final ModConfigSpec.IntValue PORT;
    public static final ModConfigSpec.IntValue RANDOM_FROM;
    public static final ModConfigSpec.IntValue RANDOM_TO;
    public static final ModConfigSpec.IntValue RANDOM_ATTEMPTS;
    public static final ModConfigSpec.EnumValue<Mode> GAME_MODE;
    public static final ModConfigSpec.EnumValue<Cheats> ALLOW_COMMANDS;
    public static final ModConfigSpec.IntValue LATENCY_BROADCAST_TICKS;
    public static final ModConfigSpec.IntValue PROBE_TICKS;

    static {
        ModConfigSpec.Builder b = new ModConfigSpec.Builder();
        b.push("host");
        PORT = b.comment("Порт для /host без аргументов").defineInRange("port", 57016, 1024, 65535);
        RANDOM_FROM = b.comment("/host random: нижняя граница случайных портов")
                .defineInRange("randomFrom", 20000, 1024, 65535);
        RANDOM_TO = b.comment("/host random: верхняя граница случайных портов")
                .defineInRange("randomTo", 45000, 1024, 65535);
        RANDOM_ATTEMPTS = b.comment("/host random: сколько портов пробовать, прежде чем сдаться")
                .defineInRange("randomAttempts", 30, 1, 500);
        GAME_MODE = b.comment("Режим игры гостей: WORLD — как в мире (как в окне «Открыть для сети»), или SURVIVAL, CREATIVE, ADVENTURE, SPECTATOR")
                .defineEnum("gameMode", Mode.WORLD);
        ALLOW_COMMANDS = b.comment("Читы (команды) для всех: WORLD — как в мире, ON, OFF")
                .defineEnum("allowCommands", Cheats.WORLD);
        b.pop();
        b.push("ping");
        PROBE_TICKS = b.comment("Как часто (в тиках) замерять пинг игроков своим ping/pong; 0 — только замер Minecraft (раз в 15 с, с Packet Fixer — раз в его timeout)")
                .defineInRange("probeTicks", 40, 0, 1200);
        LATENCY_BROADCAST_TICKS = b.comment("Как часто (в тиках) рассылать пинг игроков для таба; у Minecraft — раз в 600. 0 — не рассылать чаще обычного")
                .defineInRange("broadcastTicks", 40, 0, 1200);
        b.pop();
        SPEC = b.build();
    }

    static GameType gameMode(MinecraftServer server) {
        return switch (GAME_MODE.get()) {
            case WORLD -> server.getDefaultGameType();
            case SURVIVAL -> GameType.SURVIVAL;
            case CREATIVE -> GameType.CREATIVE;
            case ADVENTURE -> GameType.ADVENTURE;
            case SPECTATOR -> GameType.SPECTATOR;
        };
    }

    static boolean allowCommands(MinecraftServer server) {
        return switch (ALLOW_COMMANDS.get()) {
            case WORLD -> server.getWorldData().isAllowCommands();
            case ON -> true;
            case OFF -> false;
        };
    }

    private HostConfig() {}
}
