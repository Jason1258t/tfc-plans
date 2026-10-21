package ee.extras.mixin;

import com.george_vi.electroenergetics.client.WireVisual;
import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import dev.engine_room.flywheel.api.instance.Instance;
import dev.engine_room.flywheel.api.instance.Instancer;
import dev.engine_room.flywheel.api.visual.DynamicVisual;
import dev.engine_room.flywheel.lib.instance.TransformedInstance;
import ee.extras.WireVisualFixed;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Set;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;

/**
 * Веер «застывших» копий у качающейся гирлянды подвесных изоляторов EE 1.1.2 (Flywheel). Отрисовку провода
 * ({@code recreateInstances}) зовут и {@code beginFrame}, и {@code updateLight}, а Flywheel выполняет кадр и обновление
 * света параллельно (NestedPlan, разные потоки). Оба потока дописывают отрезки в один ArrayList, и созданный отрезок
 * теряется из списка: его больше никто не двигает и не удаляет. Когда провод на кадр пропал (узел ещё не пришёл)
 * и строится заново, так теряется целая гирлянда.
 * <ul>
 * <li>к проводу — по одному потоку (обёрнуты входы {@code beginFrame}, {@code updateLight}, {@code delete}:
 * у них в сигнатуре нет клиентских классов, поэтому применение миксина видно и на сервере разработки);</li>
 * <li>все созданные проводом отрезки запоминаются; те, что выпали из его списков, удаляются (уборка — только когда
 * созданных больше, чем живых, обычно это одно сравнение).</li>
 * </ul>
 * Применилось ли — пишет в лог клиента {@link ee.extras.WireFixCheck}.
 */
@Mixin(value = WireVisual.class, remap = false)
public abstract class WireVisualMixin implements WireVisualFixed {
    @Shadow @Final private List<TransformedInstance> instances;
    @Shadow private TransformedInstance startInstance;
    @Shadow private TransformedInstance endInstance;

    @Unique private final List<Instance> eeExtras$created = new ArrayList<>();

    @WrapOperation(method = {"recreateInstances", "createWire"}, at = @At(value = "INVOKE",
            target = "Ldev/engine_room/flywheel/api/instance/Instancer;createInstance()Ldev/engine_room/flywheel/api/instance/Instance;"))
    private Instance eeExtras$track(Instancer<?> instancer, Operation<Instance> original) {
        Instance instance = original.call(instancer);
        eeExtras$created.add(instance);
        return instance;
    }

    @WrapMethod(method = "beginFrame")
    private void eeExtras$frame(DynamicVisual.Context ctx, Operation<Void> original) {
        synchronized (this) {
            original.call(ctx);
            eeExtras$sweep();
        }
    }

    @WrapMethod(method = "updateLight")
    private void eeExtras$light(float partialTick, Operation<Void> original) {
        synchronized (this) {
            original.call(partialTick);
            eeExtras$sweep();
        }
    }

    @WrapMethod(method = "delete")
    private void eeExtras$delete(Operation<Void> original) {
        synchronized (this) {
            original.call();
            for (Instance instance : eeExtras$created) instance.delete();
            eeExtras$created.clear();
        }
    }

    /** Удаляет отрезки, которых нет ни в списке провода, ни среди концевых изоляторов (повторное delete безвредно) */
    @Unique
    private void eeExtras$sweep() {
        if (eeExtras$created.size() <= instances.size() + 2) return;
        Set<Instance> live = Collections.newSetFromMap(new IdentityHashMap<>());
        live.addAll(instances);
        if (startInstance != null) live.add(startInstance);
        if (endInstance != null) live.add(endInstance);
        eeExtras$created.removeIf(instance -> {
            if (live.contains(instance)) return false;
            instance.delete();
            return true;
        });
    }
}
