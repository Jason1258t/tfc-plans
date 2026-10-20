package tp.trace.mixin;

import java.util.Set;
import net.minecraft.network.protocol.game.ServerboundAcceptTeleportationPacket;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.entity.RelativeMovement;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import tp.trace.TpTrace;

/**
 * Телепорт, который сервер отправляет игре (номер, куда, кто вызвал), и подтверждение от игры: совпал ли номер.
 * Пока подтверждения нет, сервер не принимает движение и раз в секунду повторяет телепорт.
 */
@Mixin(ServerGamePacketListenerImpl.class)
public abstract class ServerGamePacketListenerImplMixin {
    @Shadow
    public ServerPlayer player;
    @Shadow
    private Vec3 awaitingPositionFromClient;
    @Shadow
    private int awaitingTeleport;

    @Inject(method = "teleport(DDDFFLjava/util/Set;)V", at = @At("HEAD"))
    private void tpTrace$teleport(double x, double y, double z, float yRot, float xRot, Set<RelativeMovement> relative,
            CallbackInfo ci) {
        TpTrace.trace(String.format("сервер шлёт телепорт #%d %s (%s): → %s%s", awaitingTeleport + 1,
                player.getGameProfile().getName(), player.level().dimension().location(), TpTrace.pos(x, y, z),
                relative.isEmpty() ? "" : " относительно " + relative), true);
    }

    @Inject(method = "handleAcceptTeleportPacket", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/PacketUtils;ensureRunningOnSameThread(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/PacketListener;Lnet/minecraft/server/level/ServerLevel;)V",
            shift = At.Shift.AFTER))
    private void tpTrace$accept(ServerboundAcceptTeleportationPacket packet, CallbackInfo ci) {
        TpTrace.trace(String.format("игра подтвердила телепорт #%d %s; сервер ждёт #%d, позиция %s", packet.getId(),
                player.getGameProfile().getName(), awaitingTeleport,
                awaitingPositionFromClient == null ? "—" : TpTrace.pos(awaitingPositionFromClient.x,
                        awaitingPositionFromClient.y, awaitingPositionFromClient.z)), false);
    }
}
