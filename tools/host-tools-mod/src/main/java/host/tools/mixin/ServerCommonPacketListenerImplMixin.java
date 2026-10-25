package host.tools.mixin;

import host.tools.PingProbe;
import net.minecraft.network.protocol.common.ServerboundPongPacket;
import net.minecraft.server.network.ServerCommonPacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Ответ клиента на наш ping (ClientboundPingPacket → ServerboundPongPacket, ванильный клиент отвечает сам). В
 * Minecraft handlePong пустой и вызывается в потоке сети — время ответа без ожидания тика сервера. Поле latency —
 * то, что сервер рассылает для таба и отдаёт latency().
 */
@Mixin(ServerCommonPacketListenerImpl.class)
public abstract class ServerCommonPacketListenerImplMixin implements PingProbe.LatencyHolder {
    @Shadow private int latency;

    @Inject(method = "handlePong", at = @At("HEAD"))
    private void hosttools$onPong(ServerboundPongPacket packet, CallbackInfo ci) {
        PingProbe.onPong(this, packet.getId());
    }

    @Override
    public int hosttools$latency() {
        return latency;
    }

    @Override
    public void hosttools$setLatency(int value) {
        latency = value;
    }
}
