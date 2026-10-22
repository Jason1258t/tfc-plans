package ee.extras.mixin;

import com.george_vi.electroenergetics.foundation.QuadraticWireHelper;
import com.george_vi.electroenergetics.foundation.WirePoints;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Настоящая причина «веера» у гирлянды подвесных изоляторов EE 1.1.2. {@code wirePointsRaw} (точки провода без
 * растяжки последнего отрезка — так рисуются гирлянды) пишет в переданный буфер, не очистив его, — в отличие от
 * {@code wirePoints}, который зовёт {@code clear()}. Отрисовка провода ({@code WireVisual}) держит один буфер на провод
 * и пересчитывает его при каждом движении конца и обновлении света: старые точки остаются, и Flywheel рисует все
 * прошлые положения качающейся гирлянды (в замере игрока — 971 отрезок вместо десятка). При перезаходе буфер новый.
 * Вызывает метод только {@code WireVisual.recreateInstances} (по байткоду).
 */
@Mixin(value = QuadraticWireHelper.class, remap = false)
public abstract class WirePointsRawMixin {
    @Inject(method = "wirePointsRaw(Lnet/minecraft/world/phys/Vec3;Lnet/minecraft/world/phys/Vec3;FFLcom/george_vi/electroenergetics/foundation/WirePoints;)Lcom/george_vi/electroenergetics/foundation/WirePoints;",
            at = @At("HEAD"))
    private static void eeExtras$clear(Vec3 pos1, Vec3 pos2, float dip, float detail, WirePoints points,
            CallbackInfoReturnable<WirePoints> cir) {
        if (points != null) points.clear();
    }
}
