package miner.tools.devtest;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.serialization.JsonOps;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import miner.tools.helmet.Helmet;
import miner.tools.helmet.HelmetEvents;
import net.minecraft.advancements.critereon.ItemPredicate;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.RegistryOps;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.item.FallingBlockEntity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.npc.Villager;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.common.util.FakePlayer;
import net.neoforged.neoforge.common.util.FakePlayerFactory;
import net.neoforged.neoforge.energy.IEnergyStorage;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.tick.PlayerTickEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.items.IItemHandler;
import top.theillusivec4.curios.api.CuriosApi;

/**
 * Проверка каски (test-server.sh helmet): /helmettest — заряд через способность FE, фонарь (расход, свет, выключатель,
 * слот Curios «голова»), описание света LambDynamicLights (тем же ItemPredicate Minecraft), снятая и выпавшая каска,
 * урон от падающего блока жителям в разных шлемах. /helmettest charge + chargereport — зарядная станция IE (нужен IE в
 * run/mods); /helmettest anvil + anvilreport — настоящие наковальни на жителей. Каждая проверка печатает OK/FAIL.
 */
@EventBusSubscriber(modid = "miner_tools_devtest")
public final class HelmetTest {
    private HelmetTest() {}

    static final BlockPos STATION = new BlockPos(4, -60, 4);
    static int pumpTicks;
    static final List<Villager> ANVIL_TARGETS = new ArrayList<>();

    @SubscribeEvent
    static void commands(RegisterCommandsEvent event) {
        CommandDispatcher<CommandSourceStack> d = event.getDispatcher();
        d.register(Commands.literal("helmettest")
                .executes(ctx -> report(ctx.getSource(), HelmetTest::run))
                .then(Commands.literal("charge").executes(ctx -> report(ctx.getSource(), HelmetTest::charge)))
                .then(Commands.literal("chargereport").executes(ctx -> report(ctx.getSource(), HelmetTest::chargeReport)))
                .then(Commands.literal("anvil").executes(ctx -> report(ctx.getSource(), HelmetTest::anvil)))
                .then(Commands.literal("anvilreport").executes(ctx -> report(ctx.getSource(), HelmetTest::anvilReport))));
    }

    interface Test {
        void run(ServerLevel level, List<String> out) throws Exception;
    }

    static int report(CommandSourceStack src, Test test) {
        List<String> out = new ArrayList<>();
        try {
            test.run(src.getLevel(), out);
        } catch (Throwable t) {
            out.add("FAIL исключение: " + t);
            t.printStackTrace();
        }
        for (String line : out) src.sendSuccess(() -> Component.literal(line), false);
        return 1;
    }

    static void check(List<String> out, String name, boolean ok) {
        out.add((ok ? "OK   " : "FAIL ") + name);
    }

    static ItemStack helmet(int energy, boolean on) {
        ItemStack s = new ItemStack(Helmet.HELMET.get());
        if (energy > 0) s.set(Helmet.ENERGY.get(), energy);
        if (on) s.set(Helmet.LAMP_ON.get(), true);
        return s;
    }

    /** Тики игрока через тот же обработчик, что подписан на PlayerTickEvent */
    static void ticks(FakePlayer p, int n) {
        for (int i = 0; i < n; i++) {
            p.tickCount++;
            NeoForgeBus.post(new PlayerTickEvent.Post(p));
        }
    }

    static void run(ServerLevel level, List<String> out) throws Exception {
        // 1. Аккумулятор: способность FE, как у предметов IE
        ItemStack s = helmet(0, false);
        IEnergyStorage e = s.getCapability(Capabilities.EnergyStorage.ITEM);
        check(out, "способность EnergyStorage.ITEM есть (её ищет зарядная станция IE)", e != null);
        check(out, "ёмкость " + e.getMaxEnergyStored(), e.getMaxEnergyStored() == Helmet.CAPACITY);
        int got = e.receiveEnergy(5000, false);
        check(out, "принято 1000 из 5000 за раз (" + got + "), заряд " + Helmet.energy(s), got == 1000 && Helmet.energy(s) == 1000);
        check(out, "отдать заряд нельзя", e.extractEnergy(500, false) == 0 && Helmet.energy(s) == 1000);

        // 2. Фонарь на игроке-заглушке (FakePlayer): расход и свет
        FakePlayer p = FakePlayerFactory.getMinecraft(level);
        p.getInventory().clearContent();
        p.setItemSlot(EquipmentSlot.HEAD, helmet(10_000, true));
        ItemStack worn = p.getItemBySlot(EquipmentSlot.HEAD);
        p.tickCount = 1;
        ticks(p, 1);
        check(out, "надета, включена, заряд есть → светит", Helmet.lit(worn));
        ticks(p, 39);
        int cost = Helmet.LAMP_COST.get();
        check(out, "40 тиков: расход " + (10_000 - Helmet.energy(worn)) + " FE (ожидается " + 40 * cost + ")",
                10_000 - Helmet.energy(worn) == 40 * cost);
        HelmetEvents.toggle(p, worn);
        check(out, "выключатель: выключен → не светит", !Helmet.lampOn(worn) && !Helmet.lit(worn));
        int before = Helmet.energy(worn);
        ticks(p, 40);
        check(out, "выключенный не тратит", Helmet.energy(worn) == before);
        HelmetEvents.toggle(p, worn);
        ticks(p, 1);
        check(out, "выключатель: снова включён → светит", Helmet.lit(worn));
        worn.set(Helmet.ENERGY.get(), 30);
        ticks(p, 40);
        check(out, "разрядился (" + Helmet.energy(worn) + " FE) → не светит, хотя включён",
                Helmet.energy(worn) == 0 && !Helmet.lit(worn) && Helmet.lampOn(worn));

        // 3. Снятая каска гаснет: в инвентаре (inventoryTick), выпавшая
        ItemStack loose = helmet(10_000, true);
        loose.set(Helmet.LIT.get(), true);
        p.getInventory().setItem(5, loose);
        loose.inventoryTick(level, p, 5, false);
        check(out, "в инвентаре (не на голове) → не светит", !Helmet.lit(loose));
        ItemStack head = helmet(10_000, true);
        head.set(Helmet.LIT.get(), true);
        p.setItemSlot(EquipmentSlot.HEAD, head);
        head.inventoryTick(level, p, 3, false);
        check(out, "на голове inventoryTick свет не трогает", Helmet.lit(head));
        ItemStack drop = head.copy();
        ItemEntity ie = new ItemEntity(level, 0.5, -59, 0.5, drop);
        level.addFreshEntity(ie);
        check(out, "выпавшая на землю → не светит", !Helmet.lit(ie.getItem()));
        ie.discard();
        p.setItemSlot(EquipmentSlot.HEAD, ItemStack.EMPTY);

        // 4. Слот Curios «голова» (в сборке его даёт Create; здесь — data проверочного мода)
        var curios = CuriosApi.getCuriosInventory(p).orElseThrow();
        var headSlot = curios.getStacksHandler("head").orElse(null);
        check(out, "у игрока есть слот Curios «head»", headSlot != null);
        if (headSlot != null) {
            check(out, "Curios: каска подходит в «head» (тег curios:head)",
                    CuriosApi.isStackValid(slotContext(p), helmet(0, false)));
            headSlot.getStacks().setStackInSlot(0, helmet(10_000, true));
            ItemStack c = HelmetEvents.worn(p);
            check(out, "Curios: каска в слоте найдена", !c.isEmpty());
            ticks(p, 20);
            check(out, "Curios: светит и тратит (" + Helmet.energy(c) + " FE)",
                    Helmet.lit(c) && Helmet.energy(c) < 10_000);
            headSlot.getStacks().setStackInSlot(0, ItemStack.EMPTY);
        }

        // 5. Описание света LambDynamicLights: тот же ItemPredicate Minecraft, что читает мод
        // Файл в jar аддона (модуль miner_tools), не проверочного мода
        try (var in = Helmet.class.getResourceAsStream("/assets/miner_tools/dynamiclights/item/miner_helmet.json")) {
            JsonObject json = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
            ItemPredicate pred = ItemPredicate.CODEC.parse(RegistryOps.create(JsonOps.INSTANCE, level.registryAccess()),
                    json.get("match")).getOrThrow();
            ItemStack lit = helmet(100, true);
            lit.set(Helmet.LIT.get(), true);
            check(out, "LambDynamicLights: горящая каска подходит под match", pred.test(lit));
            check(out, "LambDynamicLights: включённая, но не горящая — нет", !pred.test(helmet(100, true)));
            check(out, "luminance " + json.get("luminance"), json.get("luminance").getAsInt() > 0);
        }

        // 6. Урон: жители без шлема, в железном шлеме и в каске (броня та же: 2)
        DamageSource falling = level.damageSources().fallingBlock(null);
        DamageSource anvil = level.damageSources().anvil(null);
        DamageSource fall = level.damageSources().fall();
        for (DamageSource src : List.of(falling, anvil, fall)) {
            float bare = hurt(level, ItemStack.EMPTY, src, 10);
            float iron = hurt(level, new ItemStack(Items.IRON_HELMET), src, 10);
            float miner = hurt(level, helmet(0, false), src, 10);
            String name = src.getMsgId() + ": без шлема " + fmt(bare) + ", железный " + fmt(iron) + ", каска " + fmt(miner);
            if (src == fall) check(out, name + " (падение — не смягчает)", Math.abs(iron - miner) < 0.01);
            else check(out, name + " (каска ≈ половина железного)",
                    Math.abs(miner / iron - (1 - Helmet.CUSHION.get())) < 0.03);
        }
    }

    static top.theillusivec4.curios.api.SlotContext slotContext(FakePlayer p) {
        return new top.theillusivec4.curios.api.SlotContext("head", p, 0, false, true);
    }

    static String fmt(float f) {
        return String.format("%.2f", f);
    }

    /** Сколько здоровья снимет удар жителю в этом шлеме */
    static float hurt(ServerLevel level, ItemStack head, DamageSource src, float amount) {
        Villager v = EntityType.VILLAGER.create(level);
        v.setNoAi(true);
        v.moveTo(8.5, -60, 8.5);
        v.getAttribute(net.minecraft.world.entity.ai.attributes.Attributes.MAX_HEALTH).setBaseValue(100);
        v.setHealth(100);
        v.setItemSlot(EquipmentSlot.HEAD, head.copy());
        level.addFreshEntity(v);
        v.hurt(src, amount);
        float lost = 100 - v.getHealth();
        v.discard();
        return lost;
    }

    // Зарядная станция IE: ставим, кладём пустую каску, 6 секунд подаём FE в станцию, читаем заряд

    static void charge(ServerLevel level, List<String> out) {
        var block = BuiltInRegistries.BLOCK.get(ResourceLocation.fromNamespaceAndPath("immersiveengineering",
                "charging_station"));
        check(out, "зарядная станция IE есть", block != Blocks.AIR);
        level.setBlockAndUpdate(STATION, block.defaultBlockState());
        IItemHandler items = level.getCapability(Capabilities.ItemHandler.BLOCK, STATION, null);
        check(out, "у станции есть вход предметов", items != null);
        ItemStack rest = items.insertItem(0, helmet(0, false), false);
        check(out, "каска принята станцией (isStackValid IE = есть способность FE)", rest.isEmpty());
        pumpTicks = 120;
    }

    @SubscribeEvent
    static void serverTick(ServerTickEvent.Post event) {
        if (pumpTicks <= 0) return;
        pumpTicks--;
        ServerLevel level = event.getServer().overworld();
        IEnergyStorage e = level.getCapability(Capabilities.EnergyStorage.BLOCK, STATION, null);
        if (e != null) e.receiveEnergy(100_000, false);
    }

    static void chargeReport(ServerLevel level, List<String> out) {
        IItemHandler items = level.getCapability(Capabilities.ItemHandler.BLOCK, STATION, null);
        ItemStack s = items == null ? ItemStack.EMPTY : items.getStackInSlot(0);
        BlockEntity be = level.getBlockEntity(STATION);
        if (s.isEmpty() && be != null) {
            // Вход станции может не отдавать содержимое — читаем сохранение блока
            out.add("  станция: " + be.saveWithoutMetadata(level.registryAccess()));
        }
        check(out, "станция IE зарядила каску: " + Helmet.energy(s) + " / " + Helmet.CAPACITY + " FE",
                Helmet.energy(s) > 0);
    }

    // Настоящие наковальни на двух жителей: в железном шлеме и в каске

    static void anvil(ServerLevel level, List<String> out) {
        ANVIL_TARGETS.clear();
        ItemStack[] heads = {new ItemStack(Items.IRON_HELMET), helmet(0, false)};
        for (int i = 0; i < heads.length; i++) {
            BlockPos at = new BlockPos(9 + 4 * i, -60, 12);
            Villager v = EntityType.VILLAGER.create(level);
            v.setNoAi(true);
            v.moveTo(at.getX() + 0.5, at.getY(), at.getZ() + 0.5);
            v.getAttribute(net.minecraft.world.entity.ai.attributes.Attributes.MAX_HEALTH).setBaseValue(100);
            v.setHealth(100);
            v.setItemSlot(EquipmentSlot.HEAD, heads[i]);
            level.addFreshEntity(v);
            ANVIL_TARGETS.add(v);
            BlockPos top = at.above(8);
            level.setBlockAndUpdate(top, Blocks.ANVIL.defaultBlockState());
            // Урон включает AnvilBlock.falling при обычном падении; fall() сам его не включает — как у наковальни
            FallingBlockEntity.fall(level, top, Blocks.ANVIL.defaultBlockState()).setHurtsEntities(2.0F, 40);
        }
        out.add("наковальни падают");
    }

    static void anvilReport(ServerLevel level, List<String> out) {
        if (ANVIL_TARGETS.size() < 2) {
            out.add("FAIL сначала /helmettest anvil");
            return;
        }
        float iron = 100 - ANVIL_TARGETS.get(0).getHealth();
        float miner = 100 - ANVIL_TARGETS.get(1).getHealth();
        check(out, "наковальня: железный шлем −" + fmt(iron) + ", каска −" + fmt(miner), iron > 0 && miner > 0
                && Math.abs(miner / iron - (1 - Helmet.CUSHION.get())) < 0.05);
        for (Villager v : ANVIL_TARGETS) v.discard();
    }

    /** Шина событий NeoForge — отдельно, чтобы не путать с полем модов */
    static final class NeoForgeBus {
        static void post(net.neoforged.bus.api.Event e) {
            net.neoforged.neoforge.common.NeoForge.EVENT_BUS.post(e);
        }
    }
}
