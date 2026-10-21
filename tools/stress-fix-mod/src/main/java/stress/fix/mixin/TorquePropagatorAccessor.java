package stress.fix.mixin;

import com.simibubi.create.content.kinetics.KineticNetwork;
import com.simibubi.create.content.kinetics.TorquePropagator;
import java.util.Map;
import net.minecraft.world.level.LevelAccessor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Все сети вращения по мирам (поле пакетное, статическое). */
@Mixin(value = TorquePropagator.class, remap = false)
public interface TorquePropagatorAccessor {
    @Accessor("networks")
    static Map<LevelAccessor, Map<Long, KineticNetwork>> stressFix$getNetworks() {
        throw new AssertionError();
    }
}
