package host.tools.mixin;

import host.tools.LanHost;
import javax.annotation.Nullable;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.client.server.LanServerPinger;
import net.minecraft.world.level.GameType;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;

/** Обратное к publishServer: те же поля, что сбрасывают stopServer/halt, плюс порт −1 (isPublished = false). */
@Mixin(IntegratedServer.class)
public abstract class IntegratedServerMixin implements LanHost {
    @Shadow private int publishedPort;
    @Shadow @Nullable private GameType publishedGameType;
    @Shadow private LanServerPinger lanPinger;

    @Override
    public void hosttools$unpublish() {
        if (lanPinger != null) {
            lanPinger.interrupt();
            lanPinger = null;
        }
        publishedPort = -1;
        publishedGameType = null;
    }
}
