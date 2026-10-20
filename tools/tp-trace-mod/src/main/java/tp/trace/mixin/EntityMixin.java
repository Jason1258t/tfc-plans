package tp.trace.mixin;

import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import tp.trace.TpTrace;

/** Любая смена позиции игрока идёт через setPosRaw: скачок больше 4 блоков — в лог со стеком (сервер и игра) */
@Mixin(Entity.class)
public abstract class EntityMixin {
    @Inject(method = "setPosRaw", at = @At("HEAD"))
    private void tpTrace$jump(double x, double y, double z, CallbackInfo ci) {
        if (!((Object) this instanceof Player player) || player.level() == null) return;
        Vec3 old = player.position();
        if (old.x == 0 && old.y == 0 && old.z == 0) return;
        double dx = x - old.x, dy = y - old.y, dz = z - old.z;
        if (dx * dx + dy * dy + dz * dz <= 16) return;
        TpTrace.trace(String.format("скачок %s (%s, %s): %s → %s", player.getGameProfile().getName(),
                player.level().isClientSide ? "игра" : "сервер", player.level().dimension().location(),
                TpTrace.pos(old.x, old.y, old.z), TpTrace.pos(x, y, z)), true);
    }
}
