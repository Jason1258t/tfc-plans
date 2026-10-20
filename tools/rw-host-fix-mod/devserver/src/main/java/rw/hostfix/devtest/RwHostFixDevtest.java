package rw.hostfix.devtest;

import com.mojang.authlib.GameProfile;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.context.CommandContext;
import java.util.Arrays;
import java.util.UUID;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.TickTask;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.PortalProcessor;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.Portal;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.common.util.FakePlayer;
import net.neoforged.neoforge.common.util.FakePlayerFactory;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.entity.EntityTravelToDimensionEvent;
import net.yazloysasha.tfcrealworld.config.TFCRealWorldConfig;

/**
 * Только для проверочного сервера: /rwtest clear — стирание настроек карты при работающем сервере;
 * /rwtest mixin — применился ли миксин к TFCRealWorldConfig и какие размеры карты
 * видит сервер; /rwtest portal|command <x> <z> — переход «ад → обычный мир» тестового игрока (без клиента)
 * через портал или как командой: отменён ли он и где игрок оказался через несколько тиков.
 */
@Mod("rw_host_fix_devtest")
public final class RwHostFixDevtest {
    public RwHostFixDevtest() {
        NeoForge.EVENT_BUS.addListener(RwHostFixDevtest::register);
    }

    private static void register(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("rwtest")
                .then(Commands.literal("mixin").executes(RwHostFixDevtest::mixin))
                .then(Commands.literal("clear").executes(RwHostFixDevtest::clear))
                .then(Commands.literal("portal").then(Commands.argument("x", IntegerArgumentType.integer())
                        .then(Commands.argument("z", IntegerArgumentType.integer()).executes(c -> travel(c, true)))))
                .then(Commands.literal("command").then(Commands.argument("x", IntegerArgumentType.integer())
                        .then(Commands.argument("z", IntegerArgumentType.integer()).executes(c -> travel(c, false))))));
    }

    private static int mixin(CommandContext<CommandSourceStack> c) {
        String injected = String.join(", ", Arrays.stream(TFCRealWorldConfig.class.getDeclaredMethods())
                .map(m -> m.getName()).filter(n -> n.contains("rwHostFix")).toList());
        say(c, "миксин: " + (injected.isEmpty() ? "НЕ ПРИМЕНЁН" : injected));
        say(c, "карта: horizontal_scale=" + TFCRealWorldConfig.HORIZONTAL_SCALE.get() + " vertical_scale="
                + TFCRealWorldConfig.VERTICAL_SCALE.get());
        return 1;
    }

    /** То же, что делает TFC Real World при выгрузке мира на клиенте хоста: при работающем сервере не должно стереть */
    private static int clear(CommandContext<CommandSourceStack> c) {
        TFCRealWorldConfig.clearServerConfig();
        say(c, "после clearServerConfig: horizontal_scale=" + TFCRealWorldConfig.HORIZONTAL_SCALE.get()
                + " vertical_scale=" + TFCRealWorldConfig.VERTICAL_SCALE.get());
        return 1;
    }

    private static int travel(CommandContext<CommandSourceStack> c, boolean portal) {
        int x = IntegerArgumentType.getInteger(c, "x");
        int z = IntegerArgumentType.getInteger(c, "z");
        MinecraftServer server = c.getSource().getServer();
        ServerLevel nether = server.getLevel(Level.NETHER);
        FakePlayer player = FakePlayerFactory.get(nether, new GameProfile(UUID.randomUUID(), "rwtest"));
        player.moveTo(x + 0.5, 70, z + 0.5, 0, 0);
        player.portalProcess = portal ? new PortalProcessor((Portal) Blocks.NETHER_PORTAL, player.blockPosition()) : null;
        EntityTravelToDimensionEvent event = new EntityTravelToDimensionEvent(player, Level.OVERWORLD);
        NeoForge.EVENT_BUS.post(event);
        say(c, (portal ? "портал" : "команда") + " из ада " + x + " " + z + ": переход "
                + (event.isCanceled() ? "отменён" : "разрешён"));
        // ответ RCON к этому времени уже отправлен — пишем в лог сервера
        server.tell(new TickTask(server.getTickCount() + 5, () -> System.out.println("[rwtest] " + x + " " + z
                + " через 5 тиков: " + player.level().dimension().location() + " " + player.blockPosition().toShortString())));
        return 1;
    }

    private static void say(CommandContext<CommandSourceStack> c, String text) {
        c.getSource().sendSystemMessage(Component.literal("[rwtest] " + text));
    }
}
