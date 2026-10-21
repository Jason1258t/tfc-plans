package miner.tools.client;

import miner.tools.MinerTools;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RegisterMenuScreensEvent;

@EventBusSubscriber(modid = MinerTools.MOD_ID, value = Dist.CLIENT)
public final class ClientSetup {
    private ClientSetup() {}

    @SubscribeEvent
    static void screens(RegisterMenuScreensEvent event) {
        event.register(MinerTools.MENU.get(), BeltScreen::new);
    }
}
