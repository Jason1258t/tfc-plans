package ie.extras.devtest;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import ie.extras.AnalogHeaterBlock;
import ie.extras.AnalogHeaterBlockEntity;
import ie.extras.IeExtras;
import net.dries007.tfc.common.blockentities.CrucibleBlockEntity;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.ComparatorBlock;
import net.minecraft.world.level.block.entity.ChestBlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.ComparatorMode;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.tick.LevelTickEvent;
import net.neoforged.neoforge.fluids.FluidStack;
import net.neoforged.neoforge.items.IItemHandler;

/**
 * Проверка IE Extras на сервере разработки:
 *   /ietest setup <сигнал> — аналоговый нагреватель решёткой вверх, над ним тигель TFC с медным слитком (плавится при
 *       1080 °C), сбоку — сигнал: компаратор от сундука с камнем (1–14) или блок красного камня (15); питание включено
 *   /ietest signal <0–15> — поменять сигнал
 *   /ietest power on|off — бесконечное питание (запас заполняется каждый тик) или без пополнения
 *   /ietest drain — обнулить запас (вместе с power off — проверка «нет энергии»)
 *   /ietest caps — с каких граней нагреватель принимает FE (кроме решётки) и сколько берёт за раз
 *   /ietest report — сигнал, температура нагревателя и тигля, запас, свечение, выход компаратора, металл в тигле
 */
@Mod("ie_extras_devtest")
public class IeTest {
    static final BlockPos HEATER = new BlockPos(0, -60, 0);
    static final BlockPos CRUCIBLE = HEATER.above();
    static final BlockPos SIGNAL = HEATER.east();
    static final BlockPos CHEST = SIGNAL.east();
    static boolean power;

    public IeTest() {
        NeoForge.EVENT_BUS.addListener(IeTest::commands);
        NeoForge.EVENT_BUS.addListener((LevelTickEvent.Pre e) -> {
            if (power && e.getLevel() instanceof ServerLevel level && level.dimension() == ServerLevel.OVERWORLD
                    && level.getBlockEntity(HEATER) instanceof AnalogHeaterBlockEntity be) be.energy.setStored(Integer.MAX_VALUE);
        });
    }

    static void commands(RegisterCommandsEvent e) {
        CommandDispatcher<CommandSourceStack> d = e.getDispatcher();
        d.register(Commands.literal("ietest")
                .then(Commands.literal("setup").then(Commands.argument("signal", IntegerArgumentType.integer(0, 15))
                        .executes(c -> setup(c.getSource(), IntegerArgumentType.getInteger(c, "signal")))))
                .then(Commands.literal("signal").then(Commands.argument("signal", IntegerArgumentType.integer(0, 15))
                        .executes(c -> signal(c.getSource(), IntegerArgumentType.getInteger(c, "signal")))))
                .then(Commands.literal("power")
                        .then(Commands.literal("on").executes(c -> power(c.getSource(), true)))
                        .then(Commands.literal("off").executes(c -> power(c.getSource(), false))))
                .then(Commands.literal("drain").executes(c -> drain(c.getSource())))
                .then(Commands.literal("caps").executes(c -> caps(c.getSource())))
                .then(Commands.literal("report").executes(c -> report(c.getSource()))));
    }

    static int setup(CommandSourceStack src, int signal) {
        ServerLevel level = src.getLevel();
        level.setBlockAndUpdate(HEATER, IeExtras.ANALOG_HEATER.get().defaultBlockState().setValue(AnalogHeaterBlock.FACING, Direction.UP));
        level.setBlockAndUpdate(CRUCIBLE, BuiltInRegistries.BLOCK.get(ResourceLocation.parse("tfc:crucible")).defaultBlockState());
        IItemHandler items = level.getCapability(Capabilities.ItemHandler.BLOCK, CRUCIBLE, null);
        ItemStack ingot = new ItemStack(BuiltInRegistries.ITEM.get(ResourceLocation.parse("tfc:metal/ingot/copper")));
        ItemStack left = items == null ? ingot : items.insertItem(0, ingot, false);
        power = true;
        signal(src, signal);
        src.sendSuccess(() -> Component.literal("нагреватель " + HEATER.toShortString() + ", тигель " + CRUCIBLE.toShortString()
                + (left.isEmpty() ? ", медный слиток в тигле" : ", слиток НЕ лёг в тигель")), false);
        return 1;
    }

    static int signal(CommandSourceStack src, int signal) {
        ServerLevel level = src.getLevel();
        level.setBlockAndUpdate(CHEST, Blocks.AIR.defaultBlockState());
        if (signal == 0) {
            level.setBlockAndUpdate(SIGNAL, Blocks.AIR.defaultBlockState());
        } else if (signal == 15) {
            level.setBlockAndUpdate(SIGNAL, Blocks.REDSTONE_BLOCK.defaultBlockState());
        } else {
            // Компаратор отдаёт сигнал в сторону, противоположную FACING, и читает блок по FACING (DiodeBlock)
            // Сначала компаратор, потом сундук: свой выход компаратор пересчитывает только при изменении соседа
            BlockState comp = Blocks.COMPARATOR.defaultBlockState()
                    .setValue(ComparatorBlock.FACING, Direction.EAST)
                    .setValue(ComparatorBlock.MODE, ComparatorMode.COMPARE);
            level.setBlockAndUpdate(SIGNAL, comp);
            level.setBlockAndUpdate(CHEST, Blocks.CHEST.defaultBlockState());
            if (level.getBlockEntity(CHEST) instanceof ChestBlockEntity chest) {
                fillFor(chest, signal);
                chest.setChanged();
            }
        }
        src.sendSuccess(() -> Component.literal("сигнал " + signal + " (у нагревателя сейчас " + level.getBestNeighborSignal(HEATER) + ")"), false);
        return 1;
    }

    /** Сундук на 27 ячеек: сигнал компаратора = floor(заполненность × 14) + 1 (если не пуст) — подбираем число предметов
     *  (в TFC булыжник стакается по 32 — берём размер стака у самого предмета) */
    static void fillFor(ChestBlockEntity chest, int signal) {
        int slots = chest.getContainerSize();
        int stack = new ItemStack(Items.COBBLESTONE).getMaxStackSize();
        for (int items = 1; items <= slots * stack; items++) {
            if ((int) Math.floor(items / (float) stack / slots * 14f) + 1 == signal) {
                for (int i = 0; items > 0; i++) {
                    int n = Math.min(stack, items);
                    chest.setItem(i, new ItemStack(Items.COBBLESTONE, n));
                    items -= n;
                }
                return;
            }
        }
    }

    static int caps(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        StringBuilder sb = new StringBuilder("приём FE по граням:");
        for (Direction d : Direction.values()) {
            var cap = level.getCapability(Capabilities.EnergyStorage.BLOCK, HEATER, d);
            sb.append(' ').append(d.getName()).append('=').append(cap == null ? "нет" : cap.receiveEnergy(5000, true) + "/" + cap.canExtract());
        }
        String text = sb.toString();
        src.sendSuccess(() -> Component.literal(text), false);
        return 1;
    }

    static int power(CommandSourceStack src, boolean on) {
        power = on;
        src.sendSuccess(() -> Component.literal("питание " + (on ? "бесконечное" : "без пополнения")), false);
        return 1;
    }

    static int drain(CommandSourceStack src) {
        if (src.getLevel().getBlockEntity(HEATER) instanceof AnalogHeaterBlockEntity be) {
            be.energy.setStored(0);
        }
        return report(src);
    }

    /** Закрытое поле тигля — для отладки остывания */
    static String field(Object o, String name) {
        try {
            var f = o.getClass().getDeclaredField(name);
            f.setAccessible(true);
            return String.valueOf(f.get(o));
        } catch (ReflectiveOperationException e) {
            return "?";
        }
    }

    static int report(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        StringBuilder sb = new StringBuilder();
        if (level.getBlockEntity(HEATER) instanceof AnalogHeaterBlockEntity be) {
            BlockState s = level.getBlockState(HEATER);
            sb.append(String.format("нагреватель: сигнал %d, %.0f °C, запас %d FE, свечение %s, компаратор %d (блок %d)",
                    be.signal(), be.temperature(), be.energyStored(), s.getValue(AnalogHeaterBlock.LIT),
                    be.comparatorLevel(), s.getAnalogOutputSignal(level, HEATER)));
            sb.append("\n  в чат игроку: ").append(be.status().getString());
        } else sb.append("нагревателя нет");
        if (level.getBlockEntity(CRUCIBLE) instanceof CrucibleBlockEntity c) {
            FluidStack metal = c.getAlloyResult();
            IItemHandler items = level.getCapability(Capabilities.ItemHandler.BLOCK, CRUCIBLE, null);
            String slot = items == null ? "?" : items.getStackInSlot(0).toString();
            sb.append(String.format("\nтигель: %.0f °C (цель тигля %s), металл %s %d мБ, ячейка 0: %s", c.getTemperature(), field(c, "targetTemperature"),
                    metal.isEmpty() ? "—" : BuiltInRegistries.FLUID.getKey(metal.getFluid()), metal.getAmount(), slot));
        }
        String text = sb.toString();
        src.sendSuccess(() -> Component.literal(text), false);
        return 1;
    }
}
