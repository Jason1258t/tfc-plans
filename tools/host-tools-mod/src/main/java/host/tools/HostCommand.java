package host.tools;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.exceptions.SimpleCommandExceptionType;
import java.util.List;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.ComponentUtils;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

/** /host [порт|random|stop|status] — только хост (владелец мира) или оператор, только в мире хоста. */
public final class HostCommand {
    private static final SimpleCommandExceptionType NOT_HOST_WORLD = new SimpleCommandExceptionType(
            Component.literal("/host работает только в мире хоста (одиночный мир), не на выделенном сервере"));
    private static final SimpleCommandExceptionType BUSY = new SimpleCommandExceptionType(
            Component.literal("Мир уже открывается для сети — подождите"));
    private static final SimpleCommandExceptionType NOT_PUBLISHED = new SimpleCommandExceptionType(
            Component.literal("Мир не открыт для сети"));

    public static void register(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("host")
                .requires(HostCommand::isHost)
                .executes(c -> open(c.getSource(), List.of(HostConfig.PORT.get()), false))
                .then(Commands.literal("random")
                        .executes(c -> open(c.getSource(), HostService.randomPorts(), true)))
                .then(Commands.literal("stop").executes(c -> stop(c.getSource())))
                .then(Commands.literal("status").executes(c -> status(c.getSource())))
                .then(Commands.argument("port", IntegerArgumentType.integer(1024, 65535))
                        .executes(c -> open(c.getSource(), List.of(IntegerArgumentType.getInteger(c, "port")), false))));
    }

    private static boolean isHost(CommandSourceStack source) {
        ServerPlayer player = source.getPlayer();
        if (player != null && source.getServer().isSingleplayerOwner(player.getGameProfile())) return true;
        return source.hasPermission(4);
    }

    private static int open(CommandSourceStack source, List<Integer> ports, boolean random) throws CommandSyntaxException {
        MinecraftServer server = checkHostWorld(source);
        if (server.isPublished()) {
            source.sendFailure(Component.literal("Мир уже открыт для сети на порте ")
                    .append(ComponentUtils.copyOnClickText(String.valueOf(server.getPort())))
                    .append(". Закрыть: /host stop"));
            return 0;
        }
        if (HostService.isOpening()) throw BUSY.create();
        HostService.open(source, ports, random);
        return 1;
    }

    private static int stop(CommandSourceStack source) throws CommandSyntaxException {
        MinecraftServer server = checkHostWorld(source);
        if (!server.isPublished()) throw NOT_PUBLISHED.create();
        int port = server.getPort();
        int kicked = HostService.closeLan(server);
        source.sendSuccess(() -> Component.literal("Мир закрыт для сети (порт " + port + ")"
                + (kicked > 0 ? ", отключено игроков: " + kicked : "")), false);
        return 1;
    }

    private static int status(CommandSourceStack source) throws CommandSyntaxException {
        MinecraftServer server = checkHostWorld(source);
        if (server.isPublished()) {
            source.sendSuccess(() -> Component.literal("Мир открыт для сети на порте ")
                    .append(ComponentUtils.copyOnClickText(String.valueOf(server.getPort())))
                    .append(", игроков: " + server.getPlayerCount()), false);
        } else {
            source.sendSuccess(() -> Component.literal("Мир не открыт для сети. Открыть: /host (порт "
                    + HostConfig.PORT.get() + "), /host <порт> или /host random"), false);
        }
        return 1;
    }

    private static MinecraftServer checkHostWorld(CommandSourceStack source) throws CommandSyntaxException {
        if (!HostService.isHostWorld(source.getServer())) throw NOT_HOST_WORLD.create();
        return source.getServer();
    }

    private HostCommand() {}
}
