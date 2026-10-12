package ee.overheat.mixin;

import com.simibubi.create.content.processing.burner.BlazeBurnerBlock.HeatLevel;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Резистивный нагреватель Electro Energetics никогда не поднимается выше KINDLED, поэтому рецепты Create
 * с условием superheated (SEETHING) на нём не идут. При почти полном нагреве отдаём SEETHING.
 * Нагрев нагревателя 0..1: на ~6,8 кВт и выше он держится у 0,9+.
 */
@Mixin(targets = "com.george_vi.electroenergetics.content.resistive_heater.ResistiveHeaterBlockEntity", remap = false)
public abstract class ResistiveHeaterMixin {
    private static final float OVERHEAT_FROM = 0.9f;

    @Inject(method = "calculateHeatLevel", at = @At("RETURN"), cancellable = true, remap = false)
    private void ee_overheat$seething(float heat, CallbackInfoReturnable<HeatLevel> cir) {
        if (heat >= OVERHEAT_FROM) cir.setReturnValue(HeatLevel.SEETHING);
    }
}
