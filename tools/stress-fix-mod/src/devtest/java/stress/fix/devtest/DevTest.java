package stress.fix.devtest;

import com.mojang.brigadier.arguments.FloatArgumentType;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.simibubi.create.content.kinetics.KineticNetwork;
import com.simibubi.create.content.kinetics.base.KineticBlockEntity;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.coordinates.BlockPosArgument;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import stress.fix.PhantomCleaner;
import stress.fix.mixin.KineticNetworkAccessor;

/**
 * /sftest report x y z — учёт сети блока: итог (как видят блоки), живые блоки, незагруженная часть.
 * /sftest phantom x y z <мощность> <нагрузка> <блоков> — добавить в учёт незагруженной части (как остаток после
 * перезахода) и сразу пересчитать сеть.
 */
@Mod("stress_fix_devtest")
public final class DevTest {
    public DevTest() {
        NeoForge.EVENT_BUS.addListener(DevTest::register);
    }

    private static void register(RegisterCommandsEvent e) {
        e.getDispatcher().register(Commands.literal("sftest").requires(s -> s.hasPermission(2))
                .then(Commands.literal("report").then(Commands.argument("pos", BlockPosArgument.blockPos())
                        .executes(c -> report(c))))
                .then(Commands.literal("phantom").then(Commands.argument("pos", BlockPosArgument.blockPos())
                        .then(Commands.argument("capacity", FloatArgumentType.floatArg())
                                .then(Commands.argument("stress", FloatArgumentType.floatArg())
                                        .then(Commands.argument("members", IntegerArgumentType.integer(0))
                                                .executes(c -> phantom(c))))))));
    }

    private static KineticBlockEntity be(CommandContext<CommandSourceStack> c) {
        BlockPos pos = BlockPosArgument.getBlockPos(c, "pos");
        return c.getSource().getLevel().getBlockEntity(pos) instanceof KineticBlockEntity k ? k : null;
    }

    private static int report(CommandContext<CommandSourceStack> c) {
        KineticBlockEntity k = be(c);
        if (k == null || !k.hasNetwork()) {
            say(c, "sftest: нет блока Create с сетью");
            return 0;
        }
        KineticNetwork n = k.getOrCreateNetwork();
        KineticNetworkAccessor a = (KineticNetworkAccessor) n;
        say(c, String.format("sftest: скорость %.1f, перегружена %s; сеть: мощность %.0f, нагрузка %.0f; живых %d, источников %d; незагр.: мощн %.0f, нагр %.0f, блоков %d",
                k.getSpeed(), k.isOverStressed(), n.calculateCapacity(), n.calculateStress(), n.members.size(),
                n.sources.size(), a.stressFix$getUnloadedCapacity(), a.stressFix$getUnloadedStress(),
                a.stressFix$getUnloadedMembers()));
        long removed = n.members.keySet().stream().filter(m -> m.isRemoved()).count();
        long unloaded = n.members.keySet().stream().filter(m -> !c.getSource().getLevel().isLoaded(m.getBlockPos())).count();
        say(c, "sftest: initialized " + n.initialized + "; из живых удалено " + removed + ", в незагруженных чанках " + unloaded + "; мешает: "
                + PhantomCleaner.blocker(c.getSource().getLevel(), n));
        return 1;
    }

    private static int phantom(CommandContext<CommandSourceStack> c) {
        KineticBlockEntity k = be(c);
        if (k == null || !k.hasNetwork()) {
            say(c, "sftest: нет блока Create с сетью");
            return 0;
        }
        KineticNetwork n = k.getOrCreateNetwork();
        KineticNetworkAccessor a = (KineticNetworkAccessor) n;
        a.stressFix$setUnloadedCapacity(a.stressFix$getUnloadedCapacity() + FloatArgumentType.getFloat(c, "capacity"));
        a.stressFix$setUnloadedStress(a.stressFix$getUnloadedStress() + FloatArgumentType.getFloat(c, "stress"));
        a.stressFix$setUnloadedMembers(a.stressFix$getUnloadedMembers() + IntegerArgumentType.getInteger(c, "members"));
        n.updateNetwork();
        // чтобы чанки сохранились с новым итогом сети (как после долгой игры)
        for (KineticBlockEntity m : n.members.keySet()) m.setChanged();
        return report(c);
    }

    private static void say(CommandContext<CommandSourceStack> c, String s) {
        c.getSource().sendSuccess(() -> Component.literal(s), false);
    }
}
