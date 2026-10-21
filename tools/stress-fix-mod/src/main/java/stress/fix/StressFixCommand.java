package stress.fix;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.context.CommandContext;
import java.util.List;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

/**
 * /stressfix — сети с ненулевым учётом незагруженной части в текущем мире (что висит, загружена ли сеть целиком).
 * /stressfix recalc — то же, но для всех сетей заново спросить у живых блоков их вклад и пересчитать итог.
 */
public final class StressFixCommand {
    private StressFixCommand() {}

    public static void register(RegisterCommandsEvent event) {
        CommandDispatcher<CommandSourceStack> d = event.getDispatcher();
        d.register(Commands.literal("stressfix").requires(s -> s.hasPermission(2))
                .executes(c -> run(c, false))
                .then(Commands.literal("recalc").executes(c -> run(c, true))));
    }

    private static int run(CommandContext<CommandSourceStack> c, boolean force) {
        ServerLevel level = c.getSource().getLevel();
        List<PhantomCleaner.Result> results = PhantomCleaner.clean(level, force);
        int cleaned = 0, partial = 0;
        for (PhantomCleaner.Result r : results) {
            if (r.cleaned()) cleaned++;
            if (!r.fullyLoaded()) partial++;
            if (r.unloadedCapacity() == 0 && r.unloadedStress() == 0 && r.unloadedMembers() == 0) continue;
            String line = String.format("сеть у %s: незагруженная часть — мощность %d SU, нагрузка %d SU, блоков %d; живых %d; %s",
                    r.pos().toShortString(), Math.round(r.unloadedCapacity()), Math.round(r.unloadedStress()),
                    r.unloadedMembers(), r.members(),
                    r.cleaned() ? "фантом убран" : (r.fullyLoaded() ? "загружена" : "часть сети не загружена — не трогаем"));
            c.getSource().sendSuccess(() -> Component.literal(line), false);
        }
        String sum = String.format("Сетей проверено: %d, фантом убран: %d, загружены не целиком: %d%s",
                results.size(), cleaned, partial, force ? " (вклады блоков пересчитаны)" : "");
        c.getSource().sendSuccess(() -> Component.literal(sum), true);
        return results.size();
    }
}
