package builder.tools.devtest;

import builder.tools.*;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.Difficulty;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.LevelSettings;
import net.minecraft.world.level.WorldDataConfiguration;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.levelgen.WorldOptions;
import net.minecraft.world.level.levelgen.presets.WorldPresets;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.InputEvent;
import net.neoforged.neoforge.client.event.ScreenEvent;
import net.neoforged.neoforge.common.NeoForge;
import top.theillusivec4.curios.api.CuriosApi;

/** Автоматическая проверка настоящего клиентского обмена и порядка сетевых пакетов. */
@EventBusSubscriber(modid = "builder_tools_devtest", value = Dist.CLIENT)
public final class ClientTest {
    private static boolean started;
    private static int tick, fails;
    private static final BlockPos TARGET = new BlockPos(1, -59, 0);
    private static void check(String name, boolean ok) {
        if (!ok) fails++;
        System.out.println("BTCLIENT " + (ok ? "OK " : "FAIL ") + name);
    }
    @SubscribeEvent
    public static void screen(ScreenEvent.Init.Post e) {
        if (started || !(e.getScreen() instanceof TitleScreen)) return;
        started = true;
        Minecraft mc = Minecraft.getInstance(); mc.options.pauseOnLostFocus = false;
        var settings = new LevelSettings("buildertest", GameType.SURVIVAL, false, Difficulty.PEACEFUL, true,
                new GameRules(), WorldDataConfiguration.DEFAULT);
        mc.createWorldOpenFlows().createFreshLevel("buildertest", settings, new WorldOptions(1, false, false),
                reg -> reg.registryOrThrow(Registries.WORLD_PRESET).getHolderOrThrow(WorldPresets.FLAT).value().createWorldDimensions(), e.getScreen());
    }
    @SubscribeEvent
    public static void tick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.getSingleplayerServer() == null) return;
        tick++;
        try {
            if (tick == 40) mc.getSingleplayerServer().execute(() -> {
                var p = mc.getSingleplayerServer().getPlayerList().getPlayer(mc.player.getUUID());
                p.teleportTo(0.5, -59, 0.5); p.getInventory().clearContent(); p.getInventory().selected = 0;
                p.getInventory().setItem(0, new ItemStack(Items.COBBLESTONE, new ItemStack(Items.COBBLESTONE).getMaxStackSize()));
                p.getInventory().setItem(12, new ItemStack(Items.IRON_PICKAXE));
                CuriosApi.getCuriosInventory(p).flatMap(h -> h.getStacksHandler("belt")).orElseThrow().getStacks()
                        .setStackInSlot(0, new ItemStack(BuilderTools.BELT.get()));
                p.serverLevel().setBlockAndUpdate(TARGET, Blocks.STONE.defaultBlockState());
                p.inventoryMenu.broadcastChanges();
            });
            if (tick == 100) {
                check("пояс синхронизирован на клиент", BeltAccess.active(mc.player));
                mc.hitResult = new BlockHitResult(Vec3.atCenterOf(TARGET), Direction.WEST, TARGET, false);
                NeoForge.EVENT_BUS.post(new InputEvent.InteractionKeyMappingTriggered(1, mc.options.keyUse, InteractionHand.MAIN_HAND));
                check("ПКМ не меняет инструмент", mc.player.getMainHandItem().is(Items.COBBLESTONE));
                NeoForge.EVENT_BUS.post(new InputEvent.InteractionKeyMappingTriggered(0, mc.options.keyAttack, InteractionHand.MAIN_HAND));
                check("ЛКМ переставил кирку из слота 12", mc.player.getMainHandItem().is(Items.IRON_PICKAXE));
                check("блоки сохранены в исходном слоте кирки", mc.player.getInventory().getItem(12).getCount() == new ItemStack(Items.COBBLESTONE).getMaxStackSize());
                mc.gameMode.startDestroyBlock(TARGET, Direction.WEST);
            }
            if (tick == 130) mc.getSingleplayerServer().execute(() -> {
                var p = mc.getSingleplayerServer().getPlayerList().getPlayer(mc.player.getUUID());
                check("сервер получил кирку через обычный обмен", p.getMainHandItem().is(Items.IRON_PICKAXE));
                check("сервер сохранил всю стопку блоков", p.getInventory().getItem(12).getCount() == new ItemStack(Items.COBBLESTONE).getMaxStackSize());
            });
            if (tick == 150) {
                net.minecraft.client.Screenshot.grab(mc.gameDirectory, "buildertest.png", mc.getMainRenderTarget(), c -> {});
                System.out.println("BTCLIENT ИТОГ: ошибок " + fails); mc.stop();
            }
        } catch (Throwable t) { check("исключение: " + t, false); t.printStackTrace(); mc.stop(); }
    }
}
