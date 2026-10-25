package host.tools.mixin;

import io.netty.channel.ChannelFuture;
import java.util.List;
import net.minecraft.server.network.ServerConnectionListener;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Открытые порты сервера: в мире хоста — канал в памяти (сам хост) и, после «Открыть для сети», TCP-порт. */
@Mixin(ServerConnectionListener.class)
public interface ServerConnectionListenerAccessor {
    @Accessor("channels")
    List<ChannelFuture> hosttools$channels();
}
