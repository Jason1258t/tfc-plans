package ie.extras.mixin;

import com.simibubi.create.content.processing.basin.BasinBlockEntity;
import com.simibubi.create.content.processing.burner.BlazeBurnerBlock.HeatLevel;
import ie.extras.basin.BasinHeat;
import ie.extras.basin.BasinHeaters;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Чаша Create: тепло от нагревателей IE, аналогового и EE (BasinHeaters). getHeatSourceTemperature добавляет в чашу
 * миксин WoodenCog (приоритет 1000) — наш применяется после него (1100). Применяется, только если стоят Create и
 * WoodenCog (IeExtrasMixinPlugin).
 */
@Mixin(value = BasinBlockEntity.class, remap = false, priority = 1100)
public abstract class BasinBlockEntityMixin implements BasinHeat {
    @Unique
    private float ieExtras$externalTemperature;
    @Unique
    private long ieExtras$externalUntil;

    @Override
    public void ieExtras$setExternalHeat(float temperature, long until) {
        ieExtras$externalTemperature = temperature;
        ieExtras$externalUntil = until;
    }

    @Override
    public float ieExtras$externalHeat(long now) {
        return now <= ieExtras$externalUntil ? ieExtras$externalTemperature : 0;
    }

    /** Температура для предметов TFC и рецептов WoodenCog, строка в очках инженера */
    @Inject(method = "getHeatSourceTemperature", at = @At("RETURN"), cancellable = true)
    private void ieExtras$temperature(CallbackInfoReturnable<Float> cir) {
        float t = BasinHeaters.temperature((BasinBlockEntity) (Object) this);
        if (t > cir.getReturnValueF()) cir.setReturnValue(t);
    }

    /** Уровень нагрева для рецептов Create (heated / superheated) */
    @Inject(method = "getHeatLevel", at = @At("RETURN"), cancellable = true)
    private void ieExtras$heatLevel(CallbackInfoReturnable<HeatLevel> cir) {
        HeatLevel own = BasinHeaters.heatLevel((BasinBlockEntity) (Object) this);
        if (own.ordinal() > cir.getReturnValue().ordinal()) cir.setReturnValue(own);
    }

    @Inject(method = "write", at = @At("TAIL"))
    private void ieExtras$write(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket, CallbackInfo ci) {
        if (ieExtras$externalUntil > 0) {
            tag.putFloat("ieExtrasHeat", ieExtras$externalTemperature);
            tag.putLong("ieExtrasHeatUntil", ieExtras$externalUntil);
        }
    }

    @Inject(method = "read", at = @At("TAIL"))
    private void ieExtras$read(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket, CallbackInfo ci) {
        ieExtras$externalTemperature = tag.getFloat("ieExtrasHeat");
        ieExtras$externalUntil = tag.getLong("ieExtrasHeatUntil");
    }
}
