package tp.trace.mixin;

import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.game.ClientboundPlayerPositionPacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import tp.trace.TpTrace;

/** Только в игре (секция client конфига): игра получила телепорт от сервера (до перехода в поток игры — пропускаем) */
@Mixin(ClientPacketListener.class)
public abstract class ClientPacketListenerMixin {
    @Inject(method = "handleMovePlayer", at = @At("HEAD"))
    private void tpTrace$position(ClientboundPlayerPositionPacket packet, CallbackInfo ci) {
        if (!"Render thread".equals(Thread.currentThread().getName())) return;
        TpTrace.trace(String.format("игра получила телепорт #%d → %s%s", packet.getId(),
                TpTrace.pos(packet.getX(), packet.getY(), packet.getZ()),
                packet.getRelativeArguments().isEmpty() ? "" : " относительно " + packet.getRelativeArguments()), false);
    }
}
