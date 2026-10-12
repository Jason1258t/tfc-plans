package org.spongepowered.asm.mixin;
import java.lang.annotation.*;
@Retention(RetentionPolicy.CLASS) @Target(ElementType.TYPE)
public @interface Mixin { Class<?>[] value() default {}; String[] targets() default {}; int priority() default 1000; boolean remap() default true; }
