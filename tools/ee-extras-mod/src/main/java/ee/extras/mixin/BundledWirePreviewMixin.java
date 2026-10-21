package ee.extras.mixin;

import com.george_vi.electroenergetics.content.bundled_wire.BundledWireApplyingBehaviour;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNodeConnection;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

/**
 * Краш EE 1.1.2 в предпросмотре кабеля ({@code BundledWireApplyingBehaviour.tick}, его вызывает CableHud): один конец
 * кабеля уже выбран, взгляд — на блок без скрытого узла кабеля (земля, стена, клеммы), а рядом есть хоть один провод.
 * Тогда EE сравнивает с проводами мира «соединение» выбранного узла с узлом под взглядом, которого нет (null), —
 * NullPointerException в конструкторе InWorldNodeConnection, игра падает. Вместо него — соединение узла с самим собой:
 * такого провода не бывает, сравнение даёт «не совпало», как и должно без узла под взглядом.
 */
@Mixin(value = BundledWireApplyingBehaviour.class, remap = false)
public abstract class BundledWirePreviewMixin {
    @WrapOperation(method = "tick", at = @At(value = "NEW", target = "com/george_vi/electroenergetics/foundation/nodes/InWorldNodeConnection"))
    private static InWorldNodeConnection eeExtras$noHoveredNode(InWorldNode selected, InWorldNode hovered,
            Operation<InWorldNodeConnection> original) {
        return original.call(selected, hovered != null ? hovered : selected);
    }
}
