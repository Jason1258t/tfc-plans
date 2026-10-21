package miner.tools.devtest;

import com.mojang.brigadier.CommandDispatcher;
import java.util.ArrayList;
import java.util.List;
import miner.tools.BeltFilter;
import miner.tools.BeltMenu;
import miner.tools.MinerTools;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.ItemContainerContents;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.common.util.FakePlayer;
import net.neoforged.neoforge.common.util.FakePlayerFactory;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.entity.player.ItemEntityPickupEvent;
import net.neoforged.neoforge.registries.DeferredRegister;
import top.theillusivec4.curios.api.CuriosApi;

/**
 * Проверка пояса (test-server.sh): /belttest — подбор игроком-заглушкой (FakePlayer) с поясом в инвентаре и в слоте
 * Curios, окно фильтра, правило «все породы». Свои предметы с id как у TFC (rock/loose/…, dirt/…, ore/…) — чтобы
 * проверить правило без TFC. Каждая проверка печатает OK/FAIL.
 */
@Mod("miner_tools_devtest")
public class DevTest {
    static final DeferredRegister.Items ITEMS = DeferredRegister.createItems("miner_tools_devtest");
    static final String[] FAKE = {"rock/loose/granite", "rock/loose/basalt", "rock/gravel/granite", "rock/gravel/basalt",
        "dirt/loam", "dirt/silt", "ore/poor_hematite", "ore/rich_hematite", "metal/ingot/copper", "metal/ingot/gold"};

    static {
        for (String id : FAKE) ITEMS.registerSimpleItem(id);
    }

    /** Что видел обработчик с обычным приоритетом (как у Sophisticated Backpacks): была ли задержка подбора */
    static Boolean seenDelay;

    public DevTest(IEventBus modBus) {
        ITEMS.register(modBus);
        NeoForge.EVENT_BUS.addListener(DevTest::commands);
        NeoForge.EVENT_BUS.addListener((ItemEntityPickupEvent.Pre e) -> seenDelay = e.getItemEntity().hasPickUpDelay());
    }

    static Item fake(String id) {
        return BuiltInRegistries.ITEM.get(ResourceLocation.fromNamespaceAndPath("miner_tools_devtest", id));
    }

    static void commands(RegisterCommandsEvent event) {
        CommandDispatcher<CommandSourceStack> d = event.getDispatcher();
        d.register(Commands.literal("belttest").executes(ctx -> {
            List<String> out = new ArrayList<>();
            try {
                run(ctx.getSource().getLevel(), out);
            } catch (Throwable t) {
                out.add("FAIL исключение: " + t);
                t.printStackTrace();
            }
            for (String line : out) ctx.getSource().sendSuccess(() -> Component.literal(line), false);
            return 1;
        }));
    }

    static int fails;

    static void check(List<String> out, String name, boolean ok) {
        if (!ok) fails++;
        out.add((ok ? "OK   " : "FAIL ") + name);
    }

    static ItemStack belt(boolean any, ItemStack... samples) {
        ItemStack b = new ItemStack(MinerTools.BELT.get());
        b.set(MinerTools.FILTER.get(), ItemContainerContents.fromItems(List.of(samples)));
        b.set(MinerTools.ANY_VARIANT.get(), any);
        return b;
    }

    /** Бросить предмет на игрока и дать ему коснуться; вернуть, сколько осталось лежать */
    static int touch(ServerLevel level, FakePlayer p, ItemStack drop) {
        ItemEntity e = new ItemEntity(level, p.getX(), p.getY(), p.getZ(), drop.copy());
        e.setNoPickUpDelay();
        level.addFreshEntity(e);
        seenDelay = null;
        e.playerTouch(p);
        int left = e.isRemoved() ? 0 : e.getItem().getCount();
        if (!e.isRemoved()) {
            if (e.hasPickUpDelay()) left = -1000; // задержка не вернулась
            e.discard();
        }
        return left;
    }

    static void run(ServerLevel level, List<String> out) {
        fails = 0;
        FakePlayer p = FakePlayerFactory.getMinecraft(level);
        p.setPos(0.5, -60, 0.5);
        p.getInventory().clearContent();

        // 1. Правило «все породы»
        check(out, "камешек гранита ~ камешек базальта (все породы)",
                BeltFilter.matches(new ItemStack(fake("rock/loose/granite")), new ItemStack(fake("rock/loose/basalt")), true));
        check(out, "камешек гранита ≠ камешек базальта (точно)",
                !BeltFilter.matches(new ItemStack(fake("rock/loose/granite")), new ItemStack(fake("rock/loose/basalt")), false));
        check(out, "гравий гранита ~ гравий базальта",
                BeltFilter.matches(new ItemStack(fake("rock/gravel/granite")), new ItemStack(fake("rock/gravel/basalt")), true));
        check(out, "почва ~ почва", BeltFilter.matches(new ItemStack(fake("dirt/loam")), new ItemStack(fake("dirt/silt")), true));
        check(out, "камешек ≠ гравий",
                !BeltFilter.matches(new ItemStack(fake("rock/loose/granite")), new ItemStack(fake("rock/gravel/granite")), true));
        check(out, "бедная руда ≠ богатая руда (руды не склеиваются)",
                !BeltFilter.matches(new ItemStack(fake("ore/poor_hematite")), new ItemStack(fake("ore/rich_hematite")), true));
        check(out, "медный слиток ≠ золотой", !BeltFilter.matches(new ItemStack(fake("metal/ingot/copper")),
                new ItemStack(fake("metal/ingot/gold")), true));
        check(out, "гравий TFC-образца ~ ванильный гравий (тег c:gravels)",
                BeltFilter.matches(new ItemStack(Items.GRAVEL), new ItemStack(Items.GRAVEL), true));

        // 2. Подбор: пояс в инвентаре
        p.getInventory().setItem(10, belt(true, new ItemStack(fake("rock/loose/granite")), new ItemStack(Items.DIRT)));
        check(out, "пояс в инвентаре: камешек базальта не подобран", touch(level, p, new ItemStack(fake("rock/loose/basalt"), 5)) == 5);
        check(out, "обработчик NORMAL видел задержку подбора (рюкзаки пропустят)", Boolean.TRUE.equals(seenDelay));
        check(out, "пояс в инвентаре: земля не подобрана", touch(level, p, new ItemStack(Items.DIRT, 3)) == 3);
        check(out, "пояс в инвентаре: булыжник подобран", touch(level, p, new ItemStack(Items.COBBLESTONE, 4)) == 0
                && p.getInventory().countItem(Items.COBBLESTONE) == 4);
        check(out, "обработчик NORMAL без задержки для разрешённого", Boolean.FALSE.equals(seenDelay));
        p.getInventory().getItem(10).set(MinerTools.ENABLED.get(), false);
        check(out, "выключенный пояс: камешек подобран", touch(level, p, new ItemStack(fake("rock/loose/basalt"), 2)) == 0);
        p.getInventory().clearContent();

        // 3. Подбор: пояс в слоте Curios «belt»
        var curios = CuriosApi.getCuriosInventory(p);
        check(out, "у игрока есть инвентарь Curios", curios.isPresent());
        var handler = curios.flatMap(h -> h.getStacksHandler("belt"));
        check(out, "у игрока есть слот Curios belt", handler.isPresent());
        if (handler.isPresent()) {
            handler.get().getStacks().setStackInSlot(0, belt(false, new ItemStack(Items.GRAVEL)));
            check(out, "пояс в Curios: гравий не подобран", touch(level, p, new ItemStack(Items.GRAVEL, 7)) == 7);
            check(out, "пояс в Curios: песок подобран", touch(level, p, new ItemStack(Items.SAND, 1)) == 0);
            check(out, "Curios: пояс годится в слот belt", CuriosApi.getItemStackSlots(new ItemStack(MinerTools.BELT.get()), p)
                    .containsKey("belt"));
            handler.get().getStacks().setStackInSlot(0, ItemStack.EMPTY);
        }
        p.getInventory().clearContent();

        // 4. Окно фильтра
        p.getInventory().selected = 0;
        p.getInventory().setItem(0, belt(true));
        p.getInventory().setItem(5, new ItemStack(Items.DIRT, 12));
        BeltMenu menu = new BeltMenu(1, p.getInventory(), InteractionHand.MAIN_HAND);
        menu.setCarried(new ItemStack(Items.GRAVEL, 30));
        menu.clicked(0, 0, ClickType.PICKUP, p);
        ItemStack held = p.getInventory().getItem(0);
        check(out, "клик гравием по ячейке: образец сохранён на поясе",
                BeltFilter.samples(held).size() == 1 && BeltFilter.samples(held).get(0).is(Items.GRAVEL)
                        && BeltFilter.samples(held).get(0).getCount() == 1);
        check(out, "гравий в руке-курсоре не потрачен", menu.getCarried().getCount() == 30);
        menu.setCarried(ItemStack.EMPTY);
        // Shift+клик по земле в инвентаре (ячейка 5 хотбара = слот меню 9+27+5)
        menu.quickMoveStack(p, 9 + 27 + 5);
        check(out, "Shift+клик землёй: образец во второй ячейке, земля осталась у игрока",
                BeltFilter.samples(held).size() == 2 && p.getInventory().getItem(5).getCount() == 12);
        menu.quickMoveStack(p, 9 + 27 + 5);
        check(out, "повторный Shift+клик не дублирует образец", BeltFilter.samples(held).size() == 2);
        menu.clicked(0, 0, ClickType.PICKUP, p);
        check(out, "клик пустой рукой убирает образец", BeltFilter.samples(held).size() == 1
                && BeltFilter.samples(held).get(0).is(Items.DIRT));
        menu.clickMenuButton(p, BeltMenu.BUTTON_ANY);
        check(out, "кнопка «все породы» переключает", !BeltFilter.anyVariant(held) && !menu.anyVariant());
        menu.clickMenuButton(p, BeltMenu.BUTTON_ENABLED);
        check(out, "кнопка «работает» переключает", !BeltFilter.enabled(held) && !menu.enabled());
        // пояс в руке не переложить: клик по его ячейке и обмен цифрой
        menu.clicked(9 + 27, 0, ClickType.PICKUP, p);
        check(out, "ячейку с поясом нельзя взять", p.getInventory().getItem(0).is(MinerTools.BELT.get())
                && menu.getCarried().isEmpty());
        menu.clicked(9, 0, ClickType.SWAP, p);
        check(out, "обмен цифрой с ячейкой пояса запрещён", p.getInventory().getItem(0).is(MinerTools.BELT.get()));
        check(out, "окно открыто, пока пояс в руке", menu.stillValid(p));
        menu.setCarried(new ItemStack(MinerTools.BELT.get()));
        menu.clicked(1, 0, ClickType.PICKUP, p);
        check(out, "сам пояс в образцы не кладётся", BeltFilter.samples(held).size() == 1);
        menu.setCarried(ItemStack.EMPTY);
        p.getInventory().clearContent();
        check(out, "окно закрывается, если пояса в руке нет", !menu.stillValid(p));

        out.add(fails == 0 ? "ИТОГ: всё OK" : "ИТОГ: ошибок " + fails);
    }
}
