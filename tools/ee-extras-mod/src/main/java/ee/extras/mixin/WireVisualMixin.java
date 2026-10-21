package ee.extras.mixin;

import com.george_vi.electroenergetics.client.WireVisual;
import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import net.minecraft.client.multiplayer.ClientLevel;
import org.spongepowered.asm.mixin.Mixin;

/**
 * Гонка в отрисовке проводов EE 1.1.2 (Flywheel): {@code recreateInstances} зовут и {@code beginFrame}, и
 * {@code updateLight}, а Flywheel выполняет кадр и обновление света параллельно (NestedPlan, разные потоки). Оба потока
 * дописывают отрезки в один ArrayList, и созданный отрезок теряется из списка: его больше никто не двигает и не
 * удаляет. У качающейся гирлянды подвесных изоляторов так копятся «застывшие» копии — веер до перезахода.
 * Лечение — по одному потоку на провод.
 */
@Mixin(value = WireVisual.class, remap = false)
public abstract class WireVisualMixin {
    @WrapMethod(method = "recreateInstances")
    private void eeExtras$serialize(ClientLevel level, float partialTick, boolean light, Operation<Void> original) {
        synchronized (this) {
            original.call(level, partialTick, light);
        }
    }

    @WrapMethod(method = "delete")
    private void eeExtras$serializeDelete(Operation<Void> original) {
        synchronized (this) {
            original.call();
        }
    }
}
