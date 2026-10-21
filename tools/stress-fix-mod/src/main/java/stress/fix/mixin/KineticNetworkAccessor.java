package stress.fix.mixin;

import com.simibubi.create.content.kinetics.KineticNetwork;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Учёт незагруженной части сети: Create берёт его из сохранения блока и вычитает блоки по мере загрузки. */
@Mixin(value = KineticNetwork.class, remap = false)
public interface KineticNetworkAccessor {
    @Accessor("unloadedCapacity")
    float stressFix$getUnloadedCapacity();

    @Accessor("unloadedCapacity")
    void stressFix$setUnloadedCapacity(float value);

    @Accessor("unloadedStress")
    float stressFix$getUnloadedStress();

    @Accessor("unloadedStress")
    void stressFix$setUnloadedStress(float value);

    @Accessor("unloadedMembers")
    int stressFix$getUnloadedMembers();

    @Accessor("unloadedMembers")
    void stressFix$setUnloadedMembers(int value);
}
