package builder.tools.devtest;

import builder.tools.*;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.context.UseOnContext;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.common.util.FakePlayer;
import net.neoforged.neoforge.common.util.FakePlayerFactory;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import net.neoforged.neoforge.event.tick.PlayerTickEvent;
import top.theillusivec4.curios.api.CuriosApi;

/** Проверки с настоящими предметами, Curios и размещением через NeoForge. В выпускной jar не попадают. */
@Mod("builder_tools_devtest")
public final class DevTest {
    private static int failures;
    public DevTest() { NeoForge.EVENT_BUS.addListener(DevTest::commands); }
    private static void commands(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("buildertest")
            .executes(ctx -> run(ctx.getSource().getLevel(), false, ctx.getSource()))
            .then(Commands.literal("fault").executes(ctx -> run(ctx.getSource().getLevel(), true, ctx.getSource()))));
    }
    private static final List<String> OUT = new ArrayList<>();
    private static void check(String name, boolean ok) {
        OUT.add((ok ? "OK " : "FAIL ") + name);
        if (!ok) failures++;
    }
    private static int run(ServerLevel level, boolean fault, net.minecraft.commands.CommandSourceStack source) {
        OUT.clear(); failures = 0;
        try { test(level); if (fault) check("намеренная ошибка проверки", false); }
        catch (Throwable t) { check("исключение: " + t, false); t.printStackTrace(); }
        OUT.add("ИТОГ: " + (OUT.size() - failures) + " успешно, ошибок " + failures);
        for (String line : OUT) source.sendSuccess(() -> Component.literal(line), false);
        return failures == 0 ? 1 : 0;
    }
    private static void test(ServerLevel level) {
        FakePlayer p = FakePlayerFactory.getMinecraft(level);
        p.setGameMode(GameType.SURVIVAL);
        p.setPos(0.5, -59, 0.5);
        var inv = p.getInventory(); inv.clearContent(); inv.selected = 0;
        var beltSlot = CuriosApi.getCuriosInventory(p).flatMap(h -> h.getStacksHandler("belt")).orElseThrow().getStacks();
        beltSlot.setStackInSlot(0, ItemStack.EMPTY);
        inv.setItem(10, new ItemStack(BuilderTools.BELT.get()));
        check("пояс в инвентаре не работает", !BeltAccess.active(p));
        ItemStack belt = inv.removeItemNoUpdate(10); beltSlot.setStackInSlot(0, belt);
        check("надетый пояс работает", BeltAccess.active(p));
        check("пояс принимается слотом Curios", CuriosApi.getItemStackSlots(belt, p).containsKey("belt"));
        belt.set(BuilderTools.ENABLED.get(), false);
        check("выключенный пояс не работает", !BeltAccess.active(p));
        belt.set(BuilderTools.ENABLED.get(), true);
        inv.setItem(12, new ItemStack(Items.IRON_PICKAXE)); inv.setItem(13, new ItemStack(Items.IRON_SHOVEL));
        inv.setItem(14, new ItemStack(Items.IRON_AXE)); inv.setItem(0, new ItemStack(Items.COBBLESTONE, 64));
        check("камень: кирка из основного инвентаря", ToolSelection.find(p, Blocks.STONE.defaultBlockState()) == 12);
        check("земля: лопата", ToolSelection.find(p, Blocks.DIRT.defaultBlockState()) == 13);
        check("бревно: топор", ToolSelection.find(p, Blocks.OAK_LOG.defaultBlockState()) == 14);
        check("воздух: без замены", ToolSelection.find(p, Blocks.AIR.defaultBlockState()) == -1);
        inv.setItem(0, new ItemStack(Items.DIAMOND_PICKAXE));
        check("лучшая кирка уже в руке", ToolSelection.find(p, Blocks.STONE.defaultBlockState()) == -1);
        inv.setItem(0, new ItemStack(Items.WOODEN_PICKAXE)); inv.setItem(15, new ItemStack(Items.DIAMOND_PICKAXE));
        check("обсидиан: требуется алмазная кирка", ToolSelection.find(p, Blocks.OBSIDIAN.defaultBlockState()) == 15);
        inv.getItem(15).setDamageValue(inv.getItem(15).getMaxDamage()-1);
        check("инструмент на последней прочности пропущен", ToolSelection.find(p, Blocks.OBSIDIAN.defaultBlockState()) != 15);
        int fullCount = new ItemStack(Items.COBBLESTONE).getMaxStackSize();
        inv.clearContent(); inv.setItem(0, new ItemStack(Items.COBBLESTONE, fullCount));
        for (int i = 1; i < 36; i++) inv.setItem(i, new ItemStack(Items.DIRT, new ItemStack(Items.DIRT).getMaxStackSize()));
        inv.setItem(12, new ItemStack(Items.IRON_PICKAXE));
        p.inventoryMenu.clicked(ToolSelection.menuSlot(p, 12), 0, ClickType.SWAP, p);
        check("полный инвентарь: инструмент в активном слоте", inv.getItem(0).is(Items.IRON_PICKAXE));
        check("полный инвентарь: прежние блоки сохранены", inv.getItem(12).is(Items.COBBLESTONE) && inv.getItem(12).getCount() == fullCount);
        inv.clearContent(); inv.setItem(10, new ItemStack(Items.COBBLESTONE, 23));
        check("пополнение основной руки", Refill.replenish(p, InteractionHand.MAIN_HAND, new ItemStack(Items.COBBLESTONE)));
        check("количество сохранено", p.getMainHandItem().getCount() == 23 && inv.getItem(10).isEmpty());
        inv.setItem(11, new ItemStack(Items.COBBLESTONE, 9));
        check("занятая рука не заменяется", !Refill.replenish(p, InteractionHand.MAIN_HAND, new ItemStack(Items.COBBLESTONE)));
        check("пополнение второй руки", Refill.replenish(p, InteractionHand.OFF_HAND, new ItemStack(Items.COBBLESTONE)) && p.getOffhandItem().getCount() == 9);
        inv.clearContent(); ItemStack named = new ItemStack(Items.COBBLESTONE, 7);
        named.set(DataComponents.CUSTOM_NAME, Component.literal("Образец")); inv.setItem(11, named);
        check("другие компоненты не смешиваются", !Refill.replenish(p, InteractionHand.MAIN_HAND, new ItemStack(Items.COBBLESTONE)));
        inv.clearContent(); inv.setItem(0, new ItemStack(Items.COBBLESTONE)); inv.setItem(10, new ItemStack(Items.COBBLESTONE, 17));
        BlockPos base = new BlockPos(1, -60, 0); level.setBlockAndUpdate(base, Blocks.STONE.defaultBlockState()); level.setBlockAndUpdate(base.above(), Blocks.AIR.defaultBlockState());
        NeoForge.EVENT_BUS.post(new PlayerInteractEvent.RightClickBlock(p, InteractionHand.MAIN_HAND, base, new BlockHitResult(Vec3.atCenterOf(base), Direction.UP, base, false)));
        p.getMainHandItem().useOn(new UseOnContext(p, InteractionHand.MAIN_HAND, new BlockHitResult(Vec3.atCenterOf(base), Direction.UP, base, false)));
        NeoForge.EVENT_BUS.post(new PlayerTickEvent.Post(p));
        check("реальное размещение: блок в мире", level.getBlockState(base.above()).is(Blocks.COBBLESTONE));
        check("реальное размещение: последний блок пополнен", p.getMainHandItem().getCount() == 17 && inv.getItem(10).isEmpty());
        inv.setItem(0, new ItemStack(Items.COBBLESTONE)); inv.setItem(10, new ItemStack(Items.COBBLESTONE, 5));
        NeoForge.EVENT_BUS.post(new PlayerInteractEvent.RightClickBlock(p, InteractionHand.MAIN_HAND, base, new BlockHitResult(Vec3.atCenterOf(base), Direction.UP, base, false)));
        NeoForge.EVENT_BUS.post(new PlayerTickEvent.Post(p));
        check("нерасходованный блок не пополняется", inv.getItem(10).getCount() == 5 && p.getMainHandItem().getCount() == 1);
        inv.setItem(0, ItemStack.EMPTY); belt.set(BuilderTools.ENABLED.get(), false);
        check("выключенный пояс: пополнения нет", !Refill.replenish(p, InteractionHand.MAIN_HAND, new ItemStack(Items.COBBLESTONE)));
        check("выключенный пояс: выбора нет", ToolSelection.find(p, Blocks.STONE.defaultBlockState()) == -1);
        belt.set(BuilderTools.ENABLED.get(), true);
        if (net.neoforged.fml.ModList.get().isLoaded("tfc")) {
            var registry = net.minecraft.core.registries.BuiltInRegistries.ITEM;
            var copper = registry.get(net.minecraft.resources.ResourceLocation.parse("tfc:metal/pickaxe/copper"));
            var shovel = registry.get(net.minecraft.resources.ResourceLocation.parse("tfc:metal/shovel/copper"));
            inv.clearContent(); inv.setItem(12, new ItemStack(copper)); inv.setItem(13, new ItemStack(shovel));
            check("TFC: медная кирка для камня", ToolSelection.find(p, Blocks.STONE.defaultBlockState()) == 12);
            check("TFC: медная лопата для земли", ToolSelection.find(p, Blocks.DIRT.defaultBlockState()) == 13);
            check("TFC: рецепт пояса загружен", level.getRecipeManager().byKey(net.minecraft.resources.ResourceLocation.parse("builder_tools:builder_belt")).isPresent());
        }
        beltSlot.setStackInSlot(0, ItemStack.EMPTY); inv.clearContent(); level.removeBlock(base.above(), false);
    }
}
