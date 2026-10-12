package org.spongepowered.asm.mixin.injection;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD)
public @interface Inject { String[] method() default {}; At[] at() default {}; boolean cancellable() default false; boolean remap() default true; }
