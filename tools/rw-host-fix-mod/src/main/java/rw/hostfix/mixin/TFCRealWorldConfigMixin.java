package rw.hostfix.mixin;

import net.neoforged.neoforge.server.ServerLifecycleHooks;
import net.yazloysasha.tfcrealworld.config.TFCRealWorldConfig;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import rw.hostfix.RwHostFix;

/**
 * TFC Real World 4.1.4 при выгрузке мира на клиенте (смена измерения, смерть) стирает настройки карты
 * (TFCRealWorld.onLevelUnload → clearServerConfig). Настройки — статические поля, общие для клиента и встроенного
 * сервера, поэтому в «мире хоста» стирались и серверные: карта откатывалась к 80 000 × 40 000, Eratosthenes считал
 * базу «за полюсом» и каждый тик переносил игроков к краю карты, новые чанки генерировались океаном.
 * Пока в этой же программе работает сервер, стирать не даём: при запуске мира сервер всё равно читает настройки
 * заново, а при входе на чужой сервер тот присылает свои. У гостя и на выделенном сервере ничего не меняется.
 * Миксин — на класс настроек, а не на TFCRealWorld: тот ссылается на классы клиента, и переписанный миксином
 * класс на выделенном сервере не загружается (проверено на сервере разработки).
 */
@Mixin(value = TFCRealWorldConfig.class, remap = false)
public class TFCRealWorldConfigMixin {
    @Inject(method = "clearServerConfig", at = @At("HEAD"), cancellable = true)
    private static void rwHostFix$keepServerConfig(CallbackInfo ci) {
        if (ServerLifecycleHooks.getCurrentServer() != null) {
            RwHostFix.LOGGER.debug("Настройки TFC Real World не стёрты: в программе работает встроенный сервер");
            ci.cancel();
        }
    }
}
