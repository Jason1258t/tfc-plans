package host.tools.mixin;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import host.tools.client.TabPing;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.PlayerTabOverlay;
import net.minecraft.client.multiplayer.PlayerInfo;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Constant;
import org.spongepowered.asm.mixin.injection.ModifyConstant;

/**
 * Пинг цифрами в табе слева от палочек. Ширина колонки в render: имя + счёт + 13 (место под палочки) — 13 один на
 * весь метод (байткод 1.21.1), к нему добавляется ширина цифр. Вызов renderPingIcon оборачивается, а не меняется
 * сам метод: Watut перенаправляет этот вызов (@Redirect) и у «отошедших» игроков рисует свой значок вместо палочек.
 */
@Mixin(PlayerTabOverlay.class)
public abstract class PlayerTabOverlayMixin {
    @Shadow @Final private Minecraft minecraft;

    @ModifyConstant(method = "render", constant = @Constant(intValue = 13))
    private int hosttools$widenForPing(int original) {
        return original + TabPing.extraWidth(minecraft);
    }

    @WrapOperation(method = "render", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/client/gui/components/PlayerTabOverlay;renderPingIcon(Lnet/minecraft/client/gui/GuiGraphics;IIILnet/minecraft/client/multiplayer/PlayerInfo;)V"))
    private void hosttools$drawPing(PlayerTabOverlay self, GuiGraphics graphics, int width, int x, int y, PlayerInfo info,
            Operation<Void> original) {
        original.call(self, graphics, width, x, y, info);
        TabPing.draw(graphics, minecraft.font, x + width - 11, y, info);
    }
}
