package miner.tools.helmet.client;

import com.mojang.blaze3d.platform.InputConstants;
import miner.tools.MinerTools;
import miner.tools.helmet.Helmet;
import miner.tools.helmet.ToggleLampPayload;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.item.ItemProperties;
import net.minecraft.util.Mth;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterItemDecorationsEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import net.neoforged.neoforge.client.settings.KeyConflictContext;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.network.PacketDistributor;
import org.lwjgl.glfw.GLFW;

/** Клиент каски: клавиша фонаря, иконка с горящим фонарём, полоска заряда */
@EventBusSubscriber(modid = MinerTools.MOD_ID, value = Dist.CLIENT)
public final class HelmetClient {
    private HelmetClient() {}

    static final KeyMapping TOGGLE = new KeyMapping("key.miner_tools.helmet_lamp", KeyConflictContext.IN_GAME,
            InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_H, "key.categories.miner_tools");

    @SubscribeEvent
    static void keys(RegisterKeyMappingsEvent event) {
        event.register(TOGGLE);
        NeoForge.EVENT_BUS.addListener(HelmetClient::clientTick);
    }

    static void clientTick(ClientTickEvent.Post event) {
        while (TOGGLE.consumeClick()) {
            if (Minecraft.getInstance().player != null) PacketDistributor.sendToServer(ToggleLampPayload.INSTANCE);
        }
    }

    @SubscribeEvent
    static void setup(FMLClientSetupEvent event) {
        event.enqueueWork(() -> ItemProperties.register(Helmet.HELMET.get(), Helmet.id("lit"),
                (stack, level, entity, seed) -> Helmet.lit(stack) ? 1 : 0));
    }

    /**
     * Полоска заряда — над полоской прочности (у брони своя полоска прочности, одной на двоих не хватает). Цвет — как
     * у полоски предметов IE: от красного к зелёному.
     */
    @SubscribeEvent
    static void decorations(RegisterItemDecorationsEvent event) {
        event.register(Helmet.HELMET.get(), (graphics, font, stack, x, y) -> {
            float part = Mth.clamp(Helmet.energy(stack) / (float) Helmet.CAPACITY, 0, 1);
            int width = Math.round(part * 13);
            graphics.fill(net.minecraft.client.renderer.RenderType.guiOverlay(), x + 2, y + 11, x + 15, y + 13,
                    0xFF000000);
            graphics.fill(net.minecraft.client.renderer.RenderType.guiOverlay(), x + 2, y + 11, x + 2 + width,
                    y + 12, 0xFF000000 | Mth.hsvToRgb(part / 3.0F, 1.0F, 1.0F));
            return false;
        });
    }
}
