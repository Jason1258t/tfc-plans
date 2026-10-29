package ie.extras.devtest;

import com.mojang.brigadier.CommandDispatcher;
import blusunrize.immersiveengineering.api.IEProperties;
import blusunrize.immersiveengineering.common.blocks.metal.FurnaceHeaterBlockEntity;
import com.george_vi.electroenergetics.content.resistive_heater.ResistiveHeaterBlockEntity;
import com.mojang.brigadier.arguments.FloatArgumentType;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.simibubi.create.content.processing.basin.BasinBlockEntity;
import net.chauvedev.woodencog.blockEntities.BasinBlockEntityExtended;
import net.dries007.tfc.common.component.heat.HeatCapability;
import net.dries007.tfc.common.component.heat.IHeat;
import net.minecraft.world.level.block.Block;
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
 *   /ietest basin none|ie|ie_rs|analog|ee <тепло 0–1> — чаша Create с медным слитком и источник тепла: ничего; внешний
 *       нагреватель IE сбоку (с бесконечным питанием; ie_rs — с блоком красного камня у нагревателя); аналоговый
 *       нагреватель под чашей на сигнале 15; нагреватель EE под чашей с заданным теплом (поле heat)
 *   /ietest basinreport — температура чаши по WoodenCog (её же показывают очки инженера; сам текст подсказки — клиентский), уровень нагрева Create, температура слитка, запас нагревателя IE
 */
@Mod("ie_extras_devtest")
public class IeTest {
    static final BlockPos HEATER = new BlockPos(0, -60, 0);
    static final BlockPos CRUCIBLE = HEATER.above();
    static final BlockPos SIGNAL = HEATER.east();
    static final BlockPos CHEST = SIGNAL.east();
    static boolean power;
    static final BlockPos BASIN = new BlockPos(0, -60, 6);
    static final BlockPos BASIN_SIDE = BASIN.east();
    static final BlockPos BASIN_BELOW = BASIN.below();

    public IeTest() {
        NeoForge.EVENT_BUS.addListener(IeTest::commands);
        NeoForge.EVENT_BUS.addListener((LevelTickEvent.Pre e) -> {
            if (power && e.getLevel() instanceof ServerLevel level && level.dimension() == ServerLevel.OVERWORLD
                    && level.getBlockEntity(HEATER) instanceof AnalogHeaterBlockEntity be) be.energy.setStored(Integer.MAX_VALUE);
            if (e.getLevel() instanceof ServerLevel level && level.dimension() == ServerLevel.OVERWORLD) {
                if (level.getBlockEntity(BASIN_SIDE) instanceof FurnaceHeaterBlockEntity ie) ie.energyStorage.receiveEnergy(256, false);
                if (level.getBlockEntity(BASIN_BELOW) instanceof AnalogHeaterBlockEntity be) be.energy.setStored(Integer.MAX_VALUE);
                if (eeHeat >= 0 && level.getBlockEntity(BASIN_BELOW) instanceof ResistiveHeaterBlockEntity ee) ee.heat = eeHeat;
            }
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
                .then(Commands.literal("report").executes(c -> report(c.getSource())))
                .then(Commands.literal("basin")
                        .then(Commands.literal("none").executes(c -> basin(c.getSource(), "none", 0)))
                        .then(Commands.literal("ie").executes(c -> basin(c.getSource(), "ie", 0)))
                        .then(Commands.literal("ie_rs").executes(c -> basin(c.getSource(), "ie_rs", 0)))
                        .then(Commands.literal("analog").executes(c -> basin(c.getSource(), "analog", 0)))
                        .then(Commands.literal("ee").then(Commands.argument("heat", FloatArgumentType.floatArg(0, 1))
                                .executes(c -> basin(c.getSource(), "ee", FloatArgumentType.getFloat(c, "heat"))))))
                .then(Commands.literal("basinreport").executes(c -> basinReport(c.getSource()))));
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

    static float eeHeat = -1;

    static int basin(CommandSourceStack src, String mode, float heat) {
        ServerLevel level = src.getLevel();
        eeHeat = -1;
        for (BlockPos p : new BlockPos[] {BASIN, BASIN_SIDE, BASIN_BELOW, BASIN_SIDE.east(), BASIN_BELOW.east()})
            level.setBlockAndUpdate(p, Blocks.AIR.defaultBlockState());
        level.setBlockAndUpdate(BASIN_BELOW, Blocks.STONE.defaultBlockState());
        level.setBlockAndUpdate(BASIN, block("create:basin").defaultBlockState());
        switch (mode) {
            case "ie", "ie_rs" -> {
                level.setBlockAndUpdate(BASIN_SIDE, block("immersiveengineering:furnace_heater").defaultBlockState()
                        .setValue(IEProperties.FACING_ALL, Direction.WEST));
                if (mode.equals("ie_rs")) level.setBlockAndUpdate(BASIN_SIDE.east(), Blocks.REDSTONE_BLOCK.defaultBlockState());
            }
            case "analog" -> {
                level.setBlockAndUpdate(BASIN_BELOW, IeExtras.ANALOG_HEATER.get().defaultBlockState().setValue(AnalogHeaterBlock.FACING, Direction.UP));
                level.setBlockAndUpdate(BASIN_BELOW.east(), Blocks.REDSTONE_BLOCK.defaultBlockState());
            }
            case "ee" -> {
                level.setBlockAndUpdate(BASIN_BELOW, block("electroenergetics:resistive_heater").defaultBlockState());
                eeHeat = heat;
            }
            default -> {}
        }
        IItemHandler items = level.getCapability(Capabilities.ItemHandler.BLOCK, BASIN, null);
        ItemStack left = items == null ? ItemStack.EMPTY : items.insertItem(0, new ItemStack(BuiltInRegistries.ITEM.get(ResourceLocation.parse("tfc:metal/ingot/copper"))), false);
        src.sendSuccess(() -> Component.literal("чаша " + BASIN.toShortString() + ", источник: " + mode + (left.isEmpty() ? ", слиток в чаше" : ", слиток НЕ лёг")), false);
        return 1;
    }

    /** BasinBlockEntity.getHeatLevel() — пакетный, вызываем через отражение (то, что видит BasinRecipe) */
    static String heatLevel(BasinBlockEntity basin) {
        try {
            var m = BasinBlockEntity.class.getDeclaredMethod("getHeatLevel");
            m.setAccessible(true);
            return String.valueOf(m.invoke(basin));
        } catch (ReflectiveOperationException e) {
            return "? " + e;
        }
    }

    static Block block(String id) {
        return BuiltInRegistries.BLOCK.get(ResourceLocation.parse(id));
    }

    static int basinReport(CommandSourceStack src) {
        ServerLevel level = src.getLevel();
        StringBuilder sb = new StringBuilder();
        if (level.getBlockEntity(BASIN) instanceof BasinBlockEntity basin) {
            float t = ((BasinBlockEntityExtended) basin).getHeatSourceTemperature();
            sb.append(String.format("чаша: %.0f °C по WoodenCog, нагрев Create %s", t, heatLevel(basin)));
            ItemStack ingot = basin.getInputInventory().getStackInSlot(0);
            IHeat heat = HeatCapability.get(ingot);
            sb.append(String.format(", слиток %s %s", ingot, heat == null ? "без тепла" : String.format("%.0f °C", heat.getTemperature())));
        } else sb.append("чаши нет");
        BlockState below = level.getBlockState(BASIN_BELOW);
        sb.append("\n  под чашей: ").append(BuiltInRegistries.BLOCK.getKey(below.getBlock()));
        if (level.getBlockEntity(BASIN_BELOW) instanceof ResistiveHeaterBlockEntity ee)
            sb.append(String.format(" heat %.2f, HEAT_LEVEL %s", ee.heat, BasinBlockEntity.getHeatLevelOf(below)));
        if (level.getBlockEntity(BASIN_BELOW) instanceof AnalogHeaterBlockEntity a) sb.append(String.format(" %.0f °C", a.temperature()));
        if (level.getBlockEntity(BASIN_SIDE) instanceof FurnaceHeaterBlockEntity ie)
            sb.append(String.format("\n  нагреватель IE: запас %d FE, активен %s", ie.energyStorage.getEnergyStored(), ie.getIsActive()));
        String text = sb.toString();
        src.sendSuccess(() -> Component.literal(text), false);
        return 1;
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
